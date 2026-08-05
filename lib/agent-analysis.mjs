const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();

function first(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
  }
  return null;
}

function timestamp(row) {
  const value = first(row, ['분석 시각', '생성시각', 'date:기준일:start', '기준일', '_edited', '_created']);
  return value?.start || value || null;
}

function projectName(row) {
  const value = first(row, ['프로젝트명', '프로젝트', '이름', 'Name']);
  return Array.isArray(value) ? value[0] || '' : String(value || '').trim();
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  const json = parseJson(value);
  if (Array.isArray(json)) return json.filter(Boolean);
  return String(value).split(/\n|\s*;\s*/).map(item => item.trim()).filter(Boolean);
}

function normalizedAnalysisStatus(row) {
  const raw = norm(first(row, ['분석 상태', '실행 상태', 'AI 분석 상태']));
  if (/실패|failed|error/.test(raw)) return 'failed';
  if (/부분|partial/.test(raw)) return 'partial';
  if (/성공|완료|success|complete/.test(raw)) return 'success';
  return 'legacy';
}

function comparisonStatus(row, details) {
  const raw = norm(first(row, ['출처 대조 상태', 'Notion·Slack 대조', '노션·슬랙 대조']));
  if (/완료|성공|complete|success/.test(raw)) return 'complete';
  if (/부분|partial/.test(raw)) return 'partial';
  if (/실패|불가|failed|unavailable/.test(raw)) return 'unavailable';
  if (Array.isArray(details?.overall?.sourceConflicts) || Array.isArray(details?.sourceConflicts)) return 'complete';
  return 'not_run';
}

function sourceStatus(row, details) {
  return parseJson(first(row, ['출처 상태', '수집 출처 상태'])) || details?.sourceStatus || {};
}

function isOverallName(name) {
  const value = norm(name);
  return ['전체', '전체업무', '전체프로젝트', 'overall', 'all'].includes(value);
}

function sameProject(row, name) {
  const rowName = projectName(row);
  if (!rowName || !name) return false;
  return norm(rowName).includes(norm(name)) || norm(name).includes(norm(rowName));
}

export function latestProjectSummaryRow(rows = [], name) {
  return [...rows].filter(row => sameProject(row, name))
    .sort((left, right) => String(timestamp(right) || '').localeCompare(String(timestamp(left) || '')))[0] || null;
}

function projectResult(row, name) {
  const details = parseJson(first(row, ['분석 결과 JSON', '에이전트 분석 JSON', 'AI 분석 JSON']));
  const embedded = details?.projects?.find(project => norm(project.name) === norm(name))
    || (details?.name && norm(details.name) === norm(name) ? details : null)
    || {};
  const decision = first(row, ['대표 결정 필요', '오늘 확인할 판단']);
  const conflicts = embedded.sourceConflicts || parseJson(first(row, ['출처 충돌 요약', '출처 충돌'])) || [];
  return {
    name,
    summary: embedded.summary || first(row, ['현재 진행 요약', '전체 요약']) || '',
    status: embedded.status || first(row, ['프로젝트 상태', '전체 상태']) || null,
    specSummaries: Array.isArray(embedded.specSummaries) ? embedded.specSummaries : [],
    blockers: embedded.blockers || asList(first(row, ['막힌 점', '현재 막힌 것'])),
    highlights: embedded.highlights || asList(first(row, ['주요 근거', 'Slack 신호'])),
    nextActions: embedded.nextActions || asList(first(row, ['다음 액션'])),
    decisionsForCEO: embedded.decisionsForCEO || (decision ? [{ project: name, question: String(decision), context: 'Notion 업무현황 요약 DB' }] : []),
    sourceConflicts: Array.isArray(conflicts) ? conflicts : [],
    confidenceLimits: embedded.confidenceLimits || asList(first(row, ['분석 범위 제한', '신뢰 제한'])),
    generatedAt: timestamp(row),
    url: row._url || null,
  };
}

function latestTimestamp(rows) {
  return rows.map(timestamp).filter(Boolean).sort().at(-1) || null;
}

