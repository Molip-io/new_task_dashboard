import { buildSprintOverview, projectKey, currentSprints, usesSprints, normalizeSprint, availableSprints, sortIssuesOverdueFirst, applySprintSelections } from './sprint-policy.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeUrl = value => /^https?:\/\//.test(String(value || '')) ? value : '#';
const labels = { projects: '진행 중 프로젝트', 'work-items': '진행 중 작업항목', overdue: '기한 초과 작업항목', guide: '가이드 위반 작업항목', setup: '진행 준비 필요 항목', outside: '선택 밖 기한 초과', unknown: '스프린트 분류 확인 필요' };
const bindings = new Map();
let sequence = 0;
const state = { selections: {}, filters: {}, detail: null, expanded: false, message: '', saving: false };
let queryLoaded = false;
const initialQuery = typeof location === 'undefined' ? '' : location.search;

function selectedFor(project, selections) {
  const key = projectKey(project);
  return Object.hasOwn(selections, key) ? selections[key] : currentSprints(project);
}
function differs(project, selections) {
  const keys = values => values.map(normalizeSprint).sort().join('|');
  return keys(selectedFor(project, selections)) !== keys(currentSprints(project));
}
function optionHtml(values, selected) {
  return '<option value="">전체</option>' + [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko'))
    .map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');
}
function itemRows(items) {
  if (!items.length) return '<p class="scope-empty">선택한 범위에 해당하는 항목이 없습니다.</p>';
  return `<div class="scope-table-scroll"><table class="scope-table"><thead><tr><th>작업항목</th><th>상태</th><th>담당자</th><th>기간</th><th>확인사항</th></tr></thead><tbody>${items.map(item => {
    const issues = sortIssuesOverdueFirst(item.issues);
    const primary = issues[0];
    const label = primary?.type === 'OVERDUE' ? '기한 초과' : primary?.label || primary?.message || (item.status === '시작 전' ? '착수 준비 확인' : '확인된 관리 문제 없음');
    return `<tr><td><a href="${esc(safeUrl(item.url))}" target="_blank" rel="noreferrer">${esc(item.title)}</a><small>${esc(item.project)} · ${esc(item.sprint || '스프린트 미사용/미지정')} · ${esc(item.team || '-')}</small></td>
      <td>${esc(item.status || '미정')}</td><td>${esc((item.assignees || []).join(', ') || '미지정')}</td>
      <td>${esc(item.start || '-')}<br>→ ${esc(item.due || '-')}${item.overdueDays > 0 ? `<small class="scope-danger">${esc(item.overdueDays)}일 초과</small>` : ''}</td>
      <td>${issues.length ? `<details class="scope-issues"><summary>${esc(label)}${issues.length > 1 ? ` 외 ${issues.length-1}건` : ''}</summary>${issues.map(issue => `<div><strong>${esc(issue.type === 'OVERDUE' ? '기한 초과' : issue.label || issue.type)}</strong><p>${esc(issue.message)}</p>${issue.recommendedAction ? `<p>${esc(issue.recommendedAction)}</p>` : ''}</div>`).join('')}</details>` : esc(label)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function detailItems(view, detail) {
  return ({ 'work-items': view.runningItems, overdue: view.overdueItems, guide: view.guideViolationItems, setup: view.progressSetupItems, outside: view.outsideOverdueItems, unknown: view.unknownSprintItems })[detail] || [];
}
function detailHtml(view, detail) {
  if (!detail || !labels[detail]) return '';
  if (detail === 'projects') return `<section class="scope-detail"><h4>${labels.projects} ${view.projects.length}개</h4>${view.projects.map(project => `<p><strong>${esc(project.name)}</strong> · 활성 작업 ${project.stats.total}개 · 진행 중 ${project.stats.inProgress}개 · 기한 초과 ${project.stats.overdue}개</p>`).join('') || '<p>선택 범위에 활성 작업이 없습니다.</p>'}</section>`;
  const items = detailItems(view, detail);
  return `<section class="scope-detail" aria-live="polite"><div class="scope-detail-heading"><h4>${esc(labels[detail])} ${items.length}개</h4><button type="button" data-scope-copy ${items.length ? '' : 'disabled'}>목록 복사</button></div>${itemRows(items)}</section>`;
}

export function renderSprintOverview(dashboard, viewState, kpisHtml) {
  const projects = dashboard.projects || [];
  const view = buildSprintOverview(dashboard, viewState.selections, viewState.filters);
  const dirty = projects.some(project => differs(project, viewState.selections));
  const pending = dashboard.sprintSettings?.pendingInput;
  const summary = projects.map(project => `${project.name}: ${usesSprints(project) ? selectedFor(project, viewState.selections).join(', ') || '선택 없음' : '스프린트 미사용'}`).join(' / ');
  const selectors = projects.map(project => {
    const key = projectKey(project);
    const selected = selectedFor(project, viewState.selections).map(normalizeSprint);
    const options = availableSprints(dashboard, project);
    const record = dashboard.sprintSettings?.projects?.[key];
    const canSave = dashboard.sprintSettings?.writable === true && !dashboard.sample && Boolean(project.notionId || project.config?.notionId);
    return `<fieldset class="scope-project"><legend>${esc(project.name)}</legend>${usesSprints(project) ? `
      <div class="scope-choices">${options.map(sprint => `<label class="scope-choice"><input type="checkbox" data-scope-project="${esc(key)}" value="${esc(sprint)}" ${selected.includes(normalizeSprint(sprint)) ? 'checked' : ''} ${viewState.saving ? 'disabled' : ''}><span>${esc(sprint)}</span></label>`).join('') || '<span>스프린트 데이터 없음 · 데이터 다시 수집 필요</span>'}</div>
      <div class="scope-project-foot"><small>${record ? '대시보드 저장 기준' : 'Notion 이전 설정 · 최초 저장 후 대시보드 기준'}${differs(project, viewState.selections) ? ' · 미저장 선택' : ''}</small><button type="button" data-scope-save="${esc(key)}" ${!canSave || viewState.saving || (!differs(project, viewState.selections) && record) ? 'disabled' : ''}>이 프로젝트 기준 저장</button></div>` : '<p>모든 활성 작업을 집계합니다. 진행 준비는 적용하지 않습니다.</p>'}</fieldset>`;
  }).join('');
  const work = dashboard.workItems || [];
  return `<section class="sprint-overview" aria-labelledby="sprint-overview-title"><div class="scope-title"><div><p class="scope-eyebrow">SPRINT WORK OVERVIEW</p><h3 id="sprint-overview-title">3. 스프린트별 업무 현황</h3><p>프로젝트별 복수 선택 · 동일 기준으로 지표와 상세 목록을 함께 집계합니다.</p></div><span class="scope-mode">${dirty ? '조회 미리보기' : '저장된 현재 기준'}</span></div>
    <details class="scope-picker" ${viewState.expanded ? 'open' : ''}><summary><strong>현재 스프린트 선택</strong><span>${esc(summary)}</span><em>복수 선택</em></summary><div class="scope-picker-body"><p class="scope-help">체크는 이 화면의 미리보기입니다. ‘기준 저장’은 팀 공통 설정을 변경하며 관리자 인증 후 분석 입력을 다시 수집합니다.</p>${selectors}<button type="button" data-scope-reset ${viewState.saving ? 'disabled' : ''}>저장된 기준으로 되돌리기</button>${dashboard.sprintSettings?.writable ? '' : '<p class="scope-help">설정 저장은 비활성화 상태입니다. 서버 관리자 키 설정이 필요하며 조회 미리보기는 사용할 수 있습니다.</p>'}</div></details>
    ${dirty ? '<p class="scope-notice">위 통합 분석과 전일 비교는 저장된 기준의 결과입니다. 현재 조회 선택만으로 AI 분석이 다시 실행되지는 않습니다.</p>' : ''}
    ${pending ? '<p class="scope-notice">현재 스프린트가 변경됐습니다. 기존 통합 분석은 이전 기준이며 새 규칙 입력·분석이 필요합니다.</p>' : ''}
${!pending && dashboard.sprintSettings?.pendingAnalysis ? '<p class="scope-notice">새 기준의 규칙 입력은 생성됐지만 통합 분석은 아직 이전 입력 기준입니다. GPT Agent 재실행이 필요합니다.</p>' : ''}
    <div class="scope-filters"><label>프로젝트<select data-scope-filter="project">${optionHtml(projects.map(p => p.name), viewState.filters.project)}</select></label><label>팀<select data-scope-filter="team">${optionHtml(work.map(item => item.team), viewState.filters.team)}</select></label><label>담당자<select data-scope-filter="assignee">${optionHtml(work.flatMap(item => item.assignees || []), viewState.filters.assignee)}</select></label><button type="button" data-scope-filter-reset>필터 초기화</button></div>
    ${kpisHtml(view.metrics, viewState.detail).replaceAll('data-briefing-detail', 'data-scope-detail')}
    <p class="scope-help">작업 지표는 하위 작업항목 기준입니다. 진행 중은 상태 지표이므로 기한 초과와 겹칠 수 있습니다. 기한 초과는 가이드 위반·진행 준비보다 우선 표시합니다.</p>
    <div class="scope-exceptions">${view.outsideOverdueItems.length ? `<button type="button" data-scope-detail="outside">선택 밖 기한 초과 <b>${view.outsideOverdueItems.length}</b>개 확인</button>` : ''}${view.unknownSprintItems.length ? `<button type="button" data-scope-detail="unknown">스프린트 분류 확인 <b>${view.unknownSprintItems.length}</b>개</button>` : ''}${view.parentIssueCount ? `<span>상위 작업 관리 문제 ${view.parentIssueCount}개는 ‘확인필요’에서 유지</span>` : ''}</div>
    ${view.unconfiguredProjects.length ? `<p class="scope-help">선택 없음: ${esc(view.unconfiguredProjects.join(', '))}. 선택 없음은 ‘전체 스프린트’가 아닙니다.</p>` : ''}
    <p class="scope-feedback" role="status">${esc(viewState.message || '')}</p>${detailHtml(view, viewState.detail)}
    <details class="scope-history"><summary>현재 스프린트 변경 이력</summary>${(dashboard.sprintSettings?.history || []).slice(0, 10).map(record => `<p><strong>${esc(record.projectName)}</strong> · ${esc((record.previousSprints || []).join(', ') || '미지정')} → ${esc(record.sprints.join(', ') || '선택 없음')}<small>${esc(new Date(record.changedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))}</small></p>`).join('') || '<p>대시보드에서 저장한 변경 이력이 없습니다.</p>'}</details>
    <dialog class="scope-auth"><form method="dialog"><h4>현재 스프린트 기준 저장</h4><p>팀 공통 설정을 변경합니다. 관리자 키는 저장하거나 공유 링크에 포함하지 않습니다.</p><label>운영 설정 관리자 키<input type="password" name="adminKey" autocomplete="off" required minlength="24"></label><div><button type="button" data-scope-cancel>취소</button><button type="submit">저장 및 분석 입력 갱신</button></div></form></dialog></section>`;
}

export function sprintOverviewHtml(dashboard, { kpisHtml, initialDetail = null, initialFilters = {} } = {}) {
  if (!queryLoaded) {
    state.detail = labels[initialDetail] ? initialDetail : null;
    state.filters = { ...initialFilters };
    try {
      const query = new URLSearchParams(initialQuery);
      const saved = query.get('sprintView');
      if (saved && saved.length < 12000) {
        const parsed = JSON.parse(saved);
        if (parsed && !Array.isArray(parsed) && typeof parsed === 'object' && Object.values(parsed).every(values => Array.isArray(values) && values.every(v => typeof v === 'string'))) state.selections = parsed;
      }
      for (const key of ['project', 'team', 'assignee']) if (query.has(`scopeFilter_${key}`)) state.filters[key] = query.get(`scopeFilter_${key}`);
      if (labels[query.get('scopeDetail')]) state.detail = query.get('scopeDetail');
    } catch { /* Malformed shared view is not a team setting. */ }
    queryLoaded = true;
  }
  const id = String(++sequence);
  bindings.set(id, { dashboard, kpisHtml });
  return `<sprint-work-overview data-binding="${id}">${renderSprintOverview(dashboard, state, kpisHtml)}</sprint-work-overview>`;
}

if (typeof window !== 'undefined' && window.customElements && !customElements.get('sprint-work-overview')) {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./sprint-overview.css', import.meta.url).href; document.head.append(link);
  customElements.define('sprint-work-overview', class extends HTMLElement {
    connectedCallback() {
      this.binding ||= bindings.get(this.dataset.binding); bindings.delete(this.dataset.binding);
      if (!this.binding || this.bound) return; this.bound = true;
      this.addEventListener('change', event => {
        const input = event.target;
        if (input.matches('[data-scope-project]')) {
          const key = input.dataset.scopeProject;
          state.selections[key] = [...this.querySelectorAll('[data-scope-project]')].filter(box => box.dataset.scopeProject === key && box.checked).map(box => box.value);
          state.expanded = true; this.render();
        } else if (input.matches('[data-scope-filter]')) { state.filters[input.dataset.scopeFilter] = input.value; this.render(); }
      });
      this.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.dataset.scopeDetail) { state.detail = state.detail === button.dataset.scopeDetail ? null : button.dataset.scopeDetail; this.render(); }
        if (button.hasAttribute('data-scope-reset')) { state.selections = {}; state.message = ''; this.render(); }
        if (button.hasAttribute('data-scope-filter-reset')) { state.filters = {}; this.render(); }
        if (button.hasAttribute('data-scope-save')) {
          this.saveProject = button.dataset.scopeSave;
          if (!(state.selections[this.saveProject] || currentSprints(this.binding.dashboard.projects.find(p => projectKey(p) === this.saveProject))).length && !confirm('현재 스프린트를 모두 해제합니까? 이 프로젝트는 현재 스프린트 지표에서 제외됩니다.')) return;
          this.querySelector('dialog').showModal();
        }
        if (button.hasAttribute('data-scope-cancel')) { this.querySelector('dialog input').value = ''; this.querySelector('dialog').close(); }
        if (button.hasAttribute('data-scope-copy')) this.copyList();
      });
      this.addEventListener('submit', event => {
        if (!event.target.closest('dialog')) return; event.preventDefault();
        const input = this.querySelector('dialog input'); const token = input.value; input.value = ''; this.querySelector('dialog').close(); this.save(token);
      });
      this.addEventListener('cancel', () => { const input = this.querySelector('dialog input'); if (input) input.value = ''; }, true);
      this.render();
    }
    render() {
      const focused = document.activeElement;
      const restore = focused && this.contains(focused) ? { project: focused.dataset.scopeProject, value: focused.value, detail: focused.dataset.scopeDetail, filter: focused.dataset.scopeFilter } : null;
      this.innerHTML = renderSprintOverview(this.binding.dashboard, state, this.binding.kpisHtml);
      this.querySelector('.scope-picker').addEventListener('toggle', event => { state.expanded = event.target.open; });
      if (restore) [...this.querySelectorAll('input,button,select')].find(el =>
        (restore.project && el.dataset.scopeProject === restore.project && el.value === restore.value) ||
        (restore.detail && el.dataset.scopeDetail === restore.detail) || (restore.filter && el.dataset.scopeFilter === restore.filter))?.focus();
    }
    async copyList() {
      const view = buildSprintOverview(this.binding.dashboard, state.selections, state.filters);
      const items = detailItems(view, state.detail);
      const url = new URL(location.href); url.searchParams.set('tab', 'briefing'); url.searchParams.set('scopeDetail', state.detail);
      url.searchParams.set('sprintView', JSON.stringify(Object.fromEntries(this.binding.dashboard.projects.map(project => [projectKey(project), selectedFor(project, state.selections)]))));
      for (const key of ['project', 'team', 'assignee']) { url.searchParams.delete(`scopeFilter_${key}`); if (state.filters[key]) url.searchParams.set(`scopeFilter_${key}`, state.filters[key]); }
      const lines = [`${labels[state.detail]} · ${items.length}개`, '선택한 스프린트 기준 · 업무 원본 변경 없음'];
      for (const item of items) lines.push('', `${item.project} / ${item.title}`, `상태: ${item.status} · 담당: ${(item.assignees || []).join(', ') || '미지정'}`, `기간: ${item.start || '-'} → ${item.due || '-'}`, ...sortIssuesOverdueFirst(item.issues).map(issue => `확인: ${issue.type === 'OVERDUE' ? '기한 초과' : issue.label || issue.message || issue.type}`), safeUrl(item.url));
      lines.push('', `대시보드: ${url}`);
      try { await navigator.clipboard.writeText(lines.join('\n')); state.message = `${items.length}개 복사 완료`; }
      catch { state.message = '복사하지 못했습니다. 브라우저 클립보드 권한을 확인하세요.'; } this.render();
    }
    async save(token) {
      if (state.saving) return;
      const project = this.binding.dashboard.projects.find(item => projectKey(item) === this.saveProject);
      state.saving = true; state.message = '팀 공통 기준을 저장하는 중입니다.'; this.render();
      let saved = false;
      try {
        const response = await fetch('/api/sprint-settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ projectId: projectKey(project), sprints: selectedFor(project, state.selections), expectedRevision: this.binding.dashboard.sprintSettings?.projects?.[projectKey(project)]?.revision || null }) });
        token = '';
        const result = await response.json();
        if (!response.ok) throw Error(result.message || '설정을 저장하지 못했습니다.');
        saved = true;
        const selections = Object.fromEntries(Object.entries(result.settings.projects).map(([id, record]) => [id, record.sprints]));
        this.binding.dashboard.projects = applySprintSelections(this.binding.dashboard.projects, selections);
        this.binding.dashboard.sprintSettings = { ...this.binding.dashboard.sprintSettings, ...result.settings, pendingInput: result.changed };
        delete state.selections[projectKey(project)];
        state.message = '설정 저장 완료 · 새로운 규칙 입력을 수집합니다. AI 통합 분석은 별도 실행입니다.'; this.render();
        // Reuse the existing explicit collection action. No full collection on ordinary GET/checkbox changes.
        const refresh = document.getElementById('refreshBtn');
        if (refresh && !refresh.disabled) refresh.click();
        else state.message = '설정 저장 완료 · 데이터 다시 수집 후 GPT Agent를 실행하세요.';
      } catch (error) { state.message = `${saved ? '설정은 저장됐지만 후속 갱신 확인 실패' : '저장 실패'}: ${error.message}`; }
      finally { token = ''; state.saving = false; this.render(); }
    }
  });
}
