// Joshua Nunez
// The MCP server: JSON-RPC 2.0 over POST /mcp with a Bearer API key. It exposes tools that call the same services
// as the screens, as the person who owns the key. Reads work for every key; writes go through plans (aiplans.js).
const apikeys = require('./services/apikeys');
const plans = require('./services/aiplans');
const clients = require('./services/clients');
const projects = require('./services/projects');
const tasks = require('./services/tasks');
const events = require('./services/events');
const meetingnotes = require('./services/meetingnotes');
const requests = require('./services/requests');
const decisions = require('./services/decisions');
const followups = require('./services/followups');
const notifications = require('./services/notifications');
const noterecords = require('./services/noterecords');
const workspace = require('./services/workspace');
const timeentries = require('./services/timeentries');
const capacity = require('./services/capacity');
const retainers = require('./services/retainers');
const members = require('./services/members');
const dashboard = require('./services/dashboard');
const search = require('./services/search');
const sops = require('./services/sops');
const qa = require('./services/qa');
const sopchanges = require('./services/sopchanges');
const services = require('./services/services');
const goals = require('./services/goals');
const results = require('./services/results');
const reports = require('./services/reports');
const { ServiceError } = require('./services/errors');
const { originOf } = require('./oauthRoutes');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const RATE = { windowMs: 60 * 1000, max: 120 };
// ChatGPT reads this to know a tool needs the OAuth sign-in. Other clients ignore it.
const SECURITY = [{ type: 'oauth2', scopes: ['mcp'] }];

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'integer', description });

const CLIENT_FIELDS = { name: str('Client name'), status: { type: 'string', enum: ['lead', 'onboarding', 'active', 'paused', 'at_risk', 'completed', 'archived'] }, accountOwnerId: num('Team member id'), startDate: str('YYYY-MM-DD'), serviceIds: { type: 'array', items: { type: 'integer' }, description: 'Service ids from list_services' }, website: str('Website'), industry: str('Industry'), notes: str('Notes') };
const PROJECT_FIELDS = { serviceId: num('Service id'), goalId: num('A goal of the same client'), name: str('Project name'), description: str('Description'), status: { type: 'string', enum: ['planning', 'active', 'on_hold', 'completed', 'archived'] }, startDate: str('YYYY-MM-DD'), dueDate: str('YYYY-MM-DD'), managerId: num('Team member id') };
const TASK_FIELDS = { goalId: num('A goal of the same client'), sopId: num('SOP to follow (testing or approved)'), qaRequired: { type: 'boolean' }, title: str('Task title'), description: str('Description'), status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, assigneeId: num('Team member id'), dueDate: str('YYYY-MM-DD'), estimateHours: { type: 'number' } };

const EVENT_TYPES = ['client_meeting', 'internal_meeting', 'team_meeting', 'deadline', 'follow_up', 'review', 'sop_review', 'training', 'blocked_time'];
const EVENT_FIELDS = { title: str('Event title'), type: { type: 'string', enum: EVENT_TYPES }, startsAt: str('Start in UTC like 2026-10-12T14:00:00Z, or a date YYYY-MM-DD when allDay'), endsAt: str('End, same format as startsAt'), allDay: { type: 'boolean' }, location: str('Location or meeting link'), notes: str('Notes'), status: { type: 'string', enum: ['scheduled', 'completed', 'cancelled'] }, clientId: num('Client id'), projectId: num('Project id'), taskId: num('Task id (sets its project and client)'), attendees: { type: 'array', items: { type: 'integer' }, description: 'Team member ids' } };

const NOTE_FIELDS = { title: str('Meeting title (defaults to the event title)'), meetingDate: str('YYYY-MM-DD (defaults to the event date)'), eventId: num('The calendar event this note is for (one note per event)'), clientId: num('Client id'), projectId: num('Project id'), summary: str('Short summary'), agenda: str('Agenda'), discussion: str('What was discussed'), decisions: str('Decisions made, one per line'), requests: str('Requests from the client, one per line'), followUps: str('Follow-ups, one per line'), transcript: str('The raw transcript or rough notes of the meeting') };

