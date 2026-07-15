// 수집 파이프라인: Notion + Slack → data/dashboard.json
// 사용법: node collect.mjs [--no-ai]
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, loadConfig, ROOT } from './lib/env.mjs';
import { queryDatabase, searchDatabases, flatten, dbTitle } from './lib/notion.mjs';
import { channelHistory } from './lib/slack.mjs';
import { attachOperationalMetadata, saveDailySnapshot } from './lib/operational-metadata.mjs';
import { buildProjectSpecs, buildWorkload, excludePausedHierarchy, selectProjectTasks } from './lib/task-hierarchy.mjs';
import { aiEnrich } from './lib/legacy-ai-summary.mjs';

loadEnv();
const config = loadConfig();
const DATA = path.join(ROOT, 'data');
const NO_AI = process.argv.includes('--no-ai');

const DONE_STATUSES = ['완료', '중단'];
const norm = s => (s || '').replace(/\s+/g, '').toLowerCase();

function pick(row, names) {
  for (const n of names) if (row[n] !== undefined && row[n] !== null) return row[n];
  return null;
}

function dateStart(value) {
  return value?.start || value || null;
}

function writeStatus(state, extra = {}) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'collect-status.json'),
    JSON.stringify({ state, at: new Date().toISOString(), ...extra }, null, 2));
}

async function collectNotion(errors) {
  // 1. 프로젝트 리스트 (수집 설정)
  const projRows = (await queryDatabase(config.notion.projectListDbId)).map(flatten);
  const projects = projRows.map(r => ({
    name: (r['이름'] || '').trim(),
    goal: pick(r, ['프로젝트 목표', '목표', 'Goal']) || '',
    scopeFreezePlannedAt: dateStart(pick(r, ['범위 확정 예정일', '범위확정 예정일'])),
    productionCompletePlannedAt: dateStart(pick(r, ['제작 완료 예정일', '제작완료 예정일'])),
    targetAt: dateStart(pick(r, ['최종 목표일', '목표일', '출시일'])),
    channels: r['채널명'] || [],
    keywords: r['키워드'] || '',
    meetingUrl: r['회의록 URL'] || '',
    days: r['조회 기간'] || config.slackDaysDefault,
    summarize: r['요약'] !== false,
  })).filter(p => p.name && p.summarize);

  // 2. 작업 현황 DB 자동 탐색 (프로젝트별 + 마스터)
  const workDbs = await searchDatabases('작업 현황');
  const taskById = new Map();
  for (const db of workDbs) {
    const title = dbTitle(db);
    if (!title.includes('작업 현황') && !title.includes('작업현황')) continue;
    let rows;
    try { rows = await queryDatabase(db.id); }
    catch (e) { errors.push(`작업DB ${title}: ${e.message}`); continue; }
    // DB 제목에서 프로젝트 추정 ("피자 레디 작업 현황" → 피자레디)
    const titleProject = projects.find(p => norm(title).includes(norm(p.name)))?.name || null;
    for (const raw of rows) {
      const r = flatten(raw);
      const status = pick(r, ['Status', '상태']) || '시작 전';
      const dates = pick(r, ['시작날짜 <-> Dead Line', '기간', '날짜']);
      taskById.set(r._id, {
        id: r._id,
        url: r._url,
        title: pick(r, ['작업', '이름', 'Name']) || '(제목 없음)',
        status,
        team: pick(r, ['팀']) || '기타',
        assignees: pick(r, ['담당자']) || [],
        priority: pick(r, ['우선순위']) || null,
        project: pick(r, ['프로젝트']) || titleProject || '기타',
        parentIds: pick(r, ['상위 항목', '부모 항목', 'Parent item']) || [],
        dependencyIds: pick(r, ['선행 작업', '의존 작업', 'Dependencies']) || [],
        dependencyReviewStatus: pick(r, ['의존관계 검토', '관계 검토 상태']) || null,
        core: pick(r, ['핵심 스펙', '핵심']) ?? true,
        scopeFreezePlannedAt: dateStart(pick(r, ['범위 확정 예정일', '범위확정 예정일'])),
        productionCompletePlannedAt: dateStart(pick(r, ['제작 완료 예정일', '제작완료 예정일'])),
        targetAt: dateStart(pick(r, ['최종 목표일', '목표일'])),
        start: dates?.start || null,
        due: dates?.end || dates?.start || null,
        edited: r._edited,
      });
    }
  }
  const tasks = excludePausedHierarchy([...taskById.values()]);

  // 3. 회의록 DB (최근 14일)
  const meetingDbs = await searchDatabases('회의록');
  const meetings = [];
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  for (const db of meetingDbs) {
    const title = dbTitle(db);
    if (!title.includes('회의록')) continue;
    let rows;
    try {
      rows = await queryDatabase(db.id, {
        timestamp: 'last_edited_time', last_edited_time: { on_or_after: since },
      });
    } catch (e) { errors.push(`회의록DB ${title}: ${e.message}`); continue; }
    const project = projects.find(p => norm(title).includes(norm(p.name)))?.name || title.replace(/회의록/g, '').trim();
    for (const raw of rows) {
      const r = flatten(raw);
      meetings.push({
        project,
        title: pick(r, ['이름', '제목', 'Name']) || '(제목 없음)',
        date: pick(r, ['날짜', '일자', '회의 일자'])?.start || r._created,
        url: r._url,
      });
    }
  }
  meetings.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // 4. 업무현황 요약 DB (기존 에이전트 산출물, 최근 14일)
  let summaryRows = [];
  try {
    summaryRows = (await queryDatabase(config.notion.summaryDbId, {
      timestamp: 'created_time', created_time: { on_or_after: since },
    })).map(flatten);
    summaryRows.sort((a, b) => (b['생성시각'] || '').localeCompare(a['생성시각'] || ''));
  } catch (e) { errors.push(`업무현황 요약 DB: ${e.message}`); }

  return { projects, tasks, meetings, summaryRows };
}

