import { buildAgentAnalysis, latestProjectSummaryRow } from './agent-analysis.mjs';
import { notionSummaryFromRow } from './base-dashboard.mjs';
import { kstDate } from './business-days.mjs';

export function updateAgentSource(sourceHealth, analysis) {
  const sources = sourceHealth?.sources || [];
  const source = sources.find(item => item.id === 'agent-analysis');
  if (!source) return;
  source.status = analysis.analysisStatus === 'success' ? 'ok'
    : analysis.analysisStatus === 'partial' ? 'partial'
      : 'unavailable';
  source.successful = ['success', 'partial'].includes(analysis.analysisStatus) ? 1 : 0;
  source.lastSuccessAt = analysis.generatedAt || null;
  source.analysisStatus = analysis.analysisStatus;
  source.comparisonStatus = analysis.sourceComparison?.status || 'not_run';
  if (source.status !== 'ok') sourceHealth.status = 'limited';
}

export function mergeAgentSummaryRows(dashboard, rows, now = new Date().toISOString()) {
  const projectNames = (dashboard.projects || []).map(project => project.name);
  const analysis = buildAgentAnalysis(rows, projectNames, now);
  const expectedRunId = `${kstDate(now)}-morning`;
  const inputGeneratedAt = dashboard.agentHandoff?.generatedAt || dashboard.generatedAt || null;
  const analysisGeneratedAt = analysis.generatedAt || null;
  const current = analysis.runId === expectedRunId
    && ['success', 'partial'].includes(analysis.analysisStatus)
    && (!inputGeneratedAt || !analysisGeneratedAt || Date.parse(analysisGeneratedAt) >= Date.parse(inputGeneratedAt));
  if (!current) {
    const staleAnalysis = analysis.overall
      ? { ...analysis, analysisStatus: analysis.analysisStatus === 'not_run' ? 'not_run' : 'stale' }
      : analysis;
    return { dashboard: { ...dashboard, ai: staleAnalysis }, analysis: staleAnalysis, expectedRunId, current: false };
  }

  const merged = {
    ...dashboard,
    ai: analysis,
    projects: dashboard.projects.map(project => ({
      ...project,
      notionSummary: notionSummaryFromRow(latestProjectSummaryRow(rows, project.name)),
    })),
    summarySyncedAt: now,
  };
  updateAgentSource(merged.sourceHealth, analysis);
  return { dashboard: merged, analysis, expectedRunId, current: true };
}
