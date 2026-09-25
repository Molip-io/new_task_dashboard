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
- Manual refresh remains supported through `POST /api/refresh`.
- `GET /api/dashboard` should load the latest persisted dashboard snapshot from Notion and only collect live data when no snapshot exists.
- Sprint-setting writes remain server-side and protected.
- PM Control Tower P0 behavior must remain intact.
- Do not add D1/R2 unless the Site conversion proves durable state is actually required. Existing Notion persistence should be reused first.

## Known Vercel-specific pieces

- `vercel.json`
- `.vercelignore`
- Vercel Cron route configuration
- production URL currently stored in `config.json`

Do not delete these until the Site has been validated.

`DASHBOARD_URL` now overrides the config URL at runtime so the same source can run on Vercel and ChatGPT Sites during cutover.

## Runtime secrets / environment values

Configure these in ChatGPT Sites > Settings. Never paste their values into prompts or source code.

Required:
- `NOTION_TOKEN`
- `SLACK_TOKEN`

Required when private GitHub activity is collected:
- `GITHUB_TOKEN`

Required when sprint settings are writable on Sites:
- `SPRINT_ADMIN_EMAILS`

The Vercel runtime continues to use `SPRINT_SETTINGS_TOKEN` during rollback.

Optional:
- `IGNORED_NOTION_USER_IDS`
- `AI_SUMMARY_PROVIDER`, `OPENAI_API_KEY`, and `OPENAI_MODEL` apply to
  the legacy CLI/Vercel path; the Sites request path disables direct AI summaries
- `CRON_SECRET` only when a supported scheduler is connected
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
- Current Vercel production remains unchanged during validation.

## Implementation on the migration branch

- Sites builds `sites/worker.mjs` to `dist/server/index.js` and serves the original
  `public/` files through the Worker assets binding. `server.mjs`, `api/app.mjs`,
  and `vercel.json` remain intact for the existing Vercel production deployment.
- `GET /api/dashboard` reads the persisted Notion snapshot and current sprint
  settings. If the snapshot is absent, it runs a collection and requires the new
  snapshot to be saved to Notion before returning success.
- `POST /api/refresh` collects synchronously and returns a completed response.
  Requests can take substantially longer than reading a stored snapshot; a
  Worker runtime duration limit is still to be checked with actual integrations.
- `GET /api/status` reflects the last Notion snapshot. Request-local collection
  progress is not a durable global status. The UI reloads the saved snapshot.
- `POST /api/sprint-settings` uses the Sites signed-in user identity and a
  server-side `SPRINT_ADMIN_EMAILS` allowlist. The browser never receives or
  enters a settings token. `SPRINT_SETTINGS_TOKEN` remains used only by the
  untouched Vercel path.
- Live collection skips local Git repositories and uses the GitHub HTTP API.
  A local-only repository requires a GitHub URL and, if private, `GITHUB_TOKEN`.
  Local filesystem output and local `gh` credential fallback are disabled.
- No background timer runs in Sites. Manual refresh is available; an optional
  external scheduler may call `GET /api/cron/collect` with `CRON_SECRET`
  after an access route for the private Site has been configured. Scheduling
  is not activated by saving a Site version.
- The existing agent summary sync process is not scheduled in the Worker.
  Existing summary rows in Notion remain readable. A separate scheduled
  automation is required if the summary sync itself must remain automatic.

### Sites settings names

Required for collection: `NOTION_TOKEN`, `SLACK_TOKEN`.
Required for private GitHub access: `GITHUB_TOKEN`.
Required for sprint-setting writes: `SPRINT_ADMIN_EMAILS` (comma-separated
admin account emails).
Optional: `DASHBOARD_URL`, `IGNORED_NOTION_USER_IDS`,
`NOTION_REQUEST_TIMEOUT_MS`, and `CRON_SECRET` if an external scheduler
is enabled. Direct OpenAI API summaries are disabled in the Sites request path.

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
7. Only then retire the Vercel deployment and remove Vercel-only files/config in a separate cleanup commit.
