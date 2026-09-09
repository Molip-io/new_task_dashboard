// 수집 파이프라인: Notion + Slack + Git → 검증 → data/dashboard.json
// 사용법: node collect.mjs [--no-ai]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, loadConfig, ROOT } from './lib/env.mjs';
import { collectNotionData } from './lib/notion-collector.mjs';
import { channelHistoryWithContext } from './lib/slack.mjs';
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
import { writeAgentInputPacket } from './lib/agent-handoff.mjs';
import { publishAgentInputToNotion } from './lib/notion-agent-handoff.mjs';
import { publishDashboardSnapshotToNotion } from './lib/dashboard-snapshot.mjs';
import { SETTINGS_PREFIX, readSprintSettings, applySavedSprintSettings } from './lib/sprint-settings.mjs';
import { buildSprintOverview, scopeSignature, SPRINT_POLICY_VERSION } from './public/sprint-policy.js';
import { enrichParentChildCompletion } from './lib/project-state-enrichment.mjs';
import { enrichAgentPacketWithProjectOperations } from './lib/agent-project-operations.mjs';

loadEnv();
const config = loadConfig();
const DEFAULT_DATA = path.join(ROOT, 'data');
const DEFAULT_NO_AI = process.argv.includes('--no-ai');
const AI_PROVIDER = process.env.AI_SUMMARY_PROVIDER || 'notion-agent';

function writeStatus(dataDirectory, state, extra = {}) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(path.join(dataDirectory, 'collect-status.json'), JSON.stringify({ state, at: new Date().toISOString(), ...extra }, null, 2));
}

