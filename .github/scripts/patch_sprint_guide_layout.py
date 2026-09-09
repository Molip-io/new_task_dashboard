from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'missing replacement target in {path}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement):
    text = read(path)
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'pattern matched {count} times in {path}: {pattern[:100]!r}')
    write(path, text)


# Sprint policy: same guide taxonomy as 확인필요, guide overlaps remain visible,
# and selected-sprint guide counts include parent/spec management issues.
path = 'public/sprint-policy.js'
text = read(path)
if not text.startswith("import { issueMatchesCategory }"):
    text = "import { issueMatchesCategory } from './dashboard-management.js';\n\n" + text
text = text.replace("export const SPRINT_POLICY_VERSION = '2026-09-07.2';", "export const SPRINT_POLICY_VERSION = '2026-09-09.1';", 1)
write(path, text)

new_build = r'''export function buildSprintOverview(dashboard, scopeOverride = null, filters = {}) {
  let scope;
  if (typeof scopeOverride === 'string') scope = parseSprintInput(scopeOverride);
  else if (scopeOverride?.mode) scope = scopeOverride;
  else scope = dashboard.sprintSettings?.scope || dashboard.sprintScope || resolveSprintScope(dashboard, dashboard.sprintSettings?.setting || null);

  if (scope.mode === 'all' && !(scope.sprints || []).length) scope = { ...scope, sprints: allKnownSprints(dashboard) };
  const projects = applyGlobalSprintScope(dashboard.projects || [], scope);
  const byName = new Map(projects.map(project => [project.name, project]));
  const parentRecords = new Map();
  for (const project of projects) {
    for (const spec of project.specs || []) parentRecords.set(spec.id, { ...spec, project: project.name, itemLevel: 'parent' });
  }
  const raw = dashboard.workItems || [];
  for (const item of raw) {
    if (item.itemLevel !== 'parent') continue;
    const known = parentRecords.get(item.id) || {};
    parentRecords.set(item.id, { ...item, ...known, id: item.id, project: known.project || item.project, itemLevel: 'parent' });
  }
  const allIssues = dashboard.validationIssues || [];
  const unique = new Map();
  for (const original of raw) {
    if (original.itemLevel === 'parent' || CLOSED.has(original.status) || CLOSED.has(parentRecords.get(original.specId)?.status)) continue;
    const issues = new Map([...(original.issues || []), ...allIssues.filter(issue => issue.workItemId === original.id)]
      .map(issue => [issue.id || `${issue.type}:${issue.message || ''}`, issue]));
    const item = { ...original, issues: sortIssuesOverdueFirst([...issues.values()]) };
    unique.set(itemKey(item), item);
  }
  const active = [...unique.values()].filter(item =>
    (!filters.project || item.project === filters.project) &&
    (!filters.team || item.team === filters.team) &&
    (!filters.assignee || (item.assignees || []).includes(filters.assignee)));

  const selectedKeys = new Set(uniqueSprints(scope.sprints || []).map(normalizeSprint));
  const relationFor = (projectName, sprint) => {
    const project = byName.get(projectName);
    if (!project) return 'unknown';
    if (!usesSprints(project)) return 'not-applicable';
    if (scope.mode === 'all') return sprint ? 'current' : 'unknown';
    if (scope.mode === 'selected') return classifySprint(sprint, scope.sprints || []);
    return 'unknown';
  };
  const inScopeEntity = (projectName, sprint) => {
    if (!scope.configured && scope.mode === 'unset') return false;
    const project = byName.get(projectName);
    if (project && !usesSprints(project)) return true;
    if (scope.mode === 'all') return Boolean(sprint);
    return selectedKeys.has(normalizeSprint(sprint));
  };
  const inScope = item => inScopeEntity(item.project, item.sprint);

  const selected = active.filter(inScope).map(item => ({ ...item, sprintRelation: relationFor(item.project, item.sprint) }));
  const overdue = selected.filter(isOverdue);
  const guideChildren = selected.filter(item => item.issues.some(issue => issueMatchesCategory(issue, 'guide')));
  const setup = selected.filter(item => item.sprintRelation === 'current' && item.status === '시작 전' && !isOverdue(item));
  const running = selected.filter(item => item.status === '진행 중');

  const parentIssues = new Map();
  const addParentIssues = (id, values = []) => {
    if (!id) return;
    const target = parentIssues.get(id) || new Map();
    for (const issue of values) target.set(issue.id || `${issue.type}:${issue.message || ''}`, issue);
    parentIssues.set(id, target);
  };
  for (const [id, parent] of parentRecords) addParentIssues(id, parent.issues || []);
  for (const issue of allIssues) if (issue.specId && !issue.workItemId) addParentIssues(issue.specId, [issue]);

  const parentGuideCandidates = [];
  for (const [id, issueMap] of parentIssues) {
    const parent = parentRecords.get(id);
    if (!parent || CLOSED.has(parent.status)) continue;
    const issues = sortIssuesOverdueFirst([...issueMap.values()]);
    if (!issues.some(issue => issueMatchesCategory(issue, 'guide'))) continue;
    const assignees = parent.owners || parent.assignees || [];
    if (filters.project && parent.project !== filters.project) continue;
    if (filters.team) continue;
    if (filters.assignee && !assignees.includes(filters.assignee)) continue;
    parentGuideCandidates.push({
      id: parent.id,
      title: parent.title || '상위 작업',
      project: parent.project,
      sprint: parent.sprint || null,
      status: parent.status || parent.parentStatus || null,
      itemLevel: 'parent',
      team: '상위 작업',
      assignees,
      start: parent.start || null,
      due: parent.due || null,
      overdueDays: 0,
      url: parent.url || null,
      issues,
      sprintRelation: relationFor(parent.project, parent.sprint),
    });
  }
  const guideParents = parentGuideCandidates.filter(inScope);
  const guide = [...guideParents, ...guideChildren];
  const activeGuideChildren = active.filter(item => item.issues.some(issue => issueMatchesCategory(issue, 'guide')))
    .map(item => ({ ...item, sprintRelation: relationFor(item.project, item.sprint) }));
  const allGuide = [...parentGuideCandidates, ...activeGuideChildren];
  const unknownGuideViolationItems = allGuide.filter(item => usesSprints(byName.get(item.project) || {}) && relationFor(item.project, item.sprint) === 'unknown');
  const outsideGuideViolationItems = allGuide.filter(item => !inScope(item) && relationFor(item.project, item.sprint) !== 'unknown');
  const overdueGuideOverlapItems = guideChildren.filter(isOverdue);

  const selectedProjects = projects.filter(project => selected.some(item => item.project === project.name))
    .map(project => {
      const items = selected.filter(item => item.project === project.name);
      return { ...project, stats: { ...project.stats, total: items.length, inProgress: items.filter(item => item.status === '진행 중').length,
        overdue: items.filter(isOverdue).length, issueCount: items.filter(item => item.issues.length).length } };
    });
  const parentIds = new Set(allIssues.filter(issue => !issue.workItemId && issue.specId).map(issue => issue.specId));
  const outsideOverdueItems = active.filter(item => !inScope(item) && isOverdue(item));
  return {
    policyVersion: SPRINT_POLICY_VERSION,
    scope: { ...scope, sprints: uniqueSprints(scope.sprints || []) },
    scopeConfigured: scope.mode !== 'unset' && scope.configured !== false,
    projects: selectedProjects,
    configuredProjects: projects,
    workItems: selected,
    runningItems: running,
    overdueItems: overdue,
    guideViolationItems: guide,
    guideChildViolationItems: guideChildren,
    guideParentViolationItems: guideParents,
    overdueGuideOverlapItems,
    outsideGuideViolationItems,
    unknownGuideViolationItems,
    progressSetupItems: setup,
    outsideOverdueItems,
    unknownSprintItems: active.filter(item => usesSprints(byName.get(item.project) || {}) && relationFor(item.project, item.sprint) === 'unknown'),
    pastNotStartedItems: active.filter(item => relationFor(item.project, item.sprint) === 'past' && item.status === '시작 전'),
    parentIssueCount: parentIds.size,
    unconfiguredProjects: scope.mode === 'unset' ? projects.filter(usesSprints).map(project => project.name) : [],
    guideBreakdown: {
      total: guide.length,
      parent: guideParents.length,
      child: guideChildren.length,
      overdueOverlap: overdueGuideOverlapItems.length,
      outside: outsideGuideViolationItems.length,
      unknown: unknownGuideViolationItems.length,
      parentTeamFilterLimited: Boolean(filters.team),
    },
    metrics: {
      activeProjects: selectedProjects.length,
      inProgressWorkItems: running.length,
      overdueWorkItems: overdue.length,
      guideViolationWorkItems: guide.length,
      progressSetupRequiredItems: setup.length,
    },
  };
}

export function availableSprints'''
regex_once(path, r'export function buildSprintOverview\(dashboard, scopeOverride = null, filters = \{\}\) \{.*?\n\}\n\nexport function availableSprints', new_build)

