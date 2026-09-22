import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_INPUT_REMOTE_READABLE_LIMIT,
  publishAgentInputToNotion,
  remotePacketSize,
  validateAgentInputDeltas,
} from '../lib/notion-agent-handoff.mjs';

const packet = {
  schemaVersion: '1.0', runId: '2026-07-21-morning', generatedAt: '2026-07-21T07:30:00+09:00',
  projects: [{ name: '피자레디', analysisTargets: [] }],
  rules: { deltas: [] },
};

test('Given no remote rule snapshot, When the packet is published, Then one idempotent Notion input page is created', async () => {
  let created;
  const result = await publishAgentInputToNotion({
    databaseId: 'summary-db', packet,
    query: async () => [],
    create: async (databaseId, properties, children) => { created = { databaseId, properties, children }; return { id: 'new-page' }; },
    update: async () => assert.fail('must not update'),
  });

  assert.equal(result.status, 'created');
  assert.equal(created.databaseId, 'summary-db');
  assert.equal(created.properties.run_id.rich_text[0].text.content, 'rule-input:2026-07-21-morning');
  assert.deepEqual(JSON.parse(created.properties.payload.rich_text[0].text.content), {
    storage: 'page_code_block',
    format: 'json',
    marker: 'MOLIP_AGENT_INPUT_V1',
    runId: '2026-07-21-morning',
    bytes: remotePacketSize(packet),
  });
  const bodyPayload = created.children[0].code.rich_text.map(item => item.text.content).join('');
  assert.deepEqual(JSON.parse(bodyPayload), packet);
});

test('Given an existing remote rule snapshot, When republished, Then the same page is updated', async () => {
  let updatedPage;
  let appended;
  let removed;
  const result = await publishAgentInputToNotion({
    databaseId: 'summary-db', packet,
    query: async () => [{ id: 'existing-page' }],
    create: async () => assert.fail('must not create'),
    update: async pageId => { updatedPage = pageId; },
    listChildren: async () => [{
      id: 'old-block',
      type: 'code',
      code: { caption: [{ plain_text: 'MOLIP_AGENT_INPUT_V1' }] },
    }],
    append: async (pageId, children) => { appended = { pageId, children }; },
    remove: async blockId => { removed = blockId; },
  });

  assert.equal(result.status, 'updated');
  assert.equal(updatedPage, 'existing-page');
  assert.equal(appended.pageId, 'existing-page');
  assert.equal(JSON.parse(appended.children[0].code.rich_text.map(item => item.text.content).join('')).runId, packet.runId);
  assert.equal(removed, 'old-block');
  assert.ok(remotePacketSize(packet) > 0);
});

test('Given a packet larger than the connector-readable budget, When published, Then it fails before creating an unreadable page', async () => {
  const oversized = { ...packet, repeated: 'x'.repeat(AGENT_INPUT_REMOTE_READABLE_LIMIT + 1) };

  await assert.rejects(
    publishAgentInputToNotion({
      databaseId: 'summary-db',
      packet: oversized,
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
    }), /deltas/);
  }
});
