import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { publishAgentInputToNotion } from '../lib/notion-agent-handoff.mjs';
import {
  analysisErrors,
  analysisWarnings,
  morningRunId,
  readAgentInput,
  saveAnalysis,
  schemaErrors,
} from '../lib/agent-routine.mjs';

const RUN_ID = '2026-09-29-morning';
const permissiveSchema = { type: 'object' };

// In-memory summary DB that returns pages in the Notion API read shape.
function notionStore() {
  const pages = [];
  let nextId = 0;
  let nextBlock = 0;
  const readProperty = value => {
    if (value.title) return { type: 'title', title: value.title.map(item => ({ ...item, plain_text: item.text.content })) };
    if (value.rich_text) return { type: 'rich_text', rich_text: value.rich_text.map(item => ({ ...item, plain_text: item.text.content })) };
    if ('select' in value) return { type: 'select', select: value.select };
    if ('date' in value) return { type: 'date', date: value.date };
    if ('number' in value) return { type: 'number', number: value.number };
    return value;
  };
  const readBlock = block => block.type === 'code' ? {
    ...block,
    code: {
      ...block.code,
      rich_text: block.code.rich_text.map(item => ({ ...item, plain_text: item.text.content })),
      caption: block.code.caption.map(item => ({ ...item, plain_text: item.text.content })),
    },
  } : block;
  const readPage = page => ({
    id: page.id, url: page.url, created_time: page.created, last_edited_time: page.created,
    properties: Object.fromEntries(Object.entries(page.properties).map(([key, value]) => [key, readProperty(value)])),
  });
  const text = (page, name) => (page.properties[name]?.rich_text || page.properties[name]?.title || []).map(item => item.text.content).join('');
  return {
    pages,
    query: async (_databaseId, filter) => pages
      .filter(page => filter.rich_text ? text(page, filter.property) === filter.rich_text.equals : text(page, filter.property) === filter.title.equals)
      .map(readPage),
    create: async (_databaseId, properties, children) => {
      const id = `page-${++nextId}`;
      pages.push({ id, url: `https://www.notion.so/${id}`, created: '2026-09-29T00:00:00.000Z', properties: structuredClone(properties), blocks: structuredClone(children).map(block => ({ ...block, id: `block-${++nextBlock}` })) });
      return { id, url: `https://www.notion.so/${id}` };
    },
    update: async (pageId, properties) => { Object.assign(pages.find(page => page.id === pageId).properties, structuredClone(properties)); },
    listChildren: async pageId => structuredClone(pages.find(page => page.id === pageId).blocks).map(readBlock),
    append: async (pageId, children) => {
      pages.find(page => page.id === pageId).blocks.push(...structuredClone(children).map(block => ({ ...block, id: `block-${++nextBlock}` })));
    },
    remove: async blockId => { for (const page of pages) page.blocks = page.blocks.filter(block => block.id !== blockId); },
  };
}

function project(id, name, rows = 0) {
  return {
    id, name, sprintRequired: true, currentSprints: [],
    ruleAuditFormat: { columns: ['itemLevel', 'status'] },
    ruleAuditItems: Array.from({ length: rows }, (_, index) => [index % 2, index % 5]),
    analysisTargets: [],
    specCatalogFormat: { columns: ['specId', 'title'] },
    specCatalog: [[`${id}-spec-1`, '광산 외형'], [`${id}-spec-2`, '온보딩']],
    sourceEvidence: Array.from({ length: rows }, (_, index) => [`${id}-spec-1`, 'slack', '2026-09-28', `근거 ${index}`, 'x'.repeat(40), null, null, 'recent_execution']),
    previousSummary: null,
  };
}

function packet(rows = 0) {
  return {
    schemaVersion: '1.0', runId: RUN_ID, generatedAt: '2026-09-29T07:30:00+09:00',
    outputSchema: permissiveSchema, sourceHealth: null,
    rules: { metrics: { overdueWorkItems: 1 }, deltas: [] },
    projects: [project('forge', '포지 앤 포춘', rows), project('pizza', '피자레디', rows)],
  };
}

