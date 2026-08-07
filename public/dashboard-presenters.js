import { briefingDetailItems, gitRepositoryStatus, issuePresentation, primaryActionSummary } from './dashboard-management.js';

const SEVERITY_RANK = { error: 0, warning: 1, check: 2, info: 3 };
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const safeUrl = value => /^(https?:\/\/|#)/.test(String(value || '')) ? value : '#';
const fmt = value => value ? String(value).replace('T', ' ').slice(0, 16) : '-';

export function managementActionHtml(issue, fallbackUrl) {
  const presentation = issuePresentation(issue);
  const targetLabels = { 'work-item': '작업항목', spec: '상위 작업', project: '프로젝트', 'git-repository': 'Git 저장소' };
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
  const context = item ? `${item.spec || '상위 작업 미지정'} · ${item.team || '팀 미지정'}` : spec ? '상위 작업' : group.project;
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
      const collectedBranches = repository.matchedBranches?.length ? repository.matchedBranches.join(', ') : repository.defaultBranch || '-';
      const unmatched = repository.unmatchedBranches?.length ? ` · 미확인 ${repository.unmatchedBranches.join(', ')}` : '';
      return `<div class="briefing-row"><strong>${esc(project.name)} · ${esc(gitRepositoryStatus(repository))}</strong><small>${esc(repository.remote || repository.url || projectGitUrl || 'Git URL 없음')} · 브랜치 ${esc(collectedBranches)}${esc(unmatched)} · 최근 활동 ${fmt(repository.latestCommitAt || repository.lastActivityAt || repository.recentGitAt)}${mapping}</small><small>마지막 수집 ${fmt(repository.lastFetchedAt)} · 출처 ${esc(repository.source || 'notion')}</small></div>`;
    });
    return `<section class="card briefing-detail" aria-live="polite"><h3>Git 저장소 수집 상세</h3>${rows.join('') || '<div class="summary">표시할 프로젝트가 없습니다.</div>'}</section>`;
  }
  const labels = {
    projects: '진행 중 프로젝트',
    'work-items': '진행 중 작업항목',
    overdue: '기한 초과 작업항목',
    guide: '가이드 위반 작업항목',
    setup: '진행 준비 필요 항목',
  };
  const items = briefingDetailItems(dashboard, detail);
  if (detail === 'projects') return `<section class="card briefing-detail" aria-live="polite"><h3>${labels[detail]} ${items.length}개</h3>${items.map(project => `<div class="briefing-row"><strong>${esc(project.name)}</strong><small>진행 ${project.stats.inProgress}건 · 기한 초과 ${project.stats.overdue}건 · 관리 확인 ${project.stats.issueCount}건</small></div>`).join('') || '<div class="summary">해당 프로젝트가 없습니다.</div>'}</section>`;
  const shareActions = ['overdue', 'guide', 'setup'].includes(detail)
    ? `<div class="share-actions"><button type="button" class="share-primary" data-copy-slack data-share-detail="${esc(detail)}">복사</button></div>`
    : '';
  return `<section class="card briefing-detail" aria-live="polite"><div class="detail-heading"><div><h3>${labels[detail]} ${items.length}개</h3>${shareActions ? '<p>현재 목록의 담당자·기한·확인사항·Notion 링크를 공유합니다.</p>' : ''}</div>${shareActions}</div>${taskRows(items, detail === 'overdue' ? 'overdue' : 'risk')}</section>`;
}

export function briefingHtml(dashboard, selectedDetail, taskRows) {
  const metrics = dashboard.metrics;
  const overallSummary = ['success', 'partial'].includes(dashboard.ai?.analysisStatus)
    ? dashboard.ai?.overall?.summary
    : null;
  const analysisStatus = dashboard.ai?.analysisStatus;
  const analysisEmpty = analysisStatus === 'stale'
    ? '최신 업무 데이터 이후 통합 분석이 아직 실행되지 않았습니다.'
    : analysisStatus === 'failed' ? '통합 분석이 실패했습니다. 상단 데이터 수집 상태를 확인해 주세요.'
      : '통합 분석이 아직 실행되지 않았습니다.';
  const sourceBackedRisks = (dashboard.projects || []).map(project => {
    const candidates = (project.specInsights || []).flatMap(insight => (insight.evidence || [])
      .filter(item => item.attention)
      .map(item => ({ text: `[${project.name}] ${insight.title}: ${item.excerpt}`, timestamp: item.timestamp || '' })))
      .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)));
    return candidates[0]?.text || null;
  }).filter(Boolean);
  const agentRisks = ['success', 'partial'].includes(analysisStatus) ? dashboard.ai?.overall?.topRisks || [] : [];
  const importantRisks = [...sourceBackedRisks, ...agentRisks]
    .filter((item, index, rows) => rows.findIndex(candidate => String(candidate).replace(/\s+/g, '') === String(item).replace(/\s+/g, '')) === index)
    .slice(0, 5);
  const importantRiskHtml = importantRisks.length
    ? `<div class="analysis-risks"><h4>중요 확인사항</h4>${importantRisks.map(risk => `<div class="briefing-row"><strong><span class="dot warning"></span>${esc(risk)}</strong></div>`).join('')}</div>`
    : '';
  return `<div class="section-head"><div><h2>오늘의 업무 브리핑</h2><p>핵심 지표 → 통합 분석 → 어제와 달라진 것 순서입니다. 이 화면은 읽기 전용입니다.</p></div></div>
    <div class="kpis">${kpi('projects', metrics.activeProjects, '진행 중 프로젝트', 'info', selectedDetail)}${kpi('work-items', metrics.inProgressWorkItems, '진행 중 작업항목', 'normal', selectedDetail)}${kpi('overdue', metrics.overdueWorkItems, '기한 초과 작업항목', metrics.overdueWorkItems ? 'error' : '', selectedDetail)}${kpi('guide', metrics.guideViolationWorkItems, '가이드 위반 작업항목', metrics.guideViolationWorkItems ? 'error' : '', selectedDetail)}${kpi('setup', metrics.progressSetupRequiredItems, '진행 준비 필요 항목', metrics.progressSetupRequiredItems ? 'warning' : '', selectedDetail)}</div>
    ${briefingDetailHtml(dashboard, selectedDetail, taskRows)}
    <div class="bento">
    <div class="card span-6"><h3>1. 에이전트 통합 분석</h3>${overallSummary ? `<p class="summary analysis-summary">${esc(overallSummary)}</p>` : `<div class="summary">${esc(analysisEmpty)}</div>`}${importantRiskHtml}</div>
    <div class="card span-6"><h3>2. 어제와 달라진 것</h3>${dashboard.deltas.length ? dashboard.deltas.slice(0, 5).map(delta => `<div class="briefing-row"><strong><span class="dot info"></span>[${esc(delta.project)}] ${esc(delta.taskTitle || '프로젝트')} · ${esc(delta.field)}</strong><small>${esc(JSON.stringify(delta.from))} → ${esc(JSON.stringify(delta.to))}</small></div>`).join('') : `<div class="summary">${esc(dashboard.snapshotComparison?.reason || '변화가 감지되지 않았습니다.')}</div>`}</div>
    </div>`;
}