# Sprint overview presentation.
path = 'public/sprint-overview.js'
text = read(path)
text = text.replace("import { buildSprintOverview, parseSprintInput, resolveSprintScope, sortIssuesOverdueFirst } from './sprint-policy.js';", "import { buildSprintOverview, parseSprintInput, resolveSprintScope, sortIssuesOverdueFirst } from './sprint-policy.js';\nimport { issuePresentation } from './dashboard-management.js';", 1)
text = text.replace("const labels = { projects: '진행 중 프로젝트', 'work-items': '진행 중 작업항목', overdue: '기한 초과 작업항목', guide: '가이드 위반 작업항목', setup: '진행 준비 필요 항목', outside: '선택 밖 기한 초과', unknown: '스프린트 분류 확인 필요' };", "const labels = { projects: '진행 중 프로젝트', 'work-items': '진행 중 작업항목', overdue: '기한 초과 작업항목', guide: '가이드 위반 항목', setup: '진행 준비 필요 항목', outside: '선택 밖 기한 초과', unknown: '스프린트 분류 확인 필요', 'outside-guide': '선택 밖 가이드 위반', 'unknown-guide': '스프린트 분류 확인 가이드' };", 1)
write(path, text)

new_item_rows = r'''function itemRows(items) {
  if (!items.length) return '<p class="scope-empty">선택한 범위에 해당하는 항목이 없습니다.</p>';
  return `<div class="scope-table-scroll"><table class="scope-table"><thead><tr><th>항목</th><th>상태</th><th>담당자</th><th>기간</th><th>확인사항</th></tr></thead><tbody>${items.map(item => {
    const issues = sortIssuesOverdueFirst(item.issues || []);
    const primary = issues[0];
    const primaryView = primary ? issuePresentation(primary) : null;
    const label = primary?.type === 'OVERDUE' ? '기한 초과' : primaryView?.label || (item.status === '시작 전' ? '착수 준비 확인' : '확인된 관리 문제 없음');
    const level = item.itemLevel === 'parent' ? '상위 작업' : '하위 작업';
    return `<tr data-scope-item-level="${item.itemLevel === 'parent' ? 'parent' : 'child'}"><td><a href="${esc(safeUrl(item.url))}" target="_blank" rel="noreferrer">${esc(item.title)}</a><small>${esc(item.project)} · ${esc(item.sprint || '스프린트 미사용/미지정')} · ${esc(level)}${item.itemLevel === 'parent' ? '' : ` · ${esc(item.team || '-')}`}</small></td>
      <td>${esc(item.status || '미정')}</td><td>${esc((item.assignees || []).join(', ') || '미지정')}</td>
      <td>${esc(item.start || '-')}<br>→ ${esc(item.due || '-')}${item.overdueDays > 0 ? `<small class="scope-danger">${esc(item.overdueDays)}일 초과</small>` : ''}</td>
      <td>${issues.length ? `<details class="scope-issues"><summary>${esc(label)}${issues.length > 1 ? ` 외 ${issues.length-1}건` : ''}</summary>${issues.map(issue => { const view = issuePresentation(issue); return `<div><strong>${esc(issue.type === 'OVERDUE' ? '기한 초과' : view.label)}</strong><p>${esc(issue.message || view.label)}</p>${view.recommendedAction ? `<p>${esc(view.recommendedAction)}</p>` : ''}</div>`; }).join('')}</details>` : esc(label)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function detailItems'''
