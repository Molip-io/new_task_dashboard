import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as gitActivity from '../lib/git-activity.mjs';
import { collectGitActivity } from '../lib/git-activity.mjs';

test('Given the Git activity module, When GitHub collection is requested, Then it exposes an asynchronous URL collector', () => {
  assert.equal(typeof gitActivity.collectGitHubActivity, 'function');
});

function githubCommit(sha, message, committedAt, files = []) {
  return {
    sha,
    html_url: `https://github.com/Molip-io/game/commit/${sha}`,
    commit: { author: { date: committedAt, name: 'Developer', email: 'dev@molip.io' }, message },
    author: { login: 'developer' },
    files: files.map(filename => ({ filename })),
  };
}

function fakeGitHub(responses) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const route = Object.entries(responses).find(([suffix]) => String(url).endsWith(suffix));
      if (!route) return new Response(JSON.stringify({ message: 'missing fixture' }), { status: 500 });
      const value = typeof route[1] === 'function' ? route[1](url, options) : route[1];
      return new Response(JSON.stringify(value.body), { status: value.status || 200 });
    },
  };
}

test('Given a Notion GitHub URL with default, pushed, and PR commits, When activity is collected, Then commits are mapped and deduplicated by hash', async () => {
  const main = githubCommit('main-sha', 'PIZZA-42 implement reward', '2026-07-15T01:00:00Z', ['main.js']);
  const push = githubCommit('push-sha', 'work-id fix branch', '2026-07-15T02:00:00Z', ['branch.js']);
  const pr = githubCommit('pr-sha', 'unmapped review', '2026-07-15T03:00:00Z', ['review.js']);
  const github = fakeGitHub({
    '/repos/Molip-io/game': { body: { name: 'game', full_name: 'Molip-io/game', html_url: 'https://github.com/Molip-io/game', default_branch: 'main' } },
    '/repos/Molip-io/game/commits?sha=main&since=2026-06-16T00%3A00%3A00.000Z&per_page=100': { body: [main] },
    '/repos/Molip-io/game/events?per_page=100': { body: [
      { type: 'PushEvent', created_at: '2026-07-15T02:00:00Z', payload: { head: 'push-sha', ref: 'refs/heads/feature' } },
      { type: 'PushEvent', created_at: '2026-07-15T01:00:00Z', payload: { head: 'main-sha', ref: 'refs/heads/main' } },
    ] },
    '/repos/Molip-io/game/pulls?state=open&sort=updated&direction=desc&per_page=100': { body: [
      { updated_at: '2026-01-15T03:00:00Z', head: { sha: 'pr-sha', ref: 'review' } },
      { updated_at: '2026-07-15T01:00:00Z', head: { sha: 'main-sha', ref: 'main' } },
    ] },
    '/repos/Molip-io/game/commits/main-sha': { body: main },
    '/repos/Molip-io/game/commits/push-sha': { body: push },
    '/repos/Molip-io/game/commits/pr-sha': { body: pr },
  });

  const result = await gitActivity.collectGitHubActivity({
    repositories: [{ project: '피자레디', gitUrl: 'https://github.com/Molip-io/game.git', source: 'notion' }],
    tasks: [
      { id: 'git-key-work', project: '피자레디', gitKey: 'PIZZA-42' },
      { id: 'work-id', project: '피자레디', gitKey: null },
    ],
    fetchImpl: github.fetchImpl,
    env: { GITHUB_TOKEN: 'environment-token' },
    ghTokenProvider: () => { throw new Error('must not use gh fallback'); },
    now: () => new Date('2026-07-16T00:00:00Z'),
  });

  assert.deepEqual(result.commits.map(commit => commit.hash), ['pr-sha', 'push-sha', 'main-sha']);
  assert.deepEqual(result.commits.map(commit => commit.workItemId), [null, 'work-id', 'git-key-work']);
  assert.deepEqual(result.commits.map(commit => commit.branch), ['review', 'feature', 'main']);
  assert.deepEqual(result.commits.map(commit => commit.files), [['review.js'], ['branch.js'], ['main.js']]);
  assert.deepEqual(result.repositories[0], {
    name: 'game',
    project: '피자레디',
    source: 'notion',
    status: 'ok',
    defaultBranch: 'main',
    branch: 'main',
    remote: 'https://github.com/Molip-io/game',
    latestCommitAt: '2026-07-15T03:00:00Z',
    lastFetchedAt: '2026-07-16T00:00:00.000Z',
    commitCount: 3,
    mappedCommitCount: 2,
  });
  assert.equal(github.requests[0].options.headers.Authorization, 'Bearer environment-token');
  assert.deepEqual(result.errors, []);
});

test('Given no GITHUB_TOKEN and a repository without recent activity, When collection uses the local gh token, Then the repository is connected with zero commits', async () => {
  const github = fakeGitHub({
    '/repos/Molip-io/quiet': { body: { name: 'quiet', full_name: 'Molip-io/quiet', html_url: 'https://github.com/Molip-io/quiet', default_branch: 'trunk' } },
    '/repos/Molip-io/quiet/commits?sha=trunk&since=2026-06-16T00%3A00%3A00.000Z&per_page=100': { body: [] },
    '/repos/Molip-io/quiet/events?per_page=100': { body: [] },
    '/repos/Molip-io/quiet/pulls?state=open&sort=updated&direction=desc&per_page=100': { body: [] },
  });

  const result = await gitActivity.collectGitHubActivity({
    repositories: [{ project: '포지 앤 포춘', url: 'https://github.com/Molip-io/quiet' }],
    fetchImpl: github.fetchImpl,
    env: {},
    ghTokenProvider: () => 'gh-user-token',
    now: () => new Date('2026-07-16T00:00:00Z'),
  });

  assert.equal(github.requests[0].options.headers.Authorization, 'Bearer gh-user-token');
  assert.equal(result.repositories[0].status, 'no-activity');
  assert.equal(result.repositories[0].commitCount, 0);
});

