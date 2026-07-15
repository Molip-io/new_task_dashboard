import assert from 'node:assert/strict';
import test from 'node:test';
import { aiEnrich, buildLegacySummaryPrompt } from '../lib/legacy-ai-summary.mjs';

const dashboard = {
  generatedAt: '2026-07-15T07:30:00.000Z',
  projects: [{
    name: '피자레디',
    stats: { total: 2, done: 1 },
    overdueTasks: [],
    activeTasks: [{ title: 'QA', status: '진행 중', assignees: ['행크'], due: '2026-07-23' }],
    notionSummary: { status: '주의' },
    meetings: [{ date: '2026-07-14', title: 'QA 회의' }],
  }],
  slack: {
    피자레디: [{ channel: 's2_pizzaready', messages: [{ time: '2026-07-14T09:00:00.000Z', user: '행크', text: 'QA 기간 유지' }] }],
  },
};

test('Given dashboard facts, When the legacy prompt is built, Then Notion, meeting, and Slack evidence remain in its input', () => {
  const prompt = buildLegacySummaryPrompt(dashboard);

  assert.match(prompt, /피자레디/);
  assert.match(prompt, /QA 회의/);
  assert.match(prompt, /QA 기간 유지/);
  assert.match(prompt, /상태를 변경하지 말고/);
});

test('Given a runner that returns fenced JSON, When AI enrichment completes, Then the parsed object is returned', async () => {
  const expected = { overall: { summary: '요약' }, projects: [] };

  const result = await aiEnrich(dashboard, async () => `결과\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\``);

  assert.deepEqual(result, expected);
});