const REQUEST_FIELDS = { title: str('What the client asks for'), description: str('Details'), clientId: num('Client id'), projectId: num('Project id of the same client'), requestedBy: str('Who asked, such as the contact name'), dueDate: str('YYYY-MM-DD'), ownerId: num('Team member id'), status: { type: 'string', enum: ['new', 'reviewing', 'waiting', 'completed'], description: 'Approving, rejecting or starting work is for a person' } };
const DECISION_FIELDS = { title: str('What was decided'), details: str('Why, and the details'), decidedOn: str('YYYY-MM-DD'), status: { type: 'string', enum: ['active', 'reversed'] }, clientId: num('Client id'), projectId: num('Project id') };
const FOLLOWUP_FIELDS = { title: str('What must be followed up'), details: str('Details'), dueDate: str('YYYY-MM-DD'), assigneeId: num('Team member id'), status: { type: 'string', enum: ['open', 'done', 'cancelled'] }, clientId: num('Client id'), projectId: num('Project id') };

const SOPCHANGE_FIELDS = { title: str('Short name of the change'), details: str('What should change and why'), proposedText: str('Proposed wording, optional'), proposedContent: { type: 'object', description: 'Optional new version content (purpose, whenToUse, inputs, steps, checklist, expectedOutput, commonMistakes, examples). A person applies it by publishing' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, status: { type: 'string', enum: ['identified', 'needs_review'], description: 'Approving, rejecting, starting, testing and publishing are for a person' }, sourceType: { type: 'string', enum: ['task', 'qa_review', 'meeting_note', 'follow_up'] }, sourceId: num('Id of the task, QA review, meeting note or follow-up it came from') };
const TIME_TYPES = ['billable', 'non_billable', 'internal', 'meeting', 'training', 'admin'];
const TIME_FIELDS = { date: str('YYYY-MM-DD (default today)'), minutes: num('Minutes, 1 to 1440'), startedAt: str('Start in UTC like 2026-10-12T14:00:00Z, instead of minutes (give endedAt too)'), endedAt: str('End in UTC'), clientId: num('Client id'), projectId: num('Project id'), taskId: num('Task id (sets its project and client)'), description: str('What was done'), timeType: { type: 'string', enum: TIME_TYPES, description: 'Billable time needs a client' } };

const PLAN_NOTE = ' With a key that asks first, the change waits in the AI inbox until a person approves it.';
const asPlan = (summary, action, args) => ({ summary, steps: [{ action, args }] });
const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

// name, description, input schema, whether it changes anything, and how to run it.
const TOOLS = [
  { name: 'list_clients', description: 'List the agency\'s clients with their services, optionally by status.', schema: obj({ status: { type: 'string', enum: ['lead', 'onboarding', 'active', 'paused', 'at_risk', 'completed', 'archived'] } }), run: (db, ctx, a) => clients.listClients(db, ctx, { status: a.status }) },
  { name: 'get_client', description: 'One client with its contacts, projects, services and goals.', schema: obj({ id: num('Client id') }, ['id']), run: (db, ctx, a) => clients.getClient(db, ctx, a.id) },
  { name: 'list_projects', description: 'List projects, optionally for one client or one status.', schema: obj({ clientId: num('Client id'), status: str('planning, active, on_hold, completed or archived') }), run: (db, ctx, a) => projects.listProjects(db, ctx, a) },
  { name: 'get_project', description: 'One project with its task counts.', schema: obj({ id: num('Project id') }, ['id']), run: (db, ctx, a) => projects.getProject(db, ctx, a.id) },
  { name: 'list_tasks', description: 'List tasks. Filters: projectId, assigneeId, status, overdue, mine, q (search in the title).', schema: obj({ projectId: num('Project id'), assigneeId: num('Team member id'), status: str('todo, in_progress, review or done'), overdue: { type: 'boolean' }, mine: { type: 'boolean', description: 'Only tasks assigned to the key owner' }, q: str('Search text') }),
    run: (db, ctx, a) => tasks.listTasks(db, ctx, { ...a, overdue: a.overdue ? '1' : '', mine: a.mine ? '1' : '' }) },
  { name: 'get_task', description: 'One task with its comments.', schema: obj({ id: num('Task id') }, ['id']), run: (db, ctx, a) => ({ ...tasks.getTask(db, ctx, a.id), comments: tasks.listComments(db, ctx, a.id) }) },
  { name: 'list_events', description: 'The calendar between two dates: events (meetings, deadlines, reviews, blocked time and so on) plus task and project due dates as deadlines. Optional clientId and userId (what that person attends or is assigned). Times are UTC.', schema: obj({ from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD, at most 120 days after from'), clientId: num('Client id'), userId: num('Team member id'), includeCancelled: { type: 'boolean' } }, ['from', 'to']), run: (db, ctx, a) => events.calendar(db, ctx, a) },
  { name: 'get_event', description: 'One calendar event with its attendees and links.', schema: obj({ id: num('Event id') }, ['id']), run: (db, ctx, a) => events.getEvent(db, ctx, a.id) },
  { name: 'list_meeting_notes', description: 'Meeting notes, newest first, without the long sections. Filters: clientId, projectId, status (draft or final), q (title or summary), from and to dates.', schema: obj({ clientId: num('Client id'), projectId: num('Project id'), status: str('draft or final'), q: str('Search text'), from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD') }), run: (db, ctx, a) => meetingnotes.listNotes(db, ctx, a) },
  { name: 'get_meeting_note', description: 'One meeting note with every section.', schema: obj({ id: num('Meeting note id') }, ['id']), run: (db, ctx, a) => meetingnotes.getNote(db, ctx, a.id) },
  { name: 'list_requests', description: 'Client requests, newest first. Filters: clientId, projectId, status (new, reviewing, approved, in_progress, waiting, completed, rejected), open (not completed or rejected), q.', schema: obj({ clientId: num('Client id'), projectId: num('Project id'), status: str('Request status'), open: { type: 'boolean' }, q: str('Search text') }), run: (db, ctx, a) => requests.listRequests(db, ctx, { ...a, open: a.open ? '1' : '' }) },
  { name: 'get_request', description: 'One client request with its client, project, source meeting note and linked task.', schema: obj({ id: num('Request id') }, ['id']), run: (db, ctx, a) => requests.getRequest(db, ctx, a.id) },
  { name: 'list_decisions', description: 'Recorded decisions, newest first. Filters: clientId, projectId, status (active or reversed), q.', schema: obj({ clientId: num('Client id'), projectId: num('Project id'), status: str('active or reversed'), q: str('Search text') }), run: (db, ctx, a) => decisions.listDecisions(db, ctx, a) },
  { name: 'list_follow_ups', description: 'Follow-ups, open first by due date. Filters: clientId, projectId, status (open, done, cancelled), assigneeId, mine, overdue, q.', schema: obj({ clientId: num('Client id'), projectId: num('Project id'), status: str('open, done or cancelled'), assigneeId: num('Team member id'), mine: { type: 'boolean' }, overdue: { type: 'boolean' }, q: str('Search text') }), run: (db, ctx, a) => followups.listFollowUps(db, ctx, { ...a, mine: a.mine ? '1' : '', overdue: a.overdue ? '1' : '' }) },
  { name: 'get_meeting_brief', description: 'Everything needed to turn a meeting into structured notes: the note with its pasted transcript, the calendar event, and the client\'s open requests, open follow-ups and recent decisions (so nothing is duplicated). Then use update_meeting_note and create_records_from_note.', schema: obj({ noteId: num('Meeting note id') }, ['noteId']), run: (db, ctx, a) => noterecords.briefForNote(db, ctx, a.noteId) },
  { name: 'get_workspace', description: 'The key owner\'s home: My Day (today\'s events, tasks and follow-ups due or overdue, requests they handle), plus the Manager view and Owner overview when their role may see them.', schema: obj(), run: (db, ctx) => workspace.getWorkspace(db, ctx) },
  { name: 'list_notifications', description: 'The key owner\'s own notifications, newest first. Pass unread to see only unread ones.', schema: obj({ unread: { type: 'boolean' } }), run: (db, ctx, a) => notifications.listNotifications(db, ctx, { unread: !!a.unread }) },
  { name: 'list_team', description: 'The people in the agency with their ids, roles and job titles. Use the ids to assign work.', schema: obj(),
    run: (db, ctx) => members.listMembers(db, ctx).map((m) => ({ id: m.id, username: m.username, displayName: m.displayName, role: m.role, isActive: m.isActive, jobTitle: m.jobTitle, department: m.department })) },
  { name: 'get_workload', description: 'Each active person\'s open tasks, overdue tasks and open estimated hours against weekly capacity.', schema: obj(),
    run: (db, ctx) => { const d = dashboard.getDashboard(db, ctx); if (!d.workload) throw new ServiceError(403, 'Not allowed'); return { today: d.today, workload: d.workload }; } },
  { name: 'list_sops', description: 'List the agency\'s SOPs (standard operating procedures), optionally by status, service or text. Each has its current version label.', schema: obj({ status: str('draft, testing, approved or deprecated'), service: str('Service name such as SEO'), q: str('Search text') }), run: (db, ctx, a) => sops.listSops(db, ctx, a) },
  { name: 'get_sop', description: 'One SOP with its current content (purpose, steps, quality checklist and more) and its version history.', schema: obj({ id: num('SOP id') }, ['id']), run: (db, ctx, a) => sops.getSop(db, ctx, a.id) },
  { name: 'list_services', description: 'The agency\'s services (SEO, Web Development and so on) with their ids. Use the ids on clients, projects and goals.', schema: obj(), run: (db, ctx) => services.listServices(db, ctx) },
  { name: 'list_goals', description: 'The goals of one client (why the agency does the work), with their progress.', schema: obj({ clientId: num('Client id'), status: str('active, achieved or dropped') }, ['clientId']), run: (db, ctx, a) => goals.listGoals(db, ctx, a.clientId, { status: a.status }) },
  { name: 'get_metrics', description: 'The recorded metrics of a client: each metric\'s latest value, the change from the previous value, and a short history.', schema: obj({ clientId: num('Client id') }, ['clientId']), run: (db, ctx, a) => results.metricsSummary(db, ctx, a.clientId) },
  { name: 'list_results', description: 'Individual recorded results of a client, newest first. Optional metric name and from and to dates (YYYY-MM-DD).', schema: obj({ clientId: num('Client id'), metric: str('Metric name'), from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD') }, ['clientId']), run: (db, ctx, a) => results.listResults(db, ctx, a.clientId, a) },
  { name: 'get_report_data', description: 'Everything needed to write a client report for a period: goals and their progress, tasks completed, results recorded (with change since before the period), overdue work, upcoming work and goals past their date. Use it to draft the narrative of a report.', schema: obj({ clientId: num('Client id'), from: str('Period start, YYYY-MM-DD'), to: str('Period end, YYYY-MM-DD') }, ['clientId', 'from', 'to']), run: (db, ctx, a) => reports.reportData(db, ctx, a.clientId, { from: a.from, to: a.to }) },
  { name: 'list_reports', description: 'Reports, newest period first, optionally for one client or one status (draft or approved).', schema: obj({ clientId: num('Client id'), status: str('draft or approved') }), run: (db, ctx, a) => reports.listReports(db, ctx, a) },
  { name: 'get_report', description: 'One report with its seven sections: executive summary, work completed, key results, important changes, problems and risks, next priorities, recommendations.', schema: obj({ id: num('Report id') }, ['id']), run: (db, ctx, a) => reports.getReport(db, ctx, a.id) },
  { name: 'list_sop_changes', description: 'SOP change requests, open and high priority first. Filters: status (identified, needs_review, approved, in_progress, testing, published, rejected), sopId, priority, mine, q.', schema: obj({ status: str('Change request status'), sopId: num('SOP id'), priority: str('low, normal, high or urgent'), mine: { type: 'boolean' }, q: str('Search text') }), run: (db, ctx, a) => sopchanges.listChanges(db, ctx, { ...a, mine: a.mine ? '1' : '' }) },
  { name: 'get_sop_change', description: 'One SOP change request with its details, proposed content, source and, once published, the SOP version it produced.', schema: obj({ id: num('Change request id') }, ['id']), run: (db, ctx, a) => sopchanges.getChange(db, ctx, a.id) },
  { name: 'list_qa_queue', description: 'Work waiting for QA review. Reviewing itself is done by a person in NexusOS, not by an AI.', schema: obj(), run: (db, ctx) => qa.listQueue(db, ctx) },
  { name: 'search_agency', description: 'Search the whole agency at once: clients, projects, tasks, SOPs, meeting notes, client requests, decisions, follow-ups, events and team members. Needs at least 2 characters; at most 8 results per group. Only finds what this person may see.', schema: obj({ q: str('Text to find'), limit: num('Results per group, at most 8') }, ['q']), run: (db, ctx, a) => search.search(db, ctx, a.q, { limit: a.limit }) },
  { name: 'list_time_entries', description: 'Logged time between two dates, oldest first. Filters: from, to (YYYY-MM-DD), userId, status (draft, submitted, approved, rejected, locked), clientId, projectId, taskId, timeType. Managers see everyone; anyone else sees only their own.', schema: obj({ from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD'), userId: num('Team member id'), status: str('draft, submitted, approved, rejected or locked'), clientId: num('Client id'), projectId: num('Project id'), taskId: num('Task id'), timeType: str('billable, non_billable, internal, meeting, training or admin') }), run: (db, ctx, a) => timeentries.listEntries(db, ctx, a) },
  { name: 'get_workload_capacity', description: 'Per person and week (Monday to Sunday): capacity hours, planned hours (open task estimates due that week plus calendar events), logged hours, utilization percent, and an overload (over 100 percent) or under-use (under 50 percent) status. Managers see everyone; anyone else only themselves.', schema: obj({ weekStart: str('Any date in the week, YYYY-MM-DD (default this week)'), weeks: num('How many weeks, 1 to 8'), userId: num('Team member id') }), run: (db, ctx, a) => capacity.workloadCapacity(db, ctx, a) },
  { name: 'get_retainer_usage', description: 'Retainer hours used this period for every client with a retainer, or one client: allocated, used (billable approved or locked time only), remaining, percent, pending (submitted) hours and a warning at 80 percent or over 100.', schema: obj({ clientId: num('Client id') }), run: (db, ctx, a) => retainers.listUsage(db, ctx, a) },

  { name: 'apply_changes', write: true, description: `Make several changes at once as one plan that is applied all together or not at all. Steps run in order; give a step "as" to name its result and use "$name" in clientId, projectId, taskId or id of later steps. Actions: create_client, update_client (args.id), create_contact (args.clientId), create_project (args.clientId), update_project (args.id), create_task (args.projectId, optional sopId, qaRequired and goalId), create_goal (args.clientId: title, why, target, dueDate, serviceId), update_goal (args.id, status active, achieved or dropped), record_result (args.clientId: metric, value, unit, recordedOn, goalId, note), generate_report (args.clientId, periodStart, periodEnd: a draft with the facts filled in), create_report (args.clientId, title, periodStart, periodEnd and the sections), update_report (args.id and any sections), update_task (args.id), add_comment (args.taskId), create_sop, update_sop (args.id), add_sop_version (args.id), create_tasks_from_sop (args.sopId and args.projectId, mode task or steps), create_sop_change (args.sopId), update_sop_change (args.id). An AI can draft SOPs (status draft or testing) and reports (draft), but only a person can approve an SOP or a report, or review work in QA. At most 50 steps.${PLAN_NOTE}`,
    schema: obj({ summary: str('One sentence: what this plan does'), steps: { type: 'array', items: obj({ action: str('One of the actions above'), as: str('Optional name for this step\'s result'), args: { type: 'object' } }, ['action', 'args']) } }, ['summary', 'steps']),
    submit: (a) => ({ summary: a.summary, steps: a.steps }) },
  { name: 'create_client', write: true, description: `Add a client.${PLAN_NOTE}`, schema: obj(CLIENT_FIELDS, ['name']), submit: (a) => asPlan(`Create client "${a.name}"`, 'create_client', a) },
  { name: 'create_project', write: true, description: `Add a project to a client.${PLAN_NOTE}`, schema: obj({ clientId: num('Client id'), ...PROJECT_FIELDS }, ['clientId', 'name']), submit: (a) => asPlan(`Create project "${a.name}"`, 'create_project', a) },
  { name: 'record_result', write: true, description: `Record a measured result for a client: metric name, numeric value, optional unit, date (default today), goal and note.${PLAN_NOTE}`, schema: obj({ clientId: num('Client id'), metric: str('For example Organic leads'), value: { type: 'number' }, unit: str('For example leads'), recordedOn: str('YYYY-MM-DD'), goalId: num('A goal of the same client'), note: str('Note') }, ['clientId', 'metric', 'value']), submit: (a) => asPlan(`Record ${a.metric}`, 'record_result', a) },
  { name: 'generate_report', write: true, description: `Create a draft report for a client and period with the facts filled in from NexusOS. Then fill the narrative sections with update_report.${PLAN_NOTE}`, schema: obj({ clientId: num('Client id'), periodStart: str('YYYY-MM-DD'), periodEnd: str('YYYY-MM-DD'), title: str('Optional title') }, ['clientId', 'periodStart', 'periodEnd']), submit: (a) => asPlan('Generate a report', 'generate_report', a) },
  { name: 'create_report', write: true, description: `Create a draft report for a client and period, with any of the seven sections written by you. Stays a draft until a person approves it.${PLAN_NOTE}`, schema: obj({ clientId: num('Client id'), title: str('Report title'), periodStart: str('YYYY-MM-DD'), periodEnd: str('YYYY-MM-DD'), executiveSummary: str('Executive summary'), workCompleted: str('Work completed'), keyResults: str('Key results'), importantChanges: str('Important changes'), problemsRisks: str('Problems and risks'), nextPriorities: str('Next priorities'), recommendations: str('Recommendations') }, ['clientId', 'title', 'periodStart', 'periodEnd']), submit: (a) => asPlan(`Create report "${a.title}"`, 'create_report', a) },
  { name: 'create_goal', write: true, description: `Add a goal to a client: the statement (why the agency does the work), optional why, target, dueDate and serviceId.${PLAN_NOTE}`, schema: obj({ clientId: num('Client id'), title: str('The goal, for example Increase qualified organic leads'), why: str('Why it matters'), target: str('A measurable target'), dueDate: str('YYYY-MM-DD'), serviceId: num('Service id') }, ['clientId', 'title']), submit: (a) => asPlan(`Add goal "${a.title}"`, 'create_goal', a) },
  { name: 'create_sop', write: true, description: `Draft an SOP: title, service, purpose, whenToUse, inputs, steps (list), checklist (list), expectedOutput, commonMistakes, examples, requiresQa. It starts as a draft for a person to approve.${PLAN_NOTE}`,
    schema: obj({ title: str('SOP title'), service: str('Service, such as SEO'), requiresQa: { type: 'boolean' }, status: { type: 'string', enum: ['draft', 'testing'] }, purpose: str('Purpose'), whenToUse: str('When to use'), inputs: str('Required inputs'), steps: { type: 'array', items: { type: 'string' } }, checklist: { type: 'array', items: { type: 'string' } }, expectedOutput: str('Expected output'), commonMistakes: str('Common mistakes'), examples: str('Examples') }, ['title']),
    submit: (a) => asPlan(`Create SOP "${a.title}"`, 'create_sop', a) },
  { name: 'create_tasks_from_sop', write: true, description: `Start work from an SOP in a project: one task named after it, or one task per step (mode steps).${PLAN_NOTE}`, schema: obj({ sopId: num('SOP id'), projectId: num('Project id'), mode: { type: 'string', enum: ['task', 'steps'] }, assigneeId: num('Team member id'), dueDate: str('YYYY-MM-DD'), priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } }, ['sopId', 'projectId']), submit: (a) => asPlan('Create tasks from an SOP', 'create_tasks_from_sop', a) },
  { name: 'create_sop_change', write: true, description: `Raise an SOP change request: sopId, title, details (what should change and why), optional proposedText, proposedContent, priority and source. It starts as identified or needs_review for a manager to decide. Publishing is for a person.${PLAN_NOTE}`, schema: obj({ sopId: num('SOP id'), ...SOPCHANGE_FIELDS }, ['sopId', 'title', 'details']), submit: (a) => asPlan(`Raise SOP change request "${a.title}"`, 'create_sop_change', a) },
  { name: 'update_sop_change', write: true, description: `Edit an SOP change request that is still identified or needs_review. Approving, rejecting, starting, testing and publishing are for a person.${PLAN_NOTE}`, schema: obj({ id: num('Change request id'), ...SOPCHANGE_FIELDS }, ['id']), submit: (a) => asPlan(`Change SOP change request #${a.id}`, 'update_sop_change', a) },
  { name: 'create_task', write: true, description: `Add a task to a project.${PLAN_NOTE}`, schema: obj({ projectId: num('Project id'), ...TASK_FIELDS }, ['projectId', 'title']), submit: (a) => asPlan(`Create task "${a.title}"`, 'create_task', a) },
  { name: 'update_task', write: true, description: `Change a task (status, assignee, due date and so on).${PLAN_NOTE}`, schema: obj({ id: num('Task id'), ...TASK_FIELDS }, ['id']), submit: (a) => asPlan(`Change task #${a.id}`, 'update_task', a) },
  { name: 'create_event', write: true, description: `Schedule a calendar event.${PLAN_NOTE}`, schema: obj(EVENT_FIELDS, ['title', 'startsAt']), submit: (a) => asPlan(`Schedule "${a.title}"`, 'create_event', a) },
  { name: 'update_event', write: true, description: `Change a calendar event, including cancelling it. AI cannot delete events.${PLAN_NOTE}`, schema: obj({ id: num('Event id'), ...EVENT_FIELDS }, ['id']), submit: (a) => asPlan(`Change event #${a.id}`, 'update_event', a) },
  { name: 'create_meeting_note', write: true, description: `Write structured meeting notes (draft), optionally for a calendar event. Only a person can finalize them.${PLAN_NOTE}`, schema: obj(NOTE_FIELDS), submit: (a) => asPlan(`Write meeting notes "${a.title || `for event #${a.eventId}`}"`, 'create_meeting_note', a) },
  { name: 'update_meeting_note', write: true, description: `Change a draft meeting note. Only a person can finalize or reopen it.${PLAN_NOTE}`, schema: obj({ id: num('Meeting note id'), ...NOTE_FIELDS }, ['id']), submit: (a) => asPlan(`Change meeting note #${a.id}`, 'update_meeting_note', a) },
  { name: 'create_request', write: true, description: `Log a client request.${PLAN_NOTE}`, schema: obj(REQUEST_FIELDS, ['clientId', 'title']), submit: (a) => asPlan(`Add client request "${a.title}"`, 'create_request', a) },
  { name: 'update_request', write: true, description: `Change a client request. Approving, rejecting, starting it and converting it to a task are for a person.${PLAN_NOTE}`, schema: obj({ id: num('Request id'), ...REQUEST_FIELDS }, ['id']), submit: (a) => asPlan(`Change client request #${a.id}`, 'update_request', a) },
  { name: 'create_decision', write: true, description: `Record a decision.${PLAN_NOTE}`, schema: obj(DECISION_FIELDS, ['title', 'decidedOn']), submit: (a) => asPlan(`Record decision "${a.title}"`, 'create_decision', a) },
  { name: 'update_decision', write: true, description: `Change a decision.${PLAN_NOTE}`, schema: obj({ id: num('Decision id'), ...DECISION_FIELDS }, ['id']), submit: (a) => asPlan(`Change decision #${a.id}`, 'update_decision', a) },
  { name: 'create_follow_up', write: true, description: `Add a follow-up.${PLAN_NOTE}`, schema: obj(FOLLOWUP_FIELDS, ['title']), submit: (a) => asPlan(`Add follow-up "${a.title}"`, 'create_follow_up', a) },
  { name: 'update_follow_up', write: true, description: `Change a follow-up, including marking it done.${PLAN_NOTE}`, schema: obj({ id: num('Follow-up id'), ...FOLLOWUP_FIELDS }, ['id']), submit: (a) => asPlan(`Change follow-up #${a.id}`, 'update_follow_up', a) },
  { name: 'create_records_from_note', write: true, description: `Turn the Decisions, Requests and Follow-ups lines of a meeting note into records linked to it. Safe to repeat. Optional kinds: decisions, requests, followUps.${PLAN_NOTE}`, schema: obj({ noteId: num('Meeting note id'), kinds: { type: 'array', items: { type: 'string', enum: ['decisions', 'requests', 'followUps'] } } }, ['noteId']), submit: (a) => asPlan(`Create records from meeting note #${a.noteId}`, 'create_records_from_note', a) },
  { name: 'log_time', write: true, description: `Log time for the key owner as a DRAFT entry: date, minutes (or startedAt and endedAt), a task or client, description and time type. A person submits it and a manager approves it. AI cannot submit, approve, reject or lock time.${PLAN_NOTE}`, schema: obj(TIME_FIELDS, []), submit: (a) => asPlan(`Log ${a.minutes ? `${a.minutes} minutes` : 'time'}${a.description ? `: ${a.description}` : ''}`, 'log_time', a) },
  { name: 'update_time_entry', write: true, description: `Change one of the key owner's own draft or rejected time entries. AI cannot submit, approve, reject, lock or delete time.${PLAN_NOTE}`, schema: obj({ id: num('Time entry id'), ...TIME_FIELDS }, ['id']), submit: (a) => asPlan(`Change time entry #${a.id}`, 'update_time_entry', a) },
  { name: 'add_comment', write: true, description: `Comment on a task.${PLAN_NOTE}`, schema: obj({ taskId: num('Task id'), body: str('The comment') }, ['taskId', 'body']), submit: (a) => asPlan(`Comment on task #${a.taskId}`, 'add_comment', a) },
];

const toolsFor = (auth) => TOOLS.filter((t) => !t.write || auth.access !== 'read');

function callTool(db, auth, name, args) {
  const tool = toolsFor(auth).find((t) => t.name === name);
  if (!tool) throw new ServiceError(404, `Unknown tool: ${name}`);
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new ServiceError(400, 'Tool arguments must be an object');
  if (tool.write) return plans.submitPlan(db, auth, tool.submit(args));
  const ctx = { organizationId: auth.organizationId, actor: auth.actor, source: 'ai', ip: null };
  return tool.run(db, ctx, args);
}

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

function handleMessage(db, auth, msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg && msg.id, -32600, 'Invalid request');
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case 'initialize': {
      const wanted = msg.params && msg.params.protocolVersion;
      return reply(msg.id, { protocolVersion: VERSIONS.includes(wanted) ? wanted : VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'agencyos', version: '1.0.0' } });
    }
    case 'ping': return reply(msg.id, {});
    case 'tools/list': return reply(msg.id, { tools: toolsFor(auth).map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema, securitySchemes: SECURITY, _meta: { securitySchemes: SECURITY } })) });
    case 'tools/call': {
      const params = msg.params || {};
      try {
        return reply(msg.id, { content: [{ type: 'text', text: text(callTool(db, auth, params.name, params.arguments)) }] });
      } catch (err) {
        if (!(err instanceof ServiceError)) { console.error(err); return reply(msg.id, { isError: true, content: [{ type: 'text', text: 'Something went wrong' }] }); }
        return reply(msg.id, { isError: true, content: [{ type: 'text', text: err.message }] });
      }
    }
    default:
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

function mcpHandler(db) {
  const hits = new Map(); // key id -> { start, count }
  return (req, res) => {
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({ error: 'Use POST' });
    const header = req.get('authorization') || '';
    const auth = apikeys.authenticate(db, header.startsWith('Bearer ') ? header.slice(7).trim() : '');
    // The pointer tells an OAuth client (such as claude.ai) where to find the sign-in.
    if (!auth) return res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${originOf(req)}/.well-known/oauth-protected-resource", scope="mcp"`).json({ error: 'A valid API key or access token is required' });
    const now = Date.now();
    const h = hits.get(auth.keyId);
    if (!h || now - h.start >= RATE.windowMs) hits.set(auth.keyId, { start: now, count: 1 });
    else if (++h.count > RATE.max) return res.status(429).json({ error: 'Too many requests. Wait a minute' });
    const out = Array.isArray(req.body) ? req.body.map((m) => handleMessage(db, auth, m)).filter(Boolean) : handleMessage(db, auth, req.body);
    if (out === null || (Array.isArray(out) && out.length === 0)) return res.status(202).end();
    res.json(out);
  };
}

module.exports = { mcpHandler, TOOLS };
