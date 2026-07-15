import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const prototypePath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);
const designPath = new URL('../DESIGN.md', import.meta.url);
const prototype = fs.readFileSync(prototypePath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const design = fs.readFileSync(designPath, 'utf8');

test('Given the executive briefing, When reading its sections, Then decision, blockage, and delta appear in order', () => {
  const decision = app.indexOf('1. 대표가 확인할 판단');
  const blocked = app.indexOf('2. 현재 관리상 막힌 것');
  const changed = app.indexOf('3. 어제와 달라진 것');

  assert.ok(decision >= 0);
  assert.ok(blocked > decision);
  assert.ok(changed > blocked);
});

test('Given incomplete dependency data, When showing trust, Then the dashboard refuses a no-bottleneck conclusion', () => {
  assert.match(app, /이 화면을 믿을 수 있는 범위/);
  assert.match(app, /Notion 설정 확인/);
  assert.match(app, /Git 저장소 미설정/);
});

test('Given no prior snapshot, When rendering deltas, Then the dashboard shows an explicit empty state', () => {
  assert.match(app, /snapshotComparison\?\.reason/);
});

test('Given a read-only dashboard, When rendering decisions, Then no decision recording control exists', () => {
  assert.doesNotMatch(prototype, /결정 저장/);
  assert.match(app, /이 화면은 읽기 전용입니다/);
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
