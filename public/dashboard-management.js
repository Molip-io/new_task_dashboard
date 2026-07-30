const CATEGORY_ALIASES = {
  guide: 'guide', '가이드 위반': 'guide',
  readiness: 'readiness', '진행 준비': 'readiness',
  schedule: 'schedule', '일정 위험': 'schedule',
  consistency: 'consistency', '데이터 불일치': 'consistency',
  integration: 'integration', '연동 문제': 'integration',
};

export const ISSUE_CATEGORIES = {
  guide: '가이드 위반',
  readiness: '진행 준비',
  schedule: '일정 위험',
  consistency: '데이터 불일치',
  integration: '연동 문제',
};

const CATALOG = {
  MISSING_TITLE: ['guide', '작업명 입력 필요', '작업 담당자'],
  MISSING_SPRINT: ['guide', '스프린트 입력 필요', '작업 담당자'],
  MISSING_STATUS: ['guide', '상태 입력 필요', '작업 담당자'],
  MISSING_DESCRIPTION: ['guide', '작업 설명 입력 필요', 'PD 또는 메인 기획자'],
  MISSING_REQUIRED_OWNERS: ['guide', 'PD·팀장 담당자 지정 필요', 'PD 또는 메인 기획자'],
  MISSING_START_DATE: ['guide', '기간 입력 필요', '작업 담당자'],
  MISSING_DUE_DATE: ['guide', '기간 입력 필요', '작업 담당자'],
  MISSING_PRIORITY: ['guide', '우선순위 입력 필요', '작업 담당자'],
  MISSING_BRANCH: ['guide', '브랜치 입력 필요', '프로젝트 개발 담당자'],
  MISSING_CONFIRMATION_COMMENT_TAG: ['guide', '확인 요청 태그 필요', 'PD 또는 메인 기획자'],
  MISSING_COMPLETED_DATE: ['guide', '완료일 입력 필요', '작업 담당자'],
  INVALID_HIERARCHY: ['guide', '계층 수정 필요', 'PD 또는 메인 기획자'],
  MISSING_PROJECT: ['guide', '프로젝트 연결 필요', '프로젝트 운영 담당자'],
  MISSING_SPEC: ['guide', '스펙 연결 필요', 'PD 또는 메인 기획자'],
  MISSING_ASSIGNEE: ['guide', '담당자 지정 필요', '프로젝트 운영 담당자'],
  DATE_RANGE_MISMATCH: ['guide', '기간 확인 필요', '작업 담당자'],
  PARENT_CHILD_STATUS_MISMATCH: ['guide', '상하위 상태 확인', 'PD 또는 메인 기획자'],
  REOPENED_COMPLETED_ITEM: ['guide', '신규 작업 분리 필요', 'PD 또는 메인 기획자'],
  COMPLETION_DATE_RELATION: ['guide', '완료일 관계 확인', '작업 담당자'],
  MISSING_DELAY_REASON: ['guide', '지연 사유 입력 필요', 'PD 또는 메인 기획자'],
  MISSING_DELAY_DATE_HISTORY: ['guide', '변경 일정 입력 필요', 'PD 또는 메인 기획자'],
  MISSING_DELAY_OWNER_TAG: ['guide', '지연 담당자 태그 필요', 'PD 또는 메인 기획자'],
  OVERDUE: ['schedule', '지연 기록 필요', 'PD 또는 메인 기획자'],
  PAST_SPRINT_NOT_STARTED: ['schedule', '지난 스프린트 미착수', 'PD 또는 메인 기획자'],
  CURRENT_SPRINT_SETUP_REQUIRED: ['readiness', '진행 준비 필요', 'PD 또는 메인 기획자'],
  GIT_NOTION_ACTIVITY_MISMATCH: ['consistency', 'Notion·Git 상태 확인', '프로젝트 개발 담당자'],
  UNMAPPED_GIT_ACTIVITY: ['integration', 'Git 작업 연결 필요', '프로젝트 개발 담당자'],
  MISSING_GIT_URL: ['integration', 'Git URL 입력 필요', '프로젝트 개발 담당자'],
  GIT_AUTH_REQUIRED: ['integration', 'Git 인증 설정 필요', '프로젝트 개발 담당자'],
  GIT_COLLECTION_FAILED: ['integration', 'Git 수집 확인 필요', '프로젝트 개발 담당자'],
  GIT_FETCH_FAILED: ['integration', 'Git 수집 확인 필요', '프로젝트 개발 담당자'],
  GIT_PARTIAL_FETCH: ['integration', 'Git 부분 수집 확인 필요', '프로젝트 개발 담당자'],
  GIT_URL_INVALID: ['integration', 'Git URL 수정 필요', '프로젝트 개발 담당자'],
  GIT_URL_MISSING: ['integration', 'Git URL 입력 필요', '프로젝트 개발 담당자'],
  RULE_NOT_EVALUATED: ['integration', '규칙 대조 미실행', '프로젝트 운영 담당자'],
};

