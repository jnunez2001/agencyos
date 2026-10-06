# Phase 4: SOPs and QA

Approved by Josh on 2026-10-06 ("SOPs and QA first"). Blueprint sections 14 to 16 and 38 to 40. Process lives in the system: how work is done (SOPs), attached to the work itself (tasks), and checked before it counts as done (QA).

## SOPs

- Fields (blueprint section 15): title, service (free text such as SEO), owner (a team member), status, and in each version: purpose, when to use, required inputs, steps (a list), quality checklist (a list), expected output, common mistakes, examples, and a change note.
- Status: `draft`, `testing`, `approved`, `deprecated`. A flag `requires QA` says whether work following this SOP must pass QA.
- Versions: editing the content never overwrites. It adds a new version, labelled `1.0`, then `1.1`, `1.2` (or `2.0` when marked a major change). Every version stays readable.
- Who: Owner, Admin and Manager create, edit and change status. Employees read SOPs that are `testing`, `approved` or `deprecated` (not drafts). Contractors have no SOP list, but see the SOP attached to a task assigned to them.
- Steps: 1 to 50 steps and up to 30 checklist items, each up to 500 characters.
- A person must approve an SOP: when an AI makes the change, status can be `draft` or `testing`, never `approved`.

## Attaching to work

- A task can have an SOP. Only `testing` and `approved` SOPs can be attached. The task is pinned to the version current at that moment, and shows when a newer version exists.
- Attaching an SOP copies its "requires QA" flag to the task unless it was set by hand. Tasks also have a plain "needs QA" flag.
- Start from an SOP: one action creates tasks in a project from an SOP, either one task named after the SOP, or one task per step. Each carries the SOP and its QA flag.

## QA

- Statuses are now: To do, In progress, In QA, Changes requested, Done (one new status, `changes`; `review` is shown as "In QA").
- Moving a task to In QA is "Submit for QA": it creates a QA record with a snapshot of the SOP checklist and puts the task in the QA queue. Moving it out again withdraws the record.
- A task that needs QA cannot reach Done any other way than approval. Nobody can set Changes requested by hand: only a review does.
- Reviewers: Owner, Admin and Manager (`qa.review`). A reviewer ticks the checklist and writes comments, then:
  - **Approve:** every checklist item must be ticked. The task becomes Done.
  - **Request changes:** a comment is required. The task becomes Changes requested and goes back to its assignee, who can submit again. Each round is a new QA record.
- Nobody reviews their own work, except the Owner.
- A QA record keeps: who submitted and when, the checklist as it was, the reviewer, the date, the comments and the result.
- Reviewing is a human decision. An AI cannot approve or request changes.

## Screens

- **SOPs** in the sidebar (Owner, Admin, Manager, Employee): list with filters and search, an SOP page with the content, its versions and actions (new version, change status, use in a project), and the add and edit forms.
- **QA** in the sidebar (Owner, Admin, Manager): the queue of work waiting, and the review sheet.
- Task sheet: the attached SOP (steps and checklist), Submit for QA, QA history, and the review action for reviewers. The task form gets an SOP choice and a "needs QA" box. The board gets a Changes requested column.
- Dashboard: a short "QA waiting" panel for reviewers.

## AI and MCP

Read tools `list_sops`, `get_sop`, `list_qa_queue`. Plan actions `create_sop`, `update_sop`, `add_sop_version`, `create_tasks_from_sop`, and `sopId` and `qaRequired` on tasks. Everything follows the same rules, plans and AI inbox as before.

## Data (migration 005)

`sops`, `sop_versions`, `qa_reviews`, and the tasks table rebuilt with the wider status list and the columns `sop_id`, `sop_version_id` and `qa_required`. The rebuild keeps every existing task, comment and index and is tested against data from the previous schema.

## Testing

Test first. Groups: the migration with existing data, SOP rules and visibility, versions, status and the AI limit, isolation, tasks with SOPs, the QA state machine and its rules, the queue, the HTTP routes, the MCP tools, and front-end smoke tests for every new screen and sheet as Owner, Employee and Contractor.

## Out of scope

Knowledge base, SOP templates by service, attachments, SOP training progress, a designated reviewer per task, calendar, time tracking and reports.