regex_once(path, r'function itemRows\(items\) \{.*?\n\}\nfunction detailItems', new_item_rows)
text = read(path)
text = text.replace("return ({ 'work-items': view.runningItems, overdue: view.overdueItems, guide: view.guideViolationItems, setup: view.progressSetupItems, outside: view.outsideOverdueItems, unknown: view.unknownSprintItems })[detail] || [];", "return ({ 'work-items': view.runningItems, overdue: view.overdueItems, guide: view.guideViolationItems, setup: view.progressSetupItems, outside: view.outsideOverdueItems, unknown: view.unknownSprintItems, 'outside-guide': view.outsideGuideViolationItems, 'unknown-guide': view.unknownGuideViolationItems })[detail] || [];", 1)
helper = r'''
function guideCoverageHtml(view) {
  if (!view.scopeConfigured) return '';
  const breakdown = view.guideBreakdown || {};
  return `<div class="scope-guide-coverage"><div class="scope-guide-main"><span class="scope-guide-eyebrow">GUIDE COVERAGE</span><strong>현재 범위 가이드 위반 ${breakdown.total || 0}개</strong><small>상위 ${breakdown.parent || 0} · 하위 ${breakdown.child || 0}${breakdown.overdueOverlap ? ` · 기한 초과 중복 ${breakdown.overdueOverlap}` : ''}</small></div><div class="scope-guide-context"><span>선택 밖 ${breakdown.outside || 0}</span><span>스프린트 분류 확인 ${breakdown.unknown || 0}</span></div></div>${breakdown.parentTeamFilterLimited ? '<p class="scope-help">팀 필터 사용 중에는 단일 팀 귀속을 확인할 수 없는 상위 작업 가이드 위반을 범위 수치에서 제외합니다.</p>' : ''}<p class="scope-help">‘확인필요’ 탭은 전체 활성 범위와 다른 문제 분류까지 포함합니다. 여기서는 현재 스프린트의 가이드 위반을 상위·하위 모두 보여주며, 기한 초과와 가이드 위반은 동시에 집계될 수 있습니다.</p>`;
}

'''
text = text.replace('export function renderSprintOverview', helper + 'export function renderSprintOverview', 1)
text = text.replace('<h3 id="sprint-overview-title">3. 스프린트별 업무 현황</h3>', '<h3 id="sprint-overview-title">4. 스프린트별 업무 현황</h3>', 1)
text = text.replace("${kpisHtml(metrics, viewState.detail).replaceAll('data-briefing-detail', 'data-scope-detail')}\n    <p class=\"scope-help\">작업 지표는 하위 작업항목 기준입니다. 진행 중은 상태 지표이므로 기한 초과와 겹칠 수 있습니다. 기한 초과는 가이드 위반·진행 준비보다 대표 표시가 우선합니다.</p>", "${kpisHtml(metrics, viewState.detail).replaceAll('data-briefing-detail', 'data-scope-detail')}\n    ${configured ? guideCoverageHtml(view) : ''}\n    <p class=\"scope-help\">진행 중·기한 초과·진행 준비는 하위 작업 기준입니다. 가이드 위반은 선택 스프린트의 상위 작업과 하위 작업을 함께 집계하며 다른 상태 지표와 중복될 수 있습니다.</p>", 1)
text = text.replace("${view.outsideOverdueItems.length ? `<button type=\"button\" data-scope-detail=\"outside\">선택 밖 기한 초과 <b>${view.outsideOverdueItems.length}</b>개 확인</button>` : ''}${view.unknownSprintItems.length ? `<button type=\"button\" data-scope-detail=\"unknown\">스프린트 분류 확인 <b>${view.unknownSprintItems.length}</b>개</button>` : ''}${view.parentIssueCount ? `<span>상위 작업 관리 문제 ${view.parentIssueCount}개는 ‘확인필요’에서 유지</span>` : ''}", "${view.outsideOverdueItems.length ? `<button type=\"button\" data-scope-detail=\"outside\">선택 밖 기한 초과 <b>${view.outsideOverdueItems.length}</b>개 확인</button>` : ''}${view.outsideGuideViolationItems.length ? `<button type=\"button\" data-scope-detail=\"outside-guide\">선택 밖 가이드 <b>${view.outsideGuideViolationItems.length}</b>개</button>` : ''}${view.unknownGuideViolationItems.length ? `<button type=\"button\" data-scope-detail=\"unknown-guide\">스프린트 분류 확인 가이드 <b>${view.unknownGuideViolationItems.length}</b>개</button>` : ''}${view.unknownSprintItems.length ? `<button type=\"button\" data-scope-detail=\"unknown\">스프린트 분류 확인 <b>${view.unknownSprintItems.length}</b>개</button>` : ''}", 1)
text = text.replace("...sortIssuesOverdueFirst(item.issues).map(issue => `확인: ${issue.type === 'OVERDUE' ? '기한 초과' : issue.label || issue.message || issue.type}`)", "...sortIssuesOverdueFirst(item.issues || []).map(issue => `확인: ${issue.type === 'OVERDUE' ? '기한 초과' : issuePresentation(issue).label}`)", 1)
write(path, text)

