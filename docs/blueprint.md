# AgencyOS V1 — Operating System Blueprint

**Version:** 1.0  
**Status:** Build Blueprint  
**Product Type:** Multi-tenant SaaS web application  
**Primary Goal:** Give agencies one organized system for managing clients, work, projects, people, processes, results, and AI-assisted operations.

---

## 1. Product Vision

AgencyOS is a central operating system for digital agencies.

It should help an agency answer five questions at any time:

1. Who are our clients?
2. What work needs to happen?
3. Who is responsible for it?
4. Why are we doing it?
5. Did the work produce the expected result?

The system should eventually connect humans, AI, data, and external software into one controlled operating environment.

### Core principle

**AgencyOS is the source of truth.**

AI, employees, freelancers, and integrations operate through AgencyOS rather than becoming separate uncontrolled systems.

---

## 2. Product Positioning

AgencyOS is not intended to be only a generic project-management application.

Its core difference is the connection between:

**Strategy → Work → Process → Execution → QA → Results**

Most project-management systems primarily answer:

> What task is being done?

AgencyOS should also answer:

> Why is it being done, what process should be followed, who should do it, how should it be checked, and what happened afterward?

---

## 3. Target Users

### Agency Owner

Needs:
- Overview of the entire agency
- Client health
- Workload
- Priorities
- Team performance
- Results
- Approvals
- Business visibility

### Agency Manager

Needs:
- Projects
- Team workload
- Task assignment
- Deadlines
- QA
- SOPs
- Client delivery

### Agency Employee

Needs:
- Clear assignments
- Context
- SOPs
- Deadlines
- Examples
- QA submission
- Feedback

### Freelancer / Contractor

Needs:
- Only assigned projects and tasks
- Relevant files
- SOPs
- Deadlines
- Submission/QA workflow

### Client

Optional external portal:
- Project progress
- Deliverables
- Reports
- Files
- Approved information

---

## 4. AgencyOS V1 Scope

V1 contains these core modules:

1. Dashboard
2. Clients
3. Projects
4. Work / Tasks
5. SOPs
6. Team
7. Knowledge
8. Reports
9. AI Assistant
10. Integrations
11. Activity / Audit Log
12. Settings

The application must also be designed around:

- Multi-tenancy
- Role-based permissions
- API access
- MCP access
- AI provider abstraction
- Auditability
- Human approval
- Secure data boundaries

---

## 5. Global Application Navigation

```text
AgencyOS
│
├── Dashboard
│
├── Work
│   ├── All Work
│   ├── My Work
│   ├── This Week
│   ├── Overdue
│   ├── Waiting for QA
│   └── Completed
│
├── Clients
│
├── Projects
│
├── Team
│
├── SOPs
│
├── Knowledge
│
├── Reports
│
├── AI Assistant
│
├── Integrations
│
├── Activity
│
└── Settings
```

The navigation should remain simple.

Do not create separate top-level navigation items for every agency service.

SEO, content, web development, social media, etc. should be services/projects inside the operating system.

---

## 6. Dashboard

The dashboard is the agency's command center.

Its primary purpose is:

> Show what requires attention.

### Dashboard sections

#### Agency summary

```text
Active Clients
Active Projects
Open Tasks
Overdue
Waiting for QA
Tasks Due Today
```

#### Today's priorities

Show the most important work requiring attention.

#### Needs Your Decision

Examples:
- AI action awaiting approval
- Employee work awaiting QA
- Project exceeding budget
- Client issue
- Overdue deliverable
- Strategy decision

#### Team workload

```text
Josh        6 tasks
Rayne       4 tasks
Employee A  8 tasks
Employee B  3 tasks
```

#### Client health

Simple status indicators:
- On Track
- Needs Attention
- At Risk

#### Recent activity

Show meaningful events, not every database event.

---

## 7. Clients Module

A client is an organization/customer receiving services.

### Client fields

```text
Client Name
Company
Website
Industry
Primary Contact
Email
Phone
Status
Start Date
Account Owner
Services
Notes
Goals
```

### Client statuses

```text
Lead
Onboarding
Active
Paused
At Risk
Completed
Archived
```

### Client page

```text
Client
│
├── Overview
├── Goals
├── Projects
├── Work
├── Results
├── Reports
├── Files
├── Contacts
├── Notes
└── Activity
```

---

## 8. Client Goals

Every active client should have defined goals.

### SEO example

```text
Goal:
Increase qualified organic leads.
```

### Web Development example

```text
Goal:
Launch a conversion-focused website.
```

### Social Media example

```text
Goal:
Increase qualified engagement and brand awareness.
```

Goals should be independent from tasks.

A task is something we do.

A goal is why we do it.

---

## 9. Projects Module

Projects organize work for a client.

Example:

