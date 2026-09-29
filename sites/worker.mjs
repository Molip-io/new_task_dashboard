import { mergeAgentSummaryRows } from '../lib/agent-summary-sync.mjs';
import { collectSummaryRows } from '../lib/notion-collector.mjs';
import { readLatestDashboardSnapshotFromNotion } from '../lib/dashboard-snapshot.mjs';
import { loadConfig } from '../lib/env.mjs';
import {
  SETTINGS_PREFIX, readSprintSettings, decorateSprintDashboard, saveSprintSettings,
  settingsOriginAllowed,
} from '../lib/sprint-settings.mjs';

const config = loadConfig();
const RUNTIME_ENV_KEYS = [
  'NOTION_TOKEN', 'SLACK_TOKEN', 'GITHUB_TOKEN', 'SPRINT_ADMIN_EMAILS',
  'DASHBOARD_URL', 'IGNORED_NOTION_USER_IDS', 'NOTION_REQUEST_TIMEOUT_MS',
  'AI_SUMMARY_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL',
];
export function applyRuntimeEnv(env = {}) {
  for (const key of RUNTIME_ENV_KEYS) {
    if (typeof env[key] === 'string') process.env[key] = env[key];
  }
}
function authenticatedUser(request) {
  return Boolean(request.headers.get('oai-authenticated-user-id'));
}
function runtimeErrorCode(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('notion_token is not configured') || message.includes('notion_token 없음')) return 'missing_notion_token';
  if (message.includes('notion 401') || message.includes('unauthorized') || message.includes('invalid token')) return 'notion_auth_failed';
  if (message.includes('notion 403') || message.includes('permission') || message.includes('restricted')) return 'notion_permission_denied';
  if (message.includes('timeout') || message.includes('타임아웃')) return 'notion_timeout';
  return 'backend_unavailable';
}
async function healthCheck(request) {
  const configured = {
    notion: Boolean(process.env.NOTION_TOKEN),
    slack: Boolean(process.env.SLACK_TOKEN),
    github: Boolean(process.env.GITHUB_TOKEN),
    sprintAdmins: Boolean(process.env.SPRINT_ADMIN_EMAILS),
  };
  const checks = {
    snapshot: { status: 'skipped', exists: false },
    summaries: { status: 'skipped' },
    sprintSettings: { status: 'skipped' },
  };
  if (!configured.notion) {
    return { ok: false, reason: 'missing_notion_token', configured, checks };
  }

  try {
    const snapshot = await readLatestDashboardSnapshotFromNotion({ databaseId: config.notion.summaryDbId });
    checks.snapshot = { status: 'ok', exists: Boolean(snapshot) };
  } catch (error) {
    checks.snapshot = { status: 'failed', reason: runtimeErrorCode(error) };
  }

  try {
    const errors = [];
    await collectSummaryRows(config, errors);
    checks.summaries = errors.length
      ? { status: 'partial', issueCount: errors.length }
      : { status: 'ok' };
  } catch (error) {
    checks.summaries = { status: 'failed', reason: runtimeErrorCode(error) };
  }

  try {
    await readSprintSettings({ databaseId: config.notion.summaryDbId });
    checks.sprintSettings = { status: 'ok' };
  } catch (error) {
    checks.sprintSettings = { status: 'failed', reason: runtimeErrorCode(error) };
  }

  const failed = Object.values(checks).some(check => check.status === 'failed');
  const reason = failed
    ? Object.values(checks).find(check => check.status === 'failed')?.reason || 'backend_unavailable'
    : !checks.snapshot.exists ? 'snapshot_missing' : null;
  return {
    ok: !failed,
    reason,
    authenticated: authenticatedUser(request),
    configured,
    checks,
  };
}
const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});
function sprintAdmin(request) {
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const allowed = (process.env.SPRINT_ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return Boolean(email && allowed.includes(email) && request.headers.get('oai-authenticated-user-id'));
}

async function storedDashboard(request) {
  const errors = [];
  const [snapshot, rows, settings] = await Promise.all([
    readLatestDashboardSnapshotFromNotion({ databaseId: config.notion.summaryDbId }),
    collectSummaryRows(config, errors),
    readSprintSettings({ databaseId: config.notion.summaryDbId }),
  ]);
  if (!snapshot) return null;
  const merged = mergeAgentSummaryRows(snapshot.dashboard, rows.filter(row => !String(row.run_id || '').startsWith(SETTINGS_PREFIX)));
  const dashboard = decorateSprintDashboard(merged.dashboard, settings, {
    writable: sprintAdmin(request),
  });
  if (errors.length) dashboard.errors = [...new Set([...(dashboard.errors || []), ...errors])];
  dashboard.remoteSnapshot = {
    status: 'loaded', runId: snapshot.runId, pageId: snapshot.pageId, updatedAt: snapshot.updatedAt,
  };
  return dashboard;
}

async function handle(request, env) {
  // Only copy string runtime configuration into process.env. Bindings such as ASSETS
  // are objects and must remain on the Worker env object.
  applyRuntimeEnv(env);
  process.env.SITES_RUNTIME = '1';
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  try {
    if (pathname === '/api/health' && request.method === 'GET') {
      if (!authenticatedUser(request)) return json({ error: 'unauthorized' }, 401);
      return json(await healthCheck(request));
    }
    if (pathname === '/api/sprint-settings') {
      if (request.method !== 'POST') return json({ message: 'POST만 허용합니다.' }, 405);
      const authRequest = { headers: {
        authorization: request.headers.get('authorization'),
        origin: request.headers.get('origin'),
        host: url.host,
      } };
      if (!sprintAdmin(request) || !settingsOriginAllowed(authRequest)
        || request.headers.get('sec-fetch-site') === 'cross-site') {
        return json({ message: '스프린트 설정 관리자 인증이 필요합니다.' }, 403);
      }
      const body = await request.json();
      const dashboard = await storedDashboard(request);
      if (!dashboard) return json({ message: '먼저 데이터를 수집하세요.' }, 409);
      const result = await saveSprintSettings({
        databaseId: config.notion.summaryDbId,
        dashboard,
        input: body.input,
        expectedRevision: body.expectedRevision,
      });
      return json(result);
    }
    if (pathname === '/api/dashboard' && request.method === 'GET') {
      // Display only: the stored snapshot merged with the saved analysis. Collection
      // belongs to the morning routine, never to a page view.
      const dashboard = await storedDashboard(request);
      if (!dashboard) return json({ error: 'no_snapshot', message: '저장된 수집 결과가 없습니다. 아침 수집이 끝난 뒤 다시 확인하세요.' }, 503);
      return json(dashboard);
    }
    if (pathname === '/api/status' && request.method === 'GET') {
      const dashboard = await storedDashboard(request);
      return json({
        collecting: false, summarySyncing: false,
        last: dashboard ? { state: 'done', at: dashboard.generatedAt } : { state: 'empty', at: null },
        remoteSnapshot: dashboard?.remoteSnapshot || null,
      });
    }
    if (pathname === '/api/refresh' || pathname === '/api/cron/collect') {
      return json({ error: 'collection_removed', message: '화면에서 수집을 실행하지 않습니다. 수집은 아침 루틴이 실행합니다.' }, 410);
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    console.error(`[sites] ${pathname} failed:`, error?.message);
    return json({
      error: 'dashboard_unavailable',
      reason: runtimeErrorCode(error),
      message: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.',
    }, error?.statusCode || 503);
  }
}

export default { fetch: handle };
