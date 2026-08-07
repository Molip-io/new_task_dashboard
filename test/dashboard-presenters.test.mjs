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

  assert.match(html, /중요 확인사항/);
  assert.match(html, /반복 피드백으로 리소스 제작이 지연/);
});

test('Given several source-backed risks, When executive briefing renders, Then one latest risk per project prevents one project from crowding out another', () => {
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

  assert.match(html, /최신 포지 위험/);
  assert.doesNotMatch(html, /오래된 위험/);
  assert.match(html, /디자인 협업 지연/);
});