```text
MADISON

Projects

├── SEO Retainer
├── Website Redesign
└── Content Campaign
```

### Project fields

```text
Project Name
Client
Service
Description
Objective
Owner
Team
Start Date
Due Date
Status
Budget
Estimated Hours
Actual Hours
Priority
```

### Project statuses

```text
Planning
Active
Waiting
At Risk
Completed
Archived
```

---

## 10. Services

Services must be configurable.

Examples:

```text
SEO
Content Marketing
Web Development
Web Design
Social Media
Paid Ads
Email Marketing
Branding
Graphic Design
Video
```

AgencyOS should not hard-code SEO as the primary service.

Each service can eventually have:
- Templates
- SOPs
- Task templates
- Project templates
- KPIs
- Reports
- Integrations

---

## 11. Work / Task System

Tasks are the primary unit of execution.

### Task structure

Every meaningful task should support:

```text
Task Name
Client
Project
Service
Description
WHY
Expected Outcome
Owner
Priority
Status
Due Date
Estimated Effort
Actual Effort
SOP
Attachments
Comments
QA Status
Created By
```

### Task statuses

```text
Backlog
Planned
In Progress
Waiting
QA
Changes Requested
Approved
Completed
Cancelled
```

Do not create dozens of statuses.

---

## 12. Task Philosophy

A task should not simply say:

> Optimize page.

It should contain context.

Example:

```text
Task:
Optimize Commercial Service Page

Client:
Madison

WHY:
The page ranks between positions 8–12
for commercially valuable queries.

Expected Outcome:
Improve organic visibility and qualified traffic.

SOP:
Service Page Optimization v1.2

Owner:
SEO Specialist

Estimated Effort:
2.5 hours

Status:
In Progress
```

This is critical for delegation and AI.

---

## 13. Work Views

Users should be able to view work as:

### List

Best for detailed management.

### Kanban

```text
Backlog
→ Planned
→ In Progress
→ QA
→ Completed
```

### Calendar

For deadlines and scheduling.

### My Work

Only the logged-in user's assignments.

### Client Work

All work associated with one client.

### Project Work

All work associated with one project.

---

## 14. QA System

QA is a first-class feature.

Employees should not simply mark work "Done" when work requires review.

Workflow:

```text
Employee
   ↓
Submit for QA
   ↓
QA Queue
   ↓
Reviewer
   ├── Approve
   └── Request Changes
             ↓
          Employee
```

### QA record

```text
Reviewer
Date
Checklist
Comments
Result
Changes Requested
Approval
```

---

## 15. SOP System

SOP = Standard Operating Procedure.

An SOP describes how the agency performs repeatable work.

### SOP structure

```text
Title
Service
Version
Purpose
When to Use
Required Inputs
Steps
Quality Checklist
Expected Output
Common Mistakes
Examples
Owner
Status
Last Updated
```

### SOP status

```text
Draft
Testing
Approved
Deprecated
```

### Versioning

Example:

```text
Service Page Optimization
v1.0
v1.1
v1.2
```

Never silently overwrite important process changes.

---

## 16. SOP → Task Connection

An SOP should be attachable to a task.

Example:

```text
Create Task
      ↓
Select SOP
      ↓
Service Page Optimization v1.2
      ↓
System loads:
- instructions
- checklist
- expected output
- QA requirements
```

This is the foundation for future employee training.

Instead of repeatedly teaching someone, the system teaches through the process.

---

## 17. Knowledge Base

Knowledge is different from SOPs.

### SOP

**How we do something.**

### Knowledge

**What we know.**

Knowledge can contain:
- SEO concepts
- Client knowledge
- Industry information
- Internal policies
- Strategy principles
- Research
- Best practices
- Training materials

Knowledge should be searchable.

---

## 18. Reports

Reports should use existing AgencyOS data wherever possible.

A report can combine:

```text
Client Goals
+
Project Work
+
Completed Tasks
+
Results
+
KPIs
+
Notes
```

### Report structure

```text
Executive Summary

Work Completed

Key Results

Important Changes

Problems / Risks

Next Priorities

Recommendations
```

Reports should eventually support AI-generated drafts.

Human review remains available.

---

## 19. AI Assistant

AI is a core capability but should not control the system by default.

The AI Assistant should be able to understand AgencyOS context according to permissions.

Example questions:

- What should I focus on today?
- Which clients need attention?
- What work is overdue?
- Summarize this week's work.
- What tasks are waiting for QA?
- Create a project plan for a new SEO client.
- Draft an SOP from this completed workflow.
- Analyze this client's performance.

---

## 20. AI Operating Model

AI should operate through controlled tools.

```text
AI
 ↓
AgencyOS AI Layer
 ↓
Permission Check
 ↓
Business Logic
 ↓
Database
```