const SEVERITY_RANK = { error: 0, warning: 1, check: 2, info: 3 };

export function issuePresentation(issue = {}) {
  const fallback = CATALOG[issue.type] || ['guide', issue.label || '관리 확인 필요', '작업 담당자'];
  const category = CATEGORY_ALIASES[issue.category] || fallback[0];
  return {
    category,
    categoryLabel: ISSUE_CATEGORIES[category],
    label: issue.label || fallback[1],
    recommendedAction: issue.recommendedAction || 'Notion의 해당 항목을 확인하고 필요한 정보를 수정하세요.',
    responsibleRole: issue.responsibleRole || fallback[2],
    actionTarget: issue.actionTarget || fallbackActionTarget(issue, category),
  };
}

function fallbackActionTarget(issue, category) {
  if (issue.workItemId) return 'work-item';
  if (issue.specId) return 'spec';
  if (category === 'integration' && !['UNMAPPED_GIT_ACTIVITY', 'GIT_URL_MISSING', 'GIT_URL_INVALID'].includes(issue.type)) return 'git-repository';
  return 'project';
}

export function primaryActionSummary(issues = []) {
  if (!issues.length) return { label: '정상', tone: 'normal', otherCount: 0 };
  const ordered = [...issues].sort((left, right) => (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9));
  const primary = ordered[0];
  const presentation = issuePresentation(primary);
  return {
    label: `${presentation.label}${ordered.length > 1 ? ` 외 ${ordered.length - 1}건` : ''}`,
    tone: primary.severity || 'check',
    otherCount: Math.max(0, ordered.length - 1),
  };
}

export function issueMatchesCategory(issue, category) {
  return !category || issuePresentation(issue).category === category;
}

export function briefingDetailItems(dashboard, detail) {
  const active = (dashboard.workItems || []).filter(item => !['완료', '일시 정지', '정지', '중단'].includes(item.status));
  if (detail === 'projects') return (dashboard.projects || []).filter(project => project.stats?.inProgress + project.stats?.planned + project.stats?.review > 0);
  if (detail === 'work-items') return active.filter(item => item.status === '진행 중');
  if (detail === 'overdue') return active.filter(item => item.overdueDays > 0);
  if (detail === 'guide') return dashboard.guideViolationItems
    || active.filter(item => (item.issues || []).some(issue => issueMatchesCategory(issue, 'guide')));
  if (detail === 'setup') return dashboard.progressSetupItems || [];
  return [];
}

function cleanShareText(value, fallback = '-') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function uniqueWorkItems(items = []) {
  const unique = new Map();
  for (const item of items) {
    const key = item.id || `${item.project || ''}:${item.title || ''}:${item.url || ''}`;
    if (!unique.has(key)) {
      unique.set(key, { ...item, issues: [...(item.issues || [])] });
      continue;
    }
    const existing = unique.get(key);
    const issueKeys = new Set((existing.issues || []).map(issue => `${issue.type || ''}:${issue.message || ''}`));
    for (const issue of item.issues || []) {
      const issueKey = `${issue.type || ''}:${issue.message || ''}`;
      if (!issueKeys.has(issueKey)) existing.issues.push(issue);
    }
  }
  return [...unique.values()];
}

export function slackWorkItemsMessage(items = [], {
  title = '확인할 작업항목',
  generatedAt = null,
  dashboardUrl = null,
  category = null,
  issueType = null,
} = {}) {
  const rows = uniqueWorkItems(items);
  const header = `*${cleanShareText(title)} · ${rows.length}건*`;
  const lines = [header];
  if (generatedAt) lines.push(`_기준: ${cleanShareText(generatedAt).replace('T', ' ').slice(0, 16)}_`);

  for (const item of rows) {
    const issues = (item.issues || []).filter(issue =>
      (!category || issueMatchesCategory(issue, category))
      && (!issueType || issue.type === issueType));
    const issueLabels = [...new Set(issues.map(issue => issuePresentation(issue).label))];
    const assignees = (item.assignees || []).map(name => cleanShareText(name)).join(', ') || '미지정';
    const period = `${cleanShareText(item.start)} → ${cleanShareText(item.due)}${item.overdueDays > 0 ? ` · ${item.overdueDays}일 초과` : ''}`;
    lines.push(
      '',
      `• *${cleanShareText(item.project, '프로젝트 미분류')} · ${cleanShareText(item.title, '제목 없음')}*`,
      `  상태: ${cleanShareText(item.status, '미정')} · 담당자: ${assignees}`,
      `  기간: ${period}`,
    );
    if (issueLabels.length) lines.push(`  확인: ${issueLabels.join(' · ')}`);
    if (item.url) lines.push(`  Notion: ${item.url}`);
  }

  if (dashboardUrl) lines.push('', `대시보드: ${dashboardUrl}`);
  return lines.join('\n');
}

