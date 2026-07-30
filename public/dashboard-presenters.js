import { groupIssuesByProjectItem } from './dashboard-view-model.js';
import { briefingDetailItems, briefingTrustOverview, gitRepositoryStatus, issuePresentation, primaryActionSummary } from './dashboard-management.js';

const SEVERITY = { error: '🔴', warning: '🟠', check: '🟡', info: '🔵' };
const SEVERITY_RANK = { error: 0, warning: 1, check: 2, info: 3 };
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const safeUrl = value => /^(https?:\/\/|#)/.test(String(value || '')) ? value : '#';
const fmt = value => value ? String(value).replace('T', ' ').slice(0, 16) : '-';

export function managementActionHtml(issue, fallbackUrl) {
  const presentation = issuePresentation(issue);
  const targetLabels = { 'work-item': '작업항목', spec: '상위 스펙', project: '프로젝트', 'git-repository': 'Git 저장소' };
  const targetUrl = issue.metadata?.remote || issue.metadata?.url || issue.metadata?.representativeCommit?.url || fallbackUrl;
  return `<div class="management-action"><strong>${esc(presentation.categoryLabel)} · ${esc(presentation.label)}</strong><small>현재 확인 사항: ${esc(issue.message || '세부 내용을 확인하세요.')}</small><small>수정 방법: ${esc(presentation.recommendedAction)}</small><small>권장 처리: ${esc(presentation.responsibleRole)} · ${esc(targetLabels[presentation.actionTarget] || 'Notion')}</small>${targetUrl ? `<div class="inline-actions"><a href="${esc(safeUrl(targetUrl))}" target="_blank" rel="noreferrer">수정할 항목 열기</a><button type="button" class="link-copy" data-copy-link="${esc(safeUrl(targetUrl))}">링크 복사</button></div>` : ''}</div>`;
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
  return `<details class="issue-row ${esc(group.severity)}"><summary><strong>${SEVERITY[group.severity] || '•'} ${esc(title)} · ${esc(summary.label)}</strong><small>${esc(context)} · ${esc(categories.join(' · '))}${detectedAt ? ` · 감지 ${fmt(detectedAt)}` : ''}</small></summary><div class="management-actions">${issues.map(issue => managementActionHtml(issue, item?.url || spec?.url || commit?.url)).join('')}</div></details>`;
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
      const collectedBranches = repository.matchedBranches?.length ? repository.matchedBranches.join(', ') : repository.defaultBranch || '-';
      const unmatched = repository.unmatchedBranches?.length ? ` · 미확인 ${repository.unmatchedBranches.join(', ')}` : '';
      return `<div class="briefing-row"><strong>${esc(project.name)} · ${esc(gitRepositoryStatus(repository))}</strong><small>${esc(repository.remote || repository.url || projectGitUrl || 'Git URL 없음')} · 브랜치 ${esc(collectedBranches)}${esc(unmatched)} · 최근 활동 ${fmt(repository.latestCommitAt || repository.lastActivityAt || repository.recentGitAt)}${mapping}</small><small>마지막 수집 ${fmt(repository.lastFetchedAt)} · 출처 ${esc(repository.source || 'notion')}</small></div>`;
    });
    return `<section class="card briefing-detail" aria-live="polite"><h3>Git 저장소 수집 상세</h3>${rows.join('') || '<div class="summary">표시할 프로젝트가 없습니다.</div>'}</section>`;
  }
  const labels = { projects: '진행 중 프로젝트', 'work-items': '진행 중 작업항목', overdue: '기한 초과 작업항목', guide: '가이드 위반 작업항목' };
  const items = briefingDetailItems(dashboard, detail);
  if (detail === 'projects') return `<section class="card briefing-detail" aria-live="polite"><h3>${labels[detail]} ${items.length}개</h3>${items.map(project => `<div class="briefing-row"><strong>${esc(project.name)}</strong><small>진행 ${project.stats.inProgress}건 · 기한 초과 ${project.stats.overdue}건 · 관리 확인 ${project.stats.issueCount}건</small></div>`).join('') || '<div class="summary">해당 프로젝트가 없습니다.</div>'}</section>`;
  const shareActions = ['overdue', 'guide'].includes(detail)
    ? `<div class="share-actions"><button type="button" class="share-primary" data-copy-slack data-share-detail="${esc(detail)}">복사</button></div>`
    : '';
  return `<section class="card briefing-detail" aria-live="polite"><div class="detail-heading"><div><h3>${labels[detail]} ${items.length}개</h3>${shareActions ? '<p>현재 목록의 담당자·기한·확인사항·Notion 링크를 공유합니다.</p>' : ''}</div>${shareActions}</div>${taskRows(items, detail === 'overdue' ? 'overdue' : 'risk')}</section>`;
}

