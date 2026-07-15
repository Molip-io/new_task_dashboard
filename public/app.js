let D = null; // dashboard data

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = new Date().toISOString().slice(0, 10);

const STATUS_PILL = { '정상': 'green', '주의': 'yellow', '개입필요': 'red', '개입 필요': 'red', normal: 'green', watch: 'yellow', risk: 'red', blocked: 'red' };
function pill(status) {
  if (!status) return '';
  return `<span class="pill ${STATUS_PILL[status] || 'gray'}">${esc(status)}</span>`;
}

function aiProject(name) {
  return D.ai?.projects?.find(p => p.name === name) || null;
}

// ---------- 렌더 ----------
function render() {
  $('#meta').textContent = `수집 시각: ${D.generatedAt?.replace('T', ' ').slice(0, 16) || '-'}`;
  $('#sampleBadge').classList.toggle('hidden', !D.sample);
  $('#errors').classList.toggle('hidden', !D.errors?.length);
  if (D.errors?.length) $('#errors').textContent = '⚠ ' + D.errors.join('\n⚠ ');

  renderTrustLine();
  renderOverall();
  renderProjects();
  renderRisks();
  renderPeople();
  renderFeed();
}

function renderTrustLine() {
  const health = D.sourceHealth;
  if (!health) {
    $('#trustLine').innerHTML = '<strong>판단 범위</strong><span class="warn-text">출처 상태·의존관계 커버리지 미측정</span>';
    return;
  }
  const sourceLabel = { notion: 'Notion', slack: 'Slack', meetings: '회의록' };
  const statusLabel = { ok: '성공', partial: '부분 성공', unavailable: '실패' };
  const sources = health.sources.map(source => {
    const count = source.expected > 1 ? ` ${source.successful}/${source.expected}` : '';
    return `<span class="source ${source.status}">${sourceLabel[source.id] || esc(source.id)} ${statusLabel[source.status] || esc(source.status)}${count}</span>`;
  }).join('');
  const coverage = health.dependencyCoverage;
  const dependency = coverage?.status === 'unmeasured'
    ? '<span class="source partial">의존관계 미측정</span>'
    : `<span class="source ${coverage?.status === 'complete' ? 'ok' : 'partial'}">의존관계 ${coverage?.rate}% (${coverage?.reviewed}/${coverage?.total})</span>`;
  $('#trustLine').innerHTML = `<strong>판단 범위</strong>${sources}${dependency}`;
}