function analysis(overrides = {}) {
  const briefing = { currentProgress: '진행', currentProgressItems: ['광산 외형 — 진행 중 (Notion 기준)'], buildRelease: null, data: null, nextActions: [], evidence: [], confidenceLimits: [] };
  const projectResult = (id, name) => ({
    name, summary: `${name} 요약`, projectBriefing: briefing, sprintSummaries: [], blockers: [], sourceConflicts: [], nextActions: [], confidenceLimits: [],
    specSummaries: [`${id}-spec-1`, `${id}-spec-2`].map(specId => ({ specId })),
  });
  return {
    schemaVersion: '1.0', runId: RUN_ID, generatedAt: '2026-09-29T08:10:00+09:00', analysisStatus: 'partial',
    sourceStatus: {}, sourceComparison: { status: 'partial' }, ruleMetrics: {},
    overall: { summary: '전체 요약', summaryItems: ['두 프로젝트 모두 다음 빌드 준비 중'], topRisks: [], decisionsForCEO: [], changesSinceYesterday: [], sourceConflicts: [], confidenceLimits: ['회의록 일부 미검토'] },
    projects: [projectResult('forge', '포지 앤 포춘'), projectResult('pizza', '피자레디')],
    ...overrides,
  };
}

test('Given a sharded rule input, When the routine reads it, Then the original packet is rebuilt exactly', async () => {
  const store = notionStore();
  const original = packet(900);
  const published = await publishAgentInputToNotion({ databaseId: 'db', packet: original, ...store });
  assert.ok(published.partCount > 1);

  const { input, provenance } = await readAgentInput({ databaseId: 'db', runId: RUN_ID, deps: store });

  assert.deepEqual(input, original);
  assert.equal(provenance.format, 'manifest-v1');
  assert.equal(provenance.parts.length, published.partCount);
});

test('Given a small single-page input, When the routine reads it, Then the legacy page is accepted', async () => {
  const store = notionStore();
  await publishAgentInputToNotion({ databaseId: 'db', packet: packet(0), ...store });
  const { input, provenance } = await readAgentInput({ databaseId: 'db', runId: RUN_ID, deps: store });
  assert.equal(provenance.format, 'single');
  assert.deepEqual(input, packet(0));
});

test('Given no input page for the day, When the routine reads, Then it reports not_available', async () => {
  await assert.rejects(readAgentInput({ databaseId: 'db', runId: RUN_ID, deps: notionStore() }), { code: 'not_available' });
});

test('Given a manifest still publishing, When the routine reads, Then it reports not_ready', async () => {
  const store = notionStore();
  await publishAgentInputToNotion({ databaseId: 'db', packet: packet(900), ...store });
  const root = store.pages.find(page => page.properties.run_id.rich_text[0].text.content === `rule-input:${RUN_ID}`);
  const block = root.blocks.find(item => item.type === 'code');
  const body = JSON.parse(block.code.rich_text.map(item => item.text.content).join(''));
  body.packet.status = 'publishing';
  block.code.rich_text = [{ type: 'text', text: { content: JSON.stringify(body) } }];
  const pointer = JSON.parse(root.properties.payload.rich_text[0].text.content);
  root.properties.payload.rich_text = [{ type: 'text', text: { content: JSON.stringify({ ...pointer, status: 'publishing' }) } }];

  await assert.rejects(readAgentInput({ databaseId: 'db', runId: RUN_ID, deps: store }), { code: 'not_ready' });
});

test('Given a part page whose rows were cut, When the routine reads, Then the input is rejected as invalid', async () => {
  const store = notionStore();
  await publishAgentInputToNotion({ databaseId: 'db', packet: packet(900), ...store });
  const part = store.pages.find(page => page.properties.run_id.rich_text[0].text.content.startsWith('rule-input-part:'));
  const block = part.blocks.find(item => item.type === 'code');
  const body = JSON.parse(block.code.rich_text.map(item => item.text.content).join(''));
  body.projects[0].sections[0].items.pop();
  block.code.rich_text = [{ type: 'text', text: { content: JSON.stringify(body) } }];

  await assert.rejects(readAgentInput({ databaseId: 'db', runId: RUN_ID, deps: store }), { code: 'invalid' });
});

