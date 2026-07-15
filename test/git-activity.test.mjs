import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectGitActivity } from '../lib/git-activity.mjs';

test('Given a configured local repository, When Git activity is collected, Then commit metadata and changed files are linked to its project', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-git-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory });
  execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'tester@example.com'], { cwd: directory });
  fs.writeFileSync(path.join(directory, 'feature.txt'), 'work');
  execFileSync('git', ['add', 'feature.txt'], { cwd: directory });
  execFileSync('git', ['commit', '-m', 'PIZZA-42 implement feature'], { cwd: directory });

  const result = collectGitActivity({ repositories: [{ project: '피자레디', path: directory }], tasks: [{ id: 'work', project: '피자레디', gitKey: 'PIZZA-42' }], sinceDays: 30 });

  assert.equal(result.commits.length, 1);
  assert.equal(result.commits[0].project, '피자레디');
  assert.equal(result.commits[0].workItemId, 'work');
  assert.deepEqual(result.commits[0].files, ['feature.txt']);
  assert.equal(result.repositories[0].branch, 'main');
});

test('Given a repository without a selected project mapping, When Git activity is collected, Then its commits remain unmapped', () => {
  const result = collectGitActivity({ repositories: [], tasks: [], sinceDays: 30 });

  assert.deepEqual(result, { repositories: [], commits: [], errors: [] });
});
