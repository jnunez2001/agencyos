// Joshua Nunez
// "Today" as a calendar date in the agency's timezone, so due dates and "overdue" mean the same for everyone.
function todayIn(timeZone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
  } catch { /* fall through to UTC */ }
  return now.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The context may carry a fixed `today` (tests); otherwise it is worked out from the agency's timezone.
function today(db, ctx) {
  if (ctx.today) return ctx.today;
  const org = db.prepare('SELECT timezone FROM organizations WHERE id = ?').get(ctx.organizationId);
  return todayIn(org && org.timezone);
}

module.exports = { todayIn, addDays, today };
