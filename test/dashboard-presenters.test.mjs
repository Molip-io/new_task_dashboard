import assert from 'node:assert/strict';
import test from 'node:test';

import { briefingHtml } from '../public/dashboard-presenters.js';

test('Given two projects with connected repositories, When Git briefing details render, Then each project uses its own repository', () => {
  const dashboard = {
    metrics: {},
    validationIssues: [],
    deltas: [],
    projects: [
      { name: '포지 앤 포춘', config: { gitUrl: 'https://github.com/Molip-io/Forge.git' }, stats: {} },
      { name: '피자레디', config: { gitUrl: 'https://github.com/MolipLtd/Pizza-Idle.git' }, stats: {} },
    ],
    git: { repositories: [
      { project: '포지 앤 포춘', remote: 'https://github.com/Molip-io/Forge', status: 'no-activity', commitCount: 0 },
      {
        project: '피자레디',
        remote: 'https://github.com/MolipLtd/Pizza-Idle',
        status: 'ok',
        commitCount: 117,
        mappedCommitCount: 0,
        matchedBranches: ['feature/pizza-reward'],
        unmatchedBranches: ['feature/missing'],
      },
    ] },
  };

  const html = briefingHtml(dashboard, 'git', () => '');

  assert.equal(html.match(/https:\/\/github\.com\/Molip-io\/Forge/g)?.length, 1);
  assert.equal(html.match(/https:\/\/github\.com\/MolipLtd\/Pizza-Idle/g)?.length, 1);
  assert.match(html, /피자레디 · 연결됨 · 최근 활동 있음/);
  assert.match(html, /브랜치 feature\/pizza-reward · 미확인 feature\/missing/);
});

test('Given an integrated analysis with an executive risk, When briefing renders, Then the risk is visible beneath the summary', () => {
  const dashboard = {
    metrics: {}, validationIssues: [], deltas: [], projects: [],
    git: { repositories: [] },
    ai: {
      analysisStatus: 'success',
      overall: {
        summary: '피자레디 숨겨진 사원 작업이 진행 중이다.',
        topRisks: ['[피자레디] 반복 피드백으로 리소스 제작이 지연돼 디자인 협업 방식 확인이 필요하다.'],
      },
    },
  };

  const html = briefingHtml(dashboard, null, () => '');

  assert.match(html, /분석에서 짚은 위험/);
  assert.ok(html.indexOf('피자레디 숨겨진 사원 작업이 진행 중이다.') < html.indexOf('반복 피드백으로 리소스 제작이 지연'));
  assert.match(html, /반복 피드백으로 리소스 제작이 지연/);
});