# Bento-style reconciliation styling.
path = 'public/sprint-overview.css'
text = read(path)
if '.scope-guide-coverage {' not in text:
    text += r'''

.scope-guide-coverage { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:14px; align-items:center; margin:12px 0 4px; padding:15px 17px; border-radius:var(--radius-well,14px); background:var(--well,var(--panel-3)); box-shadow:inset 0 0 0 1px var(--line-soft); }
.scope-guide-main { display:grid; gap:4px; min-width:0; }
.scope-guide-main strong { font-size:15px; letter-spacing:-.01em; }
.scope-guide-main small { color:var(--muted); font-size:11px; }
.scope-guide-eyebrow { font-size:9px; font-weight:800; letter-spacing:.16em; color:var(--accent); }
.scope-guide-context { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; }
.scope-guide-context span { border:1px solid var(--line-soft); border-radius:999px; padding:5px 8px; color:var(--muted); font-size:11px; background:var(--panel-3); }
.scope-table tr[data-scope-item-level="parent"] td:first-child a { color:var(--text); font-weight:760; }
.scope-table tr[data-scope-item-level="parent"] td:first-child small { color:var(--accent); }
@media(max-width:780px) { .scope-guide-coverage { grid-template-columns:1fr; } .scope-guide-context { justify-content:flex-start; } }
'''
write(path, text)

