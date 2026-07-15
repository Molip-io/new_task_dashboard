import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectWorkDatabaseSetup } from '../lib/notion-setup.mjs';

test('Given a work database with required properties, When setup is inspected, Then it is reported as ready', () => {
  const setup = inspectWorkDatabaseSetup([{
    id: 'db',
    title: '피자레디 작업 현황',
    properties: Object.fromEntries(['작업', 'Status', '팀', '담당자', '상위 항목', '기간', '완료일', '프로젝트', '스프린트'].map(name => [name, {}])),
  }]);

  assert.equal(setup.ready, true);
  assert.deepEqual(setup.databases[0].missingProperties, []);
});

test('Given a work database without completion and sprint fields, When setup is inspected, Then missing properties are explicit', () => {
  const setup = inspectWorkDatabaseSetup([{
    id: 'db',
    title: '작업 현황',
    properties: { 작업: {}, Status: {}, 팀: {}, 담당자: {}, '상위 항목': {}, 기간: {}, 프로젝트: {} },
  }]);

  assert.equal(setup.ready, false);
  assert.deepEqual(setup.databases[0].missingProperties, ['완료일', '스프린트']);
});
