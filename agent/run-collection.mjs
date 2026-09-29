// 수집 파이프라인 오케스트레이터: 원본 수집 → 규칙·스냅샷 모델 → 에이전트 입력 게시 → 스냅샷 게시.
// 각 단계 구현은 shared/collectors, shared/snapshot, agent/publish-input에 있다.
// 사용법: node agent/run-collection.mjs [--no-ai]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, loadConfig, ROOT } from '../shared/env.mjs';
import { collectSources } from '../shared/collectors/collect-sources.mjs';
import { buildDashboard, attachHistoryAndScope } from '../shared/snapshot/build-dashboard.mjs';
import { buildRoutineAgentInput, publishRoutineAgentInput, recordAgentHandoff } from './publish-input.mjs';
import { loadPreviousSnapshot, saveDailySnapshot } from '../shared/snapshot/operational-metadata.mjs';
import { buildDashboardSyncCompleted } from '../shared/snapshot/sync-event.mjs';
import { kstDate } from '../shared/rules/business-days.mjs';
import { aiEnrich } from './ai-summary.mjs';
import { publishDashboardSnapshotToNotion } from '../shared/notion-storage/dashboard-snapshot.mjs';
import { readSprintSettings } from '../shared/notion-storage/sprint-settings.mjs';

loadEnv();
const config = loadConfig();
const DEFAULT_DATA = path.join(ROOT, 'data');
const DEFAULT_NO_AI = process.argv.includes('--no-ai');
const AI_PROVIDER = process.env.AI_SUMMARY_PROVIDER || 'notion-agent';

function writeStatus(dataDirectory, state, extra = {}) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(path.join(dataDirectory, 'collect-status.json'), JSON.stringify({ state, at: new Date().toISOString(), ...extra }, null, 2));
}

export async function runCollection({ dataDirectory = DEFAULT_DATA, noAi = DEFAULT_NO_AI, previousSnapshot = undefined, notionOptions = {}, persistFiles = true, localGitEnabled = true, dashboardUrl = config.dashboardUrl } = {}) {
  if (persistFiles) writeStatus(dataDirectory, 'running');
  const errors = [];
  const collectionStartedAt = Date.now();
  try {
    // 1. 원본 수집
    const sources = await collectSources({ config, errors, notionOptions, localGitEnabled });
    const { sprintSettings, appliedSprint } = sources;

    // 2. 규칙 판정 + 대시보드 스냅샷 모델
    const now = new Date().toISOString();
    const comparisonSnapshot = previousSnapshot === undefined && persistFiles
      ? loadPreviousSnapshot(dataDirectory, kstDate(now))
      : await previousSnapshot;
    let { dashboard, validation } = buildDashboard({ config, sources, errors, comparisonSnapshot, now, dashboardUrl });

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

    const scoped = attachHistoryAndScope(dashboard, { dataDirectory, comparisonSnapshot, sprintSettings, appliedSprint });
    dashboard = scoped.dashboard;

    // 3. 에이전트 입력 게시
    const { agentInput, packetBudgetError } = buildRoutineAgentInput({ dashboard, workOverview: scoped.workOverview, dataDirectory, persistFiles });
    const latestSprintSettings = await readSprintSettings({ databaseId: config.notion.summaryDbId });
    if (latestSprintSettings.revision !== sprintSettings.revision) throw new Error('수집 중 현재 스프린트 설정이 변경됐습니다. 이전 기준을 게시하지 않습니다.');
    const remoteHandoff = await publishRoutineAgentInput({ config, agentInput, packetBudgetError, errors });
    recordAgentHandoff(dashboard, agentInput, remoteHandoff);

    // 4. 대시보드 스냅샷 게시
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
    if (persistFiles) {
      fs.mkdirSync(dataDirectory, { recursive: true });
      fs.writeFileSync(path.join(dataDirectory, 'dashboard.json'), JSON.stringify(dashboard, null, 2));
      fs.writeFileSync(path.join(dataDirectory, 'sync-event.json'), JSON.stringify(buildDashboardSyncCompleted(dashboard), null, 2));
      saveDailySnapshot(dashboard, dataDirectory);
      writeStatus(dataDirectory, 'done', { errors, slackNotificationSent: false, remoteSnapshot });
    }
    console.log(`✔ 대시보드 생성 완료 · 에이전트 원격 입력 ${remoteHandoff.status} · 웹 스냅샷 ${remoteSnapshot.status} (확인 ${validation.issues.length}건, 경고 ${errors.length}건) · 총 ${Date.now() - collectionStartedAt}ms`);
    return { dashboard, remoteHandoff, remoteSnapshot, validation, sprintSettings };
  } catch (error) {
    if (persistFiles) writeStatus(dataDirectory, 'error', { error: error.message, errors });
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
