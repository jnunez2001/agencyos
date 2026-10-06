# Phase 13: SOP change requests (roadmap step 11)

Goal: a reviewed way to improve an SOP. Anyone who notices a problem raises a change request. A manager reviews it, approves or rejects it, and a person publishes it. Publishing adds a NEW SOP version. It never overwrites the approved one, so tasks pinned to an older version are not affected.

## Data (migration 017)

Table `sop_change_requests` with `organization_id`: sop, title, details (what should change and why), proposed text (free text, optional), proposed content (optional structured new version content, applied only on publish), priority (low, normal, high, urgent), status, optional source (task, QA review, meeting note or follow-up), rejected reason, reviewer and time, the published version and who and when published, creator.

Statuses: identified, needs_review, approved, in_progress, testing, published, rejected.

## Permissions (additive)

- `sopchanges.view`: everyone. A Contractor sees only the requests they raised. Staff do not see requests on a draft SOP unless they raised them.
- `sopchanges.create`: everyone. A Contractor may raise one only on an SOP attached to a task assigned to them, and only with that task as the source.
- `sopchanges.manage`: Owner, Admin, Manager. Moves requests through review, approves, rejects and publishes.

## Rules

- A new request starts as identified or needs_review.
- The person who raised a request may edit it (and move it between identified and needs_review) until it is approved or rejected. Managers may edit and move it at any time before it is published.
- Moving to approved, in_progress, testing or rejected is for managers. Rejecting needs a reason. A published request is locked.
- Publishing is a separate action, for managers only, from approved, in_progress or testing. It calls the existing `sops.addVersion` in the same transaction and records the version it produced. The content comes from the request's proposed content, optionally overlaid with content sent at publish time. With no content there is nothing to publish and the request stays as it is.
- An AI key can raise requests and edit drafts (identified or needs_review) but can never approve, reject, start, test or publish. The service refuses it, and the plan guard in `aiplans.js` refuses it before that.
- Every change is written to the activity log in the same transaction, with only the changed fields.

## API

`GET /api/sop-changes` (filters status, sopId, priority, mine, q), `POST /api/sop-changes`, `GET /api/sop-changes/:id`, `PATCH /api/sop-changes/:id`, `POST /api/sop-changes/:id/publish` (optional content, changeNote, major).

## MCP and plans

Read tools `list_sop_changes` and `get_sop_change`. Plan actions `create_sop_change` and `update_sop_change`. Never publish.

## Screens

- SOP page: a Change requests panel and a Raise change request button.
- `#/sops/changes`: all requests with status filters, reached from the SOPs page.
- A request opens in a sheet with its details and, for managers, the status actions, reject with a reason, and Publish.
- QA review sheet: a small Raise SOP change request button when the task follows an SOP.
