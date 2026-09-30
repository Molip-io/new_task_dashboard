import assert from 'node:assert/strict';
import test from 'node:test';
import { findUpdateGaps } from '../shared/rules/update-gaps.mjs';

const spec = (id, status, sprint) => ({ id, title: id, project: '포지 앤 포춘', parentIds: [], status, sprint });
const work = (id, specId, status, sprint, extra = {}) => ({ id, title: id, project: '포지 앤 포춘', parentIds: [specId], status, sprint, assignees: ['하티'], ...extra });

test('Given work left behind by its spec, When gaps are found, Then open items under closed specs and sprint mismatches are reported once each', () => {
  const tasks = [
    spec('done', '완료', '스프린트3'), work('left-open', 'done', '진행 중', '스프린트3', { url: 'https://notion.so/left-open', team: '개발' }), work('closed-too', 'done', '완료', '스프린트3'),
    spec('cancelled', '중단', '스프린트3'), work('not-cancelled', 'cancelled', '시작 전', '스프린트3'),
    spec('open', '진행 중', '스프린트4'), work('stale-tag', 'open', '진행 중', 'Sprint 3'), work('same-tag', 'open', '진행 중', 'Sprint4'), work('no-tag', 'open', '진행 중', null),
  ];

  const gaps = findUpdateGaps(tasks);

  assert.deepEqual(gaps.map(gap => [gap.workItemId, gap.kind]), [
    ['left-open', 'open-under-closed-spec'],
    ['not-cancelled', 'open-under-closed-spec'],
    ['stale-tag', 'sprint-mismatch'],
  ]);
  assert.deepEqual([gaps[0].url, gaps[0].team, gaps[0].assignees, gaps[0].specTitle, gaps[0].specStatus], ['https://notion.so/left-open', '개발', ['하티'], 'done', '완료']);
});
