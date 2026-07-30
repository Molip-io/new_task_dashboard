import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAnalysisJsonFromBlocks } from '../lib/notion-collector.mjs';

test('Given a Notion page with a dashboard JSON code block, When summary details are extracted, Then the machine-readable agent result is returned', () => {
  const payload = JSON.stringify({ overall: {}, projects: [] });
  const result = extractAnalysisJsonFromBlocks([
    { type: 'paragraph', paragraph: { rich_text: [{ plain_text: '설명' }] } },
    { type: 'code', code: { rich_text: [{ plain_text: payload }] } },
  ]);

  assert.equal(result, payload);
});

test('Given unrelated code blocks, When details are extracted, Then invalid JSON is ignored', () => {
  assert.equal(extractAnalysisJsonFromBlocks([{ type: 'code', code: { rich_text: [{ plain_text: 'npm test' }] } }]), null);
});