# KPI label.
path = 'public/dashboard-presenters-base.js'
text = read(path)
text = text.replace("guide: '가이드 위반 작업항목',", "guide: '가이드 위반 항목',", 1)
text = text.replace("${kpi('guide', metrics.guideViolationWorkItems, '가이드 위반 작업항목', metrics.guideViolationWorkItems ? 'error' : '', selectedDetail)}", "${kpi('guide', metrics.guideViolationWorkItems, '가이드 위반 항목', metrics.guideViolationWorkItems ? 'error' : '', selectedDetail)}", 1)
write(path, text)

# Agent input metadata must reflect the mixed guide unit.
path = 'collect.mjs'
text = read(path)
text = text.replace('// Preserve raw rules.metrics; publish the dashboard-aligned, child-only briefing projection separately.', '// Preserve raw rules.metrics; publish the dashboard-aligned scoped briefing projection separately.', 1)
text = text.replace("unit: 'child-work-items',\n      outsideOverdueItems: workOverview.outsideOverdueItems.length,\n      unknownSprintItems: workOverview.unknownSprintItems.length,", "unit: 'mixed-by-metric',\n      executionUnit: 'child-work-items',\n      guideUnit: 'parent-and-child-items',\n      guideOverlapAllowed: true,\n      outsideOverdueItems: workOverview.outsideOverdueItems.length,\n      outsideGuideViolationItems: workOverview.outsideGuideViolationItems.length,\n      unknownGuideViolationItems: workOverview.unknownGuideViolationItems.length,\n      unknownSprintItems: workOverview.unknownSprintItems.length,", 1)
write(path, text)