function renderOverall() {
  $('#overall').classList.remove('hidden');
  const overdue = D.projects.reduce((a, p) => a + p.stats.overdue, 0);
  const inProg = D.projects.reduce((a, p) => a + p.stats.inProgress, 0);
  const decisions = D.ai?.overall?.decisionsForCEO?.length ?? D.projects.filter(p => p.notionSummary?.decision).length;
  const needAttn = D.projects.filter(p => {
    const s = aiProject(p.name)?.status || p.notionSummary?.status;
    return s && s !== '정상' && s !== 'normal';
  }).length;

  $('#kpis').innerHTML = `
    <div class="kpi"><div class="num">${D.projects.length}</div><div class="label">프로젝트</div></div>
    <div class="kpi green"><div class="num">${inProg}</div><div class="label">진행 중 작업</div></div>
    <div class="kpi ${overdue ? 'red' : ''}"><div class="num">${overdue}</div><div class="label">지연 작업</div></div>
    <div class="kpi ${needAttn ? 'yellow' : ''}"><div class="num">${needAttn}</div><div class="label">주의 · 개입 필요</div></div>
    <div class="kpi ${decisions ? 'yellow' : ''}"><div class="num">${decisions}</div><div class="label">대표 결정 대기</div></div>`;

  const o = D.ai?.overall;
  $('#aiOverall').innerHTML = o ? `
    <h3>오늘의 브리핑</h3>
    <div class="summary">${esc(o.summary)}</div>
    ${o.topRisks?.length ? `<h3>주요 리스크</h3><ul class="risk-list">${o.topRisks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  ` : `<h3>오늘의 브리핑</h3><div class="summary" style="color:#8b93a7">AI 요약 없음 — 수집 시 claude CLI가 실행 가능해야 합니다.</div>`;
}

function statsBar(s) {
  const total = Math.max(s.total, 1);
  const w = n => (n / total * 100).toFixed(1) + '%';
  return `
    <div class="bar">
      <div class="done" style="width:${w(s.done)}"></div>
      <div class="prog" style="width:${w(s.inProgress)}"></div>
      <div class="plan" style="width:${w(s.planned + s.review)}"></div>
      <div class="over" style="width:${w(s.overdue)}"></div>
    </div>
    <div class="bar-legend">완료 ${s.done} · 진행 ${s.inProgress} · 대기 ${s.planned + s.review} · 지연 ${s.overdue} / 전체 ${s.total}</div>`;
}

function taskLine(t) {
  const overdue = t.due && t.due.slice(0, 10) < today;
  return `<div class="task-line">
    <span><a href="${esc(t.url || '#')}" target="_blank">${esc(t.title)}</a> ${t.status ? pill(t.status) : ''}</span>
    <span class="who">${esc((t.assignees || []).join(', '))}</span>
    <span class="due ${overdue ? 'overdue' : ''}">${esc(t.due?.slice(0, 10) || '')}</span>
  </div>`;
}

let selectedProject = null;

function renderProjects() {
  if (!D.projects.length) { $('#tab-projects').innerHTML = ''; return; }
  if (!selectedProject || !D.projects.some(p => p.name === selectedProject)) {
    selectedProject = D.projects[0].name;
  }
  const chips = D.projects.map(p => {
    const status = aiProject(p.name)?.status || p.notionSummary?.status;
    const cls = STATUS_PILL[status] || 'gray';
    const extra = p.stats.overdue ? ` · 지연 ${p.stats.overdue}` : '';
    return `<button class="chip ${p.name === selectedProject ? 'on' : ''}" data-project="${esc(p.name)}">
      <span class="dot ${cls}"></span>${esc(p.name)}<span class="chip-n">${p.stats.inProgress}건 진행${extra}</span>
    </button>`;
  }).join('');
  $('#tab-projects').innerHTML = `<div class="chips">${chips}</div><div class="grid">` +
    D.projects.filter(p => p.name === selectedProject).map(p => {
    const ai = aiProject(p.name);
    const ns = p.notionSummary;
    const status = ai?.status || ns?.status;
    return `<div class="card">
      <h2>${esc(p.name)} ${pill(status)}</h2>
      ${statsBar(p.stats)}
      ${ai?.summary || ns?.summary ? `<div class="summary">${esc(ai?.summary || ns?.summary)}</div>` : ''}
      ${ai?.statusReason ? `<div class="summary" style="color:#8b93a7">↳ ${esc(ai.statusReason)}</div>` : ''}
      ${(ai?.blockers?.length || ns?.blocked) ? `<h3>블로커</h3><ul>${(ai?.blockers || [ns.blocked]).filter(Boolean).map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      ${ai?.highlights?.length ? `<h3>하이라이트</h3><ul>${ai.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      ${ai?.nextActions?.length ? `<h3>다음 액션</h3><ul>${ai.nextActions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${p.overdueTasks.length ? `<h3>지연 작업 (${p.overdueTasks.length})</h3>${p.overdueTasks.slice(0, 5).map(taskLine).join('')}` : ''}
      ${p.slack?.length ? `<h3>슬랙</h3><div class="summary">${p.slack.map(c => `#${esc(c.channel)} ${c.count}건`).join(' · ')}</div>` : ''}
      ${p.meetings.length ? `<h3>최근 회의</h3><ul>${p.meetings.slice(0, 3).map(m => `<li>${esc(m.date?.slice(0, 10) || '')} <a href="${esc(m.url)}" target="_blank">${esc(m.title)}</a></li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('') + `</div>`;
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    selectedProject = c.dataset.project;
    renderProjects();
  }));
}

function renderRisks() {
  const decisions = D.ai?.overall?.decisionsForCEO || [];
  const notionDecisions = D.projects.filter(p => p.notionSummary?.decision)
    .filter(p => !decisions.some(d => d.project === p.name)) // AI가 이미 다룬 프로젝트는 중복 제외
    .map(p => ({ project: p.name, question: p.notionSummary.decision, context: '(노션 업무현황 요약 DB)' }));
  const all = [...decisions, ...notionDecisions];
  const allOverdue = D.projects.flatMap(p => p.overdueTasks.map(t => ({ ...t, project: p.name })));

  $('#tab-risks').innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <h2>🧭 대표 결정 필요 (${all.length})</h2>
      ${all.length ? all.map(d => `<div class="decision"><div class="q">[${esc(d.project)}] ${esc(d.question)}</div><div class="ctx">${esc(d.context || '')}</div></div>`).join('') : '<div class="summary">현재 결정 대기 항목 없음</div>'}
    </div>
    <div class="card" style="margin-bottom:14px">
      <h2>⏰ 지연 작업 전체 (${allOverdue.length})</h2>
      ${allOverdue.length ? allOverdue.map(t => `<div class="task-line"><span>[${esc(t.project)}] <a href="${esc(t.url || '#')}" target="_blank">${esc(t.title)}</a></span><span class="who">${esc((t.assignees || []).join(', '))}</span><span class="due overdue">${esc(t.due?.slice(0, 10) || '')}</span></div>`).join('') : '<div class="summary">지연 작업 없음 🎉</div>'}
    </div>`;
}

function renderPeople() {
  $('#tab-people').innerHTML = `<div class="grid">` + D.workload.map(w => `
    <div class="card person">
      <h2>${esc(w.name)} <span class="pill ${w.waitImpactMeasured ? (w.waitingOnMeCount ? 'red' : 'green') : 'yellow'}">팀 대기 영향 ${w.waitImpactMeasured ? `${w.waitingOnMeCount}건` : '미측정'}</span> <span class="pill gray">${esc(w.teams.join('·'))}</span></h2>
      <div class="bar-legend">열린 자식 일감 ${w.count}건</div>
      ${w.waitingTasks?.length ? `<h3>이 작업을 기다리는 후속 일감</h3>${w.waitingTasks.map(t => `<div class="task-line"><span>[${esc(t.project)}] ${esc(t.title)}</span><span class="who">${esc((t.assignees || []).join(', '))}</span></div>`).join('')}` : ''}
      <h3>담당 자식 일감</h3>
      ${w.tasks.slice(0, 10).map(t => `<div class="task-line"><span>[${esc(t.project)}] <a href="${esc(t.url || '#')}" target="_blank">${esc(t.title)}</a> ${pill(t.status)}</span><span class="due ${t.due && t.due.slice(0, 10) < today ? 'overdue' : ''}">${esc(t.due?.slice(0, 10) || '')}</span></div>`).join('')}
      ${w.tasks.length > 10 ? `<div class="bar-legend">외 ${w.tasks.length - 10}건…</div>` : ''}
    </div>`).join('') + `</div>`;
}

function renderFeed() {
  const highlights = (D.ai?.projects || []).filter(p => p.highlights?.length);
  $('#tab-feed').innerHTML = `
    ${highlights.length ? `<div class="card" style="margin-bottom:14px"><h2>💬 슬랙 · 회의 하이라이트</h2>${highlights.map(p => `<h3>${esc(p.name)}</h3><ul>${p.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>`).join('')}</div>` : ''}
    <div class="card">
      <h2>📅 최근 회의록</h2>
      ${D.meetings.length ? D.meetings.map(m => `<div class="feed-item"><span class="date">${esc(m.date?.slice(0, 10) || '')}</span><span class="proj">${esc(m.project)}</span><a href="${esc(m.url)}" target="_blank">${esc(m.title)}</a></div>`).join('') : '<div class="summary">최근 14일 회의록 없음</div>'}
    </div>`;
}

// ---------- 탭 & 새로고침 ----------
document.querySelectorAll('#tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
    $(`#tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

$('#refreshBtn').addEventListener('click', async () => {
  await fetch('/api/refresh', { method: 'POST' });
  pollStatus();
});

let pollTimer = null;
async function pollStatus() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const s = await (await fetch('/api/status')).json();
    $('#refreshBtn').disabled = s.collecting;
    $('#collectState').textContent = s.collecting ? '수집 중…' :
      (s.last?.state === 'error' ? `수집 실패: ${s.last.error || ''}` : '');
    if (!s.collecting) {
      clearInterval(pollTimer);
      load();
    }
  }, 2000);
}

async function load() {
  const res = await fetch('/api/dashboard');
  if (!res.ok) { $('#empty').classList.remove('hidden'); return; }
  D = await res.json();
  $('#empty').classList.add('hidden');
  render();
}

load();
pollStatus();
