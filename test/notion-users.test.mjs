import assert from 'node:assert/strict';
import test from 'node:test';
import { removeIgnoredAssignees } from '../lib/notion-users.mjs';

test('Given an ignored former employee and an active user, When assignees are normalized, Then only the active user remains', () => {
  const result = removeIgnoredAssignees([
    { id: 'former-user', name: null },
    { id: 'active-user', name: '행크' },
  ], new Set(['former-user']));

  assert.deepEqual(result, { names: ['행크'], users: [{ id: 'active-user', name: '행크' }], removedCount: 1 });
});

test('Given only an ignored assignee, When the task is active, Then the task remains with an empty assignee list', () => {
  const result = removeIgnoredAssignees([{ id: 'former-user', name: null }], new Set(['former-user']));

  assert.deepEqual(result.names, []);
  assert.equal(result.removedCount, 1);
});
