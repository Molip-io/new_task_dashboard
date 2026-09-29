import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const schema = JSON.parse(fs.readFileSync(new URL('../schemas/agent-analysis.schema.json', import.meta.url), 'utf8'));
const briefing = schema.properties.projects.items.properties.projectBriefing;

test('Given the output schema, When the itemised and briefing-sprint fields are read, Then they exist as optional additions', () => {
  for (const field of ['currentProgressItems', 'buildReleaseItems', 'dataItems', 'briefingSprint']) {
    assert.ok(briefing.properties[field], field);
    assert.ok(!briefing.required.includes(field), `${field} must stay optional for older analyses`);
  }
  assert.ok(schema.properties.overall.properties.summaryItems);
  assert.ok(!schema.properties.overall.required.includes('summaryItems'));
  for (const field of ['currentProgressItems', 'buildReleaseItems', 'dataItems']) assert.equal(briefing.properties[field].items.type, 'string');
});

test('Given the briefing sprint definition, When its structure is read, Then status, scope copy and evidence are pinned', () => {
  const sprint = briefing.properties.briefingSprint;
  assert.deepEqual(sprint.properties.status.enum, ['judged', 'undetermined']);
  assert.deepEqual(sprint.properties.savedScope.properties.mode.enum, ['selected', 'all', 'unset']);
  assert.equal(sprint.properties.evidence.items.$ref, '#/$defs/evidenceItem');
  assert.equal(sprint.additionalProperties, false);
  assert.deepEqual([...sprint.required].sort(), ['differsFromSaved', 'evidence', 'rationale', 'savedScope', 'sprints', 'status']);
});
