import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectOperations } from '../lib/project-operations.mjs';

test('Given recent project Slack lifecycle messages, When operations are built, Then build QA release and data evidence are classified', () => {
  const messages = [
    ['2026-09-04T09:00:00.000Z', 'SP3 업로드 빌드 공유 완료 · APK와 TestFlight 전달'],
    ['2026-09-04T10:00:00.000Z', 'Fun QA 및 디렉터 리뷰 진행 후 검수 예정'],
    ['2026-09-04T11:00:00.000Z', 'AOS 마켓 업로드 완료, iOS 자동 출시'],
    ['2026-09-04T12:00:00.000Z', 'CPI 테스트 결과 지표와 이벤트 로그 확인'],
  ].map(([time, text], index) => ({ time, text, url: `https://slack.test/${index}` }));
  const operations = buildProjectOperations([{ channel: 's2_forge_and_fortune', messages }]);

  assert.ok(operations.latestBuild);
  assert.ok(operations.latestQa);
  assert.ok(operations.latestRelease);
  assert.ok(operations.latestData);
  assert.ok(operations.evidenceCount >= 4);
  assert.equal(operations.evidence.every(item => item.evidenceRole === 'project_operation'), true);
});
