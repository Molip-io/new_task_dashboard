import { buildSprintOverview, parseSprintInput, resolveSprintScope, sortIssuesOverdueFirst } from './sprint-policy.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const safeUrl = value => /^https?:\/\//.test(String(value || '')) ? value : '#';
const labels = { projects: '진행 중 프로젝트', 'work-items': '진행 중 작업항목', overdue: '기한 초과 작업항목', guide: '가이드 위반 작업항목', setup: '진행 준비 필요 항목', outside: '선택 밖 기한 초과', unknown: '스프린트 분류 확인 필요' };
const bindings = new Map();
let sequence = 0;
const state = { sprintInput: null, filters: {}, detail: null, message: '', saving: false };
let queryLoaded = false;
const initialQuery = typeof location === 'undefined' ? '' : location.search;

function optionHtml(values, selected) {
  return '<option value="">전체</option>' + [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b,'ko'))
    .map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join('');
}
function savedScope(dashboard) {
  return dashboard.sprintSettings?.scope || dashboard.sprintScope || resolveSprintScope(dashboard, dashboard.sprintSettings?.setting || null);
}
function savedInput(dashboard) { return String(savedScope(dashboard)?.input || ''); }
function previewInput(dashboard) { return state.sprintInput === null ? savedInput(dashboard) : state.sprintInput; }
function parsedPreview(dashboard) {
  try { return { scope: parseSprintInput(previewInput(dashboard)), error: null }; }
  catch (error) { return { scope: savedScope(dashboard), error: error.message }; }
}
function normalizedInput(value) {
  try { return parseSprintInput(value).input; } catch { return String(value || '').trim(); }
}
function isDirty(dashboard) { return normalizedInput(previewInput(dashboard)) !== normalizedInput(savedInput(dashboard)); }

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
  const parsed = parsedPreview(dashboard);
  const view = buildSprintOverview(dashboard, parsed.scope, viewState.filters);
  const dirty = isDirty(dashboard);
  const pending = dashboard.sprintSettings?.pendingInput;
  const work = dashboard.workItems || [];
  const configured = view.scopeConfigured && !parsed.error;
  const metrics = configured ? view.metrics : {
    activeProjects: null, inProgressWorkItems: null, overdueWorkItems: null,
    guideViolationWorkItems: null, progressSetupRequiredItems: null,
  };
  const modeLabel = parsed.error ? '입력 확인 필요' : dirty ? '조회 미리보기' : '저장된 현재 기준';
  const canSave = dashboard.sprintSettings?.writable === true && !dashboard.sample && !parsed.error && dirty;
  const history = dashboard.sprintSettings?.history || [];

  return `<section class="sprint-overview" aria-labelledby="sprint-overview-title">
    <div class="scope-title"><div><p class="scope-eyebrow">SPRINT WORK OVERVIEW</p><h3 id="sprint-overview-title">3. 스프린트별 업무 현황</h3><p>공용 스프린트 범위와 프로젝트·팀·담당자 필터를 같은 업무 지표에 적용합니다.</p></div><span class="scope-mode">${esc(modeLabel)}</span></div>
    ${dirty ? '<p class="scope-notice">현재 입력은 조회 미리보기입니다. 저장해야 팀 공통 기준과 다음 규칙 입력에 반영됩니다.</p>' : ''}
    ${pending ? '<p class="scope-notice">현재 스프린트가 변경됐습니다. 기존 통합 분석은 이전 기준이며 새 규칙 입력·분석이 필요합니다.</p>' : ''}
    ${!pending && dashboard.sprintSettings?.pendingAnalysis ? '<p class="scope-notice">새 기준의 규칙 입력은 생성됐지만 통합 분석은 아직 이전 입력 기준입니다. GPT Agent 재실행이 필요합니다.</p>' : ''}
    <div class="scope-filters scope-global-filters">
      <label class="scope-sprint-input">현재 스프린트
        <span class="scope-input-row"><input type="text" inputmode="text" autocomplete="off" data-scope-sprint value="${esc(previewInput(dashboard))}" placeholder="3,4,5"><button type="button" data-scope-save ${canSave ? '' : 'disabled'}>저장</button></span>
        <small>예: 3,4,5 · 전체</small>
      </label>
      <label>프로젝트<select data-scope-filter="project">${optionHtml((dashboard.projects || []).map(p => p.name), viewState.filters.project)}</select></label>
      <label>팀<select data-scope-filter="team">${optionHtml(work.map(item => item.team), viewState.filters.team)}</select></label>
      <label>담당자<select data-scope-filter="assignee">${optionHtml(work.flatMap(item => item.assignees || []), viewState.filters.assignee)}</select></label>
      <button type="button" data-scope-filter-reset>조회 필터 초기화</button>
      ${dirty ? '<button type="button" data-scope-reset>저장값으로 되돌리기</button>' : ''}
    </div>
    ${parsed.error ? `<p class="scope-notice scope-error">${esc(parsed.error)}</p>` : ''}
    ${!configured ? '<p class="scope-help">현재 스프린트가 미입력 상태입니다. 3 또는 3,4,5처럼 입력하거나 전체를 입력하세요. 미입력 상태는 0건이 아니라 미계산입니다.</p>' : ''}
    ${kpisHtml(metrics, viewState.detail).replaceAll('data-briefing-detail', 'data-scope-detail')}
    <p class="scope-help">작업 지표는 하위 작업항목 기준입니다. 진행 중은 상태 지표이므로 기한 초과와 겹칠 수 있습니다. 기한 초과는 가이드 위반·진행 준비보다 대표 표시가 우선합니다.</p>
    <div class="scope-exceptions">${view.outsideOverdueItems.length ? `<button type="button" data-scope-detail="outside">선택 밖 기한 초과 <b>${view.outsideOverdueItems.length}</b>개 확인</button>` : ''}${view.unknownSprintItems.length ? `<button type="button" data-scope-detail="unknown">스프린트 분류 확인 <b>${view.unknownSprintItems.length}</b>개</button>` : ''}${view.parentIssueCount ? `<span>상위 작업 관리 문제 ${view.parentIssueCount}개는 ‘확인필요’에서 유지</span>` : ''}</div>
    <p class="scope-feedback" role="status">${esc(viewState.message || '')}</p>${configured ? detailHtml(view, viewState.detail) : ''}
    <details class="scope-history"><summary>현재 스프린트 변경 이력</summary>${history.slice(0, 10).map(record => `<p><strong>전체 프로젝트</strong> · ${esc(record.previousInput || '미입력')} → ${esc(record.input || '미입력')}<small>${esc(new Date(record.changedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))}</small></p>`).join('') || '<p>대시보드에서 저장한 변경 이력이 없습니다.</p>'}</details>
    <dialog class="scope-auth"><form method="dialog"><h4>현재 스프린트 저장</h4><p>모든 프로젝트에 적용되는 공용 기준을 변경합니다. 관리자 키는 저장하거나 공유 링크에 포함하지 않습니다.</p><label>운영 설정 관리자 키<input type="password" name="adminKey" autocomplete="off" required minlength="24"></label><div><button type="button" data-scope-cancel>취소</button><button type="submit">저장 및 분석 입력 갱신</button></div></form></dialog>
  </section>`;
}

