import { execFileSync } from 'node:child_process';

const API_ROOT = 'https://api.github.com';

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
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: { message: error instanceof Error ? error.message : String(error) } };
  }
}

function findWorkItem(tasks, repository, message) {
  return tasks.find(task => task.project === repository.project && (
    (task.gitKey && message.includes(task.gitKey)) || message.includes(task.id)
  ));
}

function commitRecord(payload, repository, fullName, branch, tasks) {
  const message = payload.commit?.message?.split('\n')[0] || '';
  const workItem = findWorkItem(tasks, repository, message);
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

function failureStatus(status) {
  if (status === 401 || status === 403) return 'auth-required';
  if (status === 404 || status === 422) return 'invalid-url';
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
    const [defaultCommits, events, pulls] = await Promise.all([
      api(fetchImpl, `${basePath}/commits?sha=${encodeURIComponent(defaultBranch)}&since=${encodeURIComponent(since)}&per_page=100`, authorization),
      api(fetchImpl, `${basePath}/events?per_page=100`, authorization),
      api(fetchImpl, `${basePath}/pulls?state=open&sort=updated&direction=desc&per_page=100`, authorization),
    ]);
    const sources = [defaultCommits, events, pulls];
    const failedSources = sources.filter(source => !source.ok);
    if (failedSources.length === sources.length) {
      result.repositories.push(failureRepository(repository, 'failed', lastFetchedAt));
      result.errors.push(`GitHub ${fullName}: activity endpoints failed`);
      continue;
    }

    const candidates = new Map();
    if (defaultCommits.ok && Array.isArray(defaultCommits.data)) {
      for (const item of defaultCommits.data) candidates.set(item.sha, { branch: defaultBranch, payload: item });
    }
    if (events.ok && Array.isArray(events.data)) {
      for (const event of events.data) {
        if (event.type !== 'PushEvent' || !event.payload?.head || event.created_at < since) continue;
        const branch = event.payload.ref?.replace(/^refs\/heads\//, '') || null;
        if (!candidates.has(event.payload.head)) candidates.set(event.payload.head, { branch, payload: null });
      }
    }
    if (pulls.ok && Array.isArray(pulls.data)) {
      for (const pull of pulls.data) {
        if (!pull.head?.sha) continue;
        if (!candidates.has(pull.head.sha)) candidates.set(pull.head.sha, { branch: pull.head.ref || null, payload: null });
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
    const status = failedSources.length || detailFailures ? 'partial' : commits.length ? 'ok' : 'no-activity';
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
    });
    result.commits.push(...commits);
    if (status === 'partial') result.errors.push(`GitHub ${fullName}: partial activity data`);
  }
  result.commits.sort((left, right) => (right.committedAt || '').localeCompare(left.committedAt || ''));
  return result;
}