test('Given a valid analysis, When it is saved, Then overall and project pages are readable by the dashboard parser', async () => {
  const store = notionStore();
  await publishAgentInputToNotion({ databaseId: 'db', packet: packet(900), ...store });
  const { input, provenance } = await readAgentInput({ databaseId: 'db', runId: RUN_ID, deps: store });

  const result = await saveAnalysis({ databaseId: 'db', runId: RUN_ID, analysis: analysis(), input, provenance, deps: store, now: '2026-09-29T00:00:00Z' });

  assert.deepEqual(result.pages.map(page => [page.name, page.status]), [['전체', 'created'], ['포지 앤 포춘', 'created'], ['피자레디', 'created']]);
  const overall = store.pages.find(page => page.properties.run_id.rich_text[0].text.content === `analysis:${RUN_ID}:overall`);
  assert.equal(overall.properties.이름.title[0].text.content, '전체 / 2026-09-29');
  assert.equal(overall.properties.상태.select.name, 'partial');

  const again = await saveAnalysis({ databaseId: 'db', runId: RUN_ID, analysis: analysis({ generatedAt: '2026-09-29T08:20:00+09:00' }), input, provenance, deps: store, now: '2026-09-29T00:00:00Z' });
  assert.ok(again.pages.every(page => page.status === 'updated'));
  assert.equal(overall.blocks.filter(block => block.type === 'code').length, 1);
});

test('Given an existing page with the same title from the previous agent, When saving, Then that page is updated instead of duplicated', async () => {
  const store = notionStore();
  await publishAgentInputToNotion({ databaseId: 'db', packet: packet(0), ...store });
  const { input, provenance } = await readAgentInput({ databaseId: 'db', runId: RUN_ID, deps: store });
  await store.create('db', { 이름: { title: [{ type: 'text', text: { content: '포지 앤 포춘 / 2026-09-29' } }] }, run_id: { rich_text: [{ type: 'text', text: { content: 'analysis:2026-09-29-morning:forge-and-fortune' } }] } }, [
    { object: 'block', type: 'code', code: { language: 'json', rich_text: [{ type: 'text', text: { content: '{}' } }], caption: [] } },
  ]);

  await saveAnalysis({ databaseId: 'db', runId: RUN_ID, analysis: analysis(), input, provenance, deps: store, now: '2026-09-29T00:00:00Z' });

  const forgePages = store.pages.filter(page => page.properties.이름?.title?.[0]?.text.content === '포지 앤 포춘 / 2026-09-29');
  assert.equal(forgePages.length, 1);
  assert.equal(forgePages[0].blocks.filter(block => block.type === 'code').length, 1);
});

test('Given the input was republished during analysis, When saving, Then nothing is written', async () => {
  const store = notionStore();
  await publishAgentInputToNotion({ databaseId: 'db', packet: packet(900), ...store });
  const { input, provenance } = await readAgentInput({ databaseId: 'db', runId: RUN_ID, deps: store });
  await publishAgentInputToNotion({ databaseId: 'db', packet: { ...packet(901), generatedAt: '2026-09-29T08:00:00+09:00' }, ...store });
  const before = store.pages.length;

  await assert.rejects(saveAnalysis({ databaseId: 'db', runId: RUN_ID, analysis: analysis({ generatedAt: '2026-09-29T08:30:00+09:00' }), input, provenance, deps: store }), /규칙 입력이 바뀌었습니다/);
  assert.equal(store.pages.length, before);
});

test('Given analyses that break the day contract, When validated, Then each problem is reported', () => {
  const input = packet(0);
  assert.deepEqual(analysisErrors({ analysis: analysis(), input, runId: RUN_ID }), []);
  const broken = analysis({ runId: `rule-input:${RUN_ID}`, analysisStatus: 'failed', generatedAt: '2026-09-29T07:00:00+09:00' });
  broken.projects = broken.projects.slice(0, 1);
  broken.projects[0] = { ...broken.projects[0], specSummaries: [{ specId: 'forge-spec-1' }] };
  delete broken.projects[0].projectBriefing;
  const errors = analysisErrors({ analysis: broken, input, runId: RUN_ID }).join('\n');
  for (const expected of ['runId는 접두사 없이', 'failed 결과는 저장하지 않습니다', 'generatedAt', '프로젝트 목록 불일치', 'projectBriefing 누락', '1:1이 아닙니다']) {
    assert.match(errors, new RegExp(expected));
  }
});

