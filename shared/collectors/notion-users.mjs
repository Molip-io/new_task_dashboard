export function ignoredNotionUserIds(config = {}, env = process.env) {
  const configured = config.ignoredNotionUserIds || [];
  const fromEnvironment = String(env.IGNORED_NOTION_USER_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return new Set([...configured, ...fromEnvironment]);
}

export function removeIgnoredAssignees(users, ignoredIds) {
  const kept = (users || []).filter(user => !ignoredIds.has(user.id));
  return {
    names: kept.map(user => user.name).filter(Boolean),
    users: kept,
    removedCount: (users || []).length - kept.length,
  };
}
