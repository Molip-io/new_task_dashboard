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

loadEnv();
const config = loadConfig();
const PUBLIC = path.join(ROOT, 'public');
const TEMP_DATA = path.join(os.tmpdir(), 'molip-task-dashboard');
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
  // The dashboard is public for now. Keep only the internal cron guard so
  // anyone can view the UI/API without a Basic Auth prompt while scheduled
  // collection cannot be triggered anonymously.
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
  const snapshot = await readLatestDashboardSnapshotFromNotion({ databaseId: config.notion.summaryDbId });
  if (!snapshot) return null;
  const errors = [];
  const rows = await collectSummaryRows(config, errors);
  const merged = mergeAgentSummaryRows(snapshot.dashboard, rows);
  const dashboard = merged.dashboard;
  if (errors.length) dashboard.errors = [...new Set([...(dashboard.errors || []), ...errors])];
  dashboard.remoteSnapshot = {
    status: 'loaded',
    runId: snapshot.runId,
    pageId: snapshot.pageId,
    updatedAt: snapshot.updatedAt,
  };
  return dashboard;
}

async function collectForWeb() {
  let previous = null;
  try {
    const latest = await readLatestDashboardSnapshotFromNotion({ databaseId: config.notion.summaryDbId });
    const currentDay = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (latest && latest.runId < `dashboard-snapshot:${currentDay}`) previous = comparableSnapshot(latest.dashboard);
  } catch (error) {
    console.error('[dashboard] previous snapshot unavailable:', error.message);
  }
  const result = await runCollection({
    dataDirectory: TEMP_DATA,
    noAi: true,
    previousSnapshot: previous,
    // The serverless refresh must finish within a request. Properties and
    // database rows are enough for the rule engine; full page/comment hydration
    // remains enabled for the local `node collect.mjs` path.
    notionOptions: {
      hydrateBodies: false,
      checkComments: true,
      hydrateMeetingBodies: true,
      meetingBodyBudget: 120,
      hydrateSummaryBodies: false,
    },
  });
  return compactDashboard(result.dashboard);
}

function snapshotIsStale(dashboard) {
  const generated = new Date(dashboard?.generatedAt || 0).getTime();
  return !Number.isFinite(generated) || Date.now() - generated > 36 * 60 * 60_000;
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
    if (pathname === '/api/dashboard') {
      let dashboard = await storedDashboard();
      if (!dashboard || snapshotIsStale(dashboard)) dashboard = await collectForWeb();
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
      const dashboard = await collectForWeb();
      return send(response, 200, { started: true, completed: true, dashboard });
    }
    if (pathname === '/api/cron/collect' && request.method === 'GET') {
      const dashboard = await collectForWeb();
      return send(response, 200, { ok: true, generatedAt: dashboard.generatedAt, remoteSnapshot: dashboard.remoteSnapshot || null });
    }
    return serveStatic(pathname, response);
  } catch (error) {
    console.error(`[dashboard] ${pathname} failed:`, error);
    return send(response, 500, { error: 'dashboard_unavailable', message: error.message });
  }
}