test('Given several attention candidates, When executive briefing renders, Then one latest candidate per project appears in a separate collapsed section', () => {
  const evidence = (excerpt, timestamp) => ({ source: 'meeting', attention: true, excerpt, timestamp });
  const dashboard = {
    metrics: {}, validationIssues: [], deltas: [], git: { repositories: [] },
    ai: { analysisStatus: 'stale', overall: {} },
    projects: [
      { name: '포지 앤 포춘', specInsights: [
        { title: '특수상인', evidence: [evidence('오래된 위험', '2026-07-01')] },
        { title: '가이드퀘스트', evidence: [evidence('최신 포지 위험', '2026-07-30')] },
      ] },
      { name: '피자레디', specInsights: [
        { title: '라이브 이벤트 - 숨겨진 사원', evidence: [evidence('디자인 협업 지연', '2026-07-24')] },
      ] },
    ],
  };

  const html = briefingHtml(dashboard, null, () => '');

  const candidates = html.match(/<details class="candidate-section">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(candidates);
  assert.match(candidates, /최신 포지 위험/);
  assert.match(candidates, /디자인 협업 지연/);
  assert.match(candidates, /분석상 위험으로 확정되지 않은 신호/);
  assert.doesNotMatch(html, /<details class="candidate-section" open/);
  assert.doesNotMatch(html, /오래된 위험/);
  assert.match(html, /디자인 협업 지연/);
});

function briefingDashboard(status = 'success') {
  const generatedAt = new Date().toISOString();
  return {
    generatedAt, metrics: {}, validationIssues: [], deltas: [], projects: [],
    workItems: [], progressSetupItems: [], git: { repositories: [] },
    ai: { analysisStatus: status, generatedAt, overall: {} },
  };
}

test('Given project status data, When the executive briefing renders, Then a visible project status briefing summarizes each project and links to its details', () => {
  const dashboard = briefingDashboard();
  dashboard.projects = [{
    name: '피자레디',
    managementStatus: 'warning',
    notionSummary: { status: '주의', summary: '이벤트 QA와 다음 스프린트 범위를 확인해야 합니다.' },
    stats: { total: 4, done: 1, inProgress: 2, planned: 1, review: 0, overdue: 1, issueCount: 3 },
  }];

  const html = briefingHtml(dashboard, null, () => '');

  assert.match(html, /<h4 id="project-status-title">프로젝트 현황 브리핑 <span class="section-count">1개<\/span>/);
  assert.match(html, /피자레디/);
  assert.match(html, /이벤트 QA와 다음 스프린트 범위를 확인해야 합니다\./);
  assert.match(html, /완료 1\/4 · 진행 2 · 예정 1 · 검토 0/);
  assert.match(html, /기한 초과 1 · 관리 확인 3/);
  assert.match(html, /data-project-jump="피자레디"/);
});

test('Given an executive briefing with project evidence, When rendered, Then project status contains the integrated analysis and keeps its six decision lenses visible', () => {
  const dashboard = briefingDashboard();
  dashboard.metrics = {
    overdueWorkItems: 2,
    guideViolationWorkItems: 3,
    progressSetupRequiredItems: 1,
    needsCheckProjects: 1,
  };
  dashboard.projects = [{
    name: '피자레디',
    notionSummary: { summary: '이벤트 QA를 진행 중입니다.', nextAction: 'QA 결과 확인' },
    stats: { total: 4, done: 1, inProgress: 2, planned: 1, review: 0 },
    specInsights: [{ title: '출시 준비', evidence: [{ source: 'meeting', timestamp: '2026-09-10', excerpt: '빌드 QA 확인 필요' }] }],
  }];
  dashboard.sourceHealth = { sources: [{ id: 'notion', status: 'ok', lastSuccessAt: '2026-09-10' }] };
  dashboard.ai.overall.summary = '프로젝트 통합 분석 요약입니다.';
  dashboard.ai.projects = [{ name: '피자레디', summary: '현재 이벤트 QA 진행 중', nextActions: ['QA 결과 확인'] }];

  const html = briefingHtml(dashboard, null, () => '');
  const analysis = html.indexOf('id="analysis-title"');
  const projectStatus = html.indexOf('id="project-status-title"');
  const risk = html.indexOf('id="risk-title"');

  const blockers = html.indexOf('id="blockers-title"');
  assert.ok(analysis >= 0 && projectStatus > analysis && risk > projectStatus && blockers > risk);
  assert.ok(html.indexOf('현재 진행', projectStatus) > projectStatus);
  for (const label of ['현재 진행', '빌드·출시 현황', '데이터 현황', '실행 병목', '확인 필요', '다음 주요 행동']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /빌드 QA 확인 필요/);
  assert.match(html, /QA 결과 확인/);
});

test('Given six candidate projects and agent risks, When briefing renders, Then candidates cannot crowd out any agent risk', () => {
  const dashboard = briefingDashboard();
  dashboard.projects = Array.from({ length: 6 }, (_, index) => ({
    name: `프로젝트 ${index + 1}`,
    specInsights: [{ title: `작업 ${index + 1}`, evidence: [{
      source: 'meeting', attention: true, excerpt: `후보 신호 ${index + 1}`, timestamp: '2026-09-07',
    }] }],
  }));
  dashboard.ai.overall.topRisks = Array.from({ length: 7 }, (_, index) => `분석 위험 ${index + 1}`);

  const html = briefingHtml(dashboard, null, () => '');
  const riskSection = html.match(/<section class="card analysis-risks"[\s\S]*?<\/section>/)?.[0];
  const candidates = html.match(/<details class="candidate-section">[\s\S]*?<\/details>/)?.[0];

  assert.ok(riskSection && candidates);
  for (let index = 1; index <= 7; index += 1) assert.ok(riskSection.includes(`분석 위험 ${index}`));
  for (let index = 1; index <= 6; index += 1) assert.ok(candidates.includes(`후보 신호 ${index}`));
  assert.match(riskSection, /나머지 2건 보기/);
  assert.doesNotMatch(riskSection, /후보 신호/);
  assert.doesNotMatch(candidates, /분석 위험/);
});

test('Given a setup deep link, When briefing renders, Then decisions and analysis stay before the selected management list', () => {
  const dashboard = briefingDashboard();
  dashboard.ai.overall.decisionsForCEO = [{ project: '피자레디', question: '추가 제작을 승인할까요?', context: '승인 후 제작을 시작합니다.' }];
  dashboard.ai.overall.summary = '대표 승인 대기 중입니다.';
  dashboard.progressSetupItems = [{ id: 'setup-1', title: '착수 목록 업무', status: '시작 전' }];

  const html = briefingHtml(dashboard, 'setup', items => `<div data-task-rows>${items.map(item => item.title).join(',')}</div>`);
  const decision = html.indexOf('추가 제작을 승인할까요?');
  const analysis = html.indexOf('대표 승인 대기 중입니다.');
  const detail = html.indexOf('id="briefing-detail"');

  assert.ok(decision >= 0 && analysis > decision && detail > analysis);
  assert.ok(html.indexOf('id="risk-title"') < detail);
  assert.ok(html.indexOf('id="management-title"') < detail);
  assert.ok(html.indexOf('착수 목록 업무') > detail);
  assert.match(html, /현재 스프린트에서 아직 시작 전인 항목입니다. 실행 병목·가이드 위반과는 별도 분류입니다./);
  assert.match(html, /data-briefing-detail="setup" aria-expanded="true"/);
});

test('Given untrusted decision and context text, When briefing renders, Then all decision text is escaped', () => {
  const dashboard = briefingDashboard();
  dashboard.ai.overall.decisionsForCEO = [{
    project: '<img src=x onerror="alert(1)">',
    question: '<script>alert("question")</script>',
    context: '<button onclick="alert(2)">승인 & 실행</button>',
  }];

  const html = briefingHtml(dashboard, null, () => '');

  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;question&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;button onclick=&quot;alert\(2\)&quot;&gt;승인 &amp; 실행&lt;\/button&gt;/);
  assert.doesNotMatch(html, /<script>|<img |<button onclick/);
});

