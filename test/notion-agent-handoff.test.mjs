import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_INPUT_REMOTE_READABLE_LIMIT,
  publishAgentInputToNotion,
  remotePacketSize,
} from '../lib/notion-agent-handoff.mjs';

const packet = {
  schemaVersion: '1.0', runId: '2026-07-21-morning', generatedAt: '2026-07-21T07:30:00+09:00',
  projects: [{ name: '피자레디', analysisTargets: [] }],
};

test('Given no remote rule snapshot, When the packet is published, Then one idempotent Notion input page is created', async () => {
  let created;
  const result = await publishAgentInputToNotion({
    databaseId: 'summary-db', packet,
    query: async () => [],
    create: async (databaseId, properties) => { created = { databaseId, properties }; return { id: 'new-page' }; },
    update: async () => assert.fail('must not update'),
  });

  assert.equal(result.status, 'created');
  assert.equal(created.databaseId, 'summary-db');
  assert.equal(created.properties.run_id.rich_text[0].text.content, 'rule-input:2026-07-21-morning');
  assert.match(created.properties.payload.rich_text[0].text.content, /피자레디/);
});

test('Given an existing remote rule snapshot, When republished, Then the same page is updated', async () => {
  let updatedPage;
  const result = await publishAgentInputToNotion({
    databaseId: 'summary-db', packet,
    query: async () => [{ id: 'existing-page' }],
    create: async () => assert.fail('must not create'),
    update: async pageId => { updatedPage = pageId; },
  });

  assert.equal(result.status, 'updated');
  assert.equal(updatedPage, 'existing-page');
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
