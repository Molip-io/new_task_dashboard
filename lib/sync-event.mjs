export function buildDashboardSyncCompleted(dashboard) {
  return {
    type: 'dashboardSyncCompleted',
    occurredAt: dashboard.generatedAt,
    notificationSent: false,
    payload: {
      generatedAt: dashboard.generatedAt,
      normalProjects: dashboard.projects.filter(project => project.managementStatus === 'normal').length,
      needsUpdateProjects: dashboard.projects.filter(project => project.managementStatus !== 'normal').length,
      overdueWorkItems: dashboard.workItems.filter(item => item.overdueDays > 0).length,
      issueCount: dashboard.validationIssues.length,
      dashboardUrl: dashboard.dashboardUrl || null,
    },
  };
}
