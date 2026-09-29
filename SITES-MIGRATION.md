# ChatGPT Sites deployment

ChatGPT Sites hosts the dashboard. The Site only displays data; collection and
analysis belong to the morning routine ([agent/package/ROUTINE_RUNTIME.md](agent/package/ROUTINE_RUNTIME.md)).

## Build and publish

`npm run build` bundles `dashboard/api/worker.mjs` into `dist/server/index.js` and
copies `dashboard/ui/` into `dist/client`, served through the Worker assets binding.
Publish from `main` with @Sites.

## Routes

- `GET /api/dashboard`: latest `dashboard-snapshot:YYYY-MM-DD` from the Notion summary
  DB, merged with the saved analysis and sprint settings. No snapshot → 503.
- `GET /api/status`: time of the last snapshot.
- `GET /api/health`: signed-in users only. Reports which settings exist and whether
  Notion is reachable, never their values.
- `POST /api/sprint-settings`: the signed-in user must be listed in
  `SPRINT_ADMIN_EMAILS`; cross-site requests are refused. The browser never holds a token.
- `POST /api/refresh`, `GET /api/cron/collect`: 410. The Site never collects.

Notion is the only durable store. There is no local file state, D1, R2 or background timer.

## Pages

- `/`: dashboard.
- `/share.html`: list for workers to update Notion — overdue items, guide violations
  and readiness items, filterable by assignee.

## Site settings

Set in ChatGPT Sites > Settings. Never paste values into prompts or source.

- Required: `NOTION_TOKEN`.
- Sprint-setting writes: `SPRINT_ADMIN_EMAILS` (comma-separated emails).
- Optional: `DASHBOARD_URL` (overrides `dashboardUrl` in `config.json`),
  `IGNORED_NOTION_USER_IDS`, `NOTION_REQUEST_TIMEOUT_MS`.

`SLACK_TOKEN` and `GITHUB_TOKEN` are not needed here; they belong to the routine environment.

The Site stays private to the MOLIP workspace and relies on the dispatcher's
authenticated-user headers.

## After each publish

- `/` loads and `/api/dashboard` returns today's snapshot with the analysis.
- `/share.html` shows the three counts.
- `/api/health` reports `configured.notion: true` and an existing snapshot.
- No secret appears in HTML, JS bundles or API responses.