test('Given an invalid GitHub URL, When activity is collected, Then it is reported without making an HTTP request', async () => {
  let requested = false;

  const result = await gitActivity.collectGitHubActivity({
    repositories: [{ project: '피자레디', gitUrl: 'https://gitlab.com/molip/game' }],
    fetchImpl: async () => { requested = true; throw new Error('must not fetch'); },
    env: {},
    ghTokenProvider: () => '',
    now: () => new Date('2026-07-16T00:00:00Z'),
  });

  assert.equal(requested, false);
  assert.equal(result.repositories[0].status, 'invalid-url');
});

test('Given a selected project without a GitHub URL, When activity is collected, Then the missing configuration remains visible', async () => {
  const result = await gitActivity.collectGitHubActivity({
    repositories: [{ name: '새 프로젝트', project: '새 프로젝트', gitUrl: null }],
    fetchImpl: async () => { throw new Error('must not fetch'); },
    env: {},
    ghTokenProvider: () => '',
    now: () => new Date('2026-07-16T00:00:00Z'),
  });

  assert.equal(result.repositories[0].status, 'missing-url');
  assert.equal(result.repositories[0].project, '새 프로젝트');
});

test('Given GitHub rejects repository metadata credentials, When activity is collected, Then authentication is distinguished from a generic failure', async () => {
  const github = fakeGitHub({
    '/repos/Molip-io/private': { status: 401, body: { message: 'Bad credentials' } },
  });

  const result = await gitActivity.collectGitHubActivity({
    repositories: [{ project: '피자레디', gitUrl: 'https://github.com/Molip-io/private' }],
    fetchImpl: github.fetchImpl,
    env: { GITHUB_TOKEN: 'expired' },
    now: () => new Date('2026-07-16T00:00:00Z'),
  });

  assert.equal(result.repositories[0].status, 'auth-required');
  assert.match(result.errors[0], /Bad credentials/);
});

test('Given one GitHub activity endpoint fails, When other sources remain available, Then collection is marked partial', async () => {
  const github = fakeGitHub({
    '/repos/Molip-io/game': { body: { name: 'game', full_name: 'Molip-io/game', html_url: 'https://github.com/Molip-io/game', default_branch: 'main' } },
    '/repos/Molip-io/game/commits?sha=main&since=2026-06-16T00%3A00%3A00.000Z&per_page=100': { body: [] },
    '/repos/Molip-io/game/events?per_page=100': { status: 500, body: { message: 'events unavailable' } },
    '/repos/Molip-io/game/pulls?state=open&sort=updated&direction=desc&per_page=100': { body: [] },
  });

  const result = await gitActivity.collectGitHubActivity({
    repositories: [{ project: '피자레디', gitUrl: 'https://github.com/Molip-io/game' }],
    fetchImpl: github.fetchImpl,
    env: {},
    ghTokenProvider: () => '',
    now: () => new Date('2026-07-16T00:00:00Z'),
  });

  assert.equal(result.repositories[0].status, 'partial');
  assert.match(result.errors[0], /partial activity data/);
});

test('Given all GitHub activity endpoints fail, When collection runs, Then the repository is marked failed rather than partial', async () => {
  const github = fakeGitHub({
    '/repos/Molip-io/game': { body: { name: 'game', full_name: 'Molip-io/game', html_url: 'https://github.com/Molip-io/game', default_branch: 'main' } },
    '/repos/Molip-io/game/commits?sha=main&since=2026-06-16T00%3A00%3A00.000Z&per_page=100': { status: 500, body: { message: 'unavailable' } },
    '/repos/Molip-io/game/events?per_page=100': { status: 500, body: { message: 'unavailable' } },
    '/repos/Molip-io/game/pulls?state=open&sort=updated&direction=desc&per_page=100': { status: 500, body: { message: 'unavailable' } },
  });

  const result = await gitActivity.collectGitHubActivity({
    repositories: [{ project: '피자레디', gitUrl: 'https://github.com/Molip-io/game' }],
    fetchImpl: github.fetchImpl,
    env: {},
    ghTokenProvider: () => '',
    now: () => new Date('2026-07-16T00:00:00Z'),
  });

  assert.equal(result.repositories[0].status, 'failed');
  assert.match(result.errors[0], /activity endpoints failed/);
});

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
  assert.equal(result.repositories[0].source, 'config');
  assert.equal(result.repositories[0].status, 'ok');
  assert.equal(result.repositories[0].defaultBranch, 'main');
  assert.equal(result.repositories[0].mappedCommitCount, 1);
  assert.match(result.repositories[0].lastFetchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('Given a repository without a selected project mapping, When Git activity is collected, Then its commits remain unmapped', () => {
  const result = collectGitActivity({ repositories: [], tasks: [], sinceDays: 30 });

  assert.deepEqual(result, { repositories: [], commits: [], errors: [] });
});
