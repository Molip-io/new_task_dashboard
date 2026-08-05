import { execFileSync } from 'node:child_process';
import { findTaskForCommit, matchBranches } from './git-branch-matching.mjs';

const API_ROOT = 'https://api.github.com';
const BRANCH_COMMITS_PER_PAGE = 25;
const MAX_TASK_BRANCHES = 20;

function localGitHubToken() {
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function githubRepository(value) {
  if (!value) return null;
  const ssh = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  try {
    const url = new URL(value);
    if (!['github.com', 'www.github.com'].includes(url.hostname)) return null;
    const [owner, rawRepo, ...rest] = url.pathname.split('/').filter(Boolean);
    if (!owner || !rawRepo || rest.length) return null;
    return { owner, repo: rawRepo.replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

async function api(fetchImpl, path, token) {
  try {
    const response = await fetchImpl(`${API_ROOT}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'molip-work-status-dashboard',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const data = await response.json();
    const nextUrl = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
    const nextPath = nextUrl ? `${new URL(nextUrl).pathname}${new URL(nextUrl).search}` : null;
    return { ok: response.ok, status: response.status, data, nextPath };
  } catch (error) {
    return { ok: false, status: 0, data: { message: error instanceof Error ? error.message : String(error) } };
  }
}

async function paginatedApi(fetchImpl, path, token, maxPages = 5) {
  const data = [];
  let nextPath = path;
  let pages = 0;
  while (nextPath && pages < maxPages) {
    const page = await api(fetchImpl, nextPath, token);
    if (!page.ok || !Array.isArray(page.data)) return page;
    data.push(...page.data);
    nextPath = page.nextPath;
    pages += 1;
  }
  return { ok: true, status: 200, data, truncated: Boolean(nextPath) };
}

function commitRecord(payload, repository, fullName, branch, tasks) {
  const message = payload.commit?.message?.split('\n')[0] || '';
  const workItem = findTaskForCommit(tasks, repository.project, message, branch);
  return {
    hash: payload.sha,
    shortHash: payload.sha.slice(0, 8),
    committedAt: payload.commit?.author?.date || null,
    author: payload.author?.login || payload.commit?.author?.name || null,
    email: payload.commit?.author?.email || null,
    message,
    files: (payload.files || []).map(file => file.filename).filter(Boolean),
    repository: fullName,
    project: repository.project || null,
    workItemId: workItem?.id || null,
    branch,
    url: payload.html_url || `https://github.com/${fullName}/commit/${payload.sha}`,
  };
}

function requestedTaskBranches(tasks, repository) {
  return [...new Set(tasks
    .filter(task => task.project === repository.project && task.branch)
    .map(task => String(task.branch).trim())
    .filter(Boolean))];
}

function addCandidate(candidates, sha, branch, payload) {
  if (!sha) return;
  const current = candidates.get(sha);
  if (!current) {
    candidates.set(sha, { branch, payload: payload || null });
    return;
  }
  if (!current.payload && payload) current.payload = payload;
  if (!current.branch && branch) current.branch = branch;
}

function failureStatus(status) {
  if (status === 401 || status === 403) return 'auth-required';
  if (status === 404) return 'not-accessible';
  if (status === 422) return 'invalid-url';
  return 'failed';
}

function failureRepository(repository, status, fetchedAt) {
  return {
    name: repository.name || repository.gitUrl || repository.url || 'GitHub',
    project: repository.project || null,
    source: repository.source || 'notion',
    status,
    defaultBranch: null,
    branch: null,
    remote: repository.gitUrl || repository.url || null,
    latestCommitAt: null,
    lastFetchedAt: fetchedAt,
    commitCount: 0,
    mappedCommitCount: 0,
  };
}

export async function collectGitHubActivity({
  repositories = [],
  tasks = [],
  sinceDays = 30,
  fetchImpl = globalThis.fetch,
  token,
  env = process.env,
  ghTokenProvider = localGitHubToken,
  now = () => new Date(),
} = {}) {
  const fetchedAt = now();
  const lastFetchedAt = fetchedAt.toISOString();
  const since = new Date(fetchedAt.getTime() - sinceDays * 86_400_000).toISOString();
  let authorization = env.GITHUB_TOKEN || token || '';
  if (!authorization) {
    try { authorization = await ghTokenProvider(); } catch { authorization = ''; }
  }

  const result = { repositories: [], commits: [], errors: [] };
  for (const repository of repositories) {
    const parsed = githubRepository(repository.gitUrl || repository.url);
    if (!parsed) {
      result.repositories.push(failureRepository(repository, repository.gitUrl || repository.url ? 'invalid-url' : 'missing-url', lastFetchedAt));
      result.errors.push(`GitHub ${repository.project || repository.name || 'repository'}: invalid or missing URL`);
      continue;
    }

    const basePath = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
    const metadata = await api(fetchImpl, basePath, authorization);
    if (!metadata.ok) {
      const status = failureStatus(metadata.status);
      result.repositories.push(failureRepository(repository, status, lastFetchedAt));
      result.errors.push(`GitHub ${parsed.owner}/${parsed.repo}: ${metadata.data?.message || status}`);
      continue;
    }

    const fullName = metadata.data.full_name || `${parsed.owner}/${parsed.repo}`;
    const defaultBranch = metadata.data.default_branch;
    const requestedBranches = requestedTaskBranches(tasks, repository);
    const [defaultCommits, events, pulls, branchCatalog] = await Promise.all([
      api(fetchImpl, `${basePath}/commits?sha=${encodeURIComponent(defaultBranch)}&since=${encodeURIComponent(since)}&per_page=100`, authorization),
      api(fetchImpl, `${basePath}/events?per_page=100`, authorization),
      api(fetchImpl, `${basePath}/pulls?state=open&sort=updated&direction=desc&per_page=100`, authorization),
      requestedBranches.length
        ? paginatedApi(fetchImpl, `${basePath}/branches?per_page=100`, authorization)
        : Promise.resolve({ ok: true, status: 200, data: [] }),
    ]);

    const availableBranches = branchCatalog.ok && Array.isArray(branchCatalog.data)
      ? branchCatalog.data.map(branch => branch.name).filter(Boolean)
      : [];
    const branchSelection = branchCatalog.ok
      ? matchBranches(requestedBranches, availableBranches)
      : { matches: [], unmatched: requestedBranches };
    const matchedBranches = [...new Set(branchSelection.matches.map(match => match.actual))];
    const limitedBranches = matchedBranches.slice(0, MAX_TASK_BRANCHES);
    const branchFetches = await Promise.all(limitedBranches
      .filter(branch => branch !== defaultBranch)
      .map(async branch => ({
        branch,
        response: await api(
          fetchImpl,
          `${basePath}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(since)}&per_page=${BRANCH_COMMITS_PER_PAGE}`,
          authorization,
        ),
      })));
    const sources = [defaultCommits, events, pulls, ...branchFetches.map(fetch => fetch.response)];
    const failedSources = sources.filter(source => !source.ok);
    if (failedSources.length === sources.length) {
      result.repositories.push(failureRepository(repository, 'failed', lastFetchedAt));
      result.errors.push(`GitHub ${fullName}: activity endpoints failed`);
      continue;
    }

    const candidates = new Map();
    if (defaultCommits.ok && Array.isArray(defaultCommits.data)) {
      for (const item of defaultCommits.data) addCandidate(candidates, item.sha, defaultBranch, item);
    }
    if (events.ok && Array.isArray(events.data)) {
      for (const event of events.data) {
        if (event.type !== 'PushEvent' || !event.payload?.head || event.created_at < since) continue;
        const branch = event.payload.ref?.replace(/^refs\/heads\//, '') || null;
        addCandidate(candidates, event.payload.head, branch, null);
      }
    }
    if (pulls.ok && Array.isArray(pulls.data)) {
      for (const pull of pulls.data) {
        if (!pull.head?.sha) continue;
        addCandidate(candidates, pull.head.sha, pull.head.ref || null, null);
      }
    }
    for (const fetch of branchFetches) {
      if (!fetch.response.ok || !Array.isArray(fetch.response.data)) continue;
      for (const item of fetch.response.data) {
        addCandidate(candidates, item.sha, fetch.branch, item);
      }
    }

    let detailFailures = 0;
    const commits = [];
    for (const [sha, candidate] of candidates) {
      const detail = await api(fetchImpl, `${basePath}/commits/${encodeURIComponent(sha)}`, authorization);
      const payload = detail.ok ? detail.data : candidate.payload;
      if (!detail.ok) detailFailures += 1;
      if (payload) commits.push(commitRecord(payload, repository, fullName, candidate.branch, tasks));
    }
    commits.sort((left, right) => (right.committedAt || '').localeCompare(left.committedAt || ''));
    const branchWarnings = [];
    if (requestedBranches.length && !branchCatalog.ok) branchWarnings.push('branch list unavailable');
    if (branchCatalog.truncated) branchWarnings.push('branch list exceeded 500 entries');
    if (branchSelection.unmatched.length) branchWarnings.push(`branch not found: ${branchSelection.unmatched.join(', ')}`);
    if (matchedBranches.length > MAX_TASK_BRANCHES) branchWarnings.push(`branch limit exceeded: ${matchedBranches.length}/${MAX_TASK_BRANCHES}`);
    for (const fetch of branchFetches.filter(item => !item.response.ok)) {
      branchWarnings.push(`branch activity unavailable: ${fetch.branch}`);
    }
    const status = failedSources.length || detailFailures || branchWarnings.length
      ? 'partial'
      : commits.length ? 'ok' : 'no-activity';
    result.repositories.push({
      name: metadata.data.name || repository.name || parsed.repo,
      project: repository.project || null,
      source: repository.source || 'notion',
      status,
      defaultBranch,
      branch: defaultBranch,
      remote: metadata.data.html_url || `https://github.com/${fullName}`,
      latestCommitAt: commits[0]?.committedAt || null,
      lastFetchedAt,
      commitCount: commits.length,
      mappedCommitCount: commits.filter(commit => commit.workItemId).length,
      ...(requestedBranches.length ? {
        requestedBranches,
        matchedBranches: limitedBranches,
        unmatchedBranches: branchSelection.unmatched,
        branchMatches: branchSelection.matches
          .filter(match => limitedBranches.includes(match.actual))
          .map(({ requested, actual, matchType }) => ({ requested, actual, matchType })),
      } : {}),
    });
    result.commits.push(...commits);
    if (status === 'partial') {
      result.errors.push(`GitHub ${fullName}: partial activity data`);
      result.errors.push(...branchWarnings.map(warning => `GitHub ${fullName}: ${warning}`));
    }
  }
  result.commits.sort((left, right) => (right.committedAt || '').localeCompare(left.committedAt || ''));
  return result;
}
