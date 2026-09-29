import { execFileSync } from 'node:child_process';
import { findTaskForCommit, matchBranches } from './git-branch-matching.mjs';
export { collectGitHubActivity } from './github-activity.mjs';

function git(repositoryPath, args) {
  return execFileSync('git', ['-C', repositoryPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitUrl(remote, hash) {
  if (!remote) return null;
  const https = remote
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/\.git$/, '');
  return /^https?:\/\//.test(https) ? `${https}/commit/${hash}` : null;
}

function parseLog(output, repository, tasks, remote, branch) {
  if (!output) return [];
  return output.split('\x1e').filter(Boolean).map(record => {
    const [header, ...fileLines] = record.trim().split('\n');
    const [hash, committedAt, author, email, message] = header.split('\x1f');
    const workItem = findTaskForCommit(tasks, repository.project, message, branch);
    return {
      hash,
      shortHash: hash.slice(0, 8),
      committedAt,
      author,
      email,
      message,
      files: fileLines.map(file => file.trim()).filter(Boolean),
      repository: repository.name || repository.path,
      project: repository.project || null,
      workItemId: workItem?.id || null,
      branch,
      url: commitUrl(repository.url || remote, hash),
    };
  });
}

function localBranches(repositoryPath) {
  const output = git(repositoryPath, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads',
    'refs/remotes/origin',
  ]);
  const byName = new Map();
  for (const ref of output.split('\n').map(value => value.trim()).filter(Boolean)) {
    if (ref === 'origin/HEAD') continue;
    const name = ref.replace(/^origin\//, '');
    if (!byName.has(name) || !ref.startsWith('origin/')) byName.set(name, ref);
  }
  return byName;
}

export function collectGitActivity({ repositories = [], tasks = [], sinceDays = 30, now = () => new Date() }) {
  const result = { repositories: [], commits: [], errors: [] };
  const lastFetchedAt = now().toISOString();
  for (const repository of repositories) {
    try {
      const branch = git(repository.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
      let remote = null;
      try { remote = git(repository.path, ['remote', 'get-url', 'origin']); } catch { /* optional */ }
      const requestedBranches = [...new Set(tasks
        .filter(task => task.project === repository.project && task.branch)
        .map(task => String(task.branch).trim())
        .filter(Boolean))];
      const branchesByName = localBranches(repository.path);
      const branchSelection = matchBranches(requestedBranches, [...branchesByName.keys()]);
      const matchedBranches = [...new Set(branchSelection.matches.map(match => match.actual))];
      const refs = new Map([[branch, branchesByName.get(branch) || branch]]);
      for (const matchedBranch of matchedBranches) refs.set(matchedBranch, branchesByName.get(matchedBranch) || matchedBranch);

      const commitsByHash = new Map();
      let branchFailures = 0;
      for (const [branchName, ref] of refs) {
        try {
          const output = git(repository.path, [
            'log',
            ref,
            `--since=${sinceDays} days ago`,
            '--date=iso-strict',
            '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%ae%x1f%s',
            '--name-only',
          ]);
          for (const commit of parseLog(output, repository, tasks, remote, branchName)) {
            if (!commitsByHash.has(commit.hash)) commitsByHash.set(commit.hash, commit);
          }
        } catch {
          branchFailures += 1;
        }
      }
      const commits = [...commitsByHash.values()]
        .sort((left, right) => (right.committedAt || '').localeCompare(left.committedAt || ''));
      const partial = branchFailures || branchSelection.unmatched.length;
      result.repositories.push({
        name: repository.name || repository.path,
        path: repository.path,
        project: repository.project || null,
        source: repository.source || 'config',
        status: partial ? 'partial' : commits.length ? 'ok' : 'no-activity',
        defaultBranch: branch,
        branch,
        remote: repository.url || remote,
        latestCommitAt: commits[0]?.committedAt || null,
        lastFetchedAt,
        commitCount: commits.length,
        mappedCommitCount: commits.filter(commit => commit.workItemId).length,
        ...(requestedBranches.length ? {
          requestedBranches,
          matchedBranches,
          unmatchedBranches: branchSelection.unmatched,
          branchMatches: branchSelection.matches
            .map(({ requested, actual, matchType }) => ({ requested, actual, matchType })),
        } : {}),
      });
      result.commits.push(...commits);
      if (partial) {
        result.errors.push(`Git ${repository.name || repository.path}: partial activity data`);
        if (branchSelection.unmatched.length) {
          result.errors.push(`Git ${repository.name || repository.path}: branch not found: ${branchSelection.unmatched.join(', ')}`);
        }
        if (branchFailures) result.errors.push(`Git ${repository.name || repository.path}: ${branchFailures} branch logs unavailable`);
      }
    } catch (error) {
      result.errors.push(`Git ${repository.name || repository.path}: ${error.message}`);
    }
  }
  result.commits.sort((left, right) => right.committedAt.localeCompare(left.committedAt));
  return result;
}
