import { groupIssuesByProjectItem } from './dashboard-view-model.js';
import { briefingDetailItems, gitRepositoryStatus, issuePresentation, primaryActionSummary } from './dashboard-management.js';

const SEVERITY_RANK = { error: 0, warning: 1, check: 2, info: 3 };
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const safeUrl = value => /^(https?:\/\/|#)/.test(String(value || '')) ? value : '#';
const fmt = value => value ? String(value).replace('T', ' ').slice(0, 16) : '-';

export function managementActionHtml(issue, fallbackUrl) {
  const presentation = issuePresentation(issue);
  const targetLabels = { 'work-item': '작업항목', spec: '상위 스펙', project: '프로젝트', 'git-repository': 'Git 저장소' };
  const targetUrl = issue.metadata?.remote || issue.metadata?.url || issue.metadata?.representativeCommit?.url || fallbackUrl;
  return `<div class="management-action"><strong>${esc(presentation.categoryLabel)} · ${esc(presentation.label)}</strong><small>현재 확인 사항: ${esc(issue.message || '세부 내용을 확인하세요.')}</small><small>수정 방법: ${esc(presentation.recommendedAction)}</small><small>권장 처리: ${esc(presentation.responsibleRole)} · ${esc(targetLabels[presentation.actionTarget] || 'Notion')}</small>${targetUrl ? `<small><a href="${esc(safeUrl(targetUrl))}" target="_blank" rel="noreferrer">수정할 항목 열기</a></small>` : ''}</div>`;
}

export function issueGroupRowHtml(group, dashboard) {
  const issues = [...group.issues].sort((left, right) => (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9));
  const primary = issues[0];
  const item = dashboard.workItems.find(work => work.id === primary.workItemId);
  const spec = dashboard.projects.flatMap(project => project.specs || []).find(row => row.id === primary.specId);
  const commit = dashboard.git?.commits?.find(row => row.hash === primary.metadata?.commitHash);
  const title = item?.title || spec?.title || (primary.metadata?.commitHash ? `커밋 ${primary.metadata.commitHash.slice(0, 8)}` : '프로젝트 관리 항목');
  const context = item ? `${item.spec || '스펙 미지정'} · ${item.team || '팀 미지정'}` : spec ? '상위 스펙' : group.project;
  const summary = primaryActionSummary(issues);
  const categories = [...new Set(issues.map(issue => issuePresentation(issue).categoryLabel))];
  const detectedAt = issues.map(issue => issue.detectedAt).filter(Boolean).sort().at(-1);
  return `<details class="issue-row ${esc(group.severity)}"><summary><strong><span class="dot ${esc(group.severity)}"></span>${esc(title)} · ${esc(summary.label)}</strong><small>${esc(context)} · ${esc(categories.join(' · '))}${detectedAt ? ` · 감지 ${fmt(detectedAt)}` : ''}</small></summary><div class="management-actions">${issues.map(issue => managementActionHtml(issue, item?.url || spec?.url || commit?.url)).join('')}</div></details>`;
}

function kpi(key, value, label, tone, selectedDetail) {
  return `<button type="button" class="kpi ${tone} ${selectedDetail === key ? 'selected' : ''}" data-briefing-detail="${esc(key)}" aria-expanded="${selectedDetail === key}"><span class="value">${value ?? 0}</span><span class="label">${esc(label)}</span></button>`;
}

function briefingDetailHtml(dashboard, detail, taskRows) {
  if (!detail) return '';
  if (detail === 'git') {
    const rows = dashboard.projects.map(project => {
      const projectGitUrl = project.gitUrl || project.config?.gitUrl;
      const repository = dashboard.git.repositories.find(item => item.project === project.name || item.projectName === project.name)
        || (projectGitUrl && dashboard.git.repositories.find(item => item.remote === projectGitUrl || item.url === projectGitUrl))
        || { project: project.name, remote: projectGitUrl, status: projectGitUrl ? 'connected' : 'missing-url' };
      const mapping = repository.commitCount ? ` · 작업 연결 ${repository.mappedCommitCount || 0}/${repository.commitCount}` : '';
      return `<div class="briefing-row"><strong>${esc(project.name)} · ${esc(gitRepositoryStatus(repository))}</strong><small>${esc(repository.remote || repository.url || projectGitUrl || 'Git URL 없음')} · 브랜치 ${esc(repository.defaultBranch || '-')} · 최근 활동 ${fmt(repository.latestCommitAt || repository.lastActivityAt || repository.recentGitAt)}${mapping}</small><small>마지막 수집 ${fmt(repository.lastFetchedAt)} · 출처 ${esc(repository.source || 'notion')}</small></div>`;
    });
    return `<section class="card briefing-detail" aria-live="polite"><h3>Git 저장소 수집 상세</h3>${rows.join('') || '<div class="summary">표시할 프로젝트가 없습니다.</div>'}</section>`;
  }
  const labels = { projects: '진행 중 프로젝트', 'work-items': '진행 중 작업항목', overdue: '기한 초과 작업항목', guide: '가이드 위반 작업항목' };
  const items = briefingDetailItems(dashboard, detail);
  if (detail === 'projects') return `<section class="card briefing-detail" aria-live="polite"><h3>${labels[detail]} ${items.length}개</h3>${items.map(project => `<div class="briefing-row"><strong>${esc(project.name)} · 완료 ${project.stats.completionRate}%</strong><small>진행 ${project.stats.inProgress}건 · 기한 초과 ${project.stats.overdue}건</small></div>`).join('') || '<div class="summary">해당 프로젝트가 없습니다.</div>'}</section>`;
  return `<section class="card briefing-detail" aria-live="polite"><h3>${labels[detail]} ${items.length}개</h3>${taskRows(items, detail === 'overdue' ? 'overdue' : 'risk')}</section>`;
}

export function briefingHtml(dashboard, selectedDetail, taskRows) {
  const metrics = dashboard.metrics;
  const decisions = [...(dashboard.ai?.overall?.decisionsForCEO || []), ...dashboard.projects.filter(project => project.notionSummary?.decision).map(project => ({ project: project.name, question: project.notionSummary.decision, context: 'Notion 업무현황 요약' }))];
  const priorityIssues = groupIssuesByProjectItem(dashboard.validationIssues).flatMap(group => group.items).sort((left, right) => (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)).slice(0, 5);
  return `<div class="section-head"><div><h2>오늘의 업무 브리핑</h2><p>판단할 것 → 관리상 막힌 것 → 어제와 달라진 것 순서입니다. 이 화면은 읽기 전용입니다.</p></div></div>
    <div class="kpis">${kpi('projects', metrics.activeProjects, '진행 중 프로젝트', '', selectedDetail)}${kpi('work-items', metrics.inProgressWorkItems, '진행 중 작업항목', '', selectedDetail)}${kpi('overdue', metrics.overdueWorkItems, '기한 초과 작업항목', metrics.overdueWorkItems ? 'error' : '', selectedDetail)}${kpi('guide', metrics.guideViolationWorkItems, '가이드 위반 작업항목', metrics.guideViolationWorkItems ? 'error' : '', selectedDetail)}</div>
    ${briefingDetailHtml(dashboard, selectedDetail, taskRows)}
    <div class="card briefing-section"><h3>1. 대표가 확인할 판단</h3><div class="decision-list">${decisions.length ? decisions.slice(0, 5).map(item => `<div class="decision"><strong>[${esc(item.project)}] ${esc(item.question)}</strong><small>${esc(item.context || '')}</small></div>`).join('') : '<div class="summary">명시된 판단 안건이 없습니다.</div>'}</div></div>
    <div class="grid-2"><div class="card"><h3>2. 현재 관리상 막힌 것</h3><div class="issue-list">${priorityIssues.length ? priorityIssues.map(group => issueGroupRowHtml(group, dashboard)).join('') : '<div class="summary">즉시 확인할 문제가 없습니다.</div>'}</div></div>
    <div class="card"><h3>3. 어제와 달라진 것</h3>${dashboard.deltas.length ? dashboard.deltas.slice(0, 5).map(delta => `<div class="issue-row info"><strong><span class="dot info"></span>[${esc(delta.project)}] ${esc(delta.taskTitle || '프로젝트')} · ${esc(delta.field)}</strong><small>${esc(JSON.stringify(delta.from))} → ${esc(JSON.stringify(delta.to))}</small></div>`).join('') : `<div class="summary">${esc(dashboard.snapshotComparison?.reason || '변화가 감지되지 않았습니다.')}</div>`}</div></div>`;
}