Never:

```text
AI
 ↓
Raw Database
```

The AI should never bypass AgencyOS permissions.

---

## 21. AI Action Levels

### Level 1 — Read

AI can:
- Read client information
- Read projects
- Read tasks
- Read reports
- Analyze information

### Level 2 — Draft

AI can:
- Draft tasks
- Draft reports
- Draft SOPs
- Draft project plans

Human approval required.

### Level 3 — Assisted Action

AI can:
- Create tasks
- Update task descriptions
- Organize work
- Generate reports

Depending on agency permission.

### Level 4 — Autonomous

Future capability only.

AI may perform predefined actions automatically within strict boundaries.

V1 should focus primarily on Levels 1–3.

---

## 22. AI Provider Architecture

AgencyOS must not be dependent on one AI provider.

Architecture:

```text
                    AgencyOS
                       │
                  AI Service
                       │
              Provider Interface
                       │
       ┌───────────────┼───────────────┐
       │               │               │
    OpenAI          Anthropic        Google
       │               │               │
      GPT            Claude          Gemini
```

Future providers can be added without redesigning the entire application.

---

## 23. API Architecture

AgencyOS should expose an API.

Example:

```text
/api/v1/clients
/api/v1/projects
/api/v1/tasks
/api/v1/sops
/api/v1/reports
/api/v1/team
/api/v1/knowledge
```

The API should use versioning:

```text
/api/v1/
```

This protects future compatibility.

---

## 24. MCP Architecture

AgencyOS should provide an MCP server.

Initial MCP tools could include:

```text
get_clients
get_client
get_projects
get_project
get_tasks
get_task
create_task
update_task
get_sops
get_sop
search_knowledge
get_reports
get_team_workload
get_client_results
create_report_draft
```

AI clients can discover these tools rather than needing custom integrations for every operation.

---

## 25. MCP Security

MCP access must respect the same permissions as the application.

```text
AI
 ↓
MCP
 ↓
Authentication
 ↓
Organization Check
 ↓
Permission Check
 ↓
AgencyOS Action
```

An AI connected to Agency A must never access Agency B.

A client-facing AI connection must never access internal agency data unless explicitly authorized.

---

## 26. API Authentication

V1 should support:

```text
User Authentication
Session Authentication
API Keys
Organization Scoping
Role Permissions
```

API keys should be:
- Revocable
- Scoped
- Rotatable
- Audited

Never expose secret keys in frontend code.

---

## 27. Multi-Tenant Architecture

This is mandatory because AgencyOS is intended for any agency.

Structure:

```text
Platform
│
├── Agency A
│   ├── Users
│   ├── Clients
│   ├── Projects
│   └── Data
│
├── Agency B
│   ├── Users
│   ├── Clients
│   ├── Projects
│   └── Data
│
└── Agency C
    ├── Users
    ├── Clients
    ├── Projects
    └── Data
```

Every organization-owned record must be associated with an organization ID.

No organization should be able to access another organization's data.

---

## 28. Roles

V1 roles:

### Owner

Full access.

### Admin

Operational management.

### Manager

Clients, projects, tasks, team assignments, QA.

### Member

Assigned work and relevant client/project information.

### Contractor

Limited project/task access.

### Client

Restricted client portal access.

### AI

Not a normal human role. AI access uses explicit permissions/scopes.

---

## 29. Activity / Audit Log

Every important action should be traceable.

Examples:

```text
Josh created task
Employee A changed task status
Employee B submitted QA
Josh approved task
Claude created task draft
Josh approved AI action
Admin changed user permissions
```

The audit log should record:

```text
Actor
Action
Object
Timestamp
Organization
Before
After
Source
```

Where appropriate.

---

## 30. AI Activity Log

AI actions should be separately identifiable.

Example:

```text
AI ACTIVITY

Claude
Read:
Madison SEO project

Claude
Created draft:
Commercial Page Optimization

Josh
Approved action

GPT
Generated:
Monthly report draft
```

This creates accountability.

---

## 31. Integrations

Integrations should be modular.

```text
Integrations
│
├── AI
├── Analytics
├── SEO
├── Communication
├── Storage
├── CRM
└── Other
```

Potential integrations:
- Google Search Console
- Google Analytics
- Google Ads
- Slack
- Google Drive
- Notion
- CRM systems
- Email
- SEO platforms

Do not build every integration in V1.

Build the integration framework first.

---

## 32. Events / Webhooks

AgencyOS should eventually support events such as:

```text
task.created
task.updated
task.completed
task.submitted_for_qa
task.approved
client.created
project.created
project.completed
report.created
ai.action_requested
ai.action_approved
```

External systems can subscribe to relevant events.

---

## 33. Data Model V1

Core entities:

