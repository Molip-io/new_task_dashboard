import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_INPUT_PART_LIMIT,
  AGENT_INPUT_PART_MARKER,
  AGENT_INPUT_REMOTE_READABLE_LIMIT,
  publishAgentInputToNotion,
  remotePacketSize,
  validateAgentInputDeltas,
} from '../lib/notion-agent-handoff.mjs';

const packet = {
  schemaVersion: '1.0', runId: '2026-07-21-morning', generatedAt: '2026-07-21T07:30:00+09:00',
  projects: [{ id: 'project-1', name: '피자레디', analysisTargets: [] }],
  rules: { deltas: [] },
};

function notionStore() {
  const pages = [];
  let nextId = 0;
  let nextBlockId = 0;
  return {
    pages,
    query: async (_databaseId, filter) => pages.filter(page => page.properties.run_id.rich_text[0]?.text.content === filter.rich_text.equals),
    create: async (databaseId, properties, children) => {
      const pageId = `page-${++nextId}`;
      const page = { id: pageId, url: `https://www.notion.so/${pageId}`, databaseId, properties, blocks: structuredClone(children).map(block => ({ ...block, id: `block-${++nextBlockId}` })) };
      pages.push(page);
      return { id: page.id, url: page.url };
    },
    update: async (pageId, properties) => { Object.assign(pages.find(page => page.id === pageId).properties, properties); },
    listChildren: async pageId => structuredClone(pages.find(page => page.id === pageId).blocks),
    append: async (pageId, children) => {
      const page = pages.find(candidate => candidate.id === pageId);
      page.blocks.push(...structuredClone(children).map(block => ({ ...block, id: `block-${++nextBlockId}` })));
    },
    remove: async blockId => {
      for (const page of pages) page.blocks = page.blocks.filter(block => block.id !== blockId);
    },
    options() {
      return { databaseId: 'summary-db', query: this.query, create: this.create, update: this.update, listChildren: this.listChildren, append: this.append, remove: this.remove };
    },
  };
}

function caption(block) {
  return block.code.caption.map(item => item.plain_text || item.text.content).join('');
}

function blockValue(block) {
  return JSON.parse(block.code.rich_text.map(item => item.plain_text || item.text.content).join(''));
}

test('Given no remote rule snapshot, When a small packet is published, Then one verified Notion input page is created', async () => {
  const store = notionStore();
  const result = await publishAgentInputToNotion({ ...store.options(), packet });

  assert.equal(result.status, 'created');
  assert.equal(store.pages.length, 1);
  const created = store.pages[0];
  assert.equal(created.databaseId, 'summary-db');
  assert.equal(created.properties.run_id.rich_text[0].text.content, 'rule-input:2026-07-21-morning');
  assert.deepEqual(JSON.parse(created.properties.payload.rich_text[0].text.content), {
    storage: 'page_code_block', format: 'json', marker: 'MOLIP_AGENT_INPUT_V1',
    runId: packet.runId, bytes: remotePacketSize(packet),
  });
  assert.deepEqual(blockValue(created.blocks[0]), packet);
});

test('Given an existing remote rule snapshot, When republished, Then the same page is updated without stale input blocks', async () => {
  const store = notionStore();
  await publishAgentInputToNotion({ ...store.options(), packet });
  const updatedPacket = { ...packet, generatedAt: '2026-07-21T08:30:00+09:00' };
  const result = await publishAgentInputToNotion({ ...store.options(), packet: updatedPacket });

  assert.equal(result.status, 'updated');
  assert.equal(store.pages.length, 1);
  assert.equal(store.pages[0].blocks.filter(block => caption(block) === 'MOLIP_AGENT_INPUT_V1').length, 1);
  assert.deepEqual(blockValue(store.pages[0].blocks[0]), updatedPacket);
});

