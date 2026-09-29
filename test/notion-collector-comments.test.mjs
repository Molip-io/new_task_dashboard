import assert from 'node:assert/strict';
import test from 'node:test';
import { attachTaskComments } from '../lib/notion-collector.mjs';
import { isDelayCommentTarget } from '../lib/delay-comments.mjs';

const NOW = '2026-07-15T09:00:00+09:00';
const comment = (id, created_time, text, mentionedId) => ({
  id, created_time,
  rich_text: [{ type: 'text', plain_text: text }, ...(mentionedId ? [{ type: 'mention', plain_text: '@PD', mention: { type: 'user', user: { id: mentionedId } } }] : [])],
});
const overdue = { id: 'late', title: '지연', status: '진행 중', due: '2026-07-10' };

test('Given overdue and current tasks, When targets are chosen, Then only open items past their due date qualify', () => {
  assert.equal(isDelayCommentTarget(overdue, NOW), true);
  assert.equal(isDelayCommentTarget({ ...overdue, due: '2026-07-15' }, NOW), false);
  assert.equal(isDelayCommentTarget({ ...overdue, status: '완료' }, NOW), false);
  assert.equal(isDelayCommentTarget({ ...overdue, status: '중단' }, NOW), false);
  assert.equal(isDelayCommentTarget({ ...overdue, due: null }, NOW), false);
});

test('Given comments and replies around the due date, When an overdue task is read, Then only the recognition window is kept oldest first', async () => {
  const raw = [
    comment('old', '2026-06-20T09:00:00+09:00', '이전 지연 건'),
    comment('edge', '2026-07-03T00:30:00+09:00', '7/3 공유', 'pd-1'),
    comment('reply', '2026-07-09T11:00:00+09:00', '7/10 으로 변경'),
    comment('empty', '2026-07-09T12:00:00+09:00', ''),
  ];
  const task = await attachTaskComments({ ...overdue }, { checkDelay: true, delayTarget: true, retrieve: async () => raw });

  assert.equal(task.delayCommentCheck, 'checked');
  assert.deepEqual(task.delayComments.map(item => item.id), ['edge', 'reply']);
  assert.deepEqual(task.delayComments[0].mentionUserIds, ['pd-1']);
});

test('Given the comment request fails, When an overdue task is read, Then it is marked failed and the error is recorded', async () => {
  const errors = [];
  const task = await attachTaskComments({ ...overdue }, { checkDelay: true, delayTarget: true, retrieve: async () => { throw new Error('rate limit'); }, errors });
  assert.equal(task.delayCommentCheck, 'failed');
  assert.deepEqual(task.delayComments, []);
  assert.match(errors[0], /지연 댓글 지연: rate limit/);
});

test('Given comment reading is off or out of budget, When an overdue task is passed, Then it stays skipped without a request', async () => {
  let calls = 0;
  const task = await attachTaskComments({ ...overdue }, { checkDelay: false, delayTarget: true, retrieve: async () => { calls += 1; return []; } });
  assert.equal(task.delayCommentCheck, 'skipped');
  assert.equal(calls, 0);
});

test('Given a task that is not overdue, When it is passed, Then it is not applicable and needs no request', async () => {
  let calls = 0;
  const task = await attachTaskComments({ id: 'ok', status: '진행 중', due: '2026-07-30' }, { checkDelay: false, delayTarget: false, retrieve: async () => { calls += 1; return []; } });
  assert.equal(task.delayCommentCheck, 'not_applicable');
  assert.equal(calls, 0);
});

test('Given a confirmation-request task that is also overdue, When it is read, Then one request serves both checks', async () => {
  let calls = 0;
  const task = await attachTaskComments({ ...overdue, status: '확인 요청' }, {
    checkConfirmation: true, checkDelay: true, delayTarget: true,
    retrieve: async () => { calls += 1; return [comment('c', '2026-07-09T09:00:00+09:00', '7/10 으로 변경', 'pd-1')]; },
  });
  assert.equal(calls, 1);
  assert.equal(task.commentCheckAvailable, true);
  assert.deepEqual(task.commentMentionUserIds, ['pd-1']);
  assert.equal(task.delayComments.length, 1);
});