function hoursBetween(older, newer) {
  const difference = new Date(newer).getTime() - new Date(older).getTime();
  return Number.isFinite(difference) ? difference / 3_600_000 : 0;
}

export function buildAgentAnalysis(summaryRows = [], projectNames = [], now = new Date().toISOString()) {
  if (!summaryRows.length) {
    return {
      provider: 'notion-agent', schemaVersion: '1.0', analysisStatus: 'not_run',
      generatedAt: null, runId: null, sourceStatus: {}, sourceComparison: { status: 'not_run' },
      overall: {}, projects: [],
    };
  }

  const overallRow = [...summaryRows].filter(row => isOverallName(projectName(row)))
    .sort((left, right) => String(timestamp(right) || '').localeCompare(String(timestamp(left) || '')))[0] || null;
  const selectedRows = projectNames.map(name => latestProjectSummaryRow(summaryRows, name)).filter(Boolean);
  const metadataRow = overallRow || selectedRows[0] || summaryRows[0];
  const details = parseJson(first(metadataRow, ['분석 결과 JSON', '에이전트 분석 JSON', 'AI 분석 JSON']));

  if (details?.overall && Array.isArray(details.projects)) {
    const generatedAt = details.generatedAt || timestamp(metadataRow);
    const baseStatus = details.analysisStatus || normalizedAnalysisStatus(metadataRow);
    return {
      ...details,
      provider: details.provider || 'notion-agent',
      schemaVersion: details.schemaVersion || '1.0',
      analysisStatus: generatedAt && hoursBetween(generatedAt, now) > 36 && baseStatus === 'success' ? 'stale' : baseStatus,
      generatedAt,
      runId: details.runId || first(metadataRow, ['분석 실행 ID', '실행 ID', 'run_id']),
      sourceStatus: details.sourceStatus || sourceStatus(metadataRow, details),
      sourceComparison: details.sourceComparison || { status: comparisonStatus(metadataRow, details) },
    };
  }

  const projects = projectNames.map(name => {
    const row = latestProjectSummaryRow(summaryRows, name);
    return row ? projectResult(row, name) : null;
  }).filter(Boolean);
  const generatedAt = latestTimestamp([overallRow, ...selectedRows].filter(Boolean));
  const rawStatus = normalizedAnalysisStatus(metadataRow);
  const status = generatedAt && hoursBetween(generatedAt, now) > 36 && rawStatus === 'success' ? 'stale' : rawStatus;
  const comparison = comparisonStatus(metadataRow, details);
  const overallConflicts = parseJson(first(overallRow, ['출처 충돌 요약', '출처 충돌']));
  const combinedConflicts = Array.isArray(overallConflicts) ? overallConflicts : projects.flatMap(project => project.sourceConflicts || []);
  const overallSummary = first(overallRow, ['현재 진행 요약', '전체 요약']) || '';
  const overall = {
    summary: overallSummary,
    topRisks: asList(first(overallRow, ['주요 위험', '막힌 점'])),
    decisionsForCEO: [
      ...asList(first(overallRow, ['대표 결정 필요', '오늘 확인할 판단'])).map(question => ({ project: '전체', question, context: 'Notion 업무현황 요약 DB' })),
      ...projects.flatMap(project => project.decisionsForCEO || []),
    ],
    confidenceLimits: asList(first(overallRow || metadataRow, ['분석 범위 제한', '신뢰 제한'])),
  };
  if (comparison === 'complete' || comparison === 'partial') overall.sourceConflicts = combinedConflicts;

  return {
    provider: 'notion-agent', schemaVersion: rawStatus === 'legacy' ? 'legacy' : '1.0',
    analysisStatus: status, generatedAt, runId: first(metadataRow, ['분석 실행 ID', '실행 ID', 'run_id']),
    sourceStatus: sourceStatus(metadataRow, details),
    sourceComparison: { status: comparison },
    overall, projects,
  };
}

export function summaryRowTimestamp(row) {
  return timestamp(row);
}
