// Stage 2 of a collection run: rules and the dashboard snapshot model. Takes the raw
// sources from stage 1 and returns the dashboard object. It only computes; publishing
// (agent input, Notion snapshot) is done by later stages.
import { buildBaseDashboard } from './base-dashboard.mjs';
import { validateWorkManagement } from '../rules/work-validation.mjs';
import { buildManagementDashboard } from './dashboard-model.mjs';
import { attachOperationalMetadata } from './operational-metadata.mjs';
import { enrichParentChildCompletion } from '../rules/project-state-enrichment.mjs';
import { buildSprintOverview, scopeSignature, SPRINT_POLICY_VERSION } from '../../dashboard/ui/sprint-policy.js';

export function buildDashboard({ config, sources, errors, comparisonSnapshot, now, dashboardUrl }) {
  const { notion, tasks, slack, git } = sources;
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
  const base = buildBaseDashboard({ notion, slack, errors, dashboardUrl });
  const dashboard = buildManagementDashboard({
    base, tasks, workItems: validation.workItems, issues: validation.issues,
    ruleItems: validation.ruleItems,
    progressSetupItems: validation.progressSetupItems,
    ruleStats: validation.ruleStats,
    git, notionSetup: notion.notionSetup,
  });
  return { dashboard, validation };
}

// History (previous-day comparison) and the sprint scope the rules were evaluated with.
export function attachHistoryAndScope(dashboard, { dataDirectory, comparisonSnapshot, sprintSettings, appliedSprint }) {
  const withHistory = attachOperationalMetadata(dashboard, dataDirectory, comparisonSnapshot);
  withHistory.sprintScope = {
    revision: sprintSettings.revision,
    mode: appliedSprint.scope.mode,
    input: appliedSprint.scope.input,
    sprints: appliedSprint.scope.sprints,
    configured: appliedSprint.scope.configured !== false,
    signature: scopeSignature(appliedSprint.scope),
    policyVersion: SPRINT_POLICY_VERSION,
  };
  return { dashboard: withHistory, workOverview: buildSprintOverview(withHistory, appliedSprint.scope) };
}
