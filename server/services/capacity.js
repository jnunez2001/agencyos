// Joshua Nunez
// Capacity and workload: for each person and week, what they can carry (weekly capacity from their profile), what is
// planned (estimates of open tasks due that week plus the calendar events they attend) and what is logged, with an
// overload warning above 100 percent and an under-use note below 50. Weeks run Monday to Sunday, in UTC dates.
// Managers see everyone; anyone else sees only themselves.
const { ServiceError } = require('./errors');
const { cleanDate } = require('./validate');
const { today, addDays } = require('./dates');
const perms = require('./permissions');

const MAX_WEEKS = 8;
const UNDER = 50;
const OVER = 100;
const DAY_MS = 86400000;
const round2 = (n) => Math.round(n * 100) / 100;

const mondayOf = (date) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

// The hours of a working day from a profile: end minus start, or 8 when the times do not make sense.
function dayHours(start, end) {
  const toH = (t) => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? Number(m[1]) + Number(m[2]) / 60 : null; };
  const a = toH(start); const b = toH(end);
  return a !== null && b !== null && b > a ? b - a : 8;
}

// Hours of one calendar event inside [from, toExclusive) (UTC dates), for one person.
function eventHours(e, from, to, person) {
  if (e.allDay) {
    // Each working day the event covers counts as a full working day.
    let hours = 0;
    for (let d = e.startsAt > from ? e.startsAt : from; d <= e.endsAt && d <= to; d = addDays(d, 1)) {
      const dow = ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
      if (person.workDays.includes(dow)) hours += person.dayHours;
    }
    return hours;
  }
  const start = Math.max(Date.parse(e.startsAt), Date.parse(`${from}T00:00:00Z`));
  const end = Math.min(Date.parse(e.endsAt), Date.parse(`${to}T00:00:00Z`) + DAY_MS);
  return end > start ? (end - start) / 3600000 : 0;
}

function peopleOf(db, ctx, userId) {
  const team = perms.can(ctx.actor.role, 'time.view_team');
  const rows = db.prepare(
    `SELECT u.id, u.display_name AS displayName, m.role, COALESCE(p.weekly_capacity_hours, 40) AS capacityHours,
            COALESCE(p.work_days, '1,2,3,4,5') AS workDays, COALESCE(p.work_start, '09:00') AS workStart, COALESCE(p.work_end, '17:00') AS workEnd
       FROM organization_members m
       JOIN users u ON u.id = m.user_id AND u.is_active = 1
       LEFT JOIN employee_profiles p ON p.user_id = u.id AND p.organization_id = m.organization_id
      WHERE m.organization_id = ? ORDER BY m.id`
  ).all(ctx.organizationId).map((r) => ({ ...r, workDays: String(r.workDays).split(',').map(Number), dayHours: dayHours(r.workStart, r.workEnd) }));
  if (!team) return rows.filter((r) => r.id === ctx.actor.id);
  if (userId) {
    const one = rows.filter((r) => r.id === Number(userId));
    if (!one.length) throw new ServiceError(404, 'Member not found');
    return one;
  }
  return rows;
}

function noteFor(status, util, capacity, load) {
  if (status === 'over') return `Over capacity by ${round2(load - capacity)} hours`;
  if (status === 'under') return `Only ${util} percent of capacity is planned or logged`;
  return '';
}

// Capacity for `weeks` weeks starting at the Monday of `weekStart` (this week when empty).
function workloadCapacity(db, ctx, { weekStart, weeks, userId } = {}) {
  if (!perms.can(ctx.actor.role, 'time.log')) throw new ServiceError(403, 'Not allowed');
  const given = cleanDate(weekStart, 'Week start');
  const first = mondayOf(given || today(db, ctx));
  const count = weeks === undefined || weeks === '' || weeks === null ? 1 : Number(weeks);
  if (!Number.isInteger(count) || count < 1 || count > MAX_WEEKS) throw new ServiceError(400, `Ask for 1 to ${MAX_WEEKS} weeks`);
  const people = peopleOf(db, ctx, userId);
  const ids = people.map((p) => p.id);
  const last = addDays(first, count * 7 - 1);
  const mark = ids.map(() => '?').join(',');

  const taskRows = ids.length ? db.prepare(`SELECT assignee_id AS userId, due_date AS dueDate, estimate_hours AS hours FROM tasks WHERE organization_id = ? AND status != 'done' AND estimate_hours IS NOT NULL AND due_date BETWEEN ? AND ? AND assignee_id IN (${mark})`).all(ctx.organizationId, first, last, ...ids) : [];
  const eventRows = ids.length ? db.prepare(
    `SELECT a.user_id AS userId, e.starts_at AS startsAt, e.ends_at AS endsAt, e.all_day AS allDay
       FROM events e JOIN event_attendees a ON a.event_id = e.id
      WHERE e.organization_id = ? AND e.status != 'cancelled' AND e.type != 'deadline' AND substr(e.starts_at, 1, 10) <= ? AND substr(e.ends_at, 1, 10) >= ? AND a.user_id IN (${mark})`
  ).all(ctx.organizationId, last, first, ...ids).map((r) => ({ ...r, allDay: !!r.allDay })) : [];
  const timeRows = ids.length ? db.prepare(`SELECT user_id AS userId, entry_date AS date, minutes FROM time_entries WHERE organization_id = ? AND status != 'rejected' AND entry_date BETWEEN ? AND ? AND user_id IN (${mark})`).all(ctx.organizationId, first, last, ...ids) : [];

  const out = [];
  for (let w = 0; w < count; w++) {
    const from = addDays(first, w * 7); const to = addDays(from, 6);
    const rows = people.map((p) => {
      const taskHours = round2(taskRows.filter((t) => t.userId === p.id && t.dueDate >= from && t.dueDate <= to).reduce((s, t) => s + t.hours, 0));
      const events = round2(eventRows.filter((e) => e.userId === p.id).reduce((s, e) => s + eventHours(e, from, to, p), 0));
      const logged = round2(timeRows.filter((t) => t.userId === p.id && t.date >= from && t.date <= to).reduce((s, t) => s + t.minutes, 0) / 60);
      const planned = round2(taskHours + events);
      const load = Math.max(planned, logged);
      const util = p.capacityHours > 0 ? Math.round((load / p.capacityHours) * 100) : null;
      const status = util === null ? 'ok' : util > OVER ? 'over' : util < UNDER ? 'under' : 'ok';
      return { userId: p.id, displayName: p.displayName, role: p.role, capacityHours: p.capacityHours, taskHours, eventHours: events, plannedHours: planned, loggedHours: logged, utilizationPercent: util, status, note: noteFor(status, util, p.capacityHours, load) };
    });
    out.push({ weekStart: from, weekEnd: to, people: rows });
  }
  return { weekStart: first, weekEnd: last, weeks: out };
}

module.exports = { MAX_WEEKS, mondayOf, workloadCapacity };