# Project briefing bento hierarchy.
path = 'public/project-briefing.js'
new_renderers = r'''export function projectBriefingHtml(dashboard, project) {
  const view = resolveProjectBriefing(dashboard, project);
  const stateLabels = { success: 'Agent 통합 분석', partial: 'Agent 통합 분석 · 확인 제한', stale: '이전 통합 분석 · 갱신 필요', legacy: '기존 저장 요약', not_run: '프로젝트 통합 분석 미생성' };
  const preview = view.currentProgress || '여러 출처를 종합한 프로젝트 브리핑이 아직 없습니다.';
  const sourceChips = view.sources.map(source => `<span class="project-briefing-source">${esc(SOURCES[source])}</span>`).join('');
  const axis = (label, content, empty, modifier = '') => `<section class="project-briefing-axis ${modifier}"><h4>${esc(label)}</h4><p>${esc(content || empty)}</p></section>`;
  const emptyAxis = view.structured ? '현재 분석에서 직접 확인된 내용이 없습니다. 확인 제한과 원문 근거를 함께 보세요.' : '영역별 통합 분석 미생성 · 기존 요약에서 이 영역만 임의 추출하지 않습니다.';
  const actionHtml = view.nextActions.length ? view.nextActions.map(a => `<p><span class="project-briefing-action-kind">${a.kind === 'agreed' ? '합의된 행동' : a.kind === 'suggested_check' ? 'AI 확인 제안' : '기존 분석 · 합의 여부 구분 미제공'}</span>${esc(a.text)}</p>`).join('') : '<p class="project-briefing-muted">근거로 확인되는 다음 행동이 제공되지 않았습니다.</p>';
  const narrative = view.hasNarrative ? `<div class="project-briefing-hero">${axis(view.structured ? '현재 진행 요약' : '기존 통합 요약', view.currentProgress, '', 'project-briefing-axis-primary')}</div><div class="project-briefing-grid project-briefing-grid-axes">${axis('빌드·출시 현황', view.buildRelease, emptyAxis)}${axis('데이터 현황', view.data, emptyAxis)}</div><div class="project-briefing-tri-grid"><section class="project-briefing-axis project-briefing-axis-compact"><h4>실행 병목</h4>${listHtml(view.blockers, '분석에 명시된 실행 병목이 없습니다. 출처 확인 제한이 있으면 위험 없음으로 단정하지 않습니다.')}</section><section class="project-briefing-axis project-briefing-axis-compact"><h4>확인 필요</h4>${listHtml(view.confirmationRequired, view.structured ? '별도 확인 항목이 기록되지 않았습니다.' : '기존 요약에는 별도 확인 항목 구분이 없습니다.')}</section><section class="project-briefing-axis project-briefing-axis-compact"><h4>다음 주요 행동</h4>${actionHtml}</section></div>` : '<p class="project-briefing-empty">프로젝트별 Agent 통합 분석이 필요합니다. 수집된 Slack 발췌를 프로젝트 전체의 결론으로 대신 표시하지 않습니다.</p>';
  const sourceDetails = `<details class="project-briefing-evidence"><summary>근거 보기 · 분석 연결 ${view.evidence.length}건 / 수집 참고 ${view.rawEvidence.length}건</summary><div class="project-briefing-evidence-body"><h5>프로젝트 분석에 연결된 근거</h5>${evidenceHtml(view.analysisEvidence)}${view.specEvidence.length ? `<h5>같은 프로젝트의 스펙별 분석 근거</h5><p class="project-briefing-muted">개별 스펙의 근거이며 모든 프로젝트 결론을 뒷받침한다는 뜻은 아닙니다.</p>${evidenceHtml(view.specEvidence)}` : ''}<details class="project-briefing-raw"><summary>원본 수집 근거 · ${view.rawEvidence.length}건</summary><p class="project-briefing-muted">수집기의 발췌입니다. Agent의 통합 판단이 아닙니다.</p>${evidenceHtml(view.rawEvidence)}</details></div></details>`;
  const summaryMeta = `<span class="project-briefing-status ${esc(view.status)}">${stateLabels[view.status]}</span><span>${esc(briefingTime(view.generatedAt))}</span>${view.sources.length ? `<span>${view.sources.length}개 출처 연결</span>` : ''}`;
  return `<details class="card span-6 project-operations-card project-briefing-card" data-project-briefing="${esc(project.name)}"><summary><div class="project-briefing-summary-content"><div class="project-briefing-summary-top"><span class="project-briefing-kicker">PROJECT BRIEFING</span><strong>${esc(project.name)} · 프로젝트 현황</strong><span class="project-briefing-summary-meta">${summaryMeta}</span></div><small class="project-briefing-preview">${esc(preview)}</small></div><span class="project-operations-toggle"><span class="toggle-open">펼치기</span><span class="toggle-close">접기</span></span></summary><div class="project-operations-body project-briefing-body"><div class="project-briefing-meta"><span>분석 기준 ${esc(briefingTime(view.generatedAt))}</span>${sourceChips}</div>${view.status === 'stale' ? '<p class="project-briefing-warning">최신 입력 이전의 분석입니다. 재분석 전까지 아래 내용은 마지막 확인 기록으로만 사용하세요.</p>' : ''}${narrative}${view.limits.length ? `<aside class="project-briefing-limits"><h4>분석 범위·확인 제한</h4>${listHtml(view.limits, '')}</aside>` : ''}${sourceDetails}</div></details>`;
}
export function projectBriefingsHtml(dashboard) {
  const projects = rows(dashboard.projects);
  return projects.length ? `<section class="project-briefings" aria-label="프로젝트 현황"><div class="project-briefings-head"><div><p class="project-briefings-kicker">PROJECT STATUS</p><h3 class="project-briefings-title">3. 프로젝트 현황</h3><p class="project-briefing-muted">모든 관련 근거를 Agent가 종합한 현재 진행 · 빌드·출시 · 데이터 브리핑입니다. 원문은 ‘근거 보기’에서 확인합니다.</p></div></div><div class="bento project-operations-bento">${projects.map(project => projectBriefingHtml(dashboard, project)).join('')}</div></section>` : '';
}'''
regex_once(path, r'export function projectBriefingHtml\(dashboard, project\) \{.*?\nexport function projectBriefingsHtml\(dashboard\) \{.*?\n\}', new_renderers)

