import { gzipSync, gunzipSync } from 'node:zlib';
import { createDatabasePage, flatten, queryDatabase, updatePageProperties } from './notion.mjs';

const MAX_RICH_TEXT_CHUNK = 1900;
const MAX_RICH_TEXT_ITEMS = 100;
const MAX_PAYLOAD_LENGTH = MAX_RICH_TEXT_CHUNK * MAX_RICH_TEXT_ITEMS;
const SNAPSHOT_PREFIX = 'dashboard-snapshot:';

function pick(source, keys) {
  return Object.fromEntries(keys.map(key => [key, source?.[key]]));
}

function textObjects(value, maxItems = MAX_RICH_TEXT_ITEMS) {
  const text = String(value || '');
  const parts = [];
  for (let index = 0; index < text.length && parts.length < maxItems; index += MAX_RICH_TEXT_CHUNK) {
    parts.push({ type: 'text', text: { content: text.slice(index, index + MAX_RICH_TEXT_CHUNK) } });
  }
  return parts;
}

function title(value) {
  return { title: textObjects(value, 1) };
}

function richText(value) {
  return { rich_text: textObjects(value) };
}

function date(value) {
  return { date: value ? { start: value } : null };
}

function snapshotDate(dashboard) {
  return String(dashboard.generatedAt || new Date().toISOString()).slice(0, 10);
}

function snapshotRunId(dashboard) {
  return `${SNAPSHOT_PREFIX}${snapshotDate(dashboard)}`;
}

function compactWorkItem(item) {
  return pick(item, [
    'id', 'url', 'title', 'status', 'team', 'assignees', 'project', 'start', 'due', 'completedAt',
    'sprint', 'branch', 'specId', 'spec', 'notionUpdatedAt', 'latestGitAt', 'overdueDays',
    'staleBusinessDays', 'riskScore', 'guideStatus', 'itemLevel', 'sprintRelation',
  ]);
}

function compactIssue(issue) {
  const metadata = issue.metadata ? {
    url: issue.metadata.url,
    remote: issue.metadata.remote,
    commitHash: issue.metadata.commitHash,
    representativeCommit: issue.metadata.representativeCommit?.url
      ? { url: issue.metadata.representativeCommit.url }
      : undefined,
  } : undefined;
  return {
    ...pick(issue, [
      'id', 'detectedAt', 'category', 'label', 'responsibleRole', 'actionTarget',
      'recommendedAction', 'project', 'workItemId', 'specId', 'type', 'severity', 'message',
    ]),
    metadata,
  };
}

function compactProject(project) {
  return {
    ...pick(project, ['name', 'gitUrl', 'goal', 'milestones', 'notionSummary', 'stats', 'recentGitAt', 'nearestDue', 'teams']),
    config: project.config ? { gitUrl: project.config.gitUrl || null } : undefined,
    specs: (project.specs || []).map(spec => ({
      ...pick(spec, ['id', 'url', 'title', 'status', 'sprint', 'start', 'due', 'core', 'owners', 'targetAt']),
      tasks: [],
    })),
  };
}

function compactPerson(person) {
  return {
    ...pick(person, [
      'name', 'teams', 'projects', 'projectCount', 'count', 'inProgressCount', 'overdueCount',
      'missingCompletedCount', 'nearestDue', 'latestGitAt',
    ]),
    tasks: (person.tasks || []).map(task => ({ id: task.id })),
  };
}

function compactGit(git = {}) {
  return {
    repositories: git.repositories || [],
    commits: (git.commits || []).slice(0, 100).map(commit => pick(commit, [
      'hash', 'shortHash', 'committedAt', 'author', 'message', 'repository', 'project',
      'workItemId', 'branch', 'url',
    ])),
    errors: git.errors || [],
  };
}

export function compactDashboard(dashboard) {
  return {
    ...pick(dashboard, [
      'generatedAt', 'dashboardUrl', 'sample', 'errors', 'metrics', 'deltas', 'ai',
      'sourceHealth', 'notionSetup', 'snapshotComparison', 'agentHandoff', 'remoteSnapshot', 'summarySyncedAt',
    ]),
    projects: (dashboard.projects || []).map(compactProject),
    workItems: (dashboard.workItems || []).map(compactWorkItem),
    guideViolationItems: (dashboard.guideViolationItems || []).map(item => ({
      ...compactWorkItem(item),
      issues: (item.issues || []).map(compactIssue),
    })),
    progressSetupItems: (dashboard.progressSetupItems || []).map(item => ({
      ...compactWorkItem(item),
      issues: (item.issues || []).map(compactIssue),
    })),
    workload: (dashboard.workload || []).map(compactPerson),
    validationIssues: (dashboard.validationIssues || []).map(compactIssue),
    git: compactGit(dashboard.git),
  };
}

export function encodeDashboardSnapshot(dashboard) {
  return gzipSync(JSON.stringify(compactDashboard(dashboard))).toString('base64');
}

export function decodeDashboardSnapshot(payload) {
  return JSON.parse(gunzipSync(Buffer.from(String(payload || ''), 'base64')).toString('utf8'));
}

function propertiesFor(dashboard, payload) {
  const day = snapshotDate(dashboard);
  return {
    이름: title(`대시보드 스냅샷 / ${day}`),
    프로젝트명: richText('대시보드 스냅샷'),
    기준일: date(day),
    run_id: richText(snapshotRunId(dashboard)),
    '현재 진행 요약': richText('대시보드 웹 표시용 압축 스냅샷 (gzip+base64)'),
    payload: richText(payload),
  };
}

export async function publishDashboardSnapshotToNotion({
  databaseId,
  dashboard,
  query = queryDatabase,
  create = createDatabasePage,
  update = updatePageProperties,
}) {
  const payload = encodeDashboardSnapshot(dashboard);
  if (payload.length > MAX_PAYLOAD_LENGTH) {
    throw new Error(`대시보드 스냅샷이 Notion payload 한도(${MAX_PAYLOAD_LENGTH}자)를 초과했습니다: ${payload.length}자`);
  }
  const runId = snapshotRunId(dashboard);
  const rows = await query(databaseId, { property: 'run_id', rich_text: { equals: runId } });
  const properties = propertiesFor(dashboard, payload);
  if (rows[0]) {
    await update(rows[0].id, properties);
    return { status: 'updated', pageId: rows[0].id, runId, bytes: payload.length };
  }
  const page = await create(databaseId, properties);
  return { status: 'created', pageId: page.id, runId, bytes: payload.length };
}

export async function readLatestDashboardSnapshotFromNotion({ databaseId, query = queryDatabase }) {
  const pages = await query(
    databaseId,
    { property: 'run_id', rich_text: { starts_with: SNAPSHOT_PREFIX } },
    [{ property: '기준일', direction: 'descending' }],
  );
  if (!pages[0]) return null;
  const row = flatten(pages[0]);
  if (!row.payload) return null;
  return {
    dashboard: decodeDashboardSnapshot(row.payload),
    pageId: row._id,
    runId: row.run_id,
    updatedAt: row._edited,
  };
}

export const DASHBOARD_SNAPSHOT_MAX_PAYLOAD_LENGTH = MAX_PAYLOAD_LENGTH;
