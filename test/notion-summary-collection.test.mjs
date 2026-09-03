import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSummaryRows } from '../lib/notion-collector.mjs';

function richText(value) {
  return { type: 'rich_text', rich_text: value ? [{ plain_text: value }] : [] };
}

function page(id, project, editedAt, runId = '') {
  return {
    id,
    url: `https://notion.test/${id}`,
    created_time: editedAt,
    last_edited_time: editedAt,
    properties: {
      프로젝트명: richText(project),
      run_id: richText(runId),
    },
  };
}

test('Given many summary pages, When their bodies are hydrated, Then only the latest overall page is read for the integrated JSON', async () => {
  const bodyReads = [];
  const analysis = JSON.stringify({ overall: {}, projects: [] });
  const rows = await collectSummaryRows(
    { notion: { summaryDbId: 'summary-db' } },
    [],
    '2026-08-20T00:00:00.000Z',
    {
      querySummaryDatabase: async () => [
        page('snapshot', '대시보드 스냅샷', '2026-09-03T01:00:00.000Z', 'dashboard-snapshot:2026-09-03'),
        page('project', '피자레디', '2026-09-03T02:00:00.000Z', '2026-09-03-morning'),
        page('overall-old', '전체', '2026-09-02T02:00:00.000Z', '2026-09-02-morning'),
        page('overall-new', '전체', '2026-09-03T02:00:00.000Z', '2026-09-03-morning'),
      ],
      retrieveSummaryBlocks: async id => {
        bodyReads.push(id);
        return [{ type: 'code', code: { rich_text: [{ plain_text: analysis }] } }];
      },
    },
  );

  assert.deepEqual(bodyReads, ['overall-new']);
  assert.equal(rows.find(row => row._id === 'overall-new')['분석 결과 JSON'], analysis);
  assert.equal(rows.find(row => row._id === 'project')['분석 결과 JSON'], undefined);
});

test('Given summary body hydration is disabled, When rows are collected for a bounded refresh, Then no page body is read', async () => {
  let bodyReads = 0;
  await collectSummaryRows(
    { notion: { summaryDbId: 'summary-db' } },
    [],
    undefined,
    {
      hydrateSummaryBodies: false,
      querySummaryDatabase: async () => [page('overall', '전체', '2026-09-03T02:00:00.000Z')],
      retrieveSummaryBlocks: async () => { bodyReads += 1; return []; },
    },
  );

  assert.equal(bodyReads, 0);
});
