import assert from 'node:assert/strict';
import test from 'node:test';
import { aiEnrich, buildSummaryPrompt, requestOpenAISummary } from '../lib/ai-summary.mjs';

const dashboard = {
  generatedAt: '2026-07-15T07:30:00.000Z',
  projects: [{
    name: '피자레디',
    stats: { total: 2, done: 1, completionRate: 50 },
    overdueTasks: [],
    activeTasks: [{ title: 'QA', status: '진행 중', assignees: ['행크'], due: '2026-07-23' }],
    notionSummary: { status: '주의' },
    meetings: [{ date: '2026-07-14', title: 'QA 회의' }],
  }],
  workItems: [
    { project: '피자레디', sprint: 'Sprint60', status: '완료', overdueDays: 0 },
    { project: '피자레디', sprint: 'Sprint60', status: '진행 중', overdueDays: 2 },
  ],
  slack: {
    피자레디: [{ channel: 's2_pizzaready', messages: [{ time: '2026-07-14T09:00:00.000Z', user: '행크', text: 'QA 기간 유지' }] }],
  },
};

test('Given dashboard facts, When the legacy prompt is built, Then Notion, meeting, and Slack evidence remain in its input', () => {
  const prompt = buildSummaryPrompt(dashboard);

  assert.match(prompt, /피자레디/);
  assert.match(prompt, /QA 회의/);
  assert.match(prompt, /QA 기간 유지/);
  assert.match(prompt, /상태를 새로 판정하거나/);
  assert.match(prompt, /gitCommits/);
  assert.match(prompt, /sourceConflicts/);
  assert.match(prompt, /직접 모순/);
  const input = JSON.parse(prompt.split('## 입력 데이터\n')[1]);
  assert.equal(input.projects[0].stats, undefined);
  assert.equal(input.projects[0].sprints[0].completionRate, 50);
});

test('Given a runner that returns fenced JSON, When AI enrichment completes, Then the parsed object is returned', async () => {
  const expected = { overall: { summary: '요약' }, projects: [] };

  const result = await aiEnrich(dashboard, async () => `결과\n\`\`\`json\n${JSON.stringify(expected)}\n\`\`\``);

  assert.deepEqual(result, expected);
});

test('Given an OpenAI API key, When GPT summary is requested, Then Responses API receives a strict dashboard schema without storing company data', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ output_text: '{"overall":{"summary":"요약"},"projects":[]}' }) };
  };

  const output = await requestOpenAISummary('통합 데이터', {
    apiKey: 'test-key', model: 'gpt-test', fetchImpl,
  });
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(body.model, 'gpt-test');
  assert.equal(body.input, '통합 데이터');
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.schema.required.includes('overall'), true);
  assert.equal(output, '{"overall":{"summary":"요약"},"projects":[]}');
});

test('Given no OpenAI API key, When GPT summary is requested, Then configuration guidance is explicit', async () => {
  await assert.rejects(
    requestOpenAISummary('통합 데이터', { apiKey: '', fetchImpl: async () => assert.fail('API must not be called') }),
    /OPENAI_API_KEY 없음/,
  );
});

test('Given an OpenAI API error, When GPT summary is requested, Then the provider message remains actionable', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'Incorrect API key provided' } }),
  });

  await assert.rejects(
    requestOpenAISummary('통합 데이터', { apiKey: 'bad-key', fetchImpl }),
    /OpenAI API 실패\(401\): Incorrect API key provided/,
  );
});
