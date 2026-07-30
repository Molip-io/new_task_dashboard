import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadEnv, ROOT } from './lib/env.mjs';
import { collectSummaryRows } from './lib/notion-collector.mjs';
import { mergeAgentSummaryRows } from './lib/agent-summary-sync.mjs';

loadEnv();
const config = loadConfig();
const dataDirectory = path.join(ROOT, 'data');
const dashboardFile = path.join(dataDirectory, 'dashboard.json');
const statusFile = path.join(dataDirectory, 'summary-sync-status.json');

function writeStatus(state, extra = {}) {
  fs.writeFileSync(statusFile, JSON.stringify({ state, at: new Date().toISOString(), ...extra }, null, 2));
}

async function main() {
  writeStatus('running');
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN 없음');
  if (!fs.existsSync(dashboardFile)) throw new Error('data/dashboard.json 없음');
  const dashboard = JSON.parse(fs.readFileSync(dashboardFile, 'utf8'));
  const errors = [];
  const rows = await collectSummaryRows(config, errors);
  if (errors.length) throw new Error(errors.join(' | '));
  const merged = mergeAgentSummaryRows(dashboard, rows);
  const { analysis, expectedRunId } = merged;
  if (!merged.current) {
    writeStatus('pending', { expectedRunId, actualRunId: analysis.runId || null, analysisStatus: analysis.analysisStatus });
    process.exitCode = 2;
    return;
  }
  const nextDashboard = merged.dashboard;
  const temporaryFile = `${dashboardFile}.summary-sync`;
  fs.writeFileSync(temporaryFile, JSON.stringify(nextDashboard, null, 2));
  fs.renameSync(temporaryFile, dashboardFile);
  writeStatus('done', { runId: analysis.runId, analysisStatus: analysis.analysisStatus, projectCount: analysis.projects.length });
  console.log(`✔ 에이전트 요약 동기화 완료 (${analysis.runId}, 프로젝트 ${analysis.projects.length}개)`);
}

main().catch(error => {
  writeStatus('error', { error: error.message });
  console.error(`✖ 에이전트 요약 동기화 실패: ${error.message}`);
  process.exitCode = 1;
});
