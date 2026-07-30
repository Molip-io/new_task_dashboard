import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentAnalysis, latestProjectSummaryRow } from '../lib/agent-analysis.mjs';

const rows = [
  {
    프로젝트명: '피자레디',
    생성시각: '2026-07-21T00:30:00.000Z',
    '분석 상태': '성공',
    '분석 실행 ID': '2026-07-21-morning',
    '현재 진행 요약': 'Sprint 60의 개발과 아트 작업이 진행 중이다.',
    '대표 결정 필요': '익스프레스 범위를 확인해야 한다.',
    '막힌 점': '기획 범위 확인 대기',
    '다음 액션': 'PD가 범위를 확인한다.',
    '출처 대조 상태': '완료',
    '출처 충돌 요약': JSON.stringify([{
      project: '피자레디', subject: '익스프레스 범위', notionClaim: '기획 중',
      slackClaim: '확정됐다는 언급', slackChannel: 's2_pizzaready', slackTime: '2026-07-20T08:00:00Z',
    }]),
  },
  {
    프로젝트명: '피자레디',
    생성시각: '2026-07-20T00:30:00.000Z',
    '현재 진행 요약': '이전 요약',
  },
];

test('Given daily Notion agent rows, When the dashboard analysis is built, Then the latest successful project result and source conflicts are exposed', () => {
  const analysis = buildAgentAnalysis(rows, ['피자레디'], '2026-07-21T01:00:00.000Z');

  assert.equal(analysis.provider, 'notion-agent');
  assert.equal(analysis.analysisStatus, 'success');
  assert.equal(analysis.runId, '2026-07-21-morning');
  assert.equal(analysis.projects[0].summary, 'Sprint 60의 개발과 아트 작업이 진행 중이다.');
  assert.equal(analysis.overall.decisionsForCEO[0].project, '피자레디');
  assert.equal(analysis.overall.sourceConflicts[0].subject, '익스프레스 범위');
  assert.equal(analysis.sourceComparison.status, 'complete');
});

test('Given only a legacy summary row, When it is read, Then it remains usable without pretending source comparison ran', () => {
  const analysis = buildAgentAnalysis([{
    프로젝트명: '피자레디', 생성시각: '2026-07-21T00:30:00.000Z',
    '현재 진행 요약': '기존 요약', '프로젝트 상태': '주의',
  }], ['피자레디'], '2026-07-21T01:00:00.000Z');

  assert.equal(analysis.analysisStatus, 'legacy');
  assert.equal(analysis.projects[0].summary, '기존 요약');
  assert.equal(analysis.sourceComparison.status, 'not_run');
  assert.equal(analysis.overall.sourceConflicts, undefined);
});

test('Given no summary rows, When agent analysis is built, Then not-run is explicit rather than an empty successful result', () => {
  const analysis = buildAgentAnalysis([], ['피자레디'], '2026-07-21T01:00:00.000Z');

  assert.equal(analysis.analysisStatus, 'not_run');
  assert.equal(analysis.projects.length, 0);
  assert.equal(analysis.sourceComparison.status, 'not_run');
});

test('Given duplicate project rows, When a project summary is selected, Then newest analysis wins', () => {
  assert.equal(latestProjectSummaryRow(rows, '피자레디')['현재 진행 요약'], 'Sprint 60의 개발과 아트 작업이 진행 중이다.');
});