path = 'public/project-briefing.css'
text = read(path)
if 'Bento-bold refinement' not in text:
    text += r'''

/* Bento-bold refinement: narrative remains primary, evidence remains secondary. */
.project-briefings-head { display:flex; justify-content:space-between; align-items:flex-end; gap:14px; margin-bottom:12px; }
.project-briefings-kicker, .project-briefing-kicker { display:block; font-size:9px; font-weight:800; letter-spacing:.17em; color:var(--accent); }
.project-briefings-title { font-size:23px; letter-spacing:-.03em; }
.project-briefing-card { padding:0; overflow:hidden; }
.project-briefing-card > summary { padding:18px 20px; gap:16px; align-items:center; }
.project-briefing-summary-content { display:grid; gap:9px; min-width:0; flex:1; }
.project-briefing-summary-top { display:flex; flex-wrap:wrap; align-items:center; gap:7px 10px; min-width:0; }
.project-briefing-summary-top > strong { font-size:16px; letter-spacing:-.02em; }
.project-briefing-summary-meta { display:inline-flex; flex-wrap:wrap; align-items:center; gap:6px; color:var(--muted); font-size:10px; }
.project-briefing-summary-meta .project-briefing-status { padding:3px 6px; }
.project-briefing-body { background:var(--panel-3); }
.project-briefing-hero { margin-bottom:12px; }
.project-briefing-axis { padding:15px 16px; border-radius:var(--radius-well,14px); background:var(--well,var(--panel)); box-shadow:inset 0 0 0 1px var(--line-soft); }
.project-briefing-axis-primary { padding:18px; background:linear-gradient(135deg,var(--accent-bg),var(--panel-3)); box-shadow:inset 0 0 0 1px var(--line-strong); }
.project-briefing-axis-primary h4 { color:var(--accent); font-size:11px; letter-spacing:.08em; }
.project-briefing-grid-axes { gap:10px; margin-bottom:10px; }
.project-briefing-tri-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.project-briefing-axis-compact p { font-size:12px; line-height:1.7; }
.project-briefing-evidence { margin-top:14px; }
@media (max-width:900px) { .project-briefing-tri-grid { grid-template-columns:1fr; } }
@media (max-width:720px) { .project-briefing-card > summary { padding:15px; } .project-briefing-summary-top { align-items:flex-start; } .project-briefing-summary-meta { width:100%; } }
'''
write(path, text)

# Tests.
path = 'test/sprint-policy.test.mjs'
text = read(path)
text = text.replace("test('Five metrics share one global sprint scope and child-only unit',()=>{\n  assert.deepEqual(buildSprintOverview(fixture()).metrics,{\n    activeProjects:3,inProgressWorkItems:4,overdueWorkItems:1,guideViolationWorkItems:2,progressSetupRequiredItems:1,\n  });\n});", "test('Scoped guide KPI keeps overlapping guide issues visible',()=>{\n  assert.deepEqual(buildSprintOverview(fixture()).metrics,{\n    activeProjects:3,inProgressWorkItems:4,overdueWorkItems:1,guideViolationWorkItems:3,progressSetupRequiredItems:1,\n  });\n});", 1)
text = text.replace("assert.equal(v.metrics.guideViolationWorkItems,4);", "assert.equal(v.metrics.guideViolationWorkItems,5);", 1)
text = text.replace("test('Overdue wins while raw data and counts remain immutable',()=>{\n  const d=fixture(); const original=JSON.stringify(d); const v=buildSprintOverview(d);\n  assert.ok(v.overdueItems.some(i=>i.id==='a3-late'));\n  assert.ok(!v.guideViolationItems.some(i=>i.id==='a3-late'));\n  assert.equal(v.overdueItems[0].issues.length,2);\n  assert.equal(JSON.stringify(d),original);\n});", "test('Overdue and guide remain independently discoverable while source data stays immutable',()=>{\n  const d=fixture(); const original=JSON.stringify(d); const v=buildSprintOverview(d);\n  assert.ok(v.overdueItems.some(i=>i.id==='a3-late'));\n  assert.ok(v.guideViolationItems.some(i=>i.id==='a3-late'));\n  assert.equal(v.overdueGuideOverlapItems.length,1);\n  assert.equal(v.overdueItems[0].issues.length,2);\n  assert.equal(JSON.stringify(d),original);\n});", 1)
text = text.replace("assert.equal(buildSprintOverview(d).metrics.guideViolationWorkItems,2);", "assert.equal(buildSprintOverview(d).metrics.guideViolationWorkItems,3);", 2)
text = text.replace("test('Parent issues do not inflate child task KPIs',()=>{\n  const d=fixture(); d.workItems.push({id:'parent',itemLevel:'parent',project:'A',sprint:'Sprint3',status:'진행 중',issues:[guide]});\n  assert.equal(buildSprintOverview(d).metrics.guideViolationWorkItems,2);\n});", "test('Parent guide issues are visible without changing child-only execution KPIs',()=>{\n  const d=fixture(); d.workItems.push({id:'parent',title:'Parent',itemLevel:'parent',project:'A',sprint:'Sprint3',status:'진행 중',issues:[guide]});\n  const v=buildSprintOverview(d);\n  assert.equal(v.metrics.guideViolationWorkItems,4);\n  assert.equal(v.guideBreakdown.parent,1);\n  assert.equal(v.guideBreakdown.child,3);\n  assert.equal(v.metrics.inProgressWorkItems,4);\n});", 1)
if 'Guide taxonomy matches 확인필요' not in text:
    text += r'''

test('Guide taxonomy matches 확인필요 even when raw category is missing',()=>{
  const d=fixture(); d.workItems.find(i=>i.id==='b3').issues=[{type:'MISSING_BRANCH',severity:'error',message:'missing'}];
  assert.equal(buildSprintOverview(d).metrics.guideViolationWorkItems,3);
});

test('Selected scope explains guide items outside and without a classifiable sprint',()=>{
  const v=buildSprintOverview(fixture());
  assert.equal(v.outsideGuideViolationItems.length,3);
  assert.ok(v.unknownGuideViolationItems.some(i=>i.id==='a-none'));
});
'''
write(path, text)