test('Given a packet larger than the agent read limit, When published, Then a ready manifest points to verified, reconstructable parts', async () => {
  const originalProject = {
    id: 'project-forge', name: '포지 앤 포춘', goal: '빌드 완성',
    ruleAuditFormat: { columns: ['itemLevel', 'status'] },
    ruleAuditItems: Array.from({ length: 450 }, (_, i) => [i % 2, i % 7]),
    specCatalogFormat: { columns: ['specId', 'title'] },
    specCatalog: Array.from({ length: 45 }, (_, i) => [`spec-${i}`, `활성 스펙 ${i}`]),
    analysisTargets: [{ workItemId: 'task-1' }], meetingReferences: [],
    sourceEvidenceFormat: { columns: ['specId', 'source', 'text'] },
    sourceEvidence: Array.from({ length: 850 }, (_, i) => [`spec-${i % 45}`, 'meeting', `근거-${i}-` + '확인된 프로젝트 실행 상태 '.repeat(4)]),
    gitEvidence: [{ hash: 'abcdef', message: '구현' }], slackScope: { channels: ['proj-forge'] },
  };
  const largePacket = {
    ...packet,
    projects: [originalProject],
    rules: { deltas: [], metrics: { active: 21 }, briefingScope: { mode: 'selected', sprints: ['Sprint 3.5'] } },
    outputSchema: { type: 'object', required: ['projects'] },
    sourceHealth: { status: 'ok' },
  };
  assert.ok(remotePacketSize(largePacket) > AGENT_INPUT_REMOTE_READABLE_LIMIT);
  const store = notionStore();
  const result = await publishAgentInputToNotion({ ...store.options(), packet: largePacket });

  assert.equal(result.status, 'created');
  assert.ok(result.partCount > 1);
  const root = store.pages.find(page => page.properties.run_id.rich_text[0].text.content === 'rule-input:2026-07-21-morning');
  const manifest = blockValue(root.blocks.find(block => caption(block) === 'MOLIP_AGENT_INPUT_V1'));
  assert.equal(manifest.packet.format, 'manifest-v1');
  assert.equal(manifest.packet.status, 'ready');
  const rootProperty = JSON.parse(root.properties.payload.rich_text.map(item => item.text.content).join(''));
  assert.equal(rootProperty.status, 'ready');
  assert.equal(rootProperty.generationId, manifest.packet.generationId);
  assert.equal(manifest.packet.partCount, result.partCount);
  assert.equal(manifest.packet.parts.length, result.partCount);
  assert.deepEqual(manifest.projects[0].activeSpecIds, originalProject.specCatalog.map(row => row[0]));

  const assembled = { ...manifest.projects[0] };
  let reconstructed;
  const sections = [];
  for (const ref of manifest.packet.parts) {
    const page = store.pages.find(candidate => candidate.id === ref.pageId);
    assert.ok(page, `part page ${ref.partId} exists`);
    const partProperty = JSON.parse(page.properties.payload.rich_text.map(item => item.text.content).join(''));
    assert.equal(partProperty.status, 'ready');
    assert.equal(partProperty.partId, ref.partId);
    const code = page.blocks.find(block => caption(block) === AGENT_INPUT_PART_MARKER);
    assert.ok(code, `part body ${ref.partId} exists`);
    const part = blockValue(code);
    assert.equal(part.runId, largePacket.runId);
    assert.equal(part.generatedAt, largePacket.generatedAt);
    assert.equal(part.generationId, manifest.packet.generationId);
    assert.equal(part.partCount, manifest.packet.partCount);
    assert.ok(JSON.stringify(part).length <= AGENT_INPUT_PART_LIMIT);
    assert.equal(part.projects.length, 1);
    if (part.projects[0].projectMeta) reconstructed = structuredClone(part.projects[0].projectMeta);
    sections.push(...part.projects[0].sections.map(section => ({ ...section, partIndex: part.partIndex })));
  }
  assert.ok(reconstructed);
  for (const [field, totalItems] of Object.entries(assembled.sectionCounts)) {
    const fieldSections = sections.filter(section => section.field === field).sort((a, b) => a.offset - b.offset);
    let offset = 0;
    reconstructed[field] = [];
    for (const section of fieldSections) {
      assert.equal(section.offset, offset, `${field} sections are contiguous and non-overlapping`);
      assert.equal(section.totalItems, totalItems);
      reconstructed[field].push(...section.items);
      offset += section.items.length;
    }
    assert.equal(offset, totalItems, `${field} section coverage is complete`);
  }
  assert.deepEqual(reconstructed, originalProject);
  const existingPageCount = store.pages.length;
  const replay = await publishAgentInputToNotion({ ...store.options(), packet: largePacket });
  assert.equal(replay.status, 'updated');
  assert.equal(store.pages.length, existingPageCount);
});

test('Given a shard publish fails midway, When the generation is incomplete, Then the manifest stays non-ready', async () => {
  const largePacket = {
    ...packet,
    projects: [{
      id: 'project-1', name: '피자레디',
      specCatalogFormat: { columns: ['specId'] },
      specCatalog: Array.from({ length: 30 }, (_, index) => [`spec-${index}`]),
      sourceEvidence: Array.from({ length: 900 }, (_, index) => [`spec-${index % 30}`, '회의 근거 '.repeat(12)]),
    }],
  };
  const store = notionStore();
  const createFailingPart = async (databaseId, properties, children) => {
    if (properties.프로젝트명.rich_text[0].text.content.startsWith('규칙 입력 조각')) {
      throw new Error('test: simulated shard failure');
    }
    return store.create(databaseId, properties, children);
  };
  await assert.rejects(publishAgentInputToNotion({
    ...store.options(), packet: largePacket, create: createFailingPart,
  }), /simulated shard failure/);
  assert.equal(store.pages.length, 1);
  const rootManifest = blockValue(store.pages[0].blocks[0]);
  assert.equal(rootManifest.packet.format, 'manifest-v1');
  assert.equal(rootManifest.packet.status, 'publishing');
});

test('Given a packet with a non-shardable manifest, When published, Then it fails before touching Notion', async () => {
  const oversized = { ...packet, repeated: 'x'.repeat(AGENT_INPUT_REMOTE_READABLE_LIMIT + 1) };

  await assert.rejects(
    publishAgentInputToNotion({
      databaseId: 'summary-db', packet: oversized,
      query: async () => assert.fail('must fail before querying'),
      create: async () => assert.fail('must not create'),
      update: async () => assert.fail('must not update'),
    }),
    /원격 조회 안전 한도/,
  );
});

test('both existing rules.deltas and top-level deltas are accepted without mutating source input', () => {
  const changes = [{ project: '피자레디', field: 'task.status', from: '시작 전', to: '진행 중' }];
  for (const deltas of [changes, []]) {
    for (const value of [{ rules: { deltas } }, { deltas }, { rules: { deltas }, deltas }]) {
      const before = structuredClone(value);
      assert.deepEqual(validateAgentInputDeltas(value), deltas);
      assert.deepEqual(value, before);
    }
  }
});

test('missing, malformed or conflicting deltas fail before any Notion operation', async () => {
  for (const invalid of [
    { ...packet, rules: {} },
    { ...packet, deltas: null },
    { ...packet, rules: { deltas: {} } },
    { ...packet, deltas: [{ field: 'task.status' }] },
  ]) {
    await assert.rejects(publishAgentInputToNotion({
      databaseId: 'summary-db', packet: invalid,
      query: async () => assert.fail('invalid input must not access Notion'),
    }));
  }
});
