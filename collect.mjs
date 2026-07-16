// 수집 파이프라인: Notion + Slack + Git → 검증 → data/dashboard.json
// 사용법: node collect.mjs [--no-ai]
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, loadConfig, ROOT } from './lib/env.mjs';
import { collectNotionData } from './lib/notion-collector.mjs';
import { channelHistory } from './lib/slack.mjs';
import { collectGitActivity, collectGitHubActivity } from './lib/git-activity.mjs';
import { resolveGitRepositories } from './lib/git-repositories.mjs';
import { buildBaseDashboard } from './lib/base-dashboard.mjs';
import { validateWorkManagement } from './lib/work-validation.mjs';
import { buildManagementDashboard } from './lib/dashboard-model.mjs';
import { selectProjectTasks } from './lib/task-hierarchy.mjs';
import { attachOperationalMetadata, loadPreviousSnapshot, saveDailySnapshot } from './lib/operational-metadata.mjs';
import { buildDashboardSyncCompleted } from './lib/sync-event.mjs';
import { kstDate } from './lib/business-days.mjs';
import { aiEnrich } from './lib/ai-summary.mjs';

loadEnv();
const config = loadConfig();
const DATA = path.join(ROOT, 'data');
const NO_AI = process.argv.includes('--no-ai');

function writeStatus(state, extra = {}) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'collect-status.json'), JSON.stringify({ state, at: new Date().toISOString(), ...extra }, null, 2));
}

async function collectSlack(projects, errors) {
  const out = {};
  if (!process.env.SLACK_TOKEN) {
    errors.push('SLACK_TOKEN 없음 — 슬랙 대화 수집을 건너뜁니다.');
    return out;
  }
  for (const project of projects) {
    for (const channel of project.channels) {
      try {
        const result = await channelHistory(channel, project.days);
        if (result.error) errors.push(`#${channel}: ${result.error}`);
        else (out[project.name] ||= []).push(result);
      } catch (error) { errors.push(`#${channel}: ${error.message}`); }
    }
  }
  return out;
}

async function main() {
  writeStatus('running');
  const errors = [];
  try {
    if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 없음 — .env 파일을 설정하세요.');
    console.log('▶ Notion 프로젝트·작업항목·회의록 수집...');
    const notion = await collectNotionData(config, errors);
    const selectedTasks = selectProjectTasks(notion.tasks, notion.projects);
    const unresolvedTasks = notion.tasks.filter(task => !task.project || task.project === '기타');
    const tasks = [...new Map([...selectedTasks, ...unresolvedTasks].map(task => [task.id, task])).values()];
    console.log(`  프로젝트 ${notion.projects.length}, 작업 ${tasks.length}, 회의록 ${notion.meetings.length}`);

    console.log('▶ Slack 대화 수집...');
    const slack = await collectSlack(notion.projects, errors);
    console.log('▶ Git 활동 수집...');
    const repositorySources = resolveGitRepositories({
      projects: notion.projects,
      configured: config.git?.repositories || [],
      root: ROOT,
    });
    const localGit = collectGitActivity({ repositories: repositorySources.local, tasks, sinceDays: config.git?.sinceDays || 30 });
    const remoteGit = await collectGitHubActivity({ repositories: repositorySources.remote, tasks, sinceDays: config.git?.sinceDays || 30 });
    const git = {
      repositories: [...localGit.repositories, ...remoteGit.repositories],
      commits: [...localGit.commits, ...remoteGit.commits].sort((left, right) => (right.committedAt || '').localeCompare(left.committedAt || '')),
      errors: [...localGit.errors, ...remoteGit.errors],
    };
    errors.push(...git.errors);

    const now = new Date().toISOString();
    const previousSnapshot = loadPreviousSnapshot(DATA, kstDate(now));
    const validation = validateWorkManagement({
      tasks,
      projects: notion.projects,
      gitActivity: git.commits,
      gitRepositories: git.repositories,
      previousSnapshot,
      now,
      staleBusinessDays: config.staleBusinessDays || 3,
    });
    const base = buildBaseDashboard({ notion, slack, errors, dashboardUrl: config.dashboardUrl });
    let dashboard = buildManagementDashboard({
      base, tasks, workItems: validation.workItems, issues: validation.issues,
      git, notionSetup: notion.notionSetup,
    });

    if (!NO_AI) {
      console.log('▶ AI 프로젝트 통합 요약...');
      try { dashboard.ai = await aiEnrich(dashboard); }
      catch (error) { errors.push(`AI 요약 실패: ${error.message}`); }
    }

    dashboard = attachOperationalMetadata(dashboard, DATA);
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'dashboard.json'), JSON.stringify(dashboard, null, 2));
    fs.writeFileSync(path.join(DATA, 'sync-event.json'), JSON.stringify(buildDashboardSyncCompleted(dashboard), null, 2));
    saveDailySnapshot(dashboard, DATA);
    writeStatus('done', { errors, slackNotificationSent: false });
    console.log(`✔ data/dashboard.json 생성 완료 (확인 ${validation.issues.length}건, 경고 ${errors.length}건)`);
  } catch (error) {
    writeStatus('error', { error: error.message, errors });
    console.error('✖ 수집 실패:', error.message);
    process.exitCode = 1;
  }
}

main();
