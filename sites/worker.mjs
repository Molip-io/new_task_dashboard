import { mergeAgentSummaryRows } from '../lib/agent-summary-sync.mjs';
import { comparableSnapshot } from '../lib/operational-metadata.mjs';
import { collectSummaryRows } from '../lib/notion-collector.mjs';
import { compactDashboard, readLatestDashboardSnapshotFromNotion } from '../lib/dashboard-snapshot.mjs';
import { loadConfig } from '../lib/env.mjs';
import { runCollection } from '../collect.mjs';
import {
  SETTINGS_PREFIX, readSprintSettings, decorateSprintDashboard, saveSprintSettings,
  settingsOriginAllowed,
} from '../lib/sprint-settings.mjs';

const config = loadConfig();
const RUNTIME_ENV_KEYS = [
  'NOTION_TOKEN', 'SLACK_TOKEN', 'GITHUB_TOKEN', 'SPRINT_ADMIN_EMAILS',
  'DASHBOARD_URL', 'IGNORED_NOTION_USER_IDS', 'NOTION_REQUEST_TIMEOUT_MS',
  'CRON_SECRET', 'AI_SUMMARY_PROVIDER', 'OPENAI_API_KEY', 'OPENAI_MODEL',
];
export function applyRuntimeEnv(env = {}) {
  for (const key of RUNTIME_ENV_KEYS) {
    if (typeof env[key] === 'string') process.env[key] = env[key];
  }
}
function authenticatedUser(request) {
  return Boolean(request.headers.get('oai-authenticated-user-id'));
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

async function collectForWeb(request) {
  if (!process.env.NOTION_TOKEN) {
    throw Object.assign(new Error('NOTION_TOKEN is not configured'), { statusCode: 503 });
  }
  const previousSnapshot = (async () => {
    const latest = await readLatestDashboardSnapshotFromNotion({ databaseId: config.notion.summaryDbId });
    const currentDay = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return latest && latest.runId < `dashboard-snapshot:${currentDay}`
      ? comparableSnapshot(latest.dashboard)
      : null;
  })().catch(error => {
    console.error('[sites] previous snapshot unavailable:', error?.message);
    return null;
  });
  const result = await runCollection({
    noAi: true,
    persistFiles: false,
    localGitEnabled: false,
    previousSnapshot,
    dashboardUrl: process.env.DASHBOARD_URL || new URL(request.url).origin,
    notionOptions: {
      hydrateBodies: false, checkComments: true,
      hydrateMeetingBodies: false, hydrateSummaryBodies: false,
    },
  });
  if (!['created', 'updated'].includes(result.remoteSnapshot.status)) {
    throw Object.assign(new Error('Notion dashboard snapshot could not be saved'), { statusCode: 503 });
  }
  return decorateSprintDashboard(compactDashboard(result.dashboard), result.sprintSettings, {
    writable: sprintAdmin(request),
  });
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
      return json(await storedDashboard(request) || await collectForWeb(request));
    }
    if (pathname === '/api/status' && request.method === 'GET') {
      const dashboard = await storedDashboard(request);
      return json({
        collecting: false, summarySyncing: false,
        last: dashboard ? { state: 'done', at: dashboard.generatedAt } : { state: 'empty', at: null },
        remoteSnapshot: dashboard?.remoteSnapshot || null,
      });
    }
    if (pathname === '/api/refresh' && request.method === 'POST') {
      if (!authenticatedUser(request)) return json({ error: 'unauthorized' }, 401);
      const dashboard = await collectForWeb(request);
      return json({ started: true, completed: true, dashboard });
    }
    if (pathname === '/api/cron/collect' && request.method === 'GET') {
      const supplied = request.headers.get('authorization') || '';
      if (!env.CRON_SECRET || supplied !== `Bearer ${env.CRON_SECRET}`) {
        return json({ error: 'unauthorized' }, 401);
      }
      const dashboard = await collectForWeb(request);
      return json({ ok: true, generatedAt: dashboard.generatedAt, remoteSnapshot: dashboard.remoteSnapshot });
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    console.error(`[sites] ${pathname} failed:`, error?.message);
    return json({ error: 'dashboard_unavailable', message: '데이터를 불러오지 못했습니다. 잠시 후 다시 시도하세요.' }, error?.statusCode || 503);
  }
}

export default { fetch: handle };
