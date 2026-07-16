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
      { project: '피자레디', remote: 'https://github.com/MolipLtd/Pizza-Idle', status: 'ok', commitCount: 117, mappedCommitCount: 0 },
    ] },
  };

  const html = briefingHtml(dashboard, 'git', () => '');

  assert.equal(html.match(/https:\/\/github\.com\/Molip-io\/Forge/g)?.length, 1);
  assert.equal(html.match(/https:\/\/github\.com\/MolipLtd\/Pizza-Idle/g)?.length, 1);
  assert.match(html, /피자레디 · 연결됨 · 최근 활동 있음/);
});
