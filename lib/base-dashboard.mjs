const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();

export function buildBaseDashboard({ notion, slack, errors, dashboardUrl }) {
  const projects = notion.projects.map(config => {
    const summary = notion.summaryRows.find(row => norm(row['프로젝트명']).includes(norm(config.name)));
    return {
      name: config.name,
      config,
      goal: config.goal || '',
      milestones: {
        scopeFreezePlannedAt: config.scopeFreezePlannedAt || null,
        productionCompletePlannedAt: config.productionCompletePlannedAt || null,
        targetAt: config.targetAt || null,
      },
      notionSummary: summary ? {
        date: summary['date:기준일:start'] || summary['생성시각'],
        status: summary['프로젝트 상태'] || summary['전체 상태'],
        summary: summary['현재 진행 요약'] || summary['전체 요약'],
        blocked: summary['막힌 점'],
        decision: summary['대표 결정 필요'],
        nextAction: summary['다음 액션'],
        slackSignals: summary['Slack 신호'] || [],
      } : null,
      slack: (slack[config.name] || []).map(channel => ({ channel: channel.channel, count: channel.messages.length })),
      meetings: notion.meetings.filter(meeting => norm(meeting.project).includes(norm(config.name)) || norm(config.name).includes(norm(meeting.project))).slice(0, 5),
    };
  });
  return {
    generatedAt: new Date().toISOString(), sample: false, errors, projects,
    meetings: notion.meetings.slice(0, 40), slack, ai: null, dashboardUrl,
  };
}