path = 'tools/sprint-browser-smoke.py'
text = read(path)
old = "fixture = {'sample': False, 'generatedAt': '2026-09-07T10:00:00+09:00', 'projects': projects, 'workItems': tasks, 'validationIssues': [i for t in tasks for i in t['issues']],"
new = "parent_guide = {'id': 'parent-guide', 'type': 'MISSING_REQUIRED_OWNERS', 'severity': 'error', 'message': 'Parent owners required', 'specId': 'a-spec', 'project': 'Project A'}\nfixture = {'sample': False, 'generatedAt': '2026-09-07T10:00:00+09:00', 'projects': projects, 'workItems': tasks, 'validationIssues': [parent_guide] + [i for t in tasks for i in t['issues']],"
if old not in text:
    raise SystemExit('browser fixture target missing')
text = text.replace(old, new, 1)
text = text.replace("check('Baseline five scoped KPIs', values() == [3, 3, 1, 2, 1], values())", "check('Baseline five scoped KPIs', values() == [3, 3, 1, 4, 1], values())", 1)
text = text.replace("check('Analysis changes project briefing and sprint overview are ordered', len(headings) >= 4 and headings[0].startswith('1.') and headings[1].startswith('2.') and '프로젝트 현황' in headings[2] and headings[3].startswith('3.'), headings)", "check('Analysis changes project briefing and sprint overview are ordered', len(headings) >= 4 and headings[0].startswith('1.') and headings[1].startswith('2.') and headings[2].startswith('3.') and '프로젝트 현황' in headings[2] and headings[3].startswith('4.'), headings)", 1)
text = text.replace("check('Global multi-sprint input recomputes five KPIs', values() == [3, 4, 1, 4, 2], values())", "check('Global multi-sprint input recomputes five KPIs', values() == [3, 4, 1, 6, 2], values())", 1)
text = text.replace("check('Guide list matches KPI without overdue duplicate', len(titles) == 4 and 'overdue-and-guide' not in titles, titles)", "check('Guide list matches KPI with parent and overdue overlap visible', len(titles) == 6 and 'overdue-and-guide' in titles and 'Test Spec' in titles, titles)", 1)
text = text.replace("check('Copy shares global scope and URL', 'sprintView=3%2C4' in link and 'overdue-and-guide' not in copied)", "check('Copy shares global scope and URL', 'sprintView=3%2C4' in link and 'overdue-and-guide' in copied and 'Test Spec' in copied)", 1)
text = text.replace("second.locator('.scope-table tbody tr').count() == 4", "second.locator('.scope-table tbody tr').count() == 6", 1)
write(path, text)

path = 'test/project-briefing.test.mjs'
text = read(path)
if 'uses bento narrative hierarchy' not in text:
    text += r'''

test('project briefing uses bento narrative hierarchy without exposing raw evidence first',()=>{
  const d=fixture(),h=projectBriefingHtml(d,d.projects[0]);
  assert.match(h,/project-briefing-hero/);
  assert.match(h,/project-briefing-grid-axes/);
  assert.match(h,/project-briefing-tri-grid/);
  assert.ok(h.indexOf('SYNTHESIS:')<h.indexOf('근거 보기'));
});
'''
write(path, text)

print('patch complete')