export function sprintOverviewHtml(dashboard, { kpisHtml, initialDetail = null, initialFilters = {} } = {}) {
  if (!queryLoaded) {
    state.detail = labels[initialDetail] ? initialDetail : null;
    state.filters = { ...initialFilters };
    try {
      const query = new URLSearchParams(initialQuery);
      if (query.has('sprintView')) state.sprintInput = query.get('sprintView');
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
        if (input.matches('[data-scope-sprint]')) {
          state.sprintInput = input.value;
          state.message = '';
          this.render();
        } else if (input.matches('[data-scope-filter]')) {
          state.filters[input.dataset.scopeFilter] = input.value;
          this.render();
        }
      });
      this.addEventListener('keydown', event => {
        if (event.target.matches('[data-scope-sprint]') && event.key === 'Enter') {
          event.preventDefault();
          state.sprintInput = event.target.value;
          state.message = '';
          this.render();
        }
      });
      this.addEventListener('click', event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.dataset.scopeDetail) { state.detail = state.detail === button.dataset.scopeDetail ? null : button.dataset.scopeDetail; this.render(); }
        if (button.hasAttribute('data-scope-reset')) { state.sprintInput = null; state.message = ''; this.render(); }
        if (button.hasAttribute('data-scope-filter-reset')) { state.filters = {}; this.render(); }
        if (button.hasAttribute('data-scope-save')) {
          const input = this.querySelector('[data-scope-sprint]');
          state.sprintInput = input?.value ?? previewInput(this.binding.dashboard);
          const parsed = parsedPreview(this.binding.dashboard);
          if (parsed.error) { state.message = parsed.error; this.render(); return; }
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
      if (this.rendering) return;
      this.rendering = true;
      try {
        const focused = document.activeElement;
        const restore = focused && this.contains(focused) ? { sprint: focused.matches('[data-scope-sprint]'), filter: focused.dataset.scopeFilter, detail: focused.dataset.scopeDetail } : null;
        this.innerHTML = renderSprintOverview(this.binding.dashboard, state, this.binding.kpisHtml);
        if (restore?.sprint) this.querySelector('[data-scope-sprint]')?.focus();
        else if (restore) [...this.querySelectorAll('button,select')].find(el =>
          (restore.detail && el.dataset.scopeDetail === restore.detail) || (restore.filter && el.dataset.scopeFilter === restore.filter))?.focus();
      } finally {
        this.rendering = false;
      }
    }
    async copyList() {
      const parsed = parsedPreview(this.binding.dashboard);
      if (parsed.error) return;
      const view = buildSprintOverview(this.binding.dashboard, parsed.scope, state.filters);
      const items = detailItems(view, state.detail);
      const url = new URL(location.href); url.searchParams.set('tab', 'briefing'); url.searchParams.set('scopeDetail', state.detail);
      url.searchParams.set('sprintView', previewInput(this.binding.dashboard));
      for (const key of ['project', 'team', 'assignee']) { url.searchParams.delete(`scopeFilter_${key}`); if (state.filters[key]) url.searchParams.set(`scopeFilter_${key}`, state.filters[key]); }
      const lines = [`${labels[state.detail]} · ${items.length}개`, `스프린트: ${previewInput(this.binding.dashboard) || '미입력'} · 업무 원본 변경 없음`];
      for (const item of items) lines.push('', `${item.project} / ${item.title}`, `상태: ${item.status} · 담당: ${(item.assignees || []).join(', ') || '미지정'}`, `기간: ${item.start || '-'} → ${item.due || '-'}`, ...sortIssuesOverdueFirst(item.issues).map(issue => `확인: ${issue.type === 'OVERDUE' ? '기한 초과' : issue.label || issue.message || issue.type}`), safeUrl(item.url));
      lines.push('', `대시보드: ${url}`);
      try { await navigator.clipboard.writeText(lines.join('\n')); state.message = `${items.length}개 복사 완료`; }
      catch { state.message = '복사하지 못했습니다. 브라우저 클립보드 권한을 확인하세요.'; } this.render();
    }
    async save(token) {
      if (state.saving) return;
      const parsed = parsedPreview(this.binding.dashboard);
      if (parsed.error) { state.message = parsed.error; this.render(); return; }
      state.saving = true; state.message = '팀 공통 현재 스프린트를 저장하는 중입니다.'; this.render();
      let saved = false;
      try {
        const response = await fetch('/api/sprint-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ input: previewInput(this.binding.dashboard), expectedRevision: this.binding.dashboard.sprintSettings?.revision || null }),
        });
        token = '';
        const result = await response.json();
        if (!response.ok) throw Error(result.message || '설정을 저장하지 못했습니다.');
        saved = true;
        this.binding.dashboard.sprintSettings = { ...this.binding.dashboard.sprintSettings, ...result.settings, pendingInput: result.changed };
        state.sprintInput = result.settings.setting?.input ?? state.sprintInput;
        state.message = '설정 저장 완료 · 새로운 규칙 입력을 수집합니다. AI 통합 분석은 별도 실행입니다.'; this.render();
        const refresh = document.getElementById('refreshBtn');
        if (refresh && !refresh.disabled) refresh.click();
        else state.message = '설정 저장 완료 · 데이터 다시 수집 후 GPT Agent를 실행하세요.';
      } catch (error) { state.message = `${saved ? '설정은 저장됐지만 후속 갱신 확인 실패' : '저장 실패'}: ${error.message}`; }
      finally { token = ''; state.saving = false; this.render(); }
    }
  });
}
