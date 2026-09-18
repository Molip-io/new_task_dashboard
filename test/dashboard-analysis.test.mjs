import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisPresentation, formatKst, projectAnalysisPresentation } from '../public/dashboard-analysis.js';

const now = '2026-09-07T12:00:00Z';
function dashboard(status = 'success', generatedAt = now) {
  return { generatedAt: '2026-09-07T00:00:00Z', ai: { analysisStatus: status, generatedAt } };
}

test('KST timestamps convert UTC and offsets across date boundaries', () => {
  assert.equal(formatKst('2026-09-07T16:25:00Z'), '2026-09-08 01:25');
  assert.equal(formatKst('2026-09-07T09:30:00+09:00'), '2026-09-07 09:30');
  assert.equal(formatKst('2026-09-07T15:00:00Z'), '2026-09-08 00:00');
});

test('date-only values remain dates and invalid values have an empty placeholder', () => {
  assert.equal(formatKst('2026-09-07'), '2026-09-07');
  assert.equal(formatKst('2024-02-29'), '2024-02-29');
  for (const value of [null, undefined, '', 'invalid', '2026-02-30']) assert.equal(formatKst(value), '-');
});

test('fresh success and partial retain their distinct labels and narratives', () => {
  for (const status of ['success', 'partial']) {
    const result = analysisPresentation(dashboard(status), now);
    assert.equal(result.status, status);
    assert.equal(result.canShowNarrative, true);
    assert.ok(result.label);
  }
  assert.match(analysisPresentation(dashboard('partial'), now).notice, /일부/);
});

test('36 hours is inclusive and older success and partial become stale', () => {
  for (const status of ['success', 'partial']) {
    const data = dashboard(status, '2026-09-06T00:00:00Z');
    data.generatedAt = data.ai.generatedAt;
    assert.equal(analysisPresentation(data, now).status, status);
    data.ai.generatedAt = '2026-09-05T23:59:59.999Z';
    data.generatedAt = data.ai.generatedAt;
    const result = analysisPresentation(data, now);
    assert.equal(result.status, 'stale');
    assert.equal(result.canShowNarrative, true);
    assert.match(result.notice, /과거 분석/);
  }
});

test('input freshness compares instants and prefers the agent handoff', () => {
  const data = dashboard('success', '2026-09-07T09:00:00+09:00');
  assert.equal(analysisPresentation(data, now).status, 'success');
  data.agentHandoff = { generatedAt: '2026-09-07T00:00:00.001Z' };
  assert.equal(analysisPresentation(data, now).status, 'stale');
  data.generatedAt = now;
  data.agentHandoff.generatedAt = '2026-09-07T00:00:00Z';
  assert.equal(analysisPresentation(data, now).status, 'success');
});

test('failed, not_run, legacy and existing stale are preserved regardless of timestamps', () => {
  for (const status of ['failed', 'not_run', 'legacy', 'stale']) {
    for (const time of ['2020-01-01T00:00:00Z', null]) {
      const result = analysisPresentation(dashboard(status, time), now);
      assert.equal(result.status, status);
      assert.equal(result.canShowNarrative, status === 'stale');
    }
  }
});

test('missing or invalid times never claim freshness but preserve available narratives', () => {
  for (const status of ['success', 'partial']) {
    for (const time of [null, 'invalid']) {
      const data = dashboard(status);
      data.ai.generatedAt = time;
      assert.equal(analysisPresentation(data, now).status, 'unknown');
      assert.equal(analysisPresentation(data, now).canShowNarrative, true);
      data.ai.generatedAt = now;
      data.generatedAt = time;
      assert.equal(analysisPresentation(data, now).status, 'unknown');
    }
    assert.equal(analysisPresentation(dashboard(status), 'invalid').status, 'unknown');
  }
});

test('a proven stale timestamp stays stale even if another timestamp is unavailable', () => {
  const data = dashboard('partial', '2020-01-01T00:00:00Z');
  delete data.generatedAt;
  assert.equal(analysisPresentation(data, now).status, 'stale');
});

test('absent analysis and unrecognized status are distinguishable from a successful empty result', () => {
  assert.equal(analysisPresentation({}, now).status, 'not_run');
  assert.equal(analysisPresentation(null, now).canShowNarrative, false);
  assert.equal(analysisPresentation(dashboard('unrecognized'), now).status, 'unknown');
  assert.equal(analysisPresentation(dashboard('unrecognized'), now).canShowNarrative, false);
});

test('project summaries use the same freshness label as the executive briefing', () => {
  const data = dashboard('success', '2026-09-05T00:00:00Z');
  data.generatedAt = data.ai.generatedAt;
  data.ai.projects = [{ name: '피자레디', summary: '과거 에이전트 프로젝트 요약' }];

  assert.deepEqual(projectAnalysisPresentation(data, { name: '피자레디' }, now), {
    label: '에이전트 통합 분석 · 갱신 필요',
    text: '과거 에이전트 프로젝트 요약',
    status: 'stale',
  });
});

test('failed or unrun project analysis hides leftover agent text and falls back to the project database summary', () => {
  for (const status of ['failed', 'not_run', 'legacy']) {
    const data = dashboard(status);
    data.ai.projects = [{ name: '피자레디', summary: '표시하면 안 되는 잔여 요약' }];
    const project = { name: '피자레디', notionSummary: { summary: '업무현황 DB 요약' } };
    assert.deepEqual(projectAnalysisPresentation(data, project, now), {
      label: '업무현황 요약 DB',
      text: '업무현황 DB 요약',
      status,
    });
  }
});

test('project summary matching is exact and returns no claim when no trusted summary exists', () => {
  const data = dashboard('success');
  data.ai.projects = [{ name: '피자', summary: '다른 프로젝트 요약' }];
  assert.equal(projectAnalysisPresentation(data, { name: '피자레디' }, now), null);
});