test('Given the real output schema, When an incomplete analysis is validated, Then required fields and $ref items are checked', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/agent-analysis.schema.json', import.meta.url), 'utf8'));
  const errors = schemaErrors(schema, { runId: RUN_ID, extra: true });
  assert.ok(errors.some(error => error.includes('$.overall: 필수 필드 누락')));
  assert.ok(errors.some(error => error.includes('$.extra: 스키마에 없는 필드')));
  const evidenceErrors = schemaErrors({ $defs: schema.$defs, $ref: '#/$defs/evidenceItem' }, { source: 'fax', timestamp: null, url: null, excerpt: '' });
  assert.ok(evidenceErrors.some(error => error.includes('허용값')));
});

test('Given a time in Seoul morning, When the run id is derived, Then it uses the Seoul date', () => {
  assert.equal(morningRunId(new Date('2026-09-28T23:00:00Z')), '2026-09-29-morning');
});

const bulletSchema = {
  type: 'object',
  properties: {
    overall: { type: 'object', properties: { summaryItems: { type: 'array' } } },
    projects: { type: 'array', items: { type: 'object', properties: { projectBriefing: { type: 'object', properties: { currentProgressItems: { type: 'array' } } } } } },
  },
};

test('Given an input published before the bullet schema, When an analysis without items is validated, Then items are not demanded', () => {
  const plain = analysis();
  plain.projects = plain.projects.map(project => ({ ...project, projectBriefing: { ...project.projectBriefing, currentProgressItems: undefined } }));
  delete plain.overall.summaryItems;
  assert.deepEqual(analysisErrors({ analysis: JSON.parse(JSON.stringify(plain)), input: packet(0), runId: RUN_ID }), []);
});

test('Given an analysis without bullet items, When validated, Then the missing itemised fields are errors', () => {
  const input = { ...packet(0), outputSchema: bulletSchema };
  const broken = analysis();
  broken.projects[0] = { ...broken.projects[0], projectBriefing: { ...broken.projects[0].projectBriefing, currentProgressItems: [] } };
  delete broken.overall.summaryItems;
  const errors = analysisErrors({ analysis: broken, input, runId: RUN_ID }).join('\n');
  assert.match(errors, /포지 앤 포춘: 개조식 currentProgressItems 누락/);
  assert.match(errors, /overall.summaryItems 누락/);
});

test('Given active specs collapsed into a vague phrase, When warnings are computed, Then only the unnamed active specs are listed', () => {
  const input = packet(0);
  input.projects[1].specCatalogFormat = { columns: ['specId', 'title', 'sprint', 'status'] };
  input.projects[1].specCatalog = [
    ['a', '광고제거 상품 분리 (A/B 테스트) ', 'Sprint61', '진행 예정'],
    ['b', '부족 재화 RV 팝업', 'Sprint61', '진행 예정'],
    ['c', '5배 바닥형 RV 장갑,신발 버전', 'Sprint61', '진행 중'],
    ['d', '버프형 직원 개발', null, '시작 전'],
  ];
  const result = analysis();
  result.projects[1] = { ...result.projects[1], projectBriefing: { ...result.projects[1].projectBriefing, currentProgressItems: ['Sprint61: 광고제거 상품 분리(A/B) 진행 예정, 여러 RV 지면'] } };

  const warnings = analysisWarnings({ analysis: result, input });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /피자레디: .*2건/);
  assert.match(warnings[0], /부족 재화 RV 팝업 \(Sprint61, 진행 예정\)/);
  assert.match(warnings[0], /5배 바닥형 RV 장갑,신발 버전 \(Sprint61, 진행 중\)/);
  assert.doesNotMatch(warnings[0], /광고제거|버프형 직원/);
});