function trustSectionHtml(dashboard) {
  const trust = briefingTrustOverview(dashboard);
  const comparison = trust.sourceComparisonStatus === 'complete' ? `${trust.sourceConflicts.length}건`
    : trust.sourceComparisonStatus === 'partial' ? `부분 대조 · ${trust.sourceConflicts.length}건`
      : '대조 미실행';
  const collectionGap = trust.collectionGaps.length
    ? trust.collectionGaps.map(source => `${source.id} ${source.successful ?? 0}/${source.expected ?? 0}`).join(' · ')
    : '출처 수집 정상';
  const coverage = trust.dependencyCoverageRate === null ? '의존관계 미측정' : `의존관계 검토 ${trust.dependencyCoverageRate}%`;
  const conflicts = trust.sourceConflicts.map(item => {
    const evidence = item.evidence || [];
    const otherEvidence = evidence.find(row => row.source !== 'notion');
    const otherSource = item.otherSource || 'slack';
    const otherClaim = item.otherClaim || item.slackClaim || otherEvidence?.excerpt || '';
    const otherContext = otherSource === 'slack'
      ? `Slack${item.slackChannel ? ` #${item.slackChannel}` : ''} ${fmt(item.slackTime || otherEvidence?.timestamp)}`
      : `${otherSource} ${fmt(otherEvidence?.timestamp)}`;
    return `<div class="source-conflict"><strong>[${esc(item.project)}] ${esc(item.subject)} · 확인 필요</strong><small>Notion: ${esc(item.notionClaim)}</small><small>${esc(otherContext)}: ${esc(otherClaim)}</small></div>`;
  }).join('');
  const conflictState = trust.sourceComparisonStatus === 'complete'
    ? conflicts || '<div class="summary">대조가 완료됐으며 직접 모순되는 Notion·Slack 주장은 발견되지 않았습니다.</div>'
    : trust.sourceComparisonStatus === 'partial'
      ? `${conflicts}<div class="summary">일부 출처만 대조했습니다. 표시되지 않은 항목을 충돌 없음으로 판단할 수 없습니다.</div>`
      : '<div class="summary">Notion·Slack 대조가 실행되지 않았습니다. 충돌 없음으로 판단할 수 없습니다.</div>';
  const agentLabels = { success: '에이전트 분석 완료', partial: '에이전트 부분 분석', stale: '에이전트 분석 오래됨', legacy: '기존 요약 사용 중', failed: '에이전트 분석 실패', not_run: '에이전트 분석 미실행' };
  return `<section class="card briefing-section trust-section"><h3>2. 데이터 신뢰 확인</h3><p>기한 초과는 데이터 불신이 아니라 확정 일정 위험으로 분리합니다. 누락·출처 충돌·수집 공백은 판단 전에 확인해야 합니다.</p><div class="analysis-state"><strong>${esc(agentLabels[trust.agentAnalysisStatus] || trust.agentAnalysisStatus)}</strong><small>최근 분석 ${fmt(trust.agentAnalysisAt)}</small></div><div class="trust-grid"><div><span>확정 일정 위험</span><strong>${trust.scheduleRiskCount}건</strong><small>기한 초과 작업항목</small></div><div><span>관리 데이터 부족</span><strong>${trust.guideViolationCount}건</strong><small>가이드 위반 작업항목</small></div><div><span>Notion·Slack 출처 충돌</span><strong>${comparison}</strong><small>같은 상태·기한·담당자의 직접 모순</small></div><div><span>수집·커버리지 공백</span><strong>${esc(collectionGap)}</strong><small>${esc(coverage)}</small></div></div>${conflictState}</section>`;
}

