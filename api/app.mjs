import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeAgentSummaryRows } from '../lib/agent-summary-sync.mjs';
import { comparableSnapshot } from '../lib/operational-metadata.mjs';
import { collectSummaryRows } from '../lib/notion-collector.mjs';
import {
  compactDashboard,
  readLatestDashboardSnapshotFromNotion,
} from '../lib/dashboard-snapshot.mjs';
import { loadConfig, loadEnv, ROOT } from '../lib/env.mjs';
import { runCollection } from '../collect.mjs';
import { createExpiringCache } from '../lib/expiring-cache.mjs';
import { SETTINGS_PREFIX, readSprintSettings, decorateSprintDashboard, saveSprintSettings, readSettingsBody, settingsWriteAuthorized, settingsOriginAllowed } from '../lib/sprint-settings.mjs';

loadEnv();
const config = loadConfig();
const PUBLIC = path.join(ROOT, 'public');
const TEMP_DATA = path.join(os.tmpdir(), 'molip-task-dashboard');
const dashboardCache = createExpiringCache({ ttlMs: 60_000 });
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function requestIsAuthorized(request, pathname) {
  if (pathname !== '/api/cron/collect') return true;
  const authorization = request.headers.authorization || '';
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && authorization.startsWith('Bearer ')
    && safeEqual(authorization.slice(7), secret);
}

function send(response, status, body, type = 'application/json') {
  response.statusCode = status;
  response.setHeader('Content-Type', `${type}; charset=utf-8`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function storedDashboard() {
  const cached = dashboardCache.get();
  if (cached) return cached;
  const errors = [];
  let snapshot;
  let rows;
  let sprintSettings;
  try {
    [snapshot, rows, sprintSettings] = await Promise.all([
      readLatestDashboardSnapshotFromNotion({ databaseId: config.notion.summaryDbId }),
      collectSummaryRows(config, errors),
      readSprintSettings({ databaseId: config.notion.summaryDbId }),
    ]);
  } catch (error) {
    console.error('[dashboard] stored snapshot/settings unavailable:', error.message);
    throw error;
  }
  if (!snapshot) return null;
  const merged = mergeAgentSummaryRows(snapshot.dashboard, rows.filter(row => !String(row.run_id || '').startsWith(SETTINGS_PREFIX)));
  const dashboard = decorateSprintDashboard(merged.dashboard, sprintSettings, { writable: (process.env.SPRINT_SETTINGS_TOKEN || '').length >= 24 });
  if (errors.length) dashboard.errors = [...new Set([...(dashboard.errors || []), ...errors])];
  dashboard.remoteSnapshot = {
    status: 'loaded',
    runId: snapshot.runId,
    pageId: snapshot.pageId,
    updatedAt: snapshot.updatedAt,
  };
  return dashboardCache.set(dashboard);
}

async function collectForWeb() {
  const previousSnapshot = (async () => {
    try {
      const latest = await readLatestDashboardSnapshotFromNotion({ databaseId: config.notion.summaryDbId });
      const currentDay = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return latest && latest.runId < `dashboard-snapshot:${currentDay}`
        ? comparableSnapshot(latest.dashboard)
        : null;
    } catch (error) {
      console.error('[dashboard] previous snapshot unavailable:', error.message);
      return null;
    }
  })();
  const result = await runCollection({
    dataDirectory: TEMP_DATA,
    noAi: true,
    previousSnapshot,
    notionOptions: {
      hydrateBodies: false,
      checkComments: true,
      hydrateMeetingBodies: false,
      hydrateSummaryBodies: false,
    },
  });
  const settings = result.sprintSettings
    || await readSprintSettings({ databaseId: config.notion.summaryDbId });
  return decorateSprintDashboard(compactDashboard(result.dashboard), settings, { writable: (process.env.SPRINT_SETTINGS_TOKEN || '').length >= 24 });
}

function serveStatic(pathname, response) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const full = path.resolve(PUBLIC, relative);
  if (!full.startsWith(`${PUBLIC}${path.sep}`) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    send(response, 404, { error: 'not_found' });
    return;
  }
  send(response, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
}

export default async function handler(request, response) {
  const url = new URL(request.url, 'https://dashboard.local');
  const pathname = url.pathname;
  if (!requestIsAuthorized(request, pathname)) {
    response.setHeader('WWW-Authenticate', 'Bearer realm="dashboard-cron"');
    return send(response, 401, 'Cron authentication required', 'text/plain');
  }

  try {
    if (pathname === '/api/sprint-settings') {
      if (request.method !== 'POST') return send(response, 405, { message: 'POST만 허용합니다.' });
      if (!settingsWriteAuthorized(request) || !settingsOriginAllowed(request)) return send(response, 403, { message: '스프린트 설정 관리자 인증이 필요합니다.' });
      const body = await readSettingsBody(request);
      const dashboard = await storedDashboard();
      if (!dashboard) return send(response, 409, { message: '먼저 데이터를 수집하세요.' });
      const result = await saveSprintSettings({
        databaseId: config.notion.summaryDbId,
        dashboard,
        input: body.input,
        expectedRevision: body.expectedRevision,
      });
      dashboardCache.clear();
      return send(response, 200, result);
    }
    if (pathname === '/api/dashboard') {
      let dashboard = await storedDashboard();
      if (!dashboard) dashboard = dashboardCache.set(await collectForWeb());
      return send(response, 200, dashboard);
    }
    if (pathname === '/api/status') {
      const dashboard = await storedDashboard();
      return send(response, 200, {
        collecting: false,
        summarySyncing: false,
        last: dashboard ? { state: 'done', at: dashboard.generatedAt } : { state: 'empty', at: null },
        remoteSnapshot: dashboard?.remoteSnapshot || null,
      });
    }
    if (pathname === '/api/refresh' && request.method === 'POST') {
      const dashboard = dashboardCache.set(await collectForWeb());
      return send(response, 200, { started: true, completed: true, dashboard });
    }
    if (pathname === '/api/cron/collect' && request.method === 'GET') {
      const dashboard = dashboardCache.set(await collectForWeb());
      return send(response, 200, { ok: true, generatedAt: dashboard.generatedAt, remoteSnapshot: dashboard.remoteSnapshot || null });
    }
    return serveStatic(pathname, response);
  } catch (error) {
    console.error(`[dashboard] ${pathname} failed:`, error);
    return send(response, error.statusCode || 500, { error: 'dashboard_unavailable', message: error.message });
  }
}
