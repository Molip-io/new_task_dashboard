const WORK_ASSIGNEE = '작업 담당자';
const PROJECT_OPERATOR = '프로젝트 운영 담당자';
const PROJECT_LEAD = 'PD 또는 메인 기획자';
const PROJECT_DEVELOPER = '프로젝트 개발 담당자';

export const ISSUE_CATALOG = Object.freeze({
  MISSING_START_DATE: guide('기간 입력 필요', WORK_ASSIGNEE, 'work-item', 'Notion 기간의 시작일을 입력하세요.'),
  MISSING_DUE_DATE: guide('기간 입력 필요', WORK_ASSIGNEE, 'work-item', 'Notion 기간의 마감일을 입력하세요.'),
  MISSING_COMPLETED_DATE: guide('완료일 입력 필요', WORK_ASSIGNEE, 'work-item', '실제 완료일을 입력하세요.'),
  DATE_RANGE_MISMATCH: guide('기간 확인 필요', WORK_ASSIGNEE, 'work-item', '상위·하위 작업의 시작일과 마감일을 확인하세요.'),
  MISSING_PROJECT: guide('프로젝트 연결 필요', PROJECT_OPERATOR, 'work-item', '요약 대상 프로젝트를 연결하세요.'),
  MISSING_SPEC: guide('스펙 연결 필요', PROJECT_LEAD, 'work-item', '작업항목을 상위 핵심 작업에 연결하세요.'),
  INVALID_HIERARCHY: guide('계층 수정 필요', PROJECT_LEAD, 'work-item', '상위 스펙과 작업항목의 2단계 구조로 이동하세요.'),
  MISSING_ASSIGNEE: guide('담당자 지정 필요', PROJECT_OPERATOR, 'work-item', '현재 담당자를 지정하세요.'),
  COMPLETION_DATE_RELATION: guide('완료일 관계 확인', WORK_ASSIGNEE, 'work-item', '완료일과 마감일의 관계가 실제 일정과 맞는지 확인하세요.'),
  MISSING_DELAY_REASON: guide('지연 사유 입력 필요', PROJECT_LEAD, 'spec', '상위 페이지에 지연 사유를 기록하세요.'),
  MISSING_DELAY_DATE_HISTORY: guide('변경 일정 입력 필요', PROJECT_LEAD, 'spec', '변경 전 날짜와 변경 후 날짜를 함께 기록하세요.'),
  MISSING_DELAY_OWNER_TAG: guide('지연 담당자 태그 필요', PROJECT_LEAD, 'spec', 'PD 또는 메인 기획자를 태그하세요.'),
  PARENT_CHILD_STATUS_MISMATCH: guide('상하위 상태 확인', PROJECT_LEAD, 'spec', '상위 스펙과 하위 작업항목의 상태를 일치시키세요.'),
  REOPENED_COMPLETED_ITEM: guide('신규 작업 분리 필요', PROJECT_LEAD, 'work-item', '추가 작업이면 기존 페이지가 아닌 신규 작업항목을 생성하세요.'),

  OVERDUE: schedule('지연 기록 필요', PROJECT_LEAD, 'spec', '지연 사유와 변경 일정을 상위 페이지에 기록하세요.'),

  GIT_NOTION_ACTIVITY_MISMATCH: consistency('Notion·Git 상태 확인', PROJECT_DEVELOPER, 'work-item', 'Git 활동과 실제 진행 내용이 Notion에 반영됐는지 확인하세요.'),

  UNMAPPED_GIT_ACTIVITY: integration('Git 작업 연결 필요', PROJECT_DEVELOPER, 'project', '커밋 메시지에 작업 키를 포함하거나 매핑 규칙을 추가하세요.'),
  GIT_URL_MISSING: integration('Git URL 입력 필요', PROJECT_DEVELOPER, 'project', 'Notion 프로젝트의 Git 저장소 URL을 입력하세요.'),
  GIT_URL_INVALID: integration('Git URL 수정 필요', PROJECT_DEVELOPER, 'project', 'Notion 프로젝트의 Git 저장소 URL을 GitHub 형식으로 수정하세요.'),
  GIT_AUTH_REQUIRED: integration('Git 인증 필요', PROJECT_DEVELOPER, 'git-repository', 'GitHub 접근 토큰과 저장소 권한을 확인하세요.'),
  GIT_FETCH_FAILED: integration('Git 수집 확인 필요', PROJECT_DEVELOPER, 'git-repository', '저장소 URL, 접근 권한, GitHub API 응답을 확인하세요.'),
  GIT_PARTIAL_FETCH: integration('Git 부분 수집 확인', PROJECT_DEVELOPER, 'git-repository', '수집되지 않은 브랜치 또는 PR의 접근 상태를 확인하세요.'),
});

const FALLBACK_ISSUE = guide('관리 정보 확인', WORK_ASSIGNEE, 'work-item', '현재 데이터와 Notion 작업관리 가이드를 확인하세요.');

export function issueDefinition(type) {
  return ISSUE_CATALOG[type] || FALLBACK_ISSUE;
}

export function enrichValidationIssue(issue) {
  const definition = issueDefinition(issue.type);
  return {
    ...definition,
    ...issue,
    category: issue.category || definition.category,
    label: issue.label || definition.label,
    responsibleRole: issue.responsibleRole || definition.responsibleRole,
    actionTarget: issue.actionTarget || targetFor(issue, definition.actionTarget),
    recommendedAction: issue.recommendedAction || definition.recommendedAction,
  };
}

function targetFor(issue, defaultTarget) {
  if (defaultTarget === 'work-item' && !issue.workItemId && issue.specId) return 'spec';
  return defaultTarget;
}

function guide(label, responsibleRole, actionTarget, recommendedAction) {
  return entry('guide', label, responsibleRole, actionTarget, recommendedAction);
}

function schedule(label, responsibleRole, actionTarget, recommendedAction) {
  return entry('schedule', label, responsibleRole, actionTarget, recommendedAction);
}

function consistency(label, responsibleRole, actionTarget, recommendedAction) {
  return entry('consistency', label, responsibleRole, actionTarget, recommendedAction);
}

function integration(label, responsibleRole, actionTarget, recommendedAction) {
  return entry('integration', label, responsibleRole, actionTarget, recommendedAction);
}

function entry(category, label, responsibleRole, actionTarget, recommendedAction) {
  return Object.freeze({ category, label, responsibleRole, actionTarget, recommendedAction });
}
