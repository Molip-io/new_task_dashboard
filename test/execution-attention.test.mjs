import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyExecutionAttention } from '../lib/execution-attention.mjs';

const cases = [
  ['dependency', '보안 승인 대기 때문에 후속 개발이 중단됐습니다.'],
  ['schedule', '리소스 제작 지연으로 다음 빌드 일정에 영향이 있습니다.'],
  ['scope', '보상 정책 범위가 미확정이라 제작 기준을 정하지 못했습니다.'],
  ['quality', 'QA 검증이 반복 실패해 재작업이 필요합니다.'],
  ['handoff', '기획과 개발 사이 협업 방식 개선이 필요합니다.'],
  ['technical', '결제 서버 연동 오류로 테스트가 불가합니다.'],
];

for (const [type, statement] of cases) {
  test(`Given a source-backed ${type} issue, When execution attention is classified, Then it uses the shared ${type} category`, () => {
    const result = classifyExecutionAttention(statement);

    assert.equal(result.type, type);
    assert.ok(result.action.length > 20);
  });
}

test('Given an improvement idea without execution impact, When execution attention is classified, Then it is not promoted', () => {
  const result = classifyExecutionAttention('새로운 보상 연출 아이디어를 제안합니다.');

  assert.equal(result, null);
});

test('Given gameplay text that describes an in-game bottleneck, When execution attention is classified, Then it is not mistaken for a team blocker', () => {
  const result = classifyExecutionAttention('플레이어가 광석 직원의 빈손 대기와 재고 병목을 해소하도록 행동을 추천합니다.');

  assert.equal(result, null);
});

test('Given a product feature that was deliberately deferred, When execution attention is classified, Then the settled deferral is not treated as an unresolved dependency', () => {
  const result = classifyExecutionAttention('채굴 자동화는 직접 채굴 재미 검증을 위해 후순위로 보류했습니다.');

  assert.equal(result, null);
});

test('Given a product description that explains how to resolve in-game delay, When execution attention is classified, Then it is not treated as a team schedule risk', () => {
  const result = classifyExecutionAttention('재료 공급 지연 해소: 플레이어에게 광석 직원 업그레이드를 추천합니다.');

  assert.equal(result, null);
});

test('Given a confirmed implementation choice with an optional follow-up scope, When execution attention is classified, Then it is not treated as approval waiting', () => {
  const result = classifyExecutionAttention('이벤트 페이지 제작 방식은 2D 베이스로 확정했고 3D는 필요한 범위만 검토합니다.');

  assert.equal(result, null);
});

test('Given a sentence where customer waiting is a gameplay topic after a decision list, When execution attention is classified, Then lexical proximity does not create a dependency', () => {
  const result = classifyExecutionAttention('결정된 작업을 공유했고 미결정 사항은 고객 대기 구조와 카메라 줌입니다.');

  assert.equal(result, null);
});

test('Given a technical issue that is described as work currently being fixed without execution impact, When execution attention is classified, Then it is not promoted as a blocker', () => {
  const result = classifyExecutionAttention('온보딩 흐름과 UI 연동 오류 등 세부 이슈를 수정하는 단계입니다.');

  assert.equal(result, null);
});

test('Given a prerequisite explicitly required before work starts, When execution attention is classified, Then it remains a dependency', () => {
  const result = classifyExecutionAttention('작업 전 과자 장식 비율 기준 확정이 필요합니다.');

  assert.equal(result.type, 'dependency');
});

test('Given a previously failing issue that is now resolved, When execution attention is classified, Then it is not promoted as current risk', () => {
  const result = classifyExecutionAttention('QA 검증 실패는 수정 완료되어 정상화됐습니다.');

  assert.equal(result, null);
});
