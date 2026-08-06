import { queryDatabase, searchDatabases, flatten, dbTitle, retrieveBlockChildren, retrieveComments } from './notion.mjs';
import { ignoredNotionUserIds, removeIgnoredAssignees } from './notion-users.mjs';
import { inspectWorkDatabaseSetup } from './notion-setup.mjs';
import { excludeUncollectedHierarchy, resolveTaskProjects, selectProjectTasks } from './task-hierarchy.mjs';

const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();
const pick = (row, names) => names.find(name => row[name] !== undefined && row[name] !== null) !== undefined
  ? row[names.find(name => row[name] !== undefined && row[name] !== null)] : null;
const dateStart = value => value?.start || value || null;
const list = value => Array.isArray(value) ? value : String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const single = value => Array.isArray(value) ? value[0] || null : value;
const userList = value => Array.isArray(value) ? value.filter(user => user?.id) : [];

function blockText(block) {
  const content = block?.[block.type];
  if (Array.isArray(content?.cells)) {
    return content.cells.map(cell => (cell || []).map(text => text.plain_text || '').join('')).join(' | ');
  }
  return (content?.rich_text || []).map(text => text.plain_text || '').join('');
}

export function pageBodyText(blocks = []) {
  return blocks.map(blockText).map(text => text.trim()).filter(Boolean).join('\n');
}

async function retrievePageBodyText(blockId, depth = 0, budget = { remaining: 500 }) {
  if (depth > 4 || budget.remaining <= 0) return '';
  const blocks = await retrieveBlockChildren(blockId);
  const parts = [];
  for (const block of blocks) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1;
    const text = blockText(block).trim();
    if (text) parts.push(text);
    if (block.has_children && depth < 4) {
      const childText = await retrievePageBodyText(block.id, depth + 1, budget);
      if (childText) parts.push(childText);
    }
  }
  return parts.join('\n');
}

function mentionedUserIds(comments = []) {
  return [...new Set(comments.flatMap(comment => comment.rich_text || [])
    .filter(text => text.type === 'mention' && text.mention?.type === 'user')
    .map(text => text.mention.user?.id)
    .filter(Boolean))];
}

export function extractAnalysisJsonFromBlocks(blocks = []) {
  for (const block of blocks) {
    if (block.type !== 'code') continue;
    const text = blockText(block).trim();
    if (!text.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.overall && Array.isArray(parsed.projects)) return text;
    } catch { /* 다른 코드 블록은 무시 */ }
  }
  return null;
}

export async function collectSummaryRows(config, errors = [], since = new Date(Date.now() - 14 * 86400_000).toISOString()) {
  const summaryRows = [];
  try {
    const pages = await queryDatabase(config.notion.summaryDbId, { timestamp: 'created_time', created_time: { on_or_after: since } });
    for (const page of pages) {
      const row = flatten(page);
      const machinePayload = String(row.run_id || '').startsWith('rule-input:')
        || String(row.run_id || '').startsWith('dashboard-snapshot:');
      if (!machinePayload && !row['분석 결과 JSON']) {
        try { row['분석 결과 JSON'] = extractAnalysisJsonFromBlocks(await retrieveBlockChildren(page.id)); }
        catch (error) { errors.push(`업무현황 요약 상세 ${page.id}: ${error.message}`); }
      }
      summaryRows.push(row);
    }
  } catch (error) {
    errors.push(`업무현황 요약 DB: ${error.message}`);
  }
  const summaryTime = row => row['분석 시각']?.start || row['분석 시각'] || row['생성시각'] || row['date:기준일:start'] || row._edited || row._created || '';
  return summaryRows.sort((a, b) => String(summaryTime(b)).localeCompare(String(summaryTime(a))));
}