```text
organizations
users
organization_members

clients
client_contacts

services

projects
project_members

tasks
task_comments
task_attachments

sops
sop_steps
sop_versions

knowledge_articles

reports

ai_actions

api_keys
integrations

activity_logs
webhook_events
```

Later:

```text
time_entries
invoices
payments
custom_fields
automations
client_portals
service_templates
kpis
metrics
```

Do not add these unnecessarily to V1.

---

## 34. Universal Work Model

AgencyOS should not create separate systems for SEO, design, web work, content, or advertising.

Instead:

```text
Service
   ↓
Project
   ↓
Work
   ↓
Task
   ↓
SOP
   ↓
QA
   ↓
Result
```

This makes the OS universal.

---

## 35. Service Templates

Later, agencies can create templates.

### SEO Retainer

```text
Monthly Analysis
Keyword Review
Technical Review
Content Optimization
Internal Linking
Reporting
```

### Website Project

```text
Discovery
Sitemap
Wireframes
Design
Development
QA
Launch
```

### Social Media

```text
Strategy
Content Calendar
Content Production
Approval
Publishing
Performance Review
```

These are templates, not hard-coded workflows.

---

## 36. Client Health

V1 should support a simple health system.

Possible factors:

```text
Project Status
Deadline Status
Workload
Results
Client Communication
Outstanding Issues
```

Result:

```text
ON TRACK
NEEDS ATTENTION
AT RISK
```

The system should show the reason rather than merely displaying a colored badge.

---

## 37. Build Architecture

Recommended initial stack:

```text
Frontend
Next.js
React
TypeScript

UI
Tailwind CSS
shadcn/ui

Backend
Next.js server/API layer

Database
PostgreSQL

Authentication
Supabase Auth

Storage
Supabase Storage

AI
Provider abstraction

Hosting
Vercel

Database/Auth/Storage
Supabase
```

The exact stack can change if the chosen vibe-coding environment strongly favors another architecture, but the architectural principles should remain.

---

## 38. Source of Truth Rules

### Client information
AgencyOS is the source of truth.

### Tasks
AgencyOS is the source of truth.

### SOPs
AgencyOS is the source of truth.

### AI recommendations
AI is not the source of truth.

### External analytics
External systems remain the source of raw measurement data.

### Human decisions
Approved decisions are stored in AgencyOS.

---

## 39. AI Source-of-Truth Rule

AI should never silently modify important agency information.

AI can:

```text
Analyze
Recommend
Draft
Suggest
Summarize
```

Actions that change important data should require appropriate permissions.

---

## 40. Human-in-the-Loop Rule

For important actions:

```text
AI Recommendation
      ↓
Human Review
      ↓
Approval
      ↓
Action
```

For low-risk repetitive actions, future versions can support:

```text
AI
 ↓
Policy Check
 ↓
Automatic Action
```

But only after explicit agency configuration.

---

## 41. Build Phases

### Phase 1 — Foundation

Build:
- Authentication
- Organization
- Users
- Roles
- Database
- Application shell
- Navigation

### Phase 2 — Core Operations

Build:
- Clients
- Projects
- Tasks
- Work views
- Dashboard

### Phase 3 — Process

Build:
- SOPs
- Knowledge
- QA
- Activity log

### Phase 4 — AI

Build:
- AI provider abstraction
- AI assistant
- Task drafting
- Project planning
- Report drafting
- AI permissions
- AI activity log

### Phase 5 — Integration Architecture

Build:
- API
- API keys
- Webhooks
- Integration framework
- MCP architecture

### Phase 6 — Real Agency Test

Use AgencyOS with actual agency work.

Do not immediately sell it.

First identify:
- What is annoying?
- What is missing?
- What is unnecessary?
- What is confusing?
- What should be automated?

Then improve.

---

## 42. V1 AI Features

Build only useful AI features first:

### AI Assistant
Ask questions about agency data.

### Task Drafting
Turn a description into a structured task.

### Project Planning
Generate a project plan from a goal.

### SOP Drafting
Turn a proven process into an SOP draft.

### Report Drafting
Generate a report from recorded work/results.

### Work Summary
Summarize work by client, project, employee, or period.

### Priority Suggestions
Analyze available work and suggest priorities.

Human approval remains available.

---

## 43. V1 Security Principles

Security is part of the architecture, not something added later.

Requirements:
- Organization-level data isolation
- Role-based access
- Server-side authorization
- Secure authentication
- Encrypted connections
- Secure API keys
- No secrets in frontend code
- Audit logging
- Revocable integrations
- AI permission boundaries
- Input validation
- Database constraints
- Backup strategy

---

## 44. V1 UI Philosophy

The UI should be:
- Clean
- Professional
- Fast
- Minimal
- Modern
- Easy to understand
- Slightly premium
- Not overly colorful
- Not overly corporate
- Not cluttered

