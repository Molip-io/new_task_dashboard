import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSpecStatus } from '../public/spec-state.js';

const items = (...statuses) => statuses.map(status => ({ status }));

test('Given every work item is complete, When spec status is derived, Then the spec is complete', () => {
  assert.equal(deriveSpecStatus(items('완료', '완료')), '완료');
});

test('Given any work item is in progress, When spec status is derived, Then the spec is in progress', () => {
  assert.equal(deriveSpecStatus(items('시작 전', '진행 중', '진행 예정')), '진행 중');
  assert.equal(deriveSpecStatus(items('시작 전', '확인 요청')), '확인 요청');
  assert.equal(deriveSpecStatus(items('진행 예정', '확인 요청')), '확인 요청');
});

test('Given planned, before-start, and completed work without active work, When spec status is derived, Then planned is shown', () => {
  assert.equal(deriveSpecStatus(items('완료', '진행 예정')), '진행 예정');
  assert.equal(deriveSpecStatus(items('완료', '시작 전', '진행 예정')), '진행 예정');
});

test('Given completed and before-start work without planned or active work, When spec status is derived, Then completed is shown', () => {
  assert.equal(deriveSpecStatus(items('완료', '시작 전')), '완료');
});

test('Given planned work exists without progress or completion, When spec status is derived, Then the spec is planned', () => {
  assert.equal(deriveSpecStatus(items('시작 전', '진행 예정')), '진행 예정');
});

test('Given every work item is before start, When spec status is derived, Then the spec is before start', () => {
  assert.equal(deriveSpecStatus(items('시작 전', '시작 전')), '시작 전');
});
