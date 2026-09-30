// Build notes are the one record the team keeps exactly, because every build goes out
// to the publisher. A row's title names its sprint ("3.5.0(Sprint3)", "Sprint 60
// 핫픽스") and whether it is a regular build, a hotfix or a comparison rebuild.
// QA dates exist only where a separate QA team runs QA; an empty QA period is normal
// for a project that tests in-house during development.

export const BUILD_WINDOW_DAYS = 90;

// One key for "Sprint 3.5", "스프린트3.5" and "sprint3.5".
export function buildSprintKey(value) {
  const key = String(value || '').toLowerCase().replace(/\s+/g, '').replace(/^스프린트/, 'sprint');
  return /^sprint\d+(\.\d+)?$/.test(key) ? key.replace(/^sprint0+(\d)/, 'sprint$1') : null;
}

function sprintFromTitle(title) {
  const match = /(?:sprint|스프린트)\s*(\d+(?:\.\d+)?)/i.exec(title);
  return match ? `sprint${Number(match[1].split('.')[0])}${match[1].includes('.') ? `.${match[1].split('.')[1]}` : ''}` : null;
}

function buildType(title) {
  if (/핫픽스|hotfix/i.test(title)) return 'hotfix';
  if (/재빌드|비교|rebuild/i.test(title)) return 'rebuild';
  return 'regular';
}

const dayNumber = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000 : null;
};

export function parseBuildNote(row, projectByNotionId) {
  const title = String(row['이름'] || '').trim();
  const qa = row['QA 기간'] || null;
  const qaStart = qa?.start || null;
  const qaEnd = qa?.end || qa?.start || null;
  return {
    id: row._id,
    url: row._url || null,
    title,
    project: (row['🎮 프로젝트'] || []).map(id => projectByNotionId.get(id)).find(Boolean) || null,
    sprintKey: sprintFromTitle(title),
    type: buildType(title),
    uploadedAt: row['업로드 날짜']?.start || null,
    qaStart,
    qaEnd,
    qaDays: qaStart && qaEnd ? dayNumber(qaEnd) - dayNumber(qaStart) + 1 : null,
    aosVersion: row['AOS ver'] || null,
    iosVersion: row['IOS ver'] || null,
  };
}

// Uploaded builds of one project within the window before `today`, newest first.
export function recentBuilds(builds, project, today, windowDays = BUILD_WINDOW_DAYS) {
  const end = dayNumber(today);
  return builds.filter(build => build.project === project && build.uploadedAt
    && end !== null && end - dayNumber(build.uploadedAt) >= 0 && end - dayNumber(build.uploadedAt) <= windowDays)
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

// Off-cycle = anything other than a regular sprint build (hotfixes, comparison rebuilds).
export function buildSummary(builds, windowDays = BUILD_WINDOW_DAYS) {
  const offCycle = builds.filter(build => build.type !== 'regular').length;
  const qa = builds.filter(build => build.qaDays !== null);
  return {
    windowDays,
    total: builds.length,
    offCycle,
    offCyclePercent: builds.length ? Math.round((offCycle / builds.length) * 100) : null,
    qaRecorded: qa.length,
    averageQaDays: qa.length ? Math.round((qa.reduce((sum, build) => sum + build.qaDays, 0) / qa.length) * 10) / 10 : null,
    recent: builds.slice(0, 8).map(({ title, type, sprintKey, uploadedAt, qaDays, url }) => ({ title, type, sprintKey, uploadedAt, qaDays, url })),
  };
}
