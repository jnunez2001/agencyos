// Joshua Nunez
// Seeds a scratch in-memory database with a few thousand rows, runs the main list and dashboard reads through the real
// services, and prints how long each took and how SQLite plans every query it ran (EXPLAIN QUERY PLAN), so a full scan
// of a big table shows up. It never touches real data. Usage:
//   node scripts/perf-check.js                     with every index (including database/migrations/021_indexes.sql)
//   node scripts/perf-check.js --without-indexes   the same data with the indexes of 021 dropped, to see what they buy
//   node scripts/perf-check.js --scale=2           twice the rows
//   node scripts/perf-check.js --plans             also print every line of every plan
const fs = require('fs');
const path = require('path');
const { openDb } = require('../server/db');
const orgs = require('../server/services/organizations');
const members = require('../server/services/members');
const tasks = require('../server/services/tasks');
const timeentries = require('../server/services/timeentries');
const meetingnotes = require('../server/services/meetingnotes');
const requests = require('../server/services/requests');
const followups = require('../server/services/followups');
const decisions = require('../server/services/decisions');
const events = require('../server/services/events');
const activity = require('../server/services/activity');
const search = require('../server/services/search');
const workspace = require('../server/services/workspace');
const dashboard = require('../server/services/dashboard');
const capacity = require('../server/services/capacity');
const notifications = require('../server/services/notifications');
const timeline = require('../server/services/timeline');
const projects = require('../server/services/projects');
const clients = require('../server/services/clients');

const args = process.argv.slice(2);
const without = args.includes('--without-indexes');
const showPlans = args.includes('--plans');
const scale = Number((args.find((a) => a.startsWith('--scale=')) || '--scale=1').split('=')[1]) || 1;
const N = (n) => Math.round(n * scale);

const pick = (list, i) => list[i % list.length];
const day = (n) => new Date(Date.UTC(2026, 9, 7) + n * 86400000).toISOString().slice(0, 10);
const WORDS = ['website', 'audit', 'schema', 'backlinks', 'landing', 'keywords', 'report', 'redesign', 'content', 'local', 'citations', 'speed'];
const sentence = (i, n = 12) => Array.from({ length: n }, (_, k) => WORDS[(i * 7 + k * 3) % WORDS.length]).join(' ');

