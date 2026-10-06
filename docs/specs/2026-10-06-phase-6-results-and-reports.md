# Phase 6: Results and reports

Approved by Josh on 2026-10-06 ("yes, reports and results next"). Blueprint sections 18, 36 (data side) and 47 ("Record results, generate reports, draft reports with AI"). Reports use what AgencyOS already knows (goals, projects, completed tasks) plus results the team records.

## Results

- A result is one recorded measurement for a client: a metric name ("Organic leads"), a value, an optional unit, the date it applies to, an optional goal it relates to, and an optional note. Results are entered by hand now, and an integration can fill them later.
- Metrics are named series per client (names match ignoring case). For each metric the client page shows the latest value, the change from the previous value, and a small trend line.
- Who: Owner, Admin, Manager and Employee record results. A person edits or deletes their own entries; a Manager or above edits or deletes any. A Contractor sees none. A result's goal must belong to the same client.

## Reports

- A report belongs to a client and a period (start and end dates, end not before start). It has a title, a status (`draft` or `approved`), and seven text sections from the blueprint: Executive summary, Work completed, Key results, Important changes, Problems and risks, Next priorities, Recommendations.
- **Generate from data:** one action creates a draft for a client and period with the factual sections filled in from AgencyOS: Work completed (tasks finished in the period, by project), Key results (each metric's latest value and change since before the period, plus goal progress), Problems and risks (overdue open work and goals past their date), Next priorities (open work due in the 14 days after the period, and work in progress). The narrative sections (summary, important changes, recommendations) are left for a person or an AI. The generated text is a snapshot: it does not change later.
- **Draft with AI:** an AI reads the same facts with `get_report_data` and writes the narrative sections into a report through the usual plans and AI inbox.
- **Human review:** only a person approves a report, never an AI. Editing an approved report returns it to draft. Only drafts can be deleted.
- Who: Owner, Admin and Manager create, generate, edit, approve and delete. Employees read. Contractors have no access.
- **Share:** a report page can be copied as plain text or printed (save as PDF). Sending reports to clients waits for the client portal.

## Screens

- Client page: **Results** (metric cards with trend, record a result, click a metric for its history and to edit entries) and **Reports** (the client's reports, New report, Generate from data).
- **Reports** in the sidebar: all reports with status and client filters, and the report page with the seven sections, Edit, Approve, Copy, Print.

## AI and MCP

Read tools `list_results`, `get_report_data`, `list_reports`, `get_report`. Plan actions `record_result`, `create_report`, `update_report`, `generate_report`. An AI cannot approve a report.

## Data (migration 007)

`client_results`, `reports`.

## Testing

Test first: result rules and permissions, metric summaries, generated reports from known data with a fixed "today", report rules (periods, approval, reopening, deleting), isolation, the HTTP routes, the AI actions and tools, and smoke tests for every new screen and sheet as Owner and Employee.

## Out of scope

Importing results from integrations, charts beyond the trend line, client-facing sharing and the client portal, scheduled reports, client health scoring.
