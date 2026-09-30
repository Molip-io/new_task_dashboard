const COMMON_PREFIX = /^(?:feature|feat|fix|bugfix|hotfix|release|task|work|chore)\//i;

function clean(value) {
  return String(value || '').trim().replace(/^refs\/heads\//i, '').replace(/^origin\//i, '');
}

function comparable(value) {
  return clean(value).toLowerCase();
}

// "sprint" spelled with one slip (srpint, sprnit, sprit ...) still names a sprint. The
// first and last letters must stay, so unrelated words like "print" don't qualify.
function isSprintWord(word) {
  if (word === '스프린트' || word === 'sprint') return true;
  if (word.length < 5 || word.length > 7 || word[0] !== 's' || word.at(-1) !== 't') return false;
  const target = 'sprint';
  if (word.length === target.length) {
    const diff = [...word].flatMap((letter, index) => (letter === target[index] ? [] : [index]));
    return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0] + 1 && word[diff[0]] === target[diff[1]] && word[diff[1]] === target[diff[0]]);
  }
  const [longer, shorter] = word.length > target.length ? [word, target] : [target, word];
  for (let skip = 0; skip < longer.length; skip += 1) if (longer.slice(0, skip) + longer.slice(skip + 1) === shorter) return true;
  return false;
}

const SPRINT_PART = /([a-z]{5,7}|스프린트)\s*(\d+(?:\.\d+)?)/g;

// The sprint a name refers to, e.g. "molip/develop/Srpint4" -> "4", "Sprint3.5_v2" -> "3.5".
// Two names for different sprints never match, however alike they read.
export function sprintIdentity(value) {
  for (const match of comparable(value).matchAll(SPRINT_PART)) {
    if (!isSprintWord(match[1])) continue;
    const [whole, fraction] = match[2].split('.');
    return fraction === undefined ? String(Number(whole)) : `${Number(whole)}.${fraction}`;
  }
  return null;
}

// Lower-cased name with any misspelled sprint word written out as "sprint".
function canonical(value) {
  return comparable(value).replace(SPRINT_PART, (part, word, number) => (isSprintWord(word) ? `sprint${number}` : part));
}

function compact(value) {
  return canonical(value).replace(COMMON_PREFIX, '').replace(/[^a-z0-9가-힣]+/g, '');
}

function tokens(value) {
  return new Set(canonical(value).replace(COMMON_PREFIX, '').split(/[^a-z0-9가-힣]+/).filter(Boolean));
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex + 1;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const above = previous[rightIndex + 1];
      previous[rightIndex + 1] = Math.min(
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + 1,
        diagonal + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

// A bare sprint tag such as "sprint4" names the sprint, not one branch: it matches a
// branch of that same sprint, whatever prefix the branch carries.
const BARE_SPRINT_SCORE = 0.86;

export function branchMatchScore(requested, candidate) {
  const requestedName = clean(requested);
  const candidateName = clean(candidate);
  if (!requestedName || !candidateName) return 0;
  const requestedSprint = sprintIdentity(requestedName);
  const candidateSprint = sprintIdentity(candidateName);
  if (requestedSprint && candidateSprint && requestedSprint !== candidateSprint) return 0;
  const score = nameMatchScore(requestedName, candidateName);
  if (requestedSprint && requestedSprint === candidateSprint && /^sprint\d+(\.\d+)?$/.test(canonical(requestedName))) return Math.max(score, BARE_SPRINT_SCORE);
  return score;
}

function nameMatchScore(requestedName, candidateName) {
  if (requestedName === candidateName) return 1;
  if (requestedName.toLowerCase() === candidateName.toLowerCase()) return 0.995;

  const requestedCompact = compact(requestedName);
  const candidateCompact = compact(candidateName);
  if (!requestedCompact || !candidateCompact) return 0;
  if (requestedCompact === candidateCompact) return 0.98;
  if (Math.min(requestedCompact.length, candidateCompact.length) < 5) return 0;

  const shorter = requestedCompact.length <= candidateCompact.length ? requestedCompact : candidateCompact;
  const longer = requestedCompact.length > candidateCompact.length ? requestedCompact : candidateCompact;
  const lengthRatio = shorter.length / longer.length;
  if (longer.includes(shorter) && lengthRatio >= 0.55) return 0.9 + (lengthRatio * 0.05);

  const distance = levenshtein(requestedCompact, candidateCompact);
  const editSimilarity = 1 - (distance / Math.max(requestedCompact.length, candidateCompact.length));
  if (editSimilarity >= 0.84) return editSimilarity;

  const requestedTokens = tokens(requestedName);
  const candidateTokens = tokens(candidateName);
  const intersection = [...requestedTokens].filter(token => candidateTokens.has(token)).length;
  const union = new Set([...requestedTokens, ...candidateTokens]).size;
  const tokenSimilarity = union ? intersection / union : 0;
  return tokenSimilarity >= 0.75 ? 0.84 + (tokenSimilarity * 0.05) : 0;
}

export function matchBranches(requestedBranches, availableBranches, { maxMatchesPerRequest = 3 } = {}) {
  const available = [...new Set(availableBranches.map(clean).filter(Boolean))];
  const matches = [];
  const unmatched = [];

  for (const requested of [...new Set(requestedBranches.map(clean).filter(Boolean))]) {
    const ranked = available
      .map(actual => ({ requested, actual, score: branchMatchScore(requested, actual) }))
      .filter(item => item.score >= 0.84)
      .sort((left, right) => right.score - left.score || left.actual.localeCompare(right.actual));
    if (!ranked.length) {
      unmatched.push(requested);
      continue;
    }

    const exact = ranked.find(item => item.score >= 0.995);
    if (exact) {
      matches.push({ ...exact, matchType: exact.score === 1 ? 'exact' : 'case-insensitive' });
      continue;
    }

    const bestScore = ranked[0].score;
    for (const item of ranked.filter(candidate => candidate.score >= bestScore - 0.02).slice(0, maxMatchesPerRequest)) {
      matches.push({ ...item, matchType: item.score >= 0.98 ? 'normalized' : 'similar' });
    }
  }

  return { matches, unmatched };
}

export function findTaskForCommit(tasks, project, message, branch) {
  const projectTasks = tasks.filter(task => task.project === project);
  const messageMatch = projectTasks.find(task => (
    (task.gitKey && message.includes(task.gitKey)) || message.includes(task.id)
  ));
  if (messageMatch) return messageMatch;
  if (!branch) return null;

  const ranked = projectTasks
    .filter(task => task.branch)
    .map(task => ({ task, score: branchMatchScore(task.branch, branch) }))
    .filter(item => item.score >= 0.84)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return null;
  if (ranked[1] && ranked[0].score === ranked[1].score) return null;
  return ranked[0].task;
}
