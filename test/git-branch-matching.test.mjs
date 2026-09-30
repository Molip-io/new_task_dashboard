import assert from 'node:assert/strict';
import test from 'node:test';
import { branchMatchScore, findTaskForCommit, matchBranches, sprintIdentity } from '../shared/collectors/git-branch-matching.mjs';

const branches = ['main', 'molip/develop/Sprint2', 'molip/develop/Sprint3', 'molip/develop/Sprint3.5', 'molip/develop/Sprint3.5_v2', 'molip/develop/Srpint4', 'molip/version/Sprint3', 'sprint/sprint61', 'sprint/sprint62-express'];
const matched = tag => matchBranches([tag], branches).matches.map(match => match.actual);

test('Given branch names, When their sprint is read, Then a misspelled sprint word still counts and decimals stay distinct', () => {
  assert.deepEqual(['molip/develop/Srpint4', 'molip/develop/Sprint4', 'sprint4', 'Sprint3.5_v2', 'sprint/sprint62-express', 'sprint03'].map(sprintIdentity), ['4', '4', '4', '3.5', '62', '3']);
  assert.deepEqual(['main', 'ad2', 'feature/print4', 'molip/feature/GuideQuest'].map(sprintIdentity), [null, null, null, null]);
});

test('Given a misspelled sprint branch, When tags name that sprint, Then bare and prefixed tags reach it', () => {
  assert.deepEqual(matched('sprint4'), ['molip/develop/Srpint4']);
  assert.deepEqual(matched('molip/develop/Sprint4'), ['molip/develop/Srpint4']);
  assert.equal(branchMatchScore('molip/develop/Srpint4', 'molip/develop/Srpint4'), 1);
});

test('Given branches of other sprints, When a tag names a different sprint, Then they are never matched however alike they read', () => {
  assert.equal(branchMatchScore('molip/develop/Sprint4', 'molip/develop/Sprint3'), 0);
  assert.equal(branchMatchScore('molip/develop/Sprint4', 'molip/develop/Sprint2'), 0);
  assert.deepEqual(matched('sprint5'), []);
  assert.deepEqual(matched('sprint3'), ['molip/develop/Sprint3', 'molip/version/Sprint3']);
  assert.deepEqual(matched('sprint3.5'), ['molip/develop/Sprint3.5', 'molip/develop/Sprint3.5_v2']);
});

test('Given existing tag styles, When they are matched, Then earlier behaviour is unchanged', () => {
  assert.deepEqual(matched('sprint/sprint61'), ['sprint/sprint61']);
  assert.deepEqual(matched('Sprint/Sprint61'), ['sprint/sprint61']);
  assert.deepEqual(matched('sprint61'), ['sprint/sprint61']);
  assert.deepEqual(matched('ad2'), []);
});

test('Given a commit on a misspelled sprint branch, When tasks are looked up, Then only the task of that sprint is chosen', () => {
  const tasks = [
    { id: 'sp3', project: '포지 앤 포춘', branch: 'molip/develop/Sprint3' },
    { id: 'sp4', project: '포지 앤 포춘', branch: 'molip/develop/Sprint4' },
  ];

  assert.equal(findTaskForCommit(tasks, '포지 앤 포춘', 'feat: 탈 것 목업', 'molip/develop/Srpint4').id, 'sp4');
  assert.equal(findTaskForCommit(tasks, '포지 앤 포춘', 'feat: x', 'molip/develop/Sprint3').id, 'sp3');
});