export function briefingHtml(dashboard, selectedDetail, taskRows) {
  const metrics = dashboard.metrics;
  const decisions = [...new Map([
    ...(dashboard.ai?.overall?.decisionsForCEO || []),
    ...dashboard.projects.filter(project => project.notionSummary?.decision).map(project => ({ project: project.name, question: project.notionSummary.decision, context: 'Notion 업무현황 요약' })),
  ].filter(item => item?.question).map(item => [`${item.project}:${item.question}`, item])).values()];
  const overallSummary = dashboard.ai?.overall?.summary;
  const priorityIssues = groupIssuesByProjectItem(dashboard.validationIssues).flatMap(group => group.items).sort((left, right) => (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9)).slice(0, 5);
  return `<div class="section-head"><div><h2>오늘의 업무 브리핑</h2><p>판단할 것 → 데이터 신뢰 확인 → 관리상 막힌 것 → 어제와 달라진 것 순서입니다. 이 화면은 읽기 전용입니다.</p></div></div>
    <div class="kpis">${kpi('projects', metrics.activeProjects, '진행 중 프로젝트', 'info', selectedDetail)}${kpi('work-items', metrics.inProgressWorkItems, '진행 중 작업항목', 'normal', selectedDetail)}${kpi('overdue', metrics.overdueWorkItems, '기한 초과 작업항목', metrics.overdueWorkItems ? 'error' : '', selectedDetail)}${kpi('guide', metrics.guideViolationWorkItems, '가이드 위반 작업항목', metrics.guideViolationWorkItems ? 'error' : '', selectedDetail)}</div>
    ${briefingDetailHtml(dashboard, selectedDetail, taskRows)}
    <div class="card briefing-section"><h3>1. 대표가 확인할 판단</h3>${overallSummary ? `<p class="summary analysis-summary"><strong>에이전트 통합 분석</strong> · ${esc(overallSummary)}</p>` : ''}<div class="decision-list">${decisions.length ? decisions.slice(0, 5).map(item => `<div class="decision"><strong>[${esc(item.project)}] ${esc(item.question)}</strong><small>${esc(item.context || '')}</small></div>`).join('') : '<div class="summary">명시된 판단 안건이 없습니다.</div>'}</div></div>
    ${trustSectionHtml(dashboard)}
    <div class="grid-2"><div class="card"><h3>3. 현재 관리상 막힌 것</h3><div class="issue-list">${priorityIssues.length ? priorityIssues.map(group => issueGroupRowHtml(group, dashboard)).join('') : '<div class="summary">즉시 확인할 문제가 없습니다.</div>'}</div></div>
    <div class="card"><h3>4. 어제와 달라진 것</h3>${dashboard.deltas.length ? dashboard.deltas.slice(0, 5).map(delta => `<div class="issue-row info"><strong>🔵 [${esc(delta.project)}] ${esc(delta.taskTitle || '프로젝트')} · ${esc(delta.field)}</strong><small>${esc(JSON.stringify(delta.from))} → ${esc(JSON.stringify(delta.to))}</small></div>`).join('') : `<div class="summary">${esc(dashboard.snapshotComparison?.reason || '변화가 감지되지 않았습니다.')}</div>`}</div></div>`;
}
