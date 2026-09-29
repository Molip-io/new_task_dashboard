#!/usr/bin/env node
// Usage: node tools/agent-routine/collect.mjs
// Runs the dashboard collector from the routine. It publishes today's rule input
// and the dashboard snapshot to Notion, comparing against the previous day's
// Notion snapshot. Needs NOTION_TOKEN, SLACK_TOKEN and GITHUB_TOKEN.
import { loadConfig, loadEnv } from '../../lib/env.mjs';
import { runCollection } from '../../collect.mjs';
import { preflightSources, readPreviousDashboardSnapshot } from '../../lib/agent-routine.mjs';

loadEnv();
try {
  const missing = ['NOTION_TOKEN', 'SLACK_TOKEN', 'GITHUB_TOKEN'].filter(name => !process.env[name]);
  // Report unreachable or unauthenticated sources up front so a person can fix the
  // environment; collection still runs and degrades those sources.
  const preflight = await preflightSources();
  const blocked = preflight.filter(item => !item.ok).map(item => `${item.source}: ${item.detail || '사용 불가'}`);
  if (blocked.length) console.error(`수집 전 점검 — 사람이 처리할 설정: ${blocked.join(' / ')}`);
  if (missing.includes('NOTION_TOKEN')) throw new Error('NOTION_TOKEN 환경변수가 없습니다.');
  const previousSnapshot = readPreviousDashboardSnapshot({ databaseId: loadConfig().notion.summaryDbId })
    .catch(error => { console.error(`이전 스냅샷을 읽지 못해 변경 비교 없이 수집합니다: ${error.message}`); return null; });
  const { dashboard, remoteHandoff, remoteSnapshot } = await runCollection({ noAi: true, previousSnapshot });
  console.log(JSON.stringify({
    status: remoteHandoff.status === 'failed' ? 'failed' : 'collected',
    missingTokens: missing,
    preflight,
    ruleInput: { status: remoteHandoff.status, runId: remoteHandoff.runId, partCount: remoteHandoff.partCount || 0, error: remoteHandoff.error || null },
    dashboardSnapshot: { status: remoteSnapshot.status, error: remoteSnapshot.error || null },
    comparison: dashboard.snapshotComparison || null,
    errors: dashboard.errors || [],
  }, null, 2));
  if (remoteHandoff.status === 'failed') process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', message: error.message }));
  process.exitCode = 1;
}
