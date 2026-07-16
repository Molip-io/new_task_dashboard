import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveGitRepositories } from '../lib/git-repositories.mjs';

test('Given selected Notion projects with Git URLs, When repositories are resolved, Then each project becomes a remote source', () => {
  const projects = [
    { name: '피자레디', gitUrl: 'https://github.com/MolipLtd/Pizza-Idle.git' },
    { name: '포지 앤 포춘', gitUrl: 'https://github.com/Molip-io/Forge.git' },
  ];

  const result = resolveGitRepositories({ projects, configured: [], root: '/workspace' });

  assert.deepEqual(result.local, []);
  assert.deepEqual(result.remote, [
    { name: '피자레디', project: '피자레디', url: 'https://github.com/MolipLtd/Pizza-Idle.git' },
    { name: '포지 앤 포춘', project: '포지 앤 포춘', url: 'https://github.com/Molip-io/Forge.git' },
  ]);
});

test('Given a configured local override, When repositories are resolved, Then it replaces the matching Notion remote', () => {
  const projects = [{ name: '피자레디', gitUrl: 'https://github.com/MolipLtd/Pizza-Idle.git' }];
  const configured = [{ project: '피자레디', name: 'pizza-local', path: '../Pizza-Idle' }];

  const result = resolveGitRepositories({ projects, configured, root: '/workspace/dashboard' });

  assert.deepEqual(result.remote, []);
  assert.deepEqual(result.local, [{
    project: '피자레디',
    name: 'pizza-local',
    path: '/workspace/Pizza-Idle',
  }]);
});

test('Given a selected project without a Git URL, When repositories are resolved, Then it remains a remote entry with a missing URL', () => {
  const projects = [{ name: '새 프로젝트', gitUrl: null }];

  const result = resolveGitRepositories({ projects, configured: [], root: '/workspace' });

  assert.deepEqual(result.remote, [{ name: '새 프로젝트', project: '새 프로젝트', url: null }]);
});
