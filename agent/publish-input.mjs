// Stage 3 of a collection run: the analysis agent's input. Builds the rule packet the
// morning routine reads and publishes it to the Notion summary DB (single page, or a
// manifest plus bounded project parts when one page would exceed the size limit).
import fs from 'node:fs';
import path from 'node:path';
import { fitRemoteEvidenceBudget } from './input/agent-packet-budget.mjs';
import { writeAgentInputPacket, buildAgentInputPacket } from './input/agent-handoff.mjs';
import { publishAgentInputToNotion } from '../shared/notion-storage/notion-agent-handoff.mjs';
import { enrichAgentPacketWithProjectOperations } from './input/agent-project-operations.mjs';

export function buildRoutineAgentInput({ dashboard, workOverview, dataDirectory, persistFiles }) {
  const agentInputFile = path.join(dataDirectory, 'agent-input.json');
  let agentInput = persistFiles ? writeAgentInputPacket(dashboard, agentInputFile) : buildAgentInputPacket(dashboard);
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
  let packetBudgetError = null;
  // Preserve irreducible facts and let the Notion handoff publish an atomic
  // manifest plus bounded project parts when one page would exceed 50k.
  try { fitRemoteEvidenceBudget(agentInput, { strict: false }); } catch (error) { packetBudgetError = error; }
  if (persistFiles) fs.writeFileSync(agentInputFile, JSON.stringify(agentInput, null, 2));
  return { agentInput, packetBudgetError };
}

export async function publishRoutineAgentInput({ config, agentInput, packetBudgetError, errors }) {
  let remoteHandoff = { status: 'disabled', runId: `rule-input:${agentInput.runId}` };
  if (config.features?.publishAgentInputToNotion !== false) {
    try {
      if (packetBudgetError) throw packetBudgetError;
      remoteHandoff = await publishAgentInputToNotion({ databaseId: config.notion.summaryDbId, packet: agentInput });
    } catch (error) {
      remoteHandoff = { status: 'failed', runId: `rule-input:${agentInput.runId}`, error: error.message };
      errors.push(`에이전트 규칙 입력 게시 실패: ${error.message}`);
    }
  }
  return remoteHandoff;
}

// The dashboard shows whether the day's agent input reached Notion.
export function recordAgentHandoff(dashboard, agentInput, remoteHandoff) {
  const published = ['created', 'updated'].includes(remoteHandoff.status);
  dashboard.sourceHealth.sources.push({
    id: 'rule-input',
    status: published ? 'ok' : remoteHandoff.status === 'disabled' ? 'partial' : 'unavailable',
    successful: published ? 1 : 0,
    expected: 1,
    lastSuccessAt: published ? dashboard.generatedAt : null,
  });
  if (!published) dashboard.sourceHealth.status = 'limited';
  dashboard.agentHandoff = {
    status: remoteHandoff.status,
    runId: agentInput.runId,
    generatedAt: agentInput.generatedAt,
    remoteRunId: remoteHandoff.runId,
    pageId: remoteHandoff.pageId || null,
    generationId: remoteHandoff.generationId || null,
    partCount: remoteHandoff.partCount || 0,
    error: remoteHandoff.error || null,
  };
}