async function collectSlack(projects, errors) {
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

export async function runCollection({ dataDirectory = DEFAULT_DATA, noAi = DEFAULT_NO_AI, previousSnapshot = undefined, notionOptions = {} } = {}) {
  writeStatus(dataDirectory, 'running');
  const errors = [];
  try {
    if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 없음 — .env 파일을 설정하세요.');
    console.log('▶ Notion 프로젝트·작업항목·회의록 수집...');
    const notion = await collectNotionData(config, errors, notionOptions);
    const sprintSettings = await readSprintSettings({ databaseId: config.notion.summaryDbId });
    const appliedSprint = applySavedSprintSettings(notion.projects, sprintSettings, { workItems: notion.tasks });
    notion.projects = appliedSprint.projects;
    notion.summaryRows = notion.summaryRows.filter(row => !String(row.run_id || '').startsWith(SETTINGS_PREFIX));
    const tasks = selectProjectTasks(notion.tasks, notion.projects);
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
    const comparisonSnapshot = previousSnapshot === undefined
      ? loadPreviousSnapshot(dataDirectory, kstDate(now))
      : previousSnapshot;
    const validation = enrichParentChildCompletion(validateWorkManagement({
      tasks,
      projects: notion.projects,
      gitActivity: git.commits,
      gitRepositories: git.repositories,
      previousSnapshot: comparisonSnapshot,
      now,
      staleBusinessDays: config.staleBusinessDays || 3,
      excludedStatusWorkItems: notion.collectionStats?.excludedStatusWorkItems || 0,
    }), tasks, now);
    const base = buildBaseDashboard({ notion, slack, errors, dashboardUrl: config.dashboardUrl });
    let dashboard = buildManagementDashboard({
      base, tasks, workItems: validation.workItems, issues: validation.issues,
      ruleItems: validation.ruleItems,
      progressSetupItems: validation.progressSetupItems,
      ruleStats: validation.ruleStats,
      git, notionSetup: notion.notionSetup,
    });

    if (!noAi && AI_PROVIDER === 'openai') {
      console.log('▶ 선택적 OpenAI API 프로젝트 통합 요약...');
      try {
        const result = await aiEnrich(dashboard);
        dashboard.ai = {
          ...result,
          provider: 'openai-api',
          analysisStatus: 'success',
          generatedAt: now,
          sourceComparison: { status: 'complete' },
        };
      }
      catch (error) { errors.push(`AI 요약 실패: ${error.message}`); }
    } else if (!['notion-agent', 'disabled', 'openai'].includes(AI_PROVIDER)) {
      errors.push(`알 수 없는 AI_SUMMARY_PROVIDER(${AI_PROVIDER}) — Notion 에이전트 요약만 사용합니다.`);
    }

    dashboard = attachOperationalMetadata(dashboard, dataDirectory, comparisonSnapshot);
    dashboard.sprintScope = {
      revision: sprintSettings.revision,
      mode: appliedSprint.scope.mode,
      input: appliedSprint.scope.input,
      sprints: appliedSprint.scope.sprints,
      configured: appliedSprint.scope.configured !== false,
      signature: scopeSignature(appliedSprint.scope),
      policyVersion: SPRINT_POLICY_VERSION,
    };
    const workOverview = buildSprintOverview(dashboard, appliedSprint.scope);
    fs.mkdirSync(dataDirectory, { recursive: true });
    const agentInputFile = path.join(dataDirectory, 'agent-input.json');
    let agentInput = writeAgentInputPacket(dashboard, agentInputFile);
    agentInput = enrichAgentPacketWithProjectOperations(agentInput, dashboard);
    // Preserve raw rules.metrics; publish the dashboard-aligned scoped briefing projection separately.
    agentInput.rules.briefingMetrics = workOverview.metrics;
    agentInput.rules.briefingScope = {
      ...dashboard.sprintScope,
      unit: 'mixed-by-metric',
      executionUnit: 'child-work-items',
      guideUnit: 'parent-and-child-items',
      guideOverlapAllowed: true,
      outsideOverdueItems: workOverview.outsideOverdueItems.length,
      outsideGuideViolationItems: workOverview.outsideGuideViolationItems.length,
      unknownGuideViolationItems: workOverview.unknownGuideViolationItems.length,
      unknownSprintItems: workOverview.unknownSprintItems.length,
    };
    fs.writeFileSync(agentInputFile, JSON.stringify(agentInput, null, 2));
    const latestSprintSettings = await readSprintSettings({ databaseId: config.notion.summaryDbId });
    if (latestSprintSettings.revision !== sprintSettings.revision) throw new Error('수집 중 현재 스프린트 설정이 변경됐습니다. 이전 기준을 게시하지 않습니다.');
    let remoteHandoff = { status: 'disabled', runId: `rule-input:${agentInput.runId}` };
    if (config.features?.publishAgentInputToNotion !== false) {
      try {
        remoteHandoff = await publishAgentInputToNotion({ databaseId: config.notion.summaryDbId, packet: agentInput });
      } catch (error) {
        remoteHandoff = { status: 'failed', runId: `rule-input:${agentInput.runId}`, error: error.message };
        errors.push(`에이전트 규칙 입력 게시 실패: ${error.message}`);
      }
    }
    dashboard.sourceHealth.sources.push({
      id: 'rule-input',
      status: ['created', 'updated'].includes(remoteHandoff.status) ? 'ok' : remoteHandoff.status === 'disabled' ? 'partial' : 'unavailable',
      successful: ['created', 'updated'].includes(remoteHandoff.status) ? 1 : 0,
      expected: 1,
      lastSuccessAt: ['created', 'updated'].includes(remoteHandoff.status) ? dashboard.generatedAt : null,
    });
    if (!['created', 'updated'].includes(remoteHandoff.status)) dashboard.sourceHealth.status = 'limited';
    dashboard.agentHandoff = {
      status: remoteHandoff.status,
      runId: agentInput.runId,
      generatedAt: agentInput.generatedAt,
      remoteRunId: remoteHandoff.runId,
      pageId: remoteHandoff.pageId || null,
      error: remoteHandoff.error || null,
    };
    let remoteSnapshot = { status: 'failed', runId: `dashboard-snapshot:${kstDate(now)}` };
    try {
      remoteSnapshot = await publishDashboardSnapshotToNotion({ databaseId: config.notion.summaryDbId, dashboard });
    } catch (error) {
      const message = `대시보드 원격 스냅샷 게시 실패: ${error.message}`;
      errors.push(message);
      dashboard.errors = [...new Set([...(dashboard.errors || []), message])];
      dashboard.sourceHealth.status = 'limited';
      remoteSnapshot = { ...remoteSnapshot, error: error.message };
    }
    dashboard.remoteSnapshot = remoteSnapshot;
    fs.writeFileSync(path.join(dataDirectory, 'dashboard.json'), JSON.stringify(dashboard, null, 2));
    fs.writeFileSync(path.join(dataDirectory, 'sync-event.json'), JSON.stringify(buildDashboardSyncCompleted(dashboard), null, 2));
    saveDailySnapshot(dashboard, dataDirectory);
    writeStatus(dataDirectory, 'done', { errors, slackNotificationSent: false, remoteSnapshot });
    console.log(`✔ 대시보드 생성 완료 · 에이전트 원격 입력 ${remoteHandoff.status} · 웹 스냅샷 ${remoteSnapshot.status} (확인 ${validation.issues.length}건, 경고 ${errors.length}건)`);
    return { dashboard, remoteHandoff, remoteSnapshot, validation };
  } catch (error) {
    writeStatus(dataDirectory, 'error', { error: error.message, errors });
    throw error;
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  runCollection().catch(error => {
    console.error('✖ 수집 실패:', error.message);
    process.exitCode = 1;
  });
}