export function parseProjectRows(rows, config) {
  const sprintOptionalProjects = new Set(config.validation?.sprintOptionalProjects || []);
  return rows.map(row => {
    const name = String(row['이름'] || '').trim();
    const notionSprintRequired = pick(row, ['스프린트 필수', '스프린트 사용']);
    return {
      notionId: row._id,
      name,
      goal: pick(row, ['프로젝트 목표', '목표', 'Goal']) || '',
      scopeFreezePlannedAt: dateStart(pick(row, ['범위 확정 예정일', '범위확정 예정일'])),
      productionCompletePlannedAt: dateStart(pick(row, ['제작 완료 예정일', '제작완료 예정일'])),
      targetAt: dateStart(pick(row, ['최종 목표일', '목표일', '출시일'])),
      channels: list(row['채널명']),
      keywords: row['키워드'] || '',
      meetingUrl: row['회의록 URL'] || '',
      gitUrl: pick(row, ['git', 'Git', 'Git 저장소', '저장소']) || null,
      currentSprints: list(pick(row, ['현재 스프린트', '현재스프린트'])),
      sprintRequired: notionSprintRequired === false
        ? false
        : notionSprintRequired === true
          ? true
          : !sprintOptionalProjects.has(name),
      pdUsers: userList(pick(row, ['PD:users'])),
      teamLeadUsers: userList(pick(row, ['팀장:users'])),
      days: row['조회 기간'] || config.slackDaysDefault,
      summarize: row['요약'] !== false,
    };
  }).filter(project => project.name);
}

export function taskFrom(row, titleProject, projectByNotionId, ignoredIds) {
  const dates = pick(row, ['시작날짜 <-> Dead Line', '기간', '날짜']);
  const rawUsers = pick(row, ['담당자:users']) || (pick(row, ['담당자']) || []).map(name => ({ id: name, name }));
  const assignees = removeIgnoredAssignees(rawUsers, ignoredIds);
  const projectProperty = pick(row, ['프로젝트']);
  const relationProject = Array.isArray(projectProperty) ? projectByNotionId.get(projectProperty[0]) : null;
  const propertyProject = typeof projectProperty === 'string' && projectProperty.trim() ? projectProperty : null;
  const explicitProject = relationProject || propertyProject;
  const project = explicitProject || titleProject || null;
  const title = pick(row, ['작업', '이름', 'Name']);
  const status = pick(row, ['Status', '상태']);
  const branches = list(pick(row, ['브랜치', 'Branch', 'Git 브랜치', 'GitHub 브랜치']));
  const description = pick(row, ['작업 내용 설명', '작업 설명', '설명']);
  return {
    id: row._id, url: row._url, created: row._created, edited: row._edited,
    title: title || '(제목 없음)',
    titleMissing: !String(title || '').trim(),
    status: status || null,
    team: single(pick(row, ['팀'])) || '기타',
    assignees: assignees.names,
    assigneeUsers: assignees.users,
    ignoredAssigneeCount: assignees.removedCount,
    priority: pick(row, ['우선순위']) || null,
    project,
    projectMissing: !explicitProject,
    projectSource: explicitProject ? 'property' : titleProject ? 'database-title' : null,
    parentIds: pick(row, ['상위 항목', '부모 항목', 'Parent item']) || [],
    dependencyIds: pick(row, ['선행 작업', '의존 작업', 'Dependencies']) || [],
    dependencyReviewStatus: pick(row, ['의존관계 검토', '관계 검토 상태']) || null,
    core: pick(row, ['핵심 스펙', '핵심']) ?? true,
    start: dates?.start || null,
    due: dates?.end || null,
    completedAt: dateStart(pick(row, ['완료일', '완료 날짜', '완료일자'])),
    sprint: pick(row, ['스프린트', 'Sprint']) || null,
    gitKey: pick(row, ['Git 키', '작업 키', '이슈 키']) || null,
    branch: branches[0] || null,
    branches,
    description: String(description || '').trim(),
    descriptionChecked: description !== null,
    commentMentionUserIds: [],
    commentCheckAvailable: false,
    delayReason: pick(row, ['지연 사유', '일정 변경 사유']) || null,
    previousDue: dateStart(pick(row, ['변경 전 마감일', '기존 마감일'])) || null,
    delayTaggedUsers: pick(row, ['지연 공유 대상:users', '일정 변경 공유 대상:users', 'PD:users']) || [],
  };
}