export function dashboardShareUrl(baseUrl, state = {}) {
  const url = new URL(baseUrl);
  url.search = '';
  const tab = ['briefing', 'projects', 'people', 'checks'].includes(state.tab) ? state.tab : 'briefing';
  url.searchParams.set('tab', tab);
  if (tab === 'briefing' && ['projects', 'work-items', 'overdue', 'guide', 'setup', 'git'].includes(state.briefingDetail)) {
    url.searchParams.set('detail', state.briefingDetail);
  }
  if (tab === 'checks') {
    const filters = state.checkFilters || {};
    if (filters.project) url.searchParams.set('checkProject', filters.project);
    if (filters.category) url.searchParams.set('checkCategory', filters.category);
    if (filters.issueType) url.searchParams.set('checkIssue', filters.issueType);
  }
  return url.toString();
}

export function briefingTrustOverview(dashboard = {}) {
  const active = (dashboard.workItems || []).filter(item => !['완료', '일시 정지', '정지', '중단'].includes(item.status));
  const sourceConflicts = Array.isArray(dashboard.ai?.overall?.sourceConflicts) ? dashboard.ai.overall.sourceConflicts.slice(0, 5) : [];
  const sources = dashboard.sourceHealth?.sources || [];
  const comparisonStatus = dashboard.ai?.sourceComparison?.status
    || (Array.isArray(dashboard.ai?.overall?.sourceConflicts) ? 'complete' : 'not_run');
  return {
    scheduleRiskCount: active.filter(item => item.overdueDays > 0).length,
    guideViolationCount: active.filter(item => (item.issues || []).some(issue => issueMatchesCategory(issue, 'guide'))).length,
    sourceConflicts,
    sourceComparisonAvailable: ['complete', 'partial'].includes(comparisonStatus),
    sourceComparisonStatus: comparisonStatus,
    agentAnalysisStatus: dashboard.ai?.analysisStatus || 'not_run',
    agentAnalysisAt: dashboard.ai?.generatedAt || null,
    collectionGaps: sources.filter(source => source.status !== 'ok'),
    dependencyCoverageRate: dashboard.sourceHealth?.dependencyCoverage?.rate ?? null,
  };
}

const CONNECTED = new Set(['ok', 'connected', 'inactive', 'no-activity', 'no_activity']);
const AUTH = new Set(['auth-required', 'auth_required', 'authentication_required', 'unauthorized']);
const FAILED = new Set(['failed', 'error', 'collection-failed', 'collection_failed', 'invalid-url']);

function normalizedRepositoryStatus(repository) {
  return String(repository?.status || 'connected').toLowerCase();
}

export function gitTrustSummary(git = {}, projects = []) {
  const repositories = git.repositories || [];
  const total = projects.length || repositories.length;
  const statuses = repositories.map(normalizedRepositoryStatus);
  const errors = (git.errors || []).map(error => String(error?.message || error)).join(' ').toLowerCase();
  const hasAuthError = statuses.some(status => AUTH.has(status)) || AUTH.has(String(git.status || '').toLowerCase()) || /401|403|auth|token|인증/.test(errors);
  const connected = repositories.filter(repository => CONNECTED.has(normalizedRepositoryStatus(repository))).length;
  const configured = projects.length
    ? projects.filter(project => project.gitUrl || project.config?.gitUrl || project.git?.url).length
    : repositories.filter(repository => !['missing-url', 'missing_url'].includes(normalizedRepositoryStatus(repository))).length;
  if (hasAuthError) return { label: 'Git 인증 필요', tone: 'partial', connected, total };
  if (!configured) return { label: 'Git URL 미입력', tone: 'partial', connected: 0, total };
  if (statuses.includes('partial')) return { label: 'Git 부분 수집', tone: 'partial', connected, total };
  if (connected && (connected < total || statuses.some(status => FAILED.has(status)) || git.errors?.length)) return { label: 'Git 부분 수집', tone: 'partial', connected, total };
  if (!connected && (statuses.some(status => FAILED.has(status)) || git.errors?.length)) return { label: 'Git 수집 실패', tone: 'unavailable', connected: 0, total };
  return { label: `Git ${connected}/${total || connected} 연결`, tone: 'ok', connected, total: total || connected };
}

export function gitRepositoryStatus(repository = {}) {
  const status = normalizedRepositoryStatus(repository);
  if (AUTH.has(status)) return 'Git 인증 필요';
  if (FAILED.has(status)) return 'Git 수집 실패';
  if (status === 'missing-url' || status === 'missing_url') return 'Git URL 미입력';
  if (status === 'partial') return 'Git 부분 수집';
  return repository.commitCount > 0 || repository.lastActivityAt || repository.recentGitAt ? '연결됨 · 최근 활동 있음' : '연결됨 · 최근 활동 없음';
}
