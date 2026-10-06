// Joshua Nunez
// Search across the whole agency. Every group follows the visibility rule of the service that owns the records, so
// a person never finds what they could not open: a Contractor finds only their own tasks, events they attend or
// created, notes they wrote or attend, and follow-ups assigned to them. Services that can search do the matching
// themselves; clients, projects and team members are filtered here. Every query is scoped by the organization.
const { ServiceError } = require('./errors');
const perms = require('./permissions');
const clients = require('./clients');
const projects = require('./projects');
const tasks = require('./tasks');
const sops = require('./sops');
const meetingnotes = require('./meetingnotes');
const requests = require('./requests');
const decisions = require('./decisions');
const followups = require('./followups');
const members = require('./members');

const MIN_LENGTH = 2;
const MAX_LENGTH = 100;
const PER_GROUP = 8;

const STATUS = { lead: 'Lead', onboarding: 'Onboarding', active: 'Active', paused: 'Paused', at_risk: 'At risk', completed: 'Completed', archived: 'Archived', planning: 'Planning', on_hold: 'On hold', todo: 'To do', in_progress: 'In progress', review: 'In QA', changes: 'Changes requested', done: 'Done', draft: 'Draft', testing: 'Testing', approved: 'Approved', deprecated: 'Deprecated', final: 'Final', new: 'New', reviewing: 'Reviewing', waiting: 'Waiting', rejected: 'Rejected', reversed: 'Reversed', open: 'Open', cancelled: 'Cancelled', scheduled: 'Scheduled' };
const EVENT_TYPE = { client_meeting: 'Client meeting', internal_meeting: 'Internal meeting', team_meeting: 'Team meeting', deadline: 'Deadline', follow_up: 'Follow-up', review: 'Review', sop_review: 'SOP review', training: 'Training', blocked_time: 'Blocked time' };
const ROLE = { owner: 'Owner', admin: 'Admin', manager: 'Manager', employee: 'Employee', contractor: 'Contractor' };
const label = (s) => STATUS[s] || s;
const join = (...parts) => parts.filter(Boolean).join(', ');

const need = (ctx, action) => { if (!perms.can(ctx.actor.role, action)) throw new ServiceError(403, 'Not allowed'); };
const allowed = (ctx, action) => perms.can(ctx.actor.role, action);

// Plain case-insensitive text match, so % and _ are ordinary characters.
const matcher = (q) => { const needle = q.toLowerCase(); return (...fields) => fields.some((f) => f != null && String(f).toLowerCase().includes(needle)); };
const like = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

const eventsMatching = (db, ctx, q, limit) => {
  const sees = allowed(ctx, 'clients.view');
  const rows = db.prepare(`SELECT e.id, e.title, e.type, e.starts_at AS startsAt, e.status FROM events e
     WHERE e.organization_id = ? AND (e.title LIKE ? ESCAPE '\\' OR e.location LIKE ? ESCAPE '\\')${sees ? '' : ' AND (e.created_by = ? OR EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = ?))'}
     ORDER BY e.starts_at DESC, e.id DESC LIMIT ?`).all(ctx.organizationId, like(q), like(q), ...(sees ? [] : [ctx.actor.id, ctx.actor.id]), limit);
  return rows;
};

// Finds the records matching `q` that this person may see, grouped by kind. Returns { query, groups }.
function search(db, ctx, q, { limit } = {}) {
  need(ctx, 'org.view');
  const text = String(q === undefined || q === null ? '' : q).trim().slice(0, MAX_LENGTH);
  if (text.length < MIN_LENGTH) throw new ServiceError(400, `Type at least ${MIN_LENGTH} characters to search`);
  const cap = Math.min(Math.max(Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : PER_GROUP, 1), PER_GROUP);
  const match = matcher(text);
  const groups = [];
  const add = (type, name, action, rows) => {
    if (!allowed(ctx, action)) return;
    const results = rows().slice(0, cap);
    if (results.length) groups.push({ type, label: name, results });
  };

  add('client', 'Clients', 'clients.view', () => clients.listClients(db, ctx).filter((c) => match(c.name, c.website, c.industry))
    .map((c) => ({ type: 'client', id: c.id, title: c.name, subtitle: label(c.status), hash: `#/clients/${c.id}` })));
  add('project', 'Projects', 'projects.view', () => projects.listProjects(db, ctx).filter((p) => match(p.name, p.clientName))
    .map((p) => ({ type: 'project', id: p.id, title: p.name, subtitle: join(p.clientName, label(p.status)), hash: `#/projects/${p.id}` })));
  add('task', 'Tasks', 'tasks.view', () => tasks.listTasks(db, ctx, { q: text })
    .map((t) => ({ type: 'task', id: t.id, title: t.title, subtitle: join(t.projectName, label(t.status)), hash: `#/tasks/${t.id}` })));
  add('sop', 'SOPs', 'sops.view', () => sops.listSops(db, ctx, { q: text })
    .map((s) => ({ type: 'sop', id: s.id, title: s.title, subtitle: join(s.service, label(s.status)), hash: `#/sops/${s.id}` })));
  add('note', 'Meeting notes', 'notes.view', () => meetingnotes.listNotes(db, ctx, { q: text })
    .map((n) => ({ type: 'note', id: n.id, title: n.title, subtitle: join(n.meetingDate, n.clientName), hash: `#/meetings/${n.id}` })));
  add('request', 'Client requests', 'requests.view', () => requests.listRequests(db, ctx, { q: text })
    .map((r) => ({ type: 'request', id: r.id, title: r.title, subtitle: join(r.clientName, label(r.status)), hash: `#/requests/${r.id}` })));
  add('decision', 'Decisions', 'decisions.view', () => decisions.listDecisions(db, ctx, { q: text })
    .map((d) => ({ type: 'decision', id: d.id, title: d.title, subtitle: join(d.decidedOn, label(d.status)), hash: "#/meetings/decisions" })));
  add('follow_up', 'Follow-ups', 'followups.view', () => followups.listFollowUps(db, ctx, { q: text })
    .map((f) => ({ type: 'follow_up', id: f.id, title: f.title, subtitle: join(f.assigneeName, f.dueDate ? `due ${f.dueDate}` : '', label(f.status)), hash: "#/meetings/follow-ups" })));
  add('event', 'Events', 'events.view', () => eventsMatching(db, ctx, text, cap)
    .map((e) => ({ type: 'event', id: e.id, title: e.title, subtitle: join(EVENT_TYPE[e.type] || e.type, e.startsAt.slice(0, 10)), hash: `#/calendar/${e.id}` })));
  add('member', 'Team', 'members.list', () => members.listMembers(db, ctx).filter((m) => m.isActive && match(m.displayName, m.username, m.jobTitle, m.department))
    .map((m) => ({ type: 'member', id: m.id, title: m.displayName, subtitle: join(ROLE[m.role] || m.role, m.jobTitle), hash: '#/team' })));
  return { query: text, groups };
}

module.exports = { search, MIN_LENGTH, PER_GROUP };
