// Joshua Nunez
import { h } from '../dom.js';
import { api } from '../api.js';
import { avatar, formatWhen, selectField } from '../ui.js';

// What each action reads as in a sentence. An unknown action shows its own name.
const SENTENCE = {
  'organization.setup': 'set up the agency',
  'organization.update': 'changed the agency settings',
  'member.create': 'added a member',
  'member.update': 'changed a member',
  'member.reset_password': 'reset a password',
  'profile.update': 'updated a profile',
  'password.change': 'changed their password',
  'client.create': 'added a client',
  'client.update': 'changed a client',
  'contact.create': 'added a client contact',
  'contact.update': 'changed a client contact',
  'contact.delete': 'removed a client contact',
  'project.create': 'added a project',
  'project.update': 'changed a project',
  'task.create': 'added a task',
  'task.update': 'changed a task',
  'task.delete': 'deleted a task',
  'task.comment': 'commented on a task',
  'apikey.create': 'created an AI key',
  'apikey.update': 'changed an AI key',
  'apikey.revoke': 'revoked an AI key',
  'ai.proposal.create': 'sent changes to the AI inbox',
  'ai.proposal.approve': 'approved changes from the AI inbox',
  'ai.proposal.reject': 'rejected changes from the AI inbox',
  'ai.proposal.fail': 'could not apply approved changes',
  'service.create': 'added a service',
  'service.update': 'changed a service',
  'goal.create': 'added a client goal',
  'goal.update': 'changed a client goal',
  'result.create': 'recorded a result',
  'result.update': 'changed a result',
  'result.delete': 'deleted a result',
  'report.create': 'created a report',
  'report.generate': 'generated a report draft',
  'report.update': 'changed a report',
  'report.approve': 'approved a report',
  'report.delete': 'deleted a report',
  'sop.create': 'added an SOP',
  'sop.update': 'changed an SOP',
  'sop.version': 'added an SOP version',
  'time.create': 'logged time',
  'time.update': 'changed logged time',
  'time.delete': 'deleted logged time',
  'time.submit': 'submitted time for approval',
  'time.approve': 'approved time',
  'time.reject': 'rejected time',
  'time.lock': 'locked time',
  'time.timer.start': 'started a timer',
  'time.timer.pause': 'paused a timer',
  'time.timer.resume': 'resumed a timer',
  'time.timer.stop': 'stopped a timer',
  'retainer.create': 'set up a client retainer',
  'retainer.update': 'changed a client retainer',
  'qa.submit': 'submitted a task for QA',
  'qa.approve': 'approved a task in QA',
  'qa.request_changes': 'requested changes in QA',
  'oauth.connect': 'connected an AI app',
  'oauth.refresh_reuse': 'had an AI connection ended after a reused token',
  'login.success': 'signed in',
  'login.failed': 'had a failed sign-in',
  'login.locked': 'was locked out after too many tries',
};

const FIELD = { role: 'Role', displayName: 'Name', isActive: 'Active', name: 'Name', timezone: 'Timezone', username: 'Username', jobTitle: 'Job title', department: 'Department', workDays: 'Working days', metric: 'Metric', value: 'Value', unit: 'Unit', recordedOn: 'Date', periodStart: 'Period start', periodEnd: 'Period end', executiveSummary: 'Executive summary', workCompleted: 'Work completed', keyResults: 'Key results', importantChanges: 'Important changes', problemsRisks: 'Problems and risks', nextPriorities: 'Next priorities', recommendations: 'Recommendations', services: 'Services', accountOwnerId: 'Account owner', goalId: 'Goal', why: 'Why', target: 'Target', requiresQa: 'Needs QA', qaRequired: 'Needs QA', sopId: 'SOP', version: 'Version', changeNote: 'Note', access: 'Access', title: 'Title', description: 'Description', status: 'Status', priority: 'Priority', dueDate: 'Due date', startDate: 'Start date', estimateHours: 'Estimate', website: 'Website', industry: 'Industry', notes: 'Notes', email: 'Email', phone: 'Phone', roleTitle: 'Role', isPrimary: 'Primary', assigneeId: 'Assignee', managerId: 'Manager', projectId: 'Project', clientId: 'Client', workStart: 'Start', workEnd: 'End', weeklyCapacityHours: 'Capacity', minutes: 'Minutes', timeType: 'Type', reviewNote: 'Review note', hoursAllocated: 'Hours', timerState: 'Timer' };
const show = (v) => (v == null ? 'none' : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));

const LONG = new Set(['description', 'notes', 'why', 'executiveSummary', 'workCompleted', 'keyResults', 'importantChanges', 'problemsRisks', 'nextPriorities', 'recommendations']); // long text and ids are not worth printing
const ID = new Set(['assigneeId', 'managerId', 'projectId', 'clientId', 'sopId', 'ownerId', 'goalId', 'accountOwnerId', 'serviceId']);
// "Role: employee to manager" for each field that changed. Ids carry no meaning on their own, so a new record skips them.
function changes(row) {
  const after = row.after || {};
  const before = row.before || {};
  return Object.keys(after).filter((k) => FIELD[k] && !(ID.has(k) && !row.before)).map((k) => (LONG.has(k) || ID.has(k) ? `${FIELD[k]} changed` : k in before ? `${FIELD[k]}: ${show(before[k])} to ${show(after[k])}` : `${FIELD[k]}: ${show(after[k])}`));
}

let filter = { actorId: '', action: '' };

export async function activityView(session, { rerender }) {
  const query = new URLSearchParams();
  if (filter.actorId) query.set('actorId', filter.actorId);
  if (filter.action) query.set('action', filter.action);
  const [rows, people] = await Promise.all([api('GET', `/activity?${query}`), api('GET', '/members')]);
  const who = selectField('Person', [['', 'Everyone'], ...people.map((m) => [m.id, m.displayName])], filter.actorId, { 'aria-label': 'Person' });
  const what = selectField('Action', [['', 'Everything'], ...Object.entries(SENTENCE).map(([k, v]) => [k, v])], filter.action, { 'aria-label': 'Action' });
  who.input.addEventListener('change', () => { filter.actorId = who.input.value; rerender(); });
  what.input.addEventListener('change', () => { filter.action = what.input.value; rerender(); });
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', { class: 'page-title' }, 'Activity')),
    h('div', { class: 'filters' }, who.el, what.el),
    rows.length
      ? h('section', { class: 'panel list' }, rows.map((r) => h('div', { class: 'row static' },
        avatar({ id: r.actorId || 0, displayName: r.actorName }, 'md'),
        h('div', { class: 'grow' },
          h('div', { class: 'row-title' }, `${r.actorName} ${SENTENCE[r.action] || r.action}`, r.source === 'ai' && h('span', { class: 'pill ai' }, 'AI')),
          changes(r).length ? h('div', { class: 'row-sub' }, changes(r).join(' · ')) : null),
        h('span', { class: 'muted nowrap' }, formatWhen(r.createdAt)))))
      : h('section', { class: 'panel' }, h('p', { class: 'muted' }, 'Nothing here yet.')));
}
