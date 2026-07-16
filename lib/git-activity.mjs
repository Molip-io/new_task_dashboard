import { execFileSync } from 'node:child_process';
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
    const workItem = tasks.find(task => task.project === repository.project && (
      (task.gitKey && message.includes(task.gitKey)) || message.includes(task.id)
    ));
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

export function collectGitActivity({ repositories = [], tasks = [], sinceDays = 30, now = () => new Date() }) {
  const result = { repositories: [], commits: [], errors: [] };
  const lastFetchedAt = now().toISOString();
  for (const repository of repositories) {
    try {
      const branch = git(repository.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
      let remote = null;
      try { remote = git(repository.path, ['remote', 'get-url', 'origin']); } catch { /* optional */ }
      const output = git(repository.path, [
        'log',
        `--since=${sinceDays} days ago`,
        '--date=iso-strict',
        '--pretty=format:%x1e%H%x1f%aI%x1f%an%x1f%ae%x1f%s',
        '--name-only',
      ]);
      const commits = parseLog(output, repository, tasks, remote, branch);
      result.repositories.push({
        name: repository.name || repository.path,
        path: repository.path,
        project: repository.project || null,
        source: repository.source || 'config',
        status: commits.length ? 'ok' : 'no-activity',
        defaultBranch: branch,
        branch,
        remote: repository.url || remote,
        latestCommitAt: commits[0]?.committedAt || null,
        lastFetchedAt,
        commitCount: commits.length,
        mappedCommitCount: commits.filter(commit => commit.workItemId).length,
      });
      result.commits.push(...commits);
    } catch (error) {
      result.errors.push(`Git ${repository.name || repository.path}: ${error.message}`);
    }
  }
  result.commits.sort((left, right) => right.committedAt.localeCompare(left.committedAt));
  return result;
}
