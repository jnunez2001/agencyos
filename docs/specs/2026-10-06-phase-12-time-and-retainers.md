# Roadmap steps 8 to 10: Time tracking, capacity and client retainers

Joshua Nunez. One spec for three linked steps: time is logged (8), compared with what people can carry (9), and counted against what a client pays for (10).

## Step 8: Time tracking (migration 015)

### Data
`time_entries`: user, entry date, minutes, optional started and ended times (UTC), client, project, optional task, description, time type, status, reviewer, review time, review note, lock time, and timer fields.
- Time types: billable, non_billable, internal, meeting, training, admin. Billable time needs a client (a task or project sets it).
- Statuses: draft, submitted, approved, rejected, locked.
- Links work like the calendar: a task sets its project and client, a project sets its client, and the ones given must agree and belong to this agency.

### Timer
- One timer per person at a time (running or paused), kept as a draft entry with `timer_state` running, paused or none. A partial unique index enforces it.
- Start, pause, resume, stop. Starting while a timer exists is refused with a plain message. Stop turns the timer into an ordinary draft entry (minutes are the elapsed seconds rounded to the nearest minute, at least 1).
- Manual entry takes `minutes`, or `startedAt` and `endedAt` (UTC) from which the minutes are worked out. One entry is at most 24 hours, and a person's day is at most 24 hours.

### Rules
- People edit and delete only their own draft or rejected entries, and a running timer entry is changed only through the timer. Even Owners follow this for other people's entries.
- Submit sends own draft or rejected entries (by id, or all in a date range, "submit week") for approval. An entry with a timer still going cannot be submitted.
- Managers and above approve or reject submitted entries. Rejecting needs a note. Nobody approves their own entry except an Owner. Only a person does this: an AI key can never approve, reject or lock, and the service refuses it even if a plan asks.
- Approved entries become locked only by a manager's lock action. Approved and locked entries cannot be edited or deleted. A rejected entry is edited and submitted again.
- Contractors log time only on tasks assigned to them (the task sets the project and client). They never see client names.
- Task estimate against logged time: a task shows `loggedHours` (all its entries except rejected ones) beside its estimate.

### Permissions
`time.log` everyone, `time.review` Manager and above (approve, reject and lock), `time.view_team` Manager and above (everyone's entries, the review queue, team workload). Everyone else sees only their own entries.

### API
`GET/POST /api/time-entries`, `GET/PATCH/DELETE /api/time-entries/:id`, `POST /api/time-entries/submit`, `POST /api/time-entries/:id/approve|reject|lock`, `GET /api/time/timer`, `POST /api/time/timer/start|pause|resume|stop`.

### Screen
A Time page (nav key `time`, after Meetings): timer widget, My week (days, entries, add entry, submit week), and for Managers a review queue (waiting, approved to lock) and the team workload.

## Step 9: Capacity and workload

A service worked out per person per week (Monday to Sunday, UTC dates):
- `capacityHours`: the profile's weekly capacity (40 when none).
- `taskHours`: estimates of open tasks assigned to the person and due that week.
- `eventHours`: calendar events the person attends that are not cancelled and not deadlines. Timed events count their length inside the week. All-day events count the person's working-day length (work end minus work start, 8 when unclear) for each working day they cover in the week.
- `plannedHours`: tasks plus events. `loggedHours`: time entries dated in the week except rejected ones.
- `utilizationPercent`: the larger of planned and logged, over capacity, rounded. Null when capacity is 0.
- `status`: `over` above 100 percent (overload warning), `under` below 50 percent (under-use note), else `ok`, each with a plain-language note.
- Managers see everyone (`time.view_team`); everyone else only themselves. `GET /api/capacity?weekStart&weeks` (1 to 8 weeks).
- The dashboard workload rows gain `plannedHours`, `loggedHours`, `utilizationPercent` and `capacityStatus` for the current week, and the dashboard gains `capacity` for Managers. Existing fields are unchanged.

## Step 10: Client retainers (migration 016)

- `client_retainers`: client, period (monthly), hours allocated, start date, active. One active retainer per client. Retainers are deactivated, never deleted.
- A period runs from the start date's day of the month to the day before the next one (a day that does not exist in a short month uses the last day). Today's period is the current one; before the start date the first period is shown with nothing used.
- Only billable time that is approved or locked counts as used. Submitted billable time is shown as pending, never counted.
- Usage: used, remaining, percent. Warning from 80 percent, over from above 100 percent (with the hours over).
- Managers and above manage retainers (`retainers.manage`); everyone but a Contractor sees usage (`retainers.view`). The client page shows a Retainer panel.
- API: `GET/PUT /api/clients/:id/retainer` (PUT creates or changes it), `GET /api/retainers` (usage for every active retainer).

## AI
Read: `list_time_entries`, `get_workload_capacity`, `get_retainer_usage`. Write through plans (ask first by default): `log_time` and `update_time_entry`, which only ever create or change the key owner's DRAFT entries. AI cannot submit, approve, reject or lock, cannot delete, and cannot run a timer or change retainers.

## Not in this step
Invoicing, rates and money, rollover of unused retainer hours, timesheet exports, notifications for warnings.
