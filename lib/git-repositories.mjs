import path from 'node:path';

export function resolveGitRepositories({ projects, configured = [], root }) {
  const overrides = new Map(configured.map(repository => [repository.project, repository]));
  const local = [];
  const remote = [];

  for (const project of projects) {
    const override = overrides.get(project.name);
    if (override?.path) {
      local.push({
        ...override,
        path: path.isAbsolute(override.path) ? override.path : path.resolve(root, override.path),
      });
      continue;
    }
    remote.push({ name: project.name, project: project.name, url: project.gitUrl || null });
  }

  return { local, remote };
}