async function seed(db) {
  const a = await orgs.createOrganization(db, { organizationName: 'Big Agency', displayName: 'Owner', username: 'bigowner', password: 'correct horse battery' });
  const b = await orgs.createOrganization(db, { organizationName: 'Small Agency', displayName: 'Zed', username: 'zed', password: 'correct horse battery' });
  const ctx = (id, role, org = a.organizationId) => ({ organizationId: org, actor: { id, role }, ip: '127.0.0.1', source: 'web' });
  const owner = ctx(a.userId, 'owner');
  const users = [a.userId];
  const roles = ['manager', 'manager', 'employee', 'employee', 'employee', 'employee', 'contractor', 'contractor'];
  for (let i = 0; i < roles.length; i += 1) users.push((await members.createMember(db, owner, { username: `user${i}`, displayName: `User ${i}`, role: roles[i], password: 'correct horse battery' })).id);
  db.prepare('UPDATE users SET must_change_password = 0').run();
  const org = a.organizationId;
  const who = { owner, manager: ctx(users[1], 'manager'), employee: ctx(users[3], 'employee'), contractor: ctx(users[7], 'contractor') };
  const insert = (sql, rows) => { const st = db.prepare(sql); db.transaction(() => { for (const r of rows) st.run(...r); })(); };
  const range = (n) => Array.from({ length: n }, (_, i) => i);

  insert('INSERT INTO clients (organization_id, name, status, account_owner_id) VALUES (?, ?, ?, ?)', range(N(60)).map((i) => [org, `Client ${i}`, pick(['active', 'active', 'paused', 'lead'], i), pick(users, i)]));
  const clientIds = db.prepare('SELECT id FROM clients WHERE organization_id = ?').all(org).map((r) => r.id);
  insert('INSERT INTO projects (organization_id, client_id, name, status, manager_id) VALUES (?, ?, ?, ?, ?)', range(N(240)).map((i) => [org, pick(clientIds, i), `Project ${i} ${sentence(i, 2)}`, pick(['active', 'active', 'planning', 'completed'], i), pick(users, i)]));
  const projectIds = db.prepare('SELECT id FROM projects WHERE organization_id = ?').all(org).map((r) => r.id);
  insert('INSERT INTO tasks (organization_id, project_id, title, description, status, priority, assignee_id, due_date, estimate_hours, completed_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    range(N(8000)).map((i) => { const st = pick(['todo', 'in_progress', 'done', 'done', 'review'], i); return [org, pick(projectIds, i * 3), `Task ${i} ${sentence(i, 4)}`, sentence(i, 20), st, pick(['low', 'normal', 'high', 'urgent'], i), pick(users, i), i % 5 ? day((i % 120) - 60) : null, (i % 8) + 1, st === 'done' ? `${day(-(i % 60))}T10:00:00Z` : null, users[0]]; }));
  const taskIds = db.prepare('SELECT id FROM tasks WHERE organization_id = ?').all(org).map((r) => r.id);
  insert('INSERT INTO time_entries (organization_id, user_id, entry_date, minutes, client_id, project_id, task_id, description, time_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    range(N(8000)).map((i) => [org, pick(users, i), day(-(i % 200)), 30 + (i % 5) * 30, pick(clientIds, i), pick(projectIds, i), pick(taskIds, i), sentence(i, 5), 'billable', pick(['draft', 'submitted', 'approved', 'approved', 'locked'], i)]));
  insert('INSERT INTO meeting_notes (organization_id, title, meeting_date, summary, discussion, decisions, requests, follow_ups, status, client_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    range(N(4000)).map((i) => [org, `Meeting ${i} ${sentence(i, 2)}`, day(-(i % 365)), sentence(i, 10), sentence(i + 1, 60), sentence(i + 2, 12), sentence(i + 3, 12), sentence(i + 4, 12), pick(['draft', 'final'], i), pick(clientIds, i), pick(users, i)]));
  insert('INSERT INTO client_requests (organization_id, client_id, project_id, title, description, status, owner_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    range(N(4000)).map((i) => [org, pick(clientIds, i), pick(projectIds, i), `Request ${i} ${sentence(i, 3)}`, sentence(i, 15), pick(['new', 'reviewing', 'in_progress', 'completed', 'completed'], i), pick(users, i), users[0]]));
  insert('INSERT INTO follow_ups (organization_id, client_id, title, details, due_date, assignee_id, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    range(N(4000)).map((i) => [org, pick(clientIds, i), `Follow-up ${i} ${sentence(i, 3)}`, sentence(i, 8), day((i % 90) - 45), pick(users, i), pick(['open', 'open', 'done'], i), users[0]]));
  insert('INSERT INTO decisions (organization_id, client_id, title, details, decided_on, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    range(N(3000)).map((i) => [org, pick(clientIds, i), `Decision ${i} ${sentence(i, 3)}`, sentence(i, 10), day(-(i % 300)), pick(['active', 'active', 'reversed'], i), users[0]]));
  insert('INSERT INTO events (organization_id, title, type, starts_at, ends_at, status, client_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    range(N(6000)).map((i) => [org, `Event ${i} ${sentence(i, 2)}`, pick(['client_meeting', 'internal_meeting', 'review'], i), `${day((i % 240) - 120)}T10:00:00Z`, `${day((i % 240) - 120)}T11:00:00Z`, 'scheduled', pick(clientIds, i), pick(users, i)]));
  const eventIds = db.prepare('SELECT id FROM events WHERE organization_id = ?').all(org).map((r) => r.id);
  insert('INSERT OR IGNORE INTO event_attendees (event_id, user_id) VALUES (?, ?)', eventIds.flatMap((id, i) => [[id, pick(users, i)], [id, pick(users, i + 3)]]));
  insert('INSERT INTO client_results (organization_id, client_id, metric, value, recorded_on, created_by) VALUES (?, ?, ?, ?, ?, ?)', range(N(4000)).map((i) => [org, pick(clientIds, i), `Metric ${i % 6}`, i % 100, day(-(i % 400)), users[0]]));
  insert('INSERT INTO activity_logs (organization_id, actor_user_id, action, object_type, object_id, after_json, source) VALUES (?, ?, ?, ?, ?, ?, ?)', range(N(30000)).map((i) => [org, pick(users, i), (i % 997 === 0 ? 'retainer.update' : pick(['task.update', 'time.create', 'client.update', 'login.success'], i)), 'task', pick(taskIds, i), '{"status":"done"}', 'web']));
  insert('INSERT INTO notifications (organization_id, user_id, type, title, link, read_at) VALUES (?, ?, ?, ?, ?, ?)', range(N(5000)).map((i) => [org, pick(users, i), 'task_assigned', `Task ${i}`, '#/tasks', i % 3 ? '2026-10-01T00:00:00Z' : null]));
  // a second, small agency, so the filter on the organization has something to skip
  insert('INSERT INTO clients (organization_id, name) VALUES (?, ?)', [[b.organizationId, 'Other client']]);
  db.exec('ANALYZE');
  return { who, users, clientId: clientIds[0], org };
}

// The indexes that 021 adds, so they can be dropped for the "before" run.
function indexesOf021() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '021_indexes.sql'), 'utf8');
  return [...sql.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
}

// Records every query the services run, with its parameters.
function recorder(db) {
  const calls = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const st = prepare(sql);
    return new Proxy(st, { get(t, k) {
      if (k === 'all' || k === 'get') return (...a) => { calls.push({ sql, params: a }); return t[k](...a); };
      const v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    } });
  };
  return { calls, restore: () => { db.prepare = prepare; } };
}

function planOf(db, sql, params) {
  try {
    return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => r.detail);
  } catch (err) { return [`(no plan: ${err.message})`]; }
}

async function main() {
  const db = openDb(':memory:');
  const t0 = Date.now();
  const seeded = await seed(db);
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  console.log(`Seeded in ${Date.now() - t0} ms: ${['tasks', 'time_entries', 'meeting_notes', 'client_requests', 'follow_ups', 'decisions', 'events', 'activity_logs', 'notifications', 'client_results'].map((t) => `${t} ${count(t)}`).join(', ')}`);
  if (without) { for (const name of indexesOf021()) db.exec(`DROP INDEX IF EXISTS ${name}`); db.exec('ANALYZE'); console.log('Indexes of 021_indexes.sql dropped (before).'); }
  else console.log('All indexes in place (after).');
  const { owner, manager, employee, contractor } = seeded.who;
  const cid = seeded.clientId;
  const today = '2026-10-07';
  const withDay = (c) => ({ ...c, today });
  const steps = [
    ['tasks: all (owner)', () => tasks.listTasks(db, withDay(owner))],
    ['tasks: mine, in progress', () => tasks.listTasks(db, withDay(owner), { mine: '1', status: 'in_progress' })],
    ['tasks: one project', () => tasks.listTasks(db, withDay(owner), { projectId: 3 })],
    ['tasks: overdue', () => tasks.listTasks(db, withDay(owner), { overdue: '1' })],
    ['tasks: text search', () => tasks.listTasks(db, withDay(owner), { q: 'audit' })],
    ['tasks: contractor', () => tasks.listTasks(db, withDay(contractor))],
    ['time: team, submitted', () => timeentries.listEntries(db, withDay(manager), { status: 'submitted' })],
    ['time: team, one week', () => timeentries.listEntries(db, withDay(manager), { from: '2026-09-28', to: '2026-10-04' })],
    ['time: my week', () => timeentries.listEntries(db, withDay(employee), { mine: true, from: '2026-10-05', to: '2026-10-11' })],
    ['time: one client', () => timeentries.listEntries(db, withDay(manager), { clientId: cid })],
    ['notes: list', () => meetingnotes.listNotes(db, owner)],
    ['notes: text search', () => meetingnotes.listNotes(db, owner, { q: 'backlinks' })],
    ['notes: one client', () => meetingnotes.listNotes(db, owner, { clientId: cid })],
    ['notes: contractor', () => meetingnotes.listNotes(db, contractor)],
    ['requests: open', () => requests.listRequests(db, owner, { open: '1' })],
    ['requests: all', () => requests.listRequests(db, owner)],
    ['requests: one client', () => requests.listRequests(db, owner, { clientId: cid })],
    ['follow-ups: open', () => followups.listFollowUps(db, withDay(owner), { status: 'open' })],
    ['follow-ups: overdue', () => followups.listFollowUps(db, withDay(owner), { overdue: '1' })],
    ['follow-ups: contractor', () => followups.listFollowUps(db, withDay(contractor))],
    ['decisions: list', () => decisions.listDecisions(db, owner)],
    ['calendar: a month', () => events.calendar(db, withDay(owner), { from: '2026-10-01', to: '2026-10-31' })],
    ['calendar: a month (contractor)', () => events.calendar(db, withDay(contractor), { from: '2026-10-01', to: '2026-10-31' })],
    ['activity: latest', () => activity.listActivity(db, owner, { limit: 50 })],
    ['activity: a rare action', () => activity.listActivity(db, owner, { action: 'retainer.update' })],
    ['activity: one person', () => activity.listActivity(db, owner, { actorId: seeded.users[2] })],
    ['search: a word', () => search.search(db, withDay(owner), 'audit')],
    ['workspace (owner)', () => workspace.getWorkspace(db, withDay(owner))],
    ['workspace (employee)', () => workspace.getWorkspace(db, withDay(employee))],
    ['dashboard (owner)', () => dashboard.getDashboard(db, withDay(owner))],
    ['capacity: this week', () => capacity.workloadCapacity(db, withDay(manager), { weekStart: '2026-10-05', weeks: 4 })],
    ['notifications: unread', () => notifications.listNotifications(db, owner, { unread: true })],
    ['clients: list', () => clients.listClients(db, owner)],
    ['projects: list', () => projects.listProjects(db, owner)],
    ['client timeline (7 days)', () => timeline.clientTimeline(db, { ...owner, now: '2026-10-07T12:00:00Z' }, cid, { days: 7 })],
  ];
  const rows = [];
  for (const [name, run] of steps) {
    run(); // warm up
    const rec = recorder(db);
    const times = [];
    let size = 0;
    for (let i = 0; i < 5; i += 1) { const s = process.hrtime.bigint(); const out = run(); times.push(Number(process.hrtime.bigint() - s) / 1e6); size = Array.isArray(out) ? out.length : out && out.groups ? out.groups.length : 1; }
    rec.restore();
    const seen = new Map();
    for (const c of rec.calls) if (/^\s*SELECT/i.test(c.sql) && !seen.has(c.sql)) seen.set(c.sql, c);
    const scans = [];
    for (const { sql, params } of seen.values()) {
      // a plan names tables by their alias in the query; map it back, and ignore small tables (a scan of ten rows is fine)
      const table = {};
      for (const m of sql.matchAll(/(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(?!LEFT|JOIN|ON|WHERE|INNER|GROUP|ORDER)(\w+))?/gi)) table[m[2] || m[1]] = m[1];
      for (const line of planOf(db, sql, params)) {
        if (showPlans) console.log(`  [${name}] ${line}`);
        const m = /^SCAN (\w+)(?!.*USING)/.exec(line);
        if (!m || /^(sqlite_|json_)/.test(m[1])) continue;
        const real = table[m[1]] || m[1];
        let rows = 0;
        try { rows = db.prepare(`SELECT COUNT(*) AS n FROM ${real}`).get().n; } catch { rows = 1e9; }
        if (rows >= 1000) scans.push(`SCAN ${real} (${rows} rows)`);
      }
    }
    times.sort((x, y) => x - y);
    rows.push({ name, ms: times[2], size, scans: [...new Set(scans)] });
  }
  const width = Math.max(...rows.map((r) => r.name.length));
  console.log(`\n${'workload'.padEnd(width)}  median ms  rows  full scans`);
  for (const r of rows) console.log(`${r.name.padEnd(width)}  ${r.ms.toFixed(2).padStart(9)}  ${String(r.size).padStart(4)}  ${r.scans.length ? r.scans.join('; ') : '-'}`);
  const total = rows.reduce((s, r) => s + r.ms, 0);
  console.log(`\nTotal of medians: ${total.toFixed(1)} ms; steps with a full scan: ${rows.filter((r) => r.scans.length).length} of ${rows.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