Avoid turning the dashboard into a wall of cards.

Use whitespace, typography, hierarchy, and status indicators.

---

## 45. Responsive Design

V1 should be desktop-first because agencies will do most operational work on computers.

But it must be responsive.

Desktop:
```text
Sidebar + Main Workspace
```

Tablet:
```text
Collapsed Sidebar + Workspace
```

Mobile:
```text
Compact navigation
Focused task/client views
```

A separate mobile app is not required for V1.

---

## 46. What V1 Should NOT Include

To prevent scope explosion, do not initially build:

- Payroll
- Full accounting
- Complex invoicing
- Full CRM
- Social media publishing
- Full SEO crawler
- Full rank tracker
- Advanced time tracking
- Complex automation builder
- Autonomous AI agents
- Native mobile apps
- Marketplace
- Client billing
- Hundreds of integrations

These can become V2/V3 modules.

---

## 47. V1 Definition of Done

AgencyOS V1 is successful if an agency can:

### Setup
- Create an agency
- Invite team members
- Assign roles

### Clients
- Create clients
- Store client information
- Define goals
- Assign services

### Projects
- Create projects
- Assign team
- Set deadlines
- Track status

### Work
- Create tasks
- Assign tasks
- Track status
- Use priorities
- Attach SOPs
- Submit for QA

### SOPs
- Create SOPs
- Version SOPs
- Attach SOPs to work

### Team
- View workload
- Assign work
- Review work

### Reporting
- Record results
- Generate reports
- Draft reports with AI

### AI
- Connect an AI provider
- Ask questions about agency data
- Generate recommendations
- Draft work
- Respect permissions

### API
- Authenticate API access
- Read permitted data
- Perform permitted actions

### MCP
- Expose AgencyOS capabilities as MCP tools
- Authenticate MCP connections
- Respect organization and role permissions

### Security
- Prevent cross-agency data access
- Log important actions
- Revoke access
- Protect API credentials

If those work reliably, V1 is viable.

---

## 48. AgencyOS Operating Loop

The entire product should support:

```text
PLAN
 ↓
ASSIGN
 ↓
EXECUTE
 ↓
QA
 ↓
DELIVER
 ↓
MEASURE
 ↓
LEARN
 ↓
PLAN AGAIN
```

AI can participate throughout this loop.

Humans retain control.

---

## 49. Long-Term Vision

Eventually:

```text
                         AGENCYOS
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
      PEOPLE               WORK                AI
        │                   │                   │
     Owners              Projects           OpenAI
     Managers            Tasks              Claude
     Employees            SOPs               Gemini
     Freelancers          QA                 Other AI
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                       INTEGRATIONS
                            │
       ┌─────────────┬──────┼──────┬──────────────┐
       │             │      │      │              │
     GSC           GA4    CRM    Slack          Ads
```

The end goal is not simply:

> A better task manager.

The end goal is:

> **A controllable operating layer between an agency's people, processes, data, AI systems, and external software.**

That is the product we should build.

---

# 50. Build Rule

**Do not let the vibe-coding AI invent the architecture as it goes.**

Use this blueprint as the source of truth.

Build in controlled milestones:

**Foundation → Core Operations → Process → AI → API/MCP → Integrations**

The agency itself should become the testing environment.

Build V1 → use it → identify problems → improve → automate → repeat.

**Additional V1 rule:** Calendar, meeting notes, client requests, decisions, time tracking, roles, and SOP change requests are part of the operating system itself. They must be linked to clients/projects/work rather than implemented as disconnected features.


---

# 6A. Calendar & Agency Schedule

Calendar should be a core module, not an external afterthought.

The calendar connects meetings, deadlines, employee schedules, tasks, and follow-ups.

## Calendar views

Support:

- Month
- Week
- Day
- Agenda
- My Calendar
- Team Calendar
- Client Calendar

## Calendar event types

```text
Client Meeting
Internal Meeting
Team Meeting
Deadline
Task Due Date
Follow-Up
Review
SOP Review
Training
Personal / Blocked Time
```

Events can be associated with:

```text
Client
Project
Task
Employee
Meeting Note
SOP
```

## Calendar event structure

```text
Title
Type
Date
Start Time
End Time
Timezone
Client
Project
Participants
Owner
Location / Meeting Link
Description
Related Tasks
Related Notes
Reminder
Status
```

The calendar should not become a second task system.

A calendar event represents **when something happens**.

A task represents **work that needs to be done**.

---

# 6B. Meeting Notes & Client Notes

Client notes should be structured, searchable, and connected to the rest of AgencyOS.

A simple text-notes area is not enough.

## Note types

