import assert from 'node:assert/strict';
import test from 'node:test';
import { flatten } from '../lib/notion.mjs';

test('Given Notion relation properties, When a page is flattened, Then related page IDs are preserved', () => {
  const page = {
    id: 'task-1',
    url: 'https://notion.so/task-1',
    created_time: '2026-07-15T00:00:00.000Z',
    last_edited_time: '2026-07-15T01:00:00.000Z',
    properties: {
      '상위 항목': { type: 'relation', relation: [{ id: 'spec-1' }] },
      '선행 작업': { type: 'relation', relation: [{ id: 'task-0' }] },
    },
  };

  const result = flatten(page);

  assert.deepEqual(result['상위 항목'], ['spec-1']);
  assert.deepEqual(result['선행 작업'], ['task-0']);
});

test('Given Notion people properties, When a page is flattened, Then display names and stable user IDs are both preserved', () => {
  const row = flatten({
    id: 'page-1',
    properties: {
      담당자: { type: 'people', people: [{ id: 'user-1', name: '행크' }, { id: 'former-1', name: null }] },
    },
  });

  assert.deepEqual(row['담당자'], ['행크', 'former-1']);
  assert.deepEqual(row['담당자:users'], [{ id: 'user-1', name: '행크' }, { id: 'former-1', name: null }]);
});
