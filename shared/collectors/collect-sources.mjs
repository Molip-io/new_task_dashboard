// Stage 1 of a collection run: raw sources only. Notion (projects, work items,
// meetings, saved sprint scope), Slack channel history and Git activity. No rules,
// no dashboard model, nothing is published.
import { ROOT } from '../env.mjs';
import { collectNotionData } from './notion-collector.mjs';
import { channelHistoryWithContext } from './slack.mjs';
import { collectGitActivity, collectGitHubActivity } from './git-activity.mjs';
import { resolveGitRepositories } from './git-repositories.mjs';
import { selectProjectTasks } from '../rules/task-hierarchy.mjs';
import { SETTINGS_PREFIX, readSprintSettings, applySavedSprintSettings } from '../notion-storage/sprint-settings.mjs';

async function collectSlack(config, projects, errors) {
  const out = {};
  if (!process.env.SLACK_TOKEN) {
    errors.push('SLACK_TOKEN 없음 — 슬랙 대화 수집을 건너뜁니다.');
    return out;
  }
  for (const project of projects) {
    const operationChannels = new Set(config.slack?.projectChannels?.[project.name] || []);
    const channels = [...new Set([...(project.channels || []), ...operationChannels])];
    for (const channel of channels) {
      try {
        const defaultDays = project.days || config.slackDaysDefault || 3;
        const recentDays = operationChannels.has(channel)
          ? Math.max(defaultDays, config.slack?.operationDays || 14)
          : defaultDays;
        const result = await channelHistoryWithContext(
          channel,
          recentDays,
          config.historicalContextDays || 45,
          project.name,
        );
        if (result.error) errors.push(`#${channel}: ${result.error}`);
        else {
          if (result.historicalWarnings?.length) {
            for (const warning of result.historicalWarnings) errors.push(`#${channel} historical context: ${warning}`);
          }
          (out[project.name] ||= []).push(result);
        }
      } catch (error) { errors.push(`#${channel}: ${error.message}`); }
    }
  }
  return out;
}

export async function collectSources({ config, errors, notionOptions = {}, localGitEnabled = true }) {
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 없음 — .env 파일을 설정하세요.');
  console.log('▶ Notion 프로젝트·작업항목·회의록 수집...');
  const notionStartedAt = Date.now();
  const [notion, sprintSettings] = await Promise.all([
    collectNotionData(config, errors, notionOptions),
    readSprintSettings({ databaseId: config.notion.summaryDbId }),
  ]);
  console.log(`  Notion 수집 ${Date.now() - notionStartedAt}ms`);
  const appliedSprint = applySavedSprintSettings(notion.projects, sprintSettings, { workItems: notion.tasks });
  notion.projects = appliedSprint.projects;
  notion.summaryRows = notion.summaryRows.filter(row => !String(row.run_id || '').startsWith(SETTINGS_PREFIX));
  const tasks = selectProjectTasks(notion.tasks, notion.projects);
  console.log(`  프로젝트 ${notion.projects.length}, 작업 ${tasks.length}, 회의록 ${notion.meetings.length}`);

  const repositorySources = resolveGitRepositories({
    projects: notion.projects,
    configured: config.git?.repositories || [],
    root: ROOT,
  });
  console.log('▶ Slack 대화 + Git 활동 병렬 수집...');
  const externalStartedAt = Date.now();
  const slackStartedAt = Date.now();
  const gitStartedAt = Date.now();
  const slackPromise = collectSlack(config, notion.projects, errors).then(result => {
    console.log(`  Slack 수집 ${Date.now() - slackStartedAt}ms`);
    return result;
  });
  const remoteGitPromise = collectGitHubActivity({ repositories: repositorySources.remote, tasks, sinceDays: config.git?.sinceDays || 30 }).then(result => {
    console.log(`  Git 원격 수집 ${Date.now() - gitStartedAt}ms`);
    return result;
  });
  const localGit = localGitEnabled
    ? collectGitActivity({ repositories: repositorySources.local, tasks, sinceDays: config.git?.sinceDays || 30 })
    : { repositories: [], commits: [], errors: repositorySources.local.map(repo => `Git ${repo.name || repo.path}: local repository unavailable in Sites; configure a GitHub URL`) };
  const [slack, remoteGit] = await Promise.all([slackPromise, remoteGitPromise]);
  console.log(`  Slack+Git 병렬 구간 ${Date.now() - externalStartedAt}ms`);
  const git = {
    repositories: [...localGit.repositories, ...remoteGit.repositories],
    commits: [...localGit.commits, ...remoteGit.commits].sort((left, right) => (right.committedAt || '').localeCompare(left.committedAt || '')),
    errors: [...localGit.errors, ...remoteGit.errors],
  };
  errors.push(...git.errors);
  return { notion, tasks, sprintSettings, appliedSprint, slack, git };
}