```text
General Note
Meeting Note
Decision
Client Request
Issue
Opportunity
Follow-Up
Internal Note
```

## Meeting note structure

```text
Meeting
Client
Date
Participants
Purpose

Discussion

Decisions

Action Items

Client Requests

Risks / Issues

Important Context

SOP / Process Changes

Next Meeting

Attachments
```

## Example

```text
CLIENT: Madison
MEETING: Monthly SEO Review
DATE: October 5

Discussion:
Client wants more focus on commercial service pages.

Decision:
Prioritize commercial pages before new blog content.

Action Items:
1. Review top 10 commercial pages
2. Prepare optimization recommendations
3. Send recommendations by Friday

Client Request:
Add monthly competitor comparison.

Process Note:
Current SEO reporting SOP does not include competitor comparison.

Next Meeting:
November 5
```

The system should automatically make the important parts actionable.

---

# 6C. Meeting → Action Workflow

This should be one of AgencyOS's signature workflows.

```text
MEETING
   ↓
NOTES
   ↓
DECISIONS
   ↓
ACTION ITEMS
   ↓
TASKS
   ↓
ASSIGNMENT
   ↓
EXECUTION
   ↓
QA
   ↓
RESULT
```

For example:

```text
Client says:
"Please add competitor comparison to our monthly report."
```

The user can click:

**Create Task**

AgencyOS creates:

```text
Task:
Add competitor comparison to monthly report

Client:
Madison

Source:
October 5 Client Meeting

Owner:
Josh

Due:
Friday

Priority:
Medium
```

The original meeting remains linked to the task.

This creates traceability from client conversation to actual work.

---

# 6D. Meeting Decisions

Decisions should be separate from general notes.

Example:

```text
DECISION

Client:
Madison

Decision:
Prioritize commercial service pages over informational blog content.

Made:
October 5

Made By:
Josh + Client

Reason:
Higher commercial value.

Status:
Active
```

Decisions can later be referenced by AI when analyzing projects.

This prevents important client decisions from disappearing inside meeting transcripts.

---

# 6E. SOP Change Requests

Your idea about meetings triggering SOP updates should become a formal workflow.

Example:

```text
Meeting
   ↓
Process Problem Identified
   ↓
SOP Change Request
   ↓
Review
   ↓
Update SOP
   ↓
New Version
   ↓
Team Notification
```

Example:

```text
SOP CHANGE REQUEST

SOP:
Monthly SEO Reporting

Current Version:
v1.2

Reason:
Client requested competitor comparison.

Source:
Madison Monthly Meeting — Oct 5

Requested Change:
Add competitor comparison section.

Priority:
Medium

Status:
Needs Review
```

Possible statuses:

```text
Identified
Needs Review
Approved
In Progress
Testing
Published
Rejected
```

This turns the agency into a learning system.

---

# 6F. Employee Accounts & Organization Roles

AgencyOS should have explicit role-based accounts.

Recommended V1 roles:

### Owner

Full control over the organization.

Can:
- Manage billing/settings
- Manage users
- Manage permissions
- View all clients
- View all projects
- Approve important actions
- Manage integrations
- Manage AI access
- View reports
- Manage SOPs
- View time and workload data

### Admin

Operational administrator.

Can:
- Manage users
- Manage clients
- Manage projects
- Manage workflows
- Manage SOPs
- View operational reports

Billing and ownership controls can remain restricted to the Owner.

### Manager

Responsible for delivery.

Can:
- Manage assigned clients
- Create and assign tasks
- Manage projects
- Review employee work
- Perform QA
- Approve work
- View team workload
- Review time entries
- Request SOP updates

### Employee

Execution role.

Can:
- View assigned work
- Start/stop time tracking
- Add work notes
- Follow SOPs
- Submit work for QA
- View permitted client/project information
- Add meeting/action notes where permitted

Cannot:
- Change agency-wide settings
- Manage permissions
- Delete critical records
- Modify approved SOPs without approval

### Contractor

Restricted execution access.

Can:
- View assigned projects/tasks
- Track assigned work
- Submit work
- Access required SOPs/files

### Client

Restricted external access.

Can:
- View approved projects
- View deliverables
- View approved reports
- Participate in client-facing communication
- Submit requests

Client users must never see internal notes, internal employee information, internal costs, or private strategy unless explicitly permitted.

---

# 6G. Employee Profiles

Each employee should have a profile.

```text
Name
Profile Photo
Role
Department
Services
Manager
Employment Status
Timezone
Working Hours
Skills
Capacity
Active Tasks
Current Workload
```

The profile becomes the foundation for workload and time tracking.

---

# 6H. Time Tracking

Because AgencyOS is intended to manage agency operations, employee time should be a first-class operational feature.

The purpose is not surveillance.

The purpose is:

