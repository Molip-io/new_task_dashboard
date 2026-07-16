import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const prototypePath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);
const managementPath = new URL('../public/dashboard-management.js', import.meta.url);
const presentersPath = new URL('../public/dashboard-presenters.js', import.meta.url);
const designPath = new URL('../DESIGN.md', import.meta.url);
const prototype = fs.readFileSync(prototypePath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const management = fs.readFileSync(managementPath, 'utf8');
const presenters = fs.readFileSync(presentersPath, 'utf8');
const ui = `${app}\n${presenters}`;
const design = fs.readFileSync(designPath, 'utf8');

test('Given the executive briefing, When reading its sections, Then decision, blockage, and delta appear in order', () => {
  const decision = presenters.indexOf('1. 대표가 확인할 판단');
  const blocked = presenters.indexOf('2. 현재 관리상 막힌 것');
  const changed = presenters.indexOf('3. 어제와 달라진 것');

  assert.ok(decision >= 0);
  assert.ok(blocked > decision);
  assert.ok(changed > blocked);
});

test('Given incomplete dependency data, When showing trust, Then the dashboard refuses a no-bottleneck conclusion', () => {
  assert.match(app, /이 화면을 믿을 수 있는 범위/);
  assert.match(app, /Notion 설정 확인/);
  assert.match(management, /Git URL 미입력/);
});

test('Given no prior snapshot, When rendering deltas, Then the dashboard shows an explicit empty state', () => {
  assert.match(presenters, /snapshotComparison\?\.reason/);
});

test('Given a read-only dashboard, When rendering decisions, Then no decision recording control exists', () => {
  assert.doesNotMatch(prototype, /결정 저장/);
  assert.match(presenters, /이 화면은 읽기 전용입니다/);
});

test('Given the requested navigation and terminology, When rendering the dashboard, Then work items are consistent and waiting impact is removed', () => {
  for (const menu of ['브리핑', '프로젝트', '담당자', '확인필요']) assert.match(prototype, new RegExp(menu));
  assert.match(app, /작업항목/);
  assert.doesNotMatch(app, /열린 자식 일감|팀 대기 영향|waitingOnMe|waitImpact/);
});

test('Given the accepted review, When reading the design, Then all P0 requirements are normative', () => {
  for (const requirement of ['계획 대비 기준선', '의존관계 커버리지', '데이터 신선도', '전일 스냅샷']) {
    assert.match(design, new RegExp(`\\*\\*${requirement}\\*\\*`));
  }
  assert.match(design, /결정 안건 승격 규칙/);
  assert.match(design, /동일 ID와 동일 필드의 이전 값과 현재 값을 비교/);
  assert.doesNotMatch(design, /기본 정렬은 열린 자식 일감 수/);
  assert.doesNotMatch(design, /진행 중인데 7일간 편집 없음/);
});

test('Given the refined dashboard workflow, When reading the UI contract, Then projects group specs by sprint and people or checks do not expose completed work', () => {
  assert.match(app, /프로젝트 → 스프린트 → 스펙 → 작업항목/);
  assert.match(app, /<details class="sprint-group"/);
  assert.match(app, /data-project-card=/);
  assert.match(app, /data-people-filter="project"/);
  assert.match(app, /data-person-detail-filter="sprint"/);
  assert.match(app, /groupIssuesByProjectItem/);
  assert.match(app, /관리 확인/);
  assert.doesNotMatch(app, /Notion 갱신|최신화 필요/);
});

test('Given the simplified briefing, When reading its KPI contract, Then only four accessible drill-down metrics remain', () => {
  for (const detail of ['projects', 'work-items', 'overdue', 'guide']) assert.ok(presenters.includes(`kpi('${detail}'`));
  assert.match(app, /briefingDetail/);
  assert.match(app, /aria-expanded/);
  assert.doesNotMatch(presenters, /kpi\([^\n]*missingDateWorkItems|kpi\([^\n]*needsCheckProjects|kpi\([^\n]*recentGitProjects|kpi\([^\n]*gitNotionMismatchProjects/);
  assert.doesNotMatch(ui, /Notion 작업관리 상태|프로젝트별 관리 상태/);
});

test('Given management issues, When reading task and confirmation UI, Then actions and categories explain what to fix', () => {
  assert.match(app, /data-management-check/);
  assert.match(presenters, /권장 처리/);
  assert.match(app, /data-check-filter="category"/);
  for (const category of ['가이드 위반', '일정 위험', '데이터 불일치', '연동 문제']) assert.match(app, new RegExp(category));
  assert.match(app, /기한 초과는 일정 위험이며/);
});

test('Given Git collection health, When reading the trust line, Then it can open concrete repository details', () => {
  assert.match(app, /data-briefing-detail="git"/);
  for (const status of ['Git 인증 필요', 'Git URL 미입력', 'Git 부분 수집', 'Git 수집 실패', '최근 활동 없음']) {
    assert.match(`${app}\n${management}`, new RegExp(status));
  }
});
