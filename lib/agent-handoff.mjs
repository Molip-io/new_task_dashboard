import fs from 'node:fs';
import path from 'node:path';

const DONE = new Set(['완료', '중단']);
const ANALYSIS_TARGET_LIMIT = 15;
const TARGET_ISSUES = new Set([
  'OVERDUE', 'MISSING_START_DATE', 'MISSING_DUE_DATE', 'MISSING_ASSIGNEE', 'MISSING_PROJECT',
  'PARENT_CHILD_STATUS_MISMATCH', 'REOPENED_COMPLETED_ITEM',
  'GIT_NOTION_ACTIVITY_MISMATCH', 'UNMAPPED_GIT_ACTIVITY',
]);
const OUTPUT_SCHEMA = JSON.parse(fs.readFileSync(new URL('../schemas/agent-analysis.schema.json', import.meta.url), 'utf8'));

function runId(generatedAt) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(generatedAt));
  return `${date}-morning`;
}

function workItemIssues(item, issuesByWorkItem) {
  const combined = [...(item.issues || []), ...(issuesByWorkItem.get(item.id) || [])];
  return [...new Map(combined.filter(issue => issue?.type).map(issue => [issue.type, issue])).values()];
}

function issueCounts(issues) {
  return issues.reduce((counts, issue) => {
    if (issue?.type) counts[issue.type] = (counts[issue.type] || 0) + 1;
    return counts;
  }, {});
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function titlePresent(title) {
  return present(title) && !['(제목 없음)', '제목 없음'].includes(String(title).trim());
}

function missingFields(item) {
  return [
    !titlePresent(item.title) && 'title',
    item.projectMissing && 'project',
    !present(item.team) && 'team',
    !(item.assignees || []).length && 'assignee',
    !present(item.priority) && 'priority',
    !present(item.start) && 'start',
    !present(item.due) && 'due',
    !present(item.sprint) && 'sprint',
  ].filter(Boolean);
}

function projectPacket(dashboard, project) {
  const workItems = (dashboard.workItems || []).filter(item => item.project === project.name);
  const validationIssues = (dashboard.validationIssues || []).filter(issue => issue.project === project.name);
  const issuesByWorkItem = new Map();
  for (const issue of validationIssues) {
    if (!issue.workItemId) continue;
    const itemIssues = issuesByWorkItem.get(issue.workItemId) || [];
    itemIssues.push(issue);
    issuesByWorkItem.set(issue.workItemId, itemIssues);
  }
  const changedIds = new Set((dashboard.deltas || []).filter(delta => delta.project === project.name).map(delta => delta.taskId).filter(Boolean));
  const targetRows = workItems.filter(item => !DONE.has(item.status)).map(item => {
    const itemIssues = workItemIssues(item, issuesByWorkItem);
    const reasons = [];
    if (changedIds.has(item.id)) reasons.push('changed_since_previous_snapshot');
    if (item.overdueDays > 0) reasons.push('overdue');
    for (const issue of itemIssues) if (TARGET_ISSUES.has(issue.type)) reasons.push(issue.type.toLowerCase());
    if (item.latestGitAt && itemIssues.some(issue => issue.type === 'GIT_NOTION_ACTIVITY_MISMATCH')) reasons.push('git_notion_mismatch');
    return { item, itemIssues, reasons: [...new Set(reasons)] };
  }).filter(row => row.reasons.length)
    .sort((left, right) => (right.item.riskScore || 0) - (left.item.riskScore || 0) || (right.item.overdueDays || 0) - (left.item.overdueDays || 0))
    .slice(0, ANALYSIS_TARGET_LIMIT);
  const targetIds = new Set(targetRows.map(row => row.item.id));
  const gitEvidence = (dashboard.git?.commits || []).filter(commit => commit.project === project.name)
    .filter(commit => !commit.workItemId || targetIds.has(commit.workItemId)).slice(0, 20).map(commit => ({
    hash: commit.hash, shortHash: commit.shortHash, committedAt: commit.committedAt,
    author: commit.author, message: commit.message, url: commit.url || null,
    workItemId: commit.workItemId || null,
  }));
  const slackChannels = [...new Set([
    ...(project.config?.channels || []),
    ...(dashboard.slack?.[project.name] || []).map(channel => channel.channel),
  ].filter(Boolean))];
  return {
    id: project.config?.notionId || project.notionId || null,
    name: project.name,
    goal: project.goal || '',
    milestones: project.milestones || {},
    ruleStats: project.stats || {},
    ruleIssueCounts: issueCounts(validationIssues),
    ruleAuditItems: workItems.filter(item => !DONE.has(item.status)).map(item => ({
      workItemId: item.id,
      status: item.status,
      missingFields: missingFields(item),
      projectInherited: Boolean(item.projectInherited),
      issueTypes: workItemIssues(item, issuesByWorkItem).map(issue => issue.type),
    })),
    analysisTargets: targetRows.map(({ item, itemIssues, reasons }) => ({
      workItemId: item.id, title: item.title, spec: item.spec, specId: item.specId,
      status: item.status, assignees: item.assignees || [], start: item.start || null, due: item.due || null,
      overdueDays: item.overdueDays,
      notionUpdatedAt: item.notionUpdatedAt, latestGitAt: item.latestGitAt,
      reasons, notionUrl: item.url || null,
      issues: itemIssues.filter(issue => TARGET_ISSUES.has(issue.type)).map(issue => ({
        type: issue.type, severity: issue.severity,
      })),
    })),
    analysisScope: {
      activeWorkItems: workItems.filter(item => !DONE.has(item.status)).length,
      selectedTargets: targetRows.length,
      targetLimit: ANALYSIS_TARGET_LIMIT,
    },
    meetingReferences: (project.meetings || []).map(meeting => ({ title: meeting.title, date: meeting.date, url: meeting.url })),
    slackScope: { channels: slackChannels, days: project.config?.days || null },
    gitEvidence,
    previousSummary: project.notionSummary || null,
  };
}

export function buildAgentInputPacket(dashboard) {
  return {
    schemaVersion: '1.0',
    runId: runId(dashboard.generatedAt),
    generatedAt: dashboard.generatedAt,
    timeZone: 'Asia/Seoul',
    purpose: '규칙 엔진의 확정 사실과 출처 근거를 바탕으로 업무현황 요약 DB에 통합 분석을 작성한다.',
    constraints: [
      'rules.metrics와 project.ruleStats는 원본 참고값이다. 최종 보정 집계는 실행 지침의 상태별 예외를 projects.ruleAuditItems 전체에 적용해 ruleMetrics로 따로 계산한다.',
      'ruleAuditItems는 요약 체크가 true인 프로젝트의 활성 작업 전체이며, analysisTargets는 출처 대조 우선 대상이다.',
      'ruleAuditItems.missingFields는 title|project|team|assignee|priority|start|due|sprint 중 원본 누락 필드다. projectInherited는 범위 판정용 상속일 뿐 missingFields의 project 위반을 지우지 않는다.',
      'Git 활동만으로 작업 상태를 변경하거나 완료로 단정하지 않는다.',
      '출처 충돌은 임의로 해결하지 않고 양쪽 주장과 근거를 함께 confirmation_required로 기록한다.',
      '수집되지 않은 출처는 충돌 없음이 아니라 확인 불가로 기록한다.',
    ],
    outputSchema: OUTPUT_SCHEMA,
    sourceHealth: dashboard.sourceHealth || null,
    rules: {
      metrics: dashboard.metrics || {},
      deltas: dashboard.deltas || [],
    },
    projects: (dashboard.projects || []).map(project => projectPacket(dashboard, project)),
  };
}

export function writeAgentInputPacket(dashboard, file) {
  const packet = buildAgentInputPacket(dashboard);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(packet, null, 2));
  return packet;
}
