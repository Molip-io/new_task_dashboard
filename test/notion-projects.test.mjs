import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProjectRows, taskFrom } from '../lib/notion-collector.mjs';

test('Given a selected Notion project with a Git property, When project rows are parsed, Then the Git URL is preserved', () => {
  const rows = [{
    _id: 'pizza',
    이름: '피자레디',
    git: 'https://github.com/MolipLtd/Pizza-Idle.git',
    요약: true,
  }];

  const [project] = parseProjectRows(rows, { slackDaysDefault: 3 });

  assert.equal(project.gitUrl, 'https://github.com/MolipLtd/Pizza-Idle.git');
});

test('Given a project without a Git property, When project rows are parsed, Then the Git URL is explicitly null', () => {
  const rows = [{ _id: 'other', 이름: '다른 프로젝트', 요약: true }];

  const [project] = parseProjectRows(rows, { slackDaysDefault: 3 });

  assert.equal(project.gitUrl, null);
});

test('Given current sprint and project owner properties, When project rows are parsed, Then stable project rules are preserved', () => {
  const rows = [{
    _id: 'pizza',
    이름: '피자레디',
    요약: true,
    '현재 스프린트': ['스프린트60', '스프린트61'],
    'PD:users': [{ id: 'pd', name: 'PD' }],
    '팀장:users': [{ id: 'lead', name: '팀장' }],
  }];

  const [project] = parseProjectRows(rows, { slackDaysDefault: 3 });

  assert.deepEqual(project.currentSprints, ['스프린트60', '스프린트61']);
  assert.deepEqual(project.pdUsers.map(user => user.id), ['pd']);
  assert.deepEqual(project.teamLeadUsers.map(user => user.id), ['lead']);
});

test('Given a sprint-optional AI project, When project rows are parsed, Then sprint validation is disabled without changing other projects', () => {
  const rows = [
    { _id: 'ai', 이름: 'UI 자동화', 요약: true },
    { _id: 'game', 이름: '피자레디', 요약: true },
  ];

  const projects = parseProjectRows(rows, {
    slackDaysDefault: 3,
    validation: { sprintOptionalProjects: ['UI 자동화'] },
  });

  assert.equal(projects.find(project => project.name === 'UI 자동화').sprintRequired, false);
  assert.equal(projects.find(project => project.name === '피자레디').sprintRequired, true);
});

test('Given a work row with a branch property, When it is parsed, Then the requested Git branch is preserved', () => {
  const task = taskFrom({
    _id: 'work',
    작업: '보상 밸런스',
    프로젝트: '피자레디',
    브랜치: 'feature/PIZZA-42-reward',
  }, null, new Map(), new Set());

  assert.equal(task.branch, 'feature/PIZZA-42-reward');
});

test('Given multiple work branches, When a row is parsed, Then every branch remains available while the first stays primary', () => {
  const task = taskFrom({
    _id: 'work',
    작업: '복수 브랜치',
    프로젝트: '피자레디',
    Branch: ['feature/one', 'feature/two'],
  }, null, new Map(), new Set());

  assert.equal(task.branch, 'feature/one');
  assert.deepEqual(task.branches, ['feature/one', 'feature/two']);
});
