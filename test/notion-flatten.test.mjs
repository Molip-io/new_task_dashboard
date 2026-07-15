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