async function collectWork(allProjects, config, errors) {
  const workDbs = (await searchDatabases('작업 현황')).filter(database => /작업\s*현황/.test(dbTitle(database)));
  const setup = inspectWorkDatabaseSetup(workDbs.map(database => ({ id: database.id, title: dbTitle(database), properties: database.properties })));
  const ignoredIds = ignoredNotionUserIds(config);
  const projectByNotionId = new Map(allProjects.map(project => [project.notionId, project.name]));
  const tasks = new Map();
  for (const database of workDbs) {
    const title = dbTitle(database);
    let rows = [];
    try { rows = await queryDatabase(database.id); } catch (error) { errors.push(`작업DB ${title}: ${error.message}`); }
    const titleProject = allProjects.find(project => norm(title).includes(norm(project.name)))?.name || null;
    for (const raw of rows) {
      const task = taskFrom(flatten(raw), titleProject, projectByNotionId, ignoredIds);
      tasks.set(task.id, task);
    }
  }
  const hydrated = [];
  const resolvedTasks = resolveTaskProjects([...tasks.values()]);
  const selectedTasks = selectProjectTasks(resolvedTasks, allProjects.filter(project => project.summarize));
  const collectedTasks = excludeUncollectedHierarchy(selectedTasks);
  for (const task of collectedTasks) {
    if (!(task.parentIds || []).length) {
      try {
        const body = pageBodyText(await retrieveBlockChildren(task.id));
        task.description = [task.description, body].filter(Boolean).join('\n').trim();
        task.descriptionChecked = true;
      } catch (error) {
        if (!task.descriptionChecked) errors.push(`상위항목 설명 ${task.title}: ${error.message}`);
      }
    }
    if (task.status === '확인 요청') {
      try {
        task.commentMentionUserIds = mentionedUserIds(await retrieveComments(task.id));
        task.commentCheckAvailable = true;
      } catch (error) {
        errors.push(`확인 요청 댓글 ${task.title}: ${error.message}`);
      }
    }
    hydrated.push(task);
  }
  return {
    tasks: hydrated,
    notionSetup: setup,
    excludedStatusWorkItems: selectedTasks.length - collectedTasks.length,
  };
}

async function collectMeetings(projects, errors, since) {
  const meetings = [];
  for (const database of await searchDatabases('회의록')) {
    const title = dbTitle(database);
    if (!title.includes('회의록')) continue;
    let rows = [];
    try { rows = await queryDatabase(database.id, { timestamp: 'last_edited_time', last_edited_time: { on_or_after: since } }); }
    catch (error) { errors.push(`회의록DB ${title}: ${error.message}`); }
    const project = projects.find(item => norm(title).includes(norm(item.name)))?.name || title.replace(/회의록/g, '').trim();
    for (const raw of rows) {
      const row = flatten(raw);
      const meetingSummary = String(pick(row, ['요약', 'Summary']) || '').trim();
      let content = meetingSummary;
      let contentChecked = false;
      try {
        const body = await retrievePageBodyText(row._id);
        content = [meetingSummary, body].filter(Boolean).join('\n').slice(0, 12_000);
        contentChecked = true;
      } catch (error) {
        errors.push(`회의록 본문 ${row._id}: ${error.message}`);
      }
      meetings.push({
        project,
        title: pick(row, ['회의 주제', '이름', '제목', 'Name']) || '(제목 없음)',
        date: pick(row, ['날짜', '일자', '회의 일자'])?.start || row._created,
        url: row._url,
        content,
        contentChecked,
      });
    }
  }
  return meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function collectNotionData(config, errors) {
  const allProjects = parseProjectRows((await queryDatabase(config.notion.projectListDbId)).map(flatten), config);
  const projects = allProjects.filter(project => project.summarize);
  const { tasks, notionSetup, excludedStatusWorkItems } = await collectWork(allProjects, config, errors);
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const meetings = await collectMeetings(projects, errors, since);
  const summaryRows = await collectSummaryRows(config, errors, since);
  return {
    projects,
    tasks,
    meetings,
    summaryRows,
    notionSetup,
    collectionStats: { excludedStatusWorkItems },
  };
}
