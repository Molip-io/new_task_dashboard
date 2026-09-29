# ChatGPT Sites migration

Target: replace Vercel hosting for the MOLIP task dashboard with ChatGPT Sites while preserving the existing Notion/Slack/Git collection and PM Control Tower work.

## Safety rule

Do not remove the current Vercel production deployment until the ChatGPT Site has passed functional validation.

The current production dashboard remains the rollback target during migration.

## Source

Repository: `Molip-io/new_task_dashboard`

Migration branch: `chatgpt/sites-migration`

This branch includes the PM Control Tower P0 foundation from `chatgpt/pm-control-tower-p0`.

## Desired ChatGPT Sites architecture

- ChatGPT Sites hosts the dashboard UI and server-side request handlers.
- Notion remains the durable source of truth and remote dashboard snapshot store.
- Runtime secrets stay in ChatGPT Sites Settings, never in source files.
- The application must not depend on local filesystem persistence between requests.
- The Site is display-only. It never collects: `POST /api/refresh` and `GET /api/cron/collect` answer 410.
- `GET /api/dashboard` loads the latest persisted dashboard snapshot from Notion and merges the saved analysis. Without a snapshot it answers 503.
- Sprint-setting writes remain server-side and protected.
- PM Control Tower P0 behavior must remain intact.
- Do not add D1/R2 unless the Site conversion proves durable state is actually required. Existing Notion persistence should be reused first.

## Vercel retired (2026-09-29)

The Vercel deployment and its files (`vercel.json`, `.vercelignore`, `api/app.mjs`,
the Vercel handler and the `/api/cron/collect` route) were removed once the morning
routine collected Notion, Slack and GitHub itself. `config.json` now points
`dashboardUrl` at the Site; `DASHBOARD_URL` still overrides it at runtime.

## Runtime secrets / environment values

Configure these in ChatGPT Sites > Settings. Never paste their values into prompts or source code.

Required:
- `NOTION_TOKEN`
- `SLACK_TOKEN`

Required when private GitHub activity is collected:
- `GITHUB_TOKEN`

Required when sprint settings are writable on Sites:
- `SPRINT_ADMIN_EMAILS`

The local server (`dashboard/api/server.mjs`) uses `SPRINT_SETTINGS_TOKEN`.

Optional:
- `IGNORED_NOTION_USER_IDS`
- `AI_SUMMARY_PROVIDER`, `OPENAI_API_KEY`, and `OPENAI_MODEL` apply to
  the legacy CLI path; the Sites request path disables direct AI summaries
- `DASHBOARD_URL` set to the final ChatGPT Site URL after first deployment

## Sites handoff prompt

Use this prompt in ChatGPT Work or Codex with @Sites and the checked-out migration branch:

> Deploy this existing project with ChatGPT Sites, but do not publish it yet.
> Source project: Molip-io/new_task_dashboard, branch chatgpt/sites-migration.
> First inspect the project and confirm whether its current Node/server/API shape can produce compatible ChatGPT Sites deployment artifacts.
> Preserve the existing dashboard UI, Notion/Slack/Git integrations, PM Control Tower P0 behavior, /api/dashboard, /api/refresh, /api/status, and sprint settings behavior.
> Reuse Notion as the durable source of truth and snapshot store. Do not add D1 or R2 unless the existing Notion-backed persistence is insufficient.
> Remove or replace runtime assumptions that depend on Vercel-specific routing, Vercel Cron, a long-running background server, child-process scheduling, or durable local filesystem state.
> Keep all secrets server-side and declare only the environment variable names required in Site Settings.
> Do not expose NOTION_TOKEN, SLACK_TOKEN, GITHUB_TOKEN, SPRINT_SETTINGS_TOKEN, CRON_SECRET, or OPENAI_API_KEY to the client.
> Keep the Site restricted to the owner/workspace during validation.
> Save a reviewable Site version only. Do not deploy/publish until I explicitly approve it.
> After the build succeeds, show:
> 1. compatibility changes made,
> 2. required Site environment variable names,
> 3. unsupported or degraded behavior,
> 4. whether scheduled collection needs a replacement,
> 5. the saved version identifier,
> 6. a functional test checklist.

## Validation checklist before cutover

- Home page loads.
- `GET /api/dashboard` returns the latest Notion-backed snapshot.
- Forge & Fortune current sprint is recognized as Sprint4.
- Pizza Ready current sprints are preserved project-by-project.
- Manual data refresh succeeds.
- Delay-comment evidence prevents false `MISSING_DELAY_*` warnings.
- If comment evidence cannot be read, output is unknown/not-evaluated rather than a false missing claim.
- Slack collection succeeds.
- Notion collection succeeds.
- Git activity loads or reports an explicit source limitation.
- No secret appears in browser HTML, JS bundles, API responses, or logs.

## Implementation on the migration branch

- Sites builds `dashboard/api/worker.mjs` to `dist/server/index.js` and serves the
  `dashboard/ui/` files through the Worker assets binding (`npm run build`).
  `dashboard/api/server.mjs` remains for local development.
- `GET /api/dashboard` reads the persisted Notion snapshot, the saved analysis and
  the current sprint settings. If there is no snapshot it answers 503 instead of
  collecting. Collection and publishing the snapshot are done by the morning
  routine (`agent/runtime/collect.mjs`).
- `POST /api/refresh` and `GET /api/cron/collect` answer 410. The page shows when
  the data was last collected.
- `GET /api/status` reflects the last Notion snapshot.
- `POST /api/sprint-settings` uses the Sites signed-in user identity and a
  server-side `SPRINT_ADMIN_EMAILS` allowlist. The browser never receives or
  enters a settings token. `SPRINT_SETTINGS_TOKEN` remains used only by the
  local server.
- The Site needs only `NOTION_TOKEN`, `SPRINT_ADMIN_EMAILS` and optionally
  `DASHBOARD_URL`. It does not need `SLACK_TOKEN` or `GITHUB_TOKEN`;
  those belong to the routine environment that collects.
- No background timer runs in Sites, and none is needed.
- The existing agent summary sync process is not scheduled in the Worker.
  Existing summary rows in Notion remain readable. A separate scheduled
  automation is required if the summary sync itself must remain automatic.

### Sites settings names

Required for collection: `NOTION_TOKEN`, `SLACK_TOKEN`.
Required for private GitHub access: `GITHUB_TOKEN`.
Required for sprint-setting writes: `SPRINT_ADMIN_EMAILS` (comma-separated
admin account emails).
Optional: `DASHBOARD_URL`, `IGNORED_NOTION_USER_IDS`,
and `NOTION_REQUEST_TIMEOUT_MS`. Direct OpenAI API summaries are disabled in the Sites request path.

The published Site must remain private and use dispatcher-provided authenticated
user headers. Saving a version does not activate collection, scheduling, or
private credential validation.

## Cutover

Only after validation passes:

1. Deploy the approved saved Site version.
2. Record the production Site URL.
3. Set `DASHBOARD_URL` to the Site URL in Site Settings and redeploy the approved version if needed.
4. Restrict Site access to the intended MOLIP workspace/users.
5. Re-run the functional checklist.
6. Decide how scheduled collection will run. Do not assume background services are available.
7. Only then retire the Vercel deployment and remove Vercel-only files/config in a separate cleanup commit. (Done 2026-09-29.)