- Understand project effort
- Compare estimated vs actual work
- Manage capacity
- Understand profitability
- Improve estimates
- Identify overloaded employees
- Support client hour allocations

## Time tracking methods

### Timer

Employee clicks:

**Start Timer**

Then:

```text
Client: Madison
Project: SEO Retainer
Task: Commercial Page Optimization

00:47:32
[Pause] [Stop]
```

### Manual entry

Employees can add time after completing work.

```text
Date
Employee
Client
Project
Task
Start
End
Duration
Description
```

Manual entries can be enabled or restricted by role.

---

# 6I. Time Entry Status

```text
Draft
Submitted
Approved
Rejected
Locked
```

Recommended workflow:

```text
Employee
   ↓
Submit Time
   ↓
Manager Review
   ↓
Approve
   ↓
Locked
```

For small agencies, the Owner can disable approval and allow automatic approval.

---

# 6J. Time Tracking Rules

Time should always connect to work where possible.

Preferred:

```text
Employee
 ↓
Task
 ↓
Project
 ↓
Client
```

Avoid unassigned time whenever possible.

The system should support:

```text
Billable
Non-Billable
Internal
Training
Meeting
Admin
```

This helps agencies understand where their time actually goes.

---

# 6K. Capacity & Workload

Time tracking becomes more useful when combined with employee capacity.

Example:

```text
MARK

Weekly Capacity:
40 hours

Assigned:
34 hours

Tracked:
21.5 hours

Remaining Estimated:
6 hours

Workload:
85%
```

Manager dashboard:

```text
TEAM CAPACITY

Josh       72%
Rayne      64%
Mark       92%   ← High
Sarah      48%
```

This allows managers to redistribute work before someone becomes overloaded.

---

# 6L. Time & Client Retainers

For agencies that sell hours or retainers, projects can have an optional allocation.

Example:

```text
Madison SEO Retainer

Monthly Allocation:
32 hours

Used:
24.5 hours

Remaining:
7.5 hours
```

The system can warn:

```text
80% of allocated hours used.

7.5 hours remaining.

4 tasks are still planned.
```

This should be a warning, not an automatic shutdown.

---

# 6M. Employee Workday View

When an employee logs in, the system should not show the entire agency.

It should show:

```text
Good morning, Mark.

TODAY

My Schedule
────────────────────
9:00  Madison Meeting
10:00 Commercial Page
12:00 Lunch
1:00  Whalls Content
3:00  QA Revisions

MY WORK
────────────────────
3 tasks due today

TIME
────────────────────
Today: 4h 32m
This week: 27h 10m

NEEDS ATTENTION
────────────────────
1 task waiting for client information
```

This is much more useful than giving every employee the Owner dashboard.

---

# 6N. Manager Dashboard

Managers should see the operational layer.

```text
TEAM

Workload
Deadlines
QA Queue
Overdue Work
Time
Client Issues
SOP Requests
```

Example:

```text
TEAM ATTENTION

Mark
92% workload
2 tasks overdue

Sarah
48% workload
Available capacity

SOP
Monthly Reporting
Needs review

Client
Madison
1 unresolved request
```

---

# 6O. Owner Dashboard

The Owner should see the business/agency layer.

```text
AGENCY OVERVIEW

Clients
Projects
Revenue
Workload
Capacity
Profitability
Client Health
Overdue Work
QA
SOP Improvements
AI Activity
```

The Owner should not need to inspect individual tasks just to understand whether the agency is healthy.

---

# 6P. Notifications & Reminders

AgencyOS should have a notification center.

Examples:

```text
You were assigned a task.
Your task is due tomorrow.
Your work was returned for changes.
A client request was added.
A meeting starts in 30 minutes.
An SOP needs review.
A project is approaching its hour limit.
You have a pending QA review.
```

Notifications should be actionable.

Clicking a notification should open the relevant object.

---

# 6Q. Follow-Up System

A meeting or client note can create a follow-up without manually recreating everything.

Example:

```text
Client Request
      ↓
Follow-Up
      ↓
Task
      ↓
Due Date
      ↓
Reminder
```

A follow-up should have:

```text
Title
Client
Source
Owner
Due Date
Priority
Status
Related Meeting
Related Task
```

This prevents client requests from getting lost in notes.

---

# 6R. Client Request Inbox

Clients should have a centralized place for requests.

Requests can come from:

- Client portal
- Meeting
- Email/manual entry
- Internal employee
- Manager
- AI-assisted extraction

Example:

```text
CLIENT REQUESTS

NEW
────────────────────
Add competitor section to report

IN PROGRESS
────────────────────
Review commercial pages

WAITING
────────────────────
Client needs to provide analytics access

COMPLETED
────────────────────
Update monthly report format
```

Every request can become a task.

---

# 6S. Meeting Intelligence

