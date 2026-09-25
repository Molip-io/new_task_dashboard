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

Required when sprint settings are writable:
- `SPRINT_SETTINGS_TOKEN`

Optional:
- `IGNORED_NOTION_USER_IDS`
- `AI_SUMMARY_PROVIDER`
- `OPENAI_API_KEY` only when direct OpenAI API summaries are explicitly enabled
- `OPENAI_MODEL`
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

## Cutover

Only after validation passes:

1. Deploy the approved saved Site version.
2. Record the production Site URL.
3. Set `DASHBOARD_URL` to the Site URL in Site Settings and redeploy the approved version if needed.
4. Restrict Site access to the intended MOLIP workspace/users.
5. Re-run the functional checklist.
6. Decide how scheduled collection will run. Do not assume background services are available.
7. Only then retire the Vercel deployment and remove Vercel-only files/config in a separate cleanup commit.