test('Given stale, failed, unrun, or partial analysis, When lists are empty, Then the briefing does not claim no decisions or risks', () => {
  for (const status of ['stale', 'failed', 'not_run', 'partial']) {
    const html = briefingHtml(briefingDashboard(status), null, () => '');
    assert.match(html, /표시할 결정 요청이 없습니다. 분석 범위와 최신성을 먼저 확인하세요./);
    assert.match(html, /위험이 없다는 뜻은 아닙니다./);
    assert.doesNotMatch(html, /이번 분석에 기록된 대표 결정 요청이 없습니다.|이번 분석에 기록된 위험 신호가 없습니다./);
    if (status === 'failed') {
      assert.match(html, /분석 실패/);
      assert.doesNotMatch(html, /과거 분석을 참고용으로/);
    }
    if (status === 'not_run') assert.match(html, /아직 분석 결과가 없습니다./);
    if (status === 'stale') assert.match(html, /과거 분석을 참고용으로/);
  }
  const freshHtml = briefingHtml(briefingDashboard(), null, () => '');
  assert.match(freshHtml, /이번 분석에 기록된 대표 결정 요청이 없습니다./);
  assert.match(freshHtml, /이번 분석에 기록된 위험 신호가 없습니다./);
});

test('Given failed or unrun analysis with leftover narrative data, When briefing renders, Then those old claims are not presented as current results', () => {
  for (const status of ['failed', 'not_run']) {
    const dashboard = briefingDashboard(status);
    dashboard.ai.overall = {
      summary: '실패 이전의 요약', topRisks: ['실패 이전의 위험'],
      decisionsForCEO: [{ question: '실패 이전의 결정' }],
    };
    const html = briefingHtml(dashboard, null, () => '');
    assert.doesNotMatch(html, /실패 이전의/);
    assert.match(html, /표시할 통합 분석이 없습니다./);
  }
});

test('Given a success result without analysis time, When briefing renders, Then the narrative remains with a visible freshness limitation', () => {
  const dashboard = briefingDashboard();
  dashboard.ai.generatedAt = null;
  dashboard.ai.overall.summary = '시각이 누락된 분석 요약';
  dashboard.ai.overall.topRisks = ['시각이 누락된 분석 위험'];
  dashboard.ai.overall.decisionsForCEO = [{ question: '시각이 누락된 결정 요청' }];

  const html = briefingHtml(dashboard, null, () => '');

  assert.match(html, /최신성 확인 필요/);
  assert.match(html, /시각이 누락된 분석 요약/);
  assert.match(html, /시각이 누락된 분석 위험/);
  assert.match(html, /시각이 누락된 결정 요청/);
  assert.match(html, /분석 - · 한국 시간/);
});

test('Given task and project deltas, When briefing renders, Then known fields have Korean labels and meaningful empty values', () => {
  const dashboard = briefingDashboard();
  const fields = {
    'task.status': '작업 상태', 'task.due': '마감일', 'task.assignees': '담당자',
    'project.status': '프로젝트 상태', 'project.completionRate': '완료율',
  };
  dashboard.deltas = Object.keys(fields).map(field => ({
    project: '피자레디', taskTitle: '작업 변경', field, from: null, to: ['루아', '제이'],
  }));

  const html = briefingHtml(dashboard, null, () => '');

  for (const [field, label] of Object.entries(fields)) {
    assert.ok(html.includes(label));
    assert.equal(html.includes(field), false);
  }
  assert.match(html, /미입력/);
  assert.match(html, /루아, 제이/);
  assert.match(html, /작업 정보의 변화/);
});

test('Given structured decisions and project-prefixed risks, When briefing renders, Then each can open the supporting project', () => {
  const dashboard = briefingDashboard();
  dashboard.projects = [{ name: '피자레디', specInsights: [] }, { name: '포지 앤 포춘', specInsights: [] }];
  dashboard.ai.overall.decisionsForCEO = [{ project: '피자레디', question: '출시 범위를 승인할까요?' }];
  dashboard.ai.overall.topRisks = [
    '[포지 앤 포춘] 일정 의존성 확인이 필요하다.',
    '프로젝트 구조가 없는 전사 위험',
  ];

  const html = briefingHtml(dashboard, null, () => '');

  assert.match(html, /data-project-jump="피자레디"/);
  assert.match(html, /data-project-jump="포지 앤 포춘"/);
  assert.equal(html.match(/data-project-jump=/g)?.length, 4);
  assert.match(html, /관련 프로젝트·근거 보기/);
});
