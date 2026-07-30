import fs from 'node:fs';
import path from 'node:path';

const DONE = new Set(['완료', '중단']);
const TARGET_ISSUES = new Set([
  'OVERDUE', 'MISSING_START_DATE', 'MISSING_DUE_DATE', 'MISSING_ASSIGNEE',
  'PARENT_CHILD_STATUS_MISMATCH', 'REOPENED_COMPLETED_ITEM',
  'GIT_NOTION_ACTIVITY_MISMATCH', 'UNMAPPED_GIT_ACTIVITY',
]);

function runId(generatedAt) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(generatedAt));
  return `${date}-morning`;
}

function projectPacket(dashboard, project) {
  const workItems = (dashboard.workItems || []).filter(item => item.project === project.name);
  const validationIssues = (dashboard.validationIssues || []).filter(issue => issue.project === project.name);
  const changedIds = new Set((dashboard.deltas || []).filter(delta => delta.project === project.name).map(delta => delta.taskId).filter(Boolean));
  const targetRows = workItems.filter(item => !DONE.has(item.status)).map(item => {
    const reasons = [];
    if (changedIds.has(item.id)) reasons.push('changed_since_previous_snapshot');
    if (item.overdueDays > 0) reasons.push('overdue');
    for (const issue of item.issues || []) if (TARGET_ISSUES.has(issue.type)) reasons.push(issue.type.toLowerCase());
    if (item.latestGitAt && (item.issues || []).some(issue => issue.type === 'GIT_NOTION_ACTIVITY_MISMATCH')) reasons.push('git_notion_mismatch');
    return { item, reasons: [...new Set(reasons)] };
  }).filter(row => row.reasons.length)
    .sort((left, right) => (right.item.riskScore || 0) - (left.item.riskScore || 0) || (right.item.overdueDays || 0) - (left.item.overdueDays || 0))
    .slice(0, 30);
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
    ruleIssues: validationIssues.filter(issue => !issue.workItemId || targetIds.has(issue.workItemId)),
    analysisTargets: targetRows.map(({ item, reasons }) => ({
      workItemId: item.id, title: item.title, spec: item.spec, specId: item.specId,
      sprint: item.sprint, status: item.status, team: item.team, assignees: item.assignees,
      start: item.start, due: item.due, completedAt: item.completedAt, overdueDays: item.overdueDays,
      notionUpdatedAt: item.notionUpdatedAt, latestGitAt: item.latestGitAt,
      reasons, notionUrl: item.url || null,
      issues: (item.issues || []).filter(issue => TARGET_ISSUES.has(issue.type)).map(issue => ({
        type: issue.type, category: issue.category, severity: issue.severity, message: issue.message,
      })),
    })),
    analysisScope: {
      activeWorkItems: workItems.filter(item => !DONE.has(item.status)).length,
      selectedTargets: targetRows.length,
      targetLimit: 30,
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
      '완료율·기한 초과·가이드 위반 수치는 rules와 project.ruleStats를 그대로 사용한다.',
      'Git 활동만으로 작업 상태를 변경하거나 완료로 단정하지 않는다.',
      '출처 충돌은 임의로 해결하지 않고 양쪽 주장과 근거를 함께 confirmation_required로 기록한다.',
      '수집되지 않은 출처는 충돌 없음이 아니라 확인 불가로 기록한다.',
    ],
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
