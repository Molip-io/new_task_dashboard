import { buildAgentAnalysis, latestProjectSummaryRow } from './agent-analysis.mjs';

const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();

export function notionSummaryFromRow(summary) {
  return summary ? {
    date: summary['date:기준일:start'] || summary['기준일']?.start || summary['기준일'] || summary['생성시각'],
    status: summary['프로젝트 상태'] || summary['전체 상태'],
    summary: summary['현재 진행 요약'] || summary['전체 요약'],
    blocked: summary['막힌 점'],
    decision: summary['대표 결정 필요'],
    nextAction: summary['다음 액션'],
    slackSignals: summary['Slack 신호'] || [],
  } : null;
}

export function buildBaseDashboard({ notion, slack, errors, dashboardUrl }) {
  const projects = notion.projects.map(config => {
    const summary = latestProjectSummaryRow(notion.summaryRows, config.name);
    const projectKey = norm(config.name);
    return {
      name: config.name,
      config,
      goal: config.goal || '',
      milestones: {
        scopeFreezePlannedAt: config.scopeFreezePlannedAt || null,
        productionCompletePlannedAt: config.productionCompletePlannedAt || null,
        targetAt: config.targetAt || null,
      },
      notionSummary: notionSummaryFromRow(summary),
      slack: (slack[config.name] || []).map(channel => ({ channel: channel.channel, count: channel.messages.length })),
      persistentContexts: (slack[config.name] || []).flatMap(channel => channel.persistentContexts || []),
      // Shared meeting databases do not expose their linked-view filter through
      // the API. Empty project names are therefore semantic candidates; a row
      // explicitly assigned to another project must never cross that boundary.
      meetings: notion.meetings.filter(meeting => {
        const meetingProject = norm(meeting.project);
        return !meetingProject || meetingProject === projectKey;
      }).slice(0, 40),
    };
  });
  return {
    generatedAt: new Date().toISOString(), sample: false, errors, projects,
    meetings: notion.meetings.slice(0, 40), slack,
    ai: buildAgentAnalysis(notion.summaryRows, notion.projects.map(project => project.name)),
    dashboardUrl,
  };
}
