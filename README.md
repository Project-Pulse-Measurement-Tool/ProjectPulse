# ProjectPulse — AI-Powered Project Intelligence

Working web platform for the ProjectPulse course project (KBTU, IT Project Management, 2026).
Team: Aisha · Talshyn · Marzhan · Ayaulym · Sagynysh.

Backend: **Django 5 + Django REST Framework + SQLite** (as planned in the A5 charter).
Frontend: **React 18 + Vite**, built from the team's Figma file (Frames 12 and 13: dashboard and task page).

## Run it

Requirements: Python 3.11+ and Node 18+.

```bash
pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
python backend/manage.py migrate
python backend/manage.py seed_data          # team project + live Apache Jira data (needs internet)
python backend/manage.py runserver
```

Open http://127.0.0.1:8000.
`seed_data --offline` loads only the team project. For frontend hot-reload, run `npm run dev` in `frontend/` (port 5173, proxies `/api` to Django).

### Demo accounts

All seeded accounts use the password `pulse2026`:
`aisha`, `talshyn`, `marzhan`, `ayaulym`, `sagynysh` (team members) and `admin` (Django admin at `/admin/`).
New users can register at `/register`.

## Real data

| Project | Source |
|---|---|
| **ProjectPulse MVP** (`PP`) | Our own tasks T1–T34, K1–K10, ACT1/ACT3 with the real owners, dates, hours and dependencies from A3, A4, A5 and the A6/A7 Sprint 1 backlog (26 Oct – 8 Nov 2026). |
| **Apache Kafka, Flink, Spark, Cassandra** | Live import from the public Apache Software Foundation Jira (`issues.apache.org/jira`, REST API, no login). Up to 250 issues per project updated in the last 90 days with an assignee: real keys, titles, descriptions, assignees, statuses, priorities, types, fix versions, comments and blocking links. |

Any other Apache project can be imported from the UI (**Import from Apache Jira**), and imported projects can be re-synced in **Settings**.

ProjectPulse requires every task to have a deadline (US4). For imported issues the deadline is the Jira due date, otherwise the
release date of the earliest fix version, otherwise an estimate (created date + 14/21/45/75/90 days for Blocker/Critical/Major/Minor/Trivial).
Estimated deadlines are marked as such in the UI and counted on the Analytics page.
The "created per week" chart only covers the imported window (issues updated in the last 90 days).

## Features → course documents

| Feature | Where |
|---|---|
| F1 Task cards: one owner, deadline, status (US4, US5) | **Add task** form refuses a task without an owner; status pills on the task page; Kanban **Board** with drag-and-drop (or ←/→ keys) |
| F2 Workload view (US1, US6) | **Overview** card and **Workload** page: open tasks per member, "above limit" over the limit (default 3, editable in Settings); click a member to see their open tasks and move one to someone else |
| F5 Delay warnings (US3, US8) | Not started + due in ≤ 2 days → **At risk** with the reason; past deadline and not Done → **Delayed**; the owner gets a notification (bell) once when a task becomes Delayed |
| F3 Timeline (US7) | **Timeline**: six-week calendar of all deadlines, filter by person |
| F4 AI task & subtask suggestions (US2) | Task page → **AI suggest subtasks** → Accept all |
| AI Chat Assistant | **AI Assistant**: "Why are we behind schedule?", "Who is overloaded?", "What is due this week?", questions about a person or a task key (English or Russian) |
| AI Daily Brief | **Overview**: headline, closed since yesterday, due this week, most overdue, overloaded people, today's focus |
| Suggested next action | Task page card (Figma Frame 13): reassign to a less-loaded member, unblock dependencies, start or replan — Accept / Change owner / Dismiss |
| Basic Project Health Score | 0–100 from delayed, at-risk, overloaded and unfinished work, with the breakdown |
| Full Analytics Dashboard | **Analytics**: created vs resolved per week (chart or table), deadline status, priority, type, top closers, median cycle time, on-time rate |

## AI engine

Without configuration the assistant runs a built-in analyst that answers directly from the database — free, matching the
zero cash budget of the pilot. To use Claude instead, set an API key before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...      # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
```

Chat answers and subtask suggestions then go to `claude-opus-5-5` (override with `PP_CLAUDE_MODEL`). If the API call fails,
the app falls back to the built-in analyst automatically. The badge on the AI Assistant page shows which engine is active.

## Tests

```bash
python backend/manage.py test core
```

14 tests cover the acceptance criteria of US4, US1, US3 and US8 (including the 2-day / 3-day / passed boundary cases),
the AI assistant answers and the "Suggested next action" reassignment.

## API (all under `/api/`, token auth)

`auth/login` · `auth/register` · `projects` · `projects/<id>` · `projects/<id>/dashboard` · `projects/<id>/tasks` ·
`projects/<id>/workload` · `projects/<id>/timeline` · `projects/<id>/analytics` · `projects/<id>/chat` · `projects/<id>/brief` ·
`projects/<id>/sync` · `jira/import` · `tasks/<id>` · `tasks/<id>/suggestion` · `tasks/<id>/subtasks` · `tasks/<id>/suggest-subtasks` ·
`tasks/<id>/comments` · `notifications`

For a public deployment set `DJANGO_DEBUG=0`, `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS`, and serve `frontend/dist`
as static files (for example with WhiteNoise or the hosting platform's static file setting).
