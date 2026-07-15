import { queryDatabase, searchDatabases, flatten, dbTitle } from './notion.mjs';
import { ignoredNotionUserIds, removeIgnoredAssignees } from './notion-users.mjs';
import { inspectWorkDatabaseSetup } from './notion-setup.mjs';
import { excludePausedHierarchy } from './task-hierarchy.mjs';

const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();
const pick = (row, names) => names.find(name => row[name] !== undefined && row[name] !== null) !== undefined
  ? row[names.find(name => row[name] !== undefined && row[name] !== null)] : null;
const dateStart = value => value?.start || value || null;
const list = value => Array.isArray(value) ? value : String(value || '').split(',').map(item => item.trim()).filter(Boolean);
const single = value => Array.isArray(value) ? value[0] || null : value;

function projectRows(rows, config) {
  return rows.map(row => ({
    notionId: row._id,
    name: String(row['이름'] || '').trim(),
    goal: pick(row, ['프로젝트 목표', '목표', 'Goal']) || '',
    scopeFreezePlannedAt: dateStart(pick(row, ['범위 확정 예정일', '범위확정 예정일'])),
    productionCompletePlannedAt: dateStart(pick(row, ['제작 완료 예정일', '제작완료 예정일'])),
    targetAt: dateStart(pick(row, ['최종 목표일', '목표일', '출시일'])),
    channels: list(row['채널명']),
    keywords: row['키워드'] || '',
    meetingUrl: row['회의록 URL'] || '',
    days: row['조회 기간'] || config.slackDaysDefault,
    summarize: row['요약'] !== false,
  })).filter(project => project.name);
}

function taskFrom(row, titleProject, projectByNotionId, ignoredIds) {
  const dates = pick(row, ['시작날짜 <-> Dead Line', '기간', '날짜']);
  const rawUsers = pick(row, ['담당자:users']) || (pick(row, ['담당자']) || []).map(name => ({ id: name, name }));
  const assignees = removeIgnoredAssignees(rawUsers, ignoredIds);
  const projectProperty = pick(row, ['프로젝트']);
  const relationProject = Array.isArray(projectProperty) ? projectByNotionId.get(projectProperty[0]) : null;
  const project = relationProject || (typeof projectProperty === 'string' && projectProperty.trim() ? projectProperty : titleProject || '기타');
  return {
    id: row._id, url: row._url, created: row._created, edited: row._edited,
    title: pick(row, ['작업', '이름', 'Name']) || '(제목 없음)',
    status: pick(row, ['Status', '상태']) || '시작 전',
    team: single(pick(row, ['팀'])) || '기타',
    assignees: assignees.names,
    assigneeUsers: assignees.users,
    ignoredAssigneeCount: assignees.removedCount,
    priority: pick(row, ['우선순위']) || null,
    project,
    parentIds: pick(row, ['상위 항목', '부모 항목', 'Parent item']) || [],
    dependencyIds: pick(row, ['선행 작업', '의존 작업', 'Dependencies']) || [],
    dependencyReviewStatus: pick(row, ['의존관계 검토', '관계 검토 상태']) || null,
    core: pick(row, ['핵심 스펙', '핵심']) ?? true,
    start: dates?.start || null,
    due: dates?.end || null,
    completedAt: dateStart(pick(row, ['완료일', '완료 날짜', '완료일자'])),
    sprint: pick(row, ['스프린트', 'Sprint']) || null,
    gitKey: pick(row, ['Git 키', '작업 키', '이슈 키']) || null,
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
  return { tasks: excludePausedHierarchy([...tasks.values()]), notionSetup: setup };
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
      meetings.push({ project, title: pick(row, ['이름', '제목', 'Name']) || '(제목 없음)', date: pick(row, ['날짜', '일자', '회의 일자'])?.start || row._created, url: row._url });
    }
  }
  return meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function collectNotionData(config, errors) {
  const allProjects = projectRows((await queryDatabase(config.notion.projectListDbId)).map(flatten), config);
  const projects = allProjects.filter(project => project.summarize);
  const { tasks, notionSetup } = await collectWork(allProjects, config, errors);
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const meetings = await collectMeetings(projects, errors, since);
  let summaryRows = [];
  try { summaryRows = (await queryDatabase(config.notion.summaryDbId, { timestamp: 'created_time', created_time: { on_or_after: since } })).map(flatten); }
  catch (error) { errors.push(`업무현황 요약 DB: ${error.message}`); }
  summaryRows.sort((a, b) => (b['생성시각'] || '').localeCompare(a['생성시각'] || ''));
  return { projects, tasks, meetings, summaryRows, notionSetup };
}
