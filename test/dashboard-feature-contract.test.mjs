import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const prototypePath = '/Users/molip/.gstack/projects/newtaskdashboard/designs/decision-dashboard-20260714/finalized.html';
const designPath = new URL('../DESIGN.md', import.meta.url);
const prototype = fs.readFileSync(prototypePath, 'utf8');
const design = fs.readFileSync(designPath, 'utf8');

test('Given the executive briefing, When reading its sections, Then decision, blockage, and delta appear in order', () => {
  const decision = prototype.indexOf('>오늘 결정할 것<');
  const blocked = prototype.indexOf('>현재 막힌 것<');
  const changed = prototype.indexOf('>어제와 달라진 것<');

  assert.ok(decision >= 0);
  assert.ok(blocked > decision);
  assert.ok(changed > blocked);
});

test('Given incomplete dependency data, When showing trust, Then the dashboard refuses a no-bottleneck conclusion', () => {
  assert.match(prototype, /의존관계 미측정/);
  assert.match(prototype, /‘병목 없음’으로 해석하지 않습니다/);
  assert.match(prototype, /Notion 성공/);
  assert.match(prototype, /Slack 4\/4/);
  assert.match(prototype, /회의록 성공/);
});

test('Given no prior snapshot, When rendering deltas, Then the dashboard shows an explicit empty state', () => {
  assert.match(prototype, /전일 스냅샷이 없어 확정 변화를 표시하지 않습니다/);
  assert.doesNotMatch(prototype, /<span class="delta-kind done">포지 7\/14/);
});

test('Given a read-only dashboard, When rendering decisions, Then no decision recording control exists', () => {
  assert.doesNotMatch(prototype, /<button[^>]+class="[^"]*record/);
  assert.match(prototype, /이 화면에서는 결정을 저장하지 않습니다/);
});

test('Given the people view, When explaining priority, Then waiting impact outranks task count', () => {
  assert.match(prototype, /<th>팀 대기 영향<\/th>/);
  assert.match(prototype, /기본 정렬은 ‘내 작업을 기다리는 확인된 후속 작업 수’/);
  assert.match(prototype, /관계 미측정/);
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