Later, AI can help transform meeting information.

Example:

```text
Meeting transcript / notes
          ↓
       AI Analysis
          ↓
 ┌────────┼────────┐
 ↓        ↓        ↓
Decisions Actions  Risks
          ↓
        Tasks
          ↓
   SOP Suggestions
```

The AI should **suggest**, not silently create important changes.

Example:

> "This meeting appears to contain a process change that may require updating the Monthly Reporting SOP."

Then:

**[Create SOP Change Request]**

---

# 6T. Operational Memory

AgencyOS should preserve context over time.

For each client, AI and authorized team members should be able to retrieve:

```text
Goals
Decisions
Meeting Notes
Requests
Projects
Tasks
Reports
Results
Problems
SOP Changes
Important Context
```

This means a new employee does not need to ask:

> "What happened with this client?"

They can inspect the client's operational history.

---

# 6U. Improved Core Operating Loop

With Calendar, Notes, Time, SOPs, and AI included, the AgencyOS loop becomes:

```text
CLIENT / BUSINESS GOAL
        ↓
MEETING / DISCOVERY
        ↓
NOTES + DECISIONS
        ↓
REQUESTS + OPPORTUNITIES
        ↓
PRIORITIES
        ↓
PROJECT / TASK
        ↓
SOP
        ↓
ASSIGN
        ↓
TIME TRACK
        ↓
EXECUTE
        ↓
QA
        ↓
DELIVER
        ↓
MEASURE
        ↓
REPORT
        ↓
LEARN
        ↓
SOP / PROCESS IMPROVEMENT
        ↓
NEXT CYCLE
```

This is the stronger version of the AgencyOS concept.

---

# 6V. New V1 Data Model Additions

Add these entities to the original V1 model:

```text
calendar_events
meeting_notes
meeting_participants

decisions
client_requests
follow_ups

sop_change_requests

employee_profiles
employee_schedules
employee_capacity

time_entries
time_entry_approvals

notifications

client_portal_users
```

The updated core model becomes:

```text
organizations
users
organization_members
employee_profiles

clients
client_contacts
client_requests

services

projects
project_members

tasks
task_comments
task_attachments

calendar_events
meeting_notes
meeting_participants
decisions
follow_ups

sops
sop_steps
sop_versions
sop_change_requests

knowledge_articles

time_entries
time_entry_approvals
employee_capacity

reports

ai_actions

api_keys
integrations
webhook_events

notifications
activity_logs
```

---

# 6W. Updated V1 Modules

The final V1 navigation should now be:

```text
AgencyOS
│
├── Dashboard
│
├── Calendar
│
├── Work
│   ├── All Work
│   ├── My Work
│   ├── This Week
│   ├── Overdue
│   ├── Waiting for QA
│   └── Completed
│
├── Clients
│
├── Projects
│
├── Team
│
├── SOPs
│
├── Knowledge
│
├── Reports
│
├── AI Assistant
│
├── Integrations
│
├── Activity
│
└── Settings
```

---

# 6X. Updated V1 Definition of Done

AgencyOS V1 should now allow an agency to:

### Manage people
- Create Owner, Admin, Manager, Employee, Contractor, and Client accounts
- Assign permissions
- Manage employee profiles
- Define working hours/capacity

### Manage clients
- Create clients
- Store goals
- Store contacts
- Record requests
- Maintain operational history

### Manage meetings
- Schedule meetings
- Link meetings to clients/projects
- Record structured meeting notes
- Record decisions
- Create follow-ups
- Convert action items into tasks

### Manage work
- Create projects
- Create tasks
- Assign owners
- Attach SOPs
- Track deadlines
- Run QA

### Manage time
- Start/stop timer
- Add manual time
- Assign time to client/project/task
- Mark billable/non-billable
- Submit time for approval
- View capacity
- Monitor retainer/hour allocations

### Manage processes
- Create SOPs
- Version SOPs
- Submit SOP change requests
- Approve and publish SOP updates
- Link SOP changes to the meeting/request that caused them

### Manage AI
- Connect AI providers
- Ask questions
- Analyze agency data
- Draft work
- Suggest priorities
- Extract meeting actions
- Suggest SOP changes
- Respect permissions
- Log AI actions

### Manage integrations
- API access
- MCP access
- API keys
- Webhooks
- Integration permissions

---

# 6Y. Product Principle

The AgencyOS should preserve the relationship between:

**Conversation → Decision → Request → Work → Time → QA → Result → Learning**

Nothing important from a client interaction should disappear.

Nothing important from employee work should become invisible.

Nothing important from an AI action should happen without appropriate control.

Nothing learned from repeated work should require the agency to rediscover it every time.

This is what makes AgencyOS an **operating system**, rather than just a task manager.
