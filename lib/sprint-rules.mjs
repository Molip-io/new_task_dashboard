function clean(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function sprintIdentity(value) {
  const raw = clean(value);
  if (!raw) return null;
  const matched = raw.match(/^(?:sprint|스프린트)(\d+)$/);
  if (!matched) return { key: raw, number: null };
  const number = Number(matched[1]);
  return { key: `sprint${number}`, number };
}

export function normalizeSprint(value) {
  return sprintIdentity(value)?.key || null;
}

export function classifySprint(value, currentSprints = []) {
  const sprint = sprintIdentity(value);
  const current = [...new Map((currentSprints || [])
    .map(sprintIdentity)
    .filter(Boolean)
    .map(item => [item.key, item])).values()];
  if (!sprint || !current.length) return 'unknown';
  if (current.some(item => item.key === sprint.key)) return 'current';
  if (sprint.number === null || current.some(item => item.number === null)) return 'unknown';
  const numbers = current.map(item => item.number);
  if (sprint.number > Math.max(...numbers)) return 'future';
  if (sprint.number < Math.min(...numbers)) return 'past';
  return 'unknown';
}
