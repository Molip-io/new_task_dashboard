import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeAgentSummaryRows } from '../lib/agent-summary-sync.mjs';

test('Given a same-day agent result older than the latest rule input, When summaries merge, Then it is marked stale and not current', () => {
  const dashboard = {
    generatedAt: '2026-08-06T09:29:05.790Z',
    agentHandoff: { generatedAt: '2026-08-06T09:29:05.790Z' },
    projects: [{ name: 'UI 자동화' }],
    ai: { analysisStatus: 'partial', overall: { summary: '이전 요약' } },
  };
  const rows = [{
    프로젝트명: '전체',
    run_id: '2026-08-06-morning',
    '분석 상태': 'partial',
    '분석 시각': '2026-08-06T18:04:35.173+09:00',
    '분석 결과 JSON': JSON.stringify({
      schemaVersion: '1.0', runId: '2026-08-06-morning', generatedAt: '2026-08-06T18:04:35.173+09:00',
      analysisStatus: 'partial', overall: { summary: '이전 요약', topRisks: [], decisionsForCEO: [], changesSinceYesterday: [], sourceConflicts: [], confidenceLimits: [] },
      projects: [], sourceStatus: {}, sourceComparison: { status: 'partial' }, ruleMetrics: {}, adjustments: [],
    }),
  }];

  const merged = mergeAgentSummaryRows(dashboard, rows, '2026-08-06T09:30:00.000Z');

  assert.equal(merged.current, false);
  assert.equal(merged.analysis.analysisStatus, 'stale');
  assert.equal(merged.dashboard.ai.overall.summary, '이전 요약');
});
