import fs from 'node:fs';
import path from 'node:path';

const DONE = new Set(['완료', '일시 정지', '정지', '중단']);
// Keep the remote handoff below Notion's safe read budget. Full rule coverage
// stays in ruleAuditItems; analysisTargets only carries the highest-risk rows.
const ANALYSIS_TARGET_LIMIT = 3;
const REMOTE_PACKET_TARGET = 48_000;
const MISSING_FIELD_BITS = Object.freeze({
  title: 1,
  project: 2,
  assignee: 4,
  priority: 8,
  start: 16,
  due: 32,
  sprint: 64,
  status: 128,
  branch: 256,
});
const TARGET_ISSUES = new Set([
  'OVERDUE', 'MISSING_TITLE', 'MISSING_PROJECT', 'MISSING_SPRINT', 'MISSING_STATUS',
  'MISSING_DESCRIPTION', 'MISSING_REQUIRED_OWNERS', 'MISSING_ASSIGNEE', 'MISSING_PRIORITY',
  'MISSING_START_DATE', 'MISSING_DUE_DATE', 'MISSING_BRANCH', 'MISSING_CONFIRMATION_COMMENT_TAG',
  'MISSING_SPEC', 'INVALID_HIERARCHY', 'PARENT_CHILD_STATUS_MISMATCH', 'REOPENED_COMPLETED_ITEM',
  'CURRENT_SPRINT_SETUP_REQUIRED', 'PAST_SPRINT_NOT_STARTED', 'RULE_NOT_EVALUATED',
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

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function titlePresent(title) {
  return present(title) && !['(제목 없음)', '제목 없음'].includes(String(title).trim());
}

function missingFieldMask(item) {
  return (
    (!titlePresent(item.title) ? MISSING_FIELD_BITS.title : 0)
    | (item.projectMissing ? MISSING_FIELD_BITS.project : 0)
    | (!(item.assignees || []).length ? MISSING_FIELD_BITS.assignee : 0)
    | (!present(item.priority) ? MISSING_FIELD_BITS.priority : 0)
    | (!present(item.start) ? MISSING_FIELD_BITS.start : 0)
    | (!present(item.due) ? MISSING_FIELD_BITS.due : 0)
    | (!present(item.sprint) ? MISSING_FIELD_BITS.sprint : 0)
    | (!present(item.status) ? MISSING_FIELD_BITS.status : 0)
    | (!present(item.branch) ? MISSING_FIELD_BITS.branch : 0)
  );
}

function auditCatalog(values) {
  const entries = [...new Set(values)];
  return {
    entries,
    indexByValue: new Map(entries.map((value, index) => [value, index])),
  };
}

function specCatalog(project) {
  const columns = ['specId', 'title', 'sprint', 'status', 'activeTaskCount', 'completionRate', 'overdueCount'];
  const rows = (project.specs || [])
    .filter(spec => (spec.tasks || []).some(task => !DONE.has(task.status)))
    .map(spec => [
      spec.id || null,
      spec.title || '',
      spec.sprint || null,
      spec.status || null,
      (spec.tasks || []).filter(task => !DONE.has(task.status)).length,
      spec.childStats?.completionRate || 0,
      (spec.tasks || []).filter(task => task.overdueDays > 0).length,
    ]);
  return { columns, rows };
}

function projectSourceEvidence(project) {
  const rows = [];
  for (const insight of project.specInsights || []) {
    const candidates = (insight.evidence || []).filter(item => item.source && item.source !== 'notion');
    const selected = [];
    for (const source of ['slack', 'meeting', 'git']) {
      const match = candidates.find(item => item.source === source);
      if (match) selected.push(match);
    }
    for (const candidate of candidates) {
      if (selected.length >= 3) break;
      if (!selected.includes(candidate)) selected.push(candidate);
    }
    for (const item of selected) {
      rows.push([
        insight.specId || null,
        item.source,
        item.timestamp || null,
        item.title || '',
        String(item.excerpt || '').slice(0, 64),
        item.url || null,
      ]);
    }
  }
  return rows;
}

function fitRemoteEvidenceBudget(packet) {
  const packetSize = () => JSON.stringify(packet).length;
  if (packetSize() <= REMOTE_PACKET_TARGET) return packet;

  for (const project of packet.projects) {
    for (const row of project.sourceEvidence || []) row[4] = String(row[4] || '').slice(0, 40);
  }
  if (packetSize() <= REMOTE_PACKET_TARGET) return packet;

  for (const project of packet.projects) {
    for (const row of project.sourceEvidence || []) row[3] = String(row[3] || '').slice(0, 48);
  }
  while (packetSize() > REMOTE_PACKET_TARGET) {
    let removed = false;
    for (const project of [...packet.projects].sort((left, right) => (right.sourceEvidence?.length || 0) - (left.sourceEvidence?.length || 0))) {
      const counts = new Map((project.sourceEvidence || []).map(row => [row[0], 0]));
      for (const row of project.sourceEvidence || []) counts.set(row[0], (counts.get(row[0]) || 0) + 1);
      const index = (project.sourceEvidence || []).findLastIndex(row => (counts.get(row[0]) || 0) > 1);
      if (index < 0) continue;
      project.sourceEvidence.splice(index, 1);
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return packet;
}

function projectPacket(dashboard, project) {
  const workItems = (dashboard.workItems || []).filter(item => item.project === project.name);
  const ruleItems = (dashboard.ruleItems || workItems).filter(item => item.project === project.name);
  const activeWorkItems = ruleItems.filter(item => !DONE.has(item.status));
  const validationIssues = (dashboard.validationIssues || []).filter(issue => issue.project === project.name);
  const issuesByWorkItem = new Map();
  for (const issue of validationIssues) {
    if (!issue.workItemId) continue;
    const itemIssues = issuesByWorkItem.get(issue.workItemId) || [];
    itemIssues.push(issue);
    issuesByWorkItem.set(issue.workItemId, itemIssues);
  }
  const auditIssuesByWorkItem = new Map(activeWorkItems.map(item => [item.id, workItemIssues(item, issuesByWorkItem)]));
  const auditIssueTypes = [...new Set([...auditIssuesByWorkItem.values()].flatMap(issues => issues.map(issue => issue.type)))].sort();
  const auditIssueTypeIndex = new Map(auditIssueTypes.map((type, index) => [type, index]));
  const auditCatalogs = {
    itemLevel: auditCatalog(activeWorkItems.map(item => item.itemLevel || 'child')),
    status: auditCatalog(activeWorkItems.map(item => item.status || null)),
    sprint: auditCatalog(activeWorkItems.map(item => item.sprint || null)),
    sprintRelation: auditCatalog(activeWorkItems.map(item => item.sprintRelation || 'unknown')),
  };
  const changedIds = new Set((dashboard.deltas || []).filter(delta => delta.project === project.name).map(delta => delta.taskId).filter(Boolean));
  const targetRows = activeWorkItems.map(item => {
    const itemIssues = auditIssuesByWorkItem.get(item.id) || [];
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
    .filter(commit => !commit.workItemId || targetIds.has(commit.workItemId)).slice(0, 5).map(commit => ({
    hash: commit.hash, shortHash: commit.shortHash, committedAt: commit.committedAt,
    author: commit.author, message: commit.message, url: commit.url || null,
    workItemId: commit.workItemId || null,
  }));
  const slackChannels = [...new Set([
    ...(project.config?.channels || []),
    ...(dashboard.slack?.[project.name] || []).map(channel => channel.channel),
  ].filter(Boolean))];
  const specs = specCatalog(project);
  return {
    id: project.config?.notionId || project.notionId || null,
    name: project.name,
    goal: project.goal || '',
    currentSprints: project.config?.currentSprints || [],
    pdUserIds: (project.config?.pdUsers || []).map(user => user.id),
    teamLeadUserIds: (project.config?.teamLeadUsers || []).map(user => user.id),
    milestones: project.milestones || {},
    ruleAuditFormat: {
      columns: ['itemLevel', 'status', 'sprint', 'sprintRelation', 'missingFieldMask', 'projectInherited', 'issueTypeIndexes'],
      indexedValues: Object.fromEntries(Object.entries(auditCatalogs).map(([key, catalog]) => [key, catalog.entries])),
      missingFieldBits: MISSING_FIELD_BITS,
      issueTypes: auditIssueTypes,
    },
    ruleAuditItems: activeWorkItems.map(item => [
      auditCatalogs.itemLevel.indexByValue.get(item.itemLevel || 'child'),
      auditCatalogs.status.indexByValue.get(item.status || null),
      auditCatalogs.sprint.indexByValue.get(item.sprint || null),
      auditCatalogs.sprintRelation.indexByValue.get(item.sprintRelation || 'unknown'),
      missingFieldMask(item),
      item.projectInherited ? 1 : 0,
      (auditIssuesByWorkItem.get(item.id) || []).map(issue => auditIssueTypeIndex.get(issue.type)),
    ]),
    specCatalogFormat: { columns: specs.columns },
    specCatalog: specs.rows,
    analysisTargets: targetRows.map(({ item, reasons }) => ({
      workItemId: item.itemLevel === 'parent' ? null : item.id,
      itemLevel: item.itemLevel || 'child',
      title: item.title, status: item.status, assignees: item.assignees || [], due: item.due || null,
      sprint: item.sprint || null, branch: item.branch || null,
      reasons, notionUrl: item.url || null,
    })),
    analysisScope: {
      activeWorkItems: activeWorkItems.length,
      selectedTargets: targetRows.length,
      targetLimit: ANALYSIS_TARGET_LIMIT,
    },
    meetingReferences: (project.meetings || []).map(meeting => ({
      title: meeting.title,
      date: meeting.date,
      url: meeting.url,
      contentChecked: Boolean(meeting.contentChecked),
    })),
    sourceEvidenceFormat: { columns: ['specId', 'source', 'timestamp', 'title', 'excerpt', 'url'] },
    sourceEvidence: projectSourceEvidence(project),
    slackScope: { channels: slackChannels, days: project.config?.days || null },
    gitEvidence,
    previousSummary: project.notionSummary || null,
  };
}

export function buildAgentInputPacket(dashboard) {
  const packet = {
    schemaVersion: '1.0',
    runId: runId(dashboard.generatedAt),
    generatedAt: dashboard.generatedAt,
    timeZone: 'Asia/Seoul',
    purpose: '규칙 엔진의 확정 사실과 출처 근거를 바탕으로 업무현황 요약 DB에 통합 분석을 작성한다.',
    constraints: [
      'rules.metrics는 원본 참고값이다. 최종 보정 집계는 실행 지침의 상태별 예외를 projects.ruleAuditItems 전체에 적용해 ruleMetrics로 따로 계산한다.',
      'ruleAuditItems는 요약 체크가 true인 프로젝트의 활성 작업 전체이며, analysisTargets는 출처 대조 우선 대상이다.',
      'specCatalog는 프로젝트 화면에 표시할 활성 스펙 전체다. 각 스펙마다 Notion 기준 진행 요약을 만들고, 허용된 Slack·회의록·Git에서 직접 연결되는 근거만 specSummaries에 기록한다.',
      'projects.sourceEvidence는 sourceEvidenceFormat.columns 순서의 압축 행이며, 로컬 수집기가 프로젝트 전체 Slack 스레드·회의록 본문·Git에서 보수적으로 직접 연결한 근거다. analysisTargets 제한과 무관하게 specCatalog 전체 요약에 사용한다.',
      'analysisTargets 제한은 커넥터를 이용한 추가 심층 대조에만 적용한다. sourceEvidence는 이미 수집된 입력이므로 전체를 읽을 수 있다.',
      'ruleAuditItems는 ruleAuditFormat.columns 순서의 행이다. itemLevel·status·sprint·sprintRelation 값은 ruleAuditFormat.indexedValues의 해당 배열 인덱스다. missingFieldMask는 missingFieldBits의 비트 OR 값이며 issueTypeIndexes는 ruleAuditFormat.issueTypes의 인덱스다. projectInherited는 범위 판정용 상속일 뿐 project 누락 비트를 지우지 않는다.',
      '진행 중인 상위항목 아래의 완료된 하위 작업항목은 상위 진행률·상태 계산에만 사용하고 규칙 평가·출처 대조·요약에서는 제외한다. 완료·일시 정지·정지·중단 상태인 상위항목의 하위 계층은 수집 및 최종 집계에서 제외한다.',
      '현재 스프린트의 시작 전 항목은 진행 준비 필요로 집계하고, 미래 스프린트의 시작 전 항목은 실행 준비 필드 위반에서 제외한다.',
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
  return fitRemoteEvidenceBudget(packet);
}

export function writeAgentInputPacket(dashboard, file) {
  const packet = buildAgentInputPacket(dashboard);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(packet, null, 2));
  return packet;
}