async function collectSlack(projects, errors) {
  const out = {};
  if (!process.env.SLACK_TOKEN) {
    errors.push('SLACK_TOKEN 없음 — 슬랙 수집 건너뜀 (.env 설정 필요)');
    return out;
  }
  for (const p of projects) {
    for (const ch of p.channels) {
      try {
        const res = await channelHistory(ch, p.days);
        if (res.error) { errors.push(`#${ch}: ${res.error}`); continue; }
        (out[p.name] ||= []).push(res);
      } catch (e) { errors.push(`#${ch}: ${e.message}`); }
    }
  }
  return out;
}

function buildBase({ projects, tasks, meetings, summaryRows }, slack, errors) {
  const today = new Date().toISOString().slice(0, 10);
  const selectedTasks = selectProjectTasks(tasks, projects);
  const projNames = projects.map(project => project.name);

  const projectCards = projNames.map(name => {
    const pt = selectedTasks.filter(t => t.project === name || norm(t.project) === norm(name));
    const projectConfig = projects.find(p => p.name === name) || null;
    const active = pt.filter(t => !DONE_STATUSES.includes(t.status));
    const overdue = active.filter(t => t.due && t.due.slice(0, 10) < today);
    const latestSummary = summaryRows.find(s => norm(s['프로젝트명']).includes(norm(name)));
    return {
      name,
      config: projectConfig,
      goal: projectConfig?.goal || '',
      milestones: {
        scopeFreezePlannedAt: projectConfig?.scopeFreezePlannedAt || null,
        productionCompletePlannedAt: projectConfig?.productionCompletePlannedAt || null,
        targetAt: projectConfig?.targetAt || null,
      },
      specs: buildProjectSpecs(pt, DONE_STATUSES),
      stats: {
        total: pt.length,
        done: pt.filter(t => t.status === '완료').length,
        inProgress: pt.filter(t => t.status === '진행 중').length,
        planned: pt.filter(t => ['진행 예정', '시작 전'].includes(t.status)).length,
        review: pt.filter(t => ['확인 요청', '검토중'].includes(t.status)).length,
        overdue: overdue.length,
      },
      overdueTasks: overdue.map(t => ({ title: t.title, assignees: t.assignees, due: t.due, url: t.url })),
      activeTasks: active.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 30),
      notionSummary: latestSummary ? {
        date: latestSummary['date:기준일:start'] || latestSummary['생성시각'],
        status: latestSummary['프로젝트 상태'] || latestSummary['전체 상태'],
        summary: latestSummary['현재 진행 요약'] || latestSummary['전체 요약'],
        blocked: latestSummary['막힌 점'],
        decision: latestSummary['대표 결정 필요'],
        nextAction: latestSummary['다음 액션'],
        slackSignals: latestSummary['Slack 신호'] || [],
      } : null,
      slack: (slack[name] || []).map(c => ({ channel: c.channel, count: c.messages.length })),
      meetings: meetings.filter(m => norm(m.project).includes(norm(name)) || norm(name).includes(norm(m.project))).slice(0, 5),
    };
  }).filter(c => c.stats.total > 0 || c.config);

  const { workload, unassignedTasks, personalTaskLinks, waitImpactMeasured } = buildWorkload(selectedTasks, DONE_STATUSES);

  return {
    generatedAt: new Date().toISOString(),
    sample: false,
    errors,
    projects: projectCards,
    workload,
    teamQueue: { unassignedTasks, count: unassignedTasks.length },
    hierarchyStats: { personalTaskLinks, waitImpactMeasured },
    meetings: meetings.slice(0, 40),
    slack,
    ai: null,
  };
}

async function main() {
  writeStatus('running');
  const errors = [];
  try {
    if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 없음 — .env 파일을 설정하세요 (.env.example 참고)');
    console.log('▶ Notion 수집...');
    const notion = await collectNotion(errors);
    console.log(`  프로젝트 ${notion.projects.length}, 작업 ${notion.tasks.length}, 회의록 ${notion.meetings.length}`);
    console.log('▶ Slack 수집...');
    const slack = await collectSlack(notion.projects, errors);
    const dashboard = buildBase(notion, slack, errors);

    if (!NO_AI) {
      console.log('▶ AI 요약 (claude -p)...');
      try { dashboard.ai = await aiEnrich(dashboard); }
      catch (e) { errors.push(`AI 요약 실패: ${e.message}`); }
    }

    const enrichedDashboard = attachOperationalMetadata(dashboard, DATA);
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'dashboard.json'), JSON.stringify(enrichedDashboard, null, 2));
    saveDailySnapshot(enrichedDashboard, DATA);
    writeStatus('done', { errors });
    console.log(`✔ data/dashboard.json 생성 완료 (경고 ${errors.length}건)`);
    errors.forEach(e => console.log('  ⚠', e));
  } catch (e) {
    writeStatus('error', { error: e.message, errors });
    console.error('✖ 수집 실패:', e.message);
    process.exitCode = 1;
  }
}

main();
