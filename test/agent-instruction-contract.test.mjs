import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const instructions = read('../agent-package/01_AGENT_INSTRUCTIONS.md');
const daily = read('../agent-package/02_DAILY_RUN_PROMPT.md');

test('copy-ready documents have completion markers and the daily prompt reaches saving and read-back verification', () => {
  assert.ok(instructions.trimEnd().endsWith('END_MOLIP_AGENT_INSTRUCTIONS'));
  assert.ok(daily.trimEnd().endsWith('END_MOLIP_DAILY_PROMPT'));
  for (const heading of ['오늘 입력 검증', '기준 고정', '직접 근거와 회의록', '상황 중심 브리핑', '저장 전 검증', '저장·저장 후 검증', '완료 보고']) assert.ok(daily.includes(heading), heading);
  assert.match(daily, /다시 읽어/);
  assert.match(daily, /실패하면 성공이라고 보고하지 마/);
});

test('canonical documents match the actual indexed input and nested deltas contract', () => {
  for (const doc of [instructions, daily]) {
    for (const key of ['MOLIP_AGENT_INPUT_V1', 'indexedValues', 'ruleAuditItems', 'specCatalog', 'rules.deltas', 'outputSchema']) assert.ok(doc.includes(key), key);
    assert.match(doc, /최상위 `deltas`가 없어도/);
    assert.match(doc, /둘 다.*배열이 아니거나.*서로 다르면/);
    assert.match(doc, /재구성/);
  }
  for (const doc of [instructions, daily]) {
    for (const key of ['manifest-v1', 'MOLIP_AGENT_INPUT_PART_V1', 'sectionCounts', 'projectMeta', 'totalItems']) assert.ok(doc.includes(key), key);
  }
});

test('semantic gates require every project briefing and prohibit metrics being replaced by collection health', () => {
  for (const doc of [instructions, daily]) {
    assert.match(doc, /projectBriefing.*반드시|반드시.*projectBriefing/);
    for (const key of ['currentProgress', 'buildRelease', 'data', 'projects[].summary', 'overall.summary', 'specSummaries', '1:1', 'confirmationRequired']) assert.ok(doc.includes(key), key);
    assert.match(doc, /로그.*오류/);
    assert.match(doc, /승리/);
    assert.match(doc, /null/);
    assert.match(doc, /다시 작성/);
    assert.match(doc, /역사적 근거/);
  }
});

test('meeting coverage and sprint limitations do not become false certainty', () => {
  for (const doc of [instructions, daily]) {
    for (const word of ['meetingReferences', 'contentChecked', 'meetingNotes', 'recent_execution', 'persistent_context', 'project_operation', '미평가']) assert.ok(doc.includes(word), word);
    assert.match(doc, /회의록/);
    assert.match(doc, /분석은 계속/);
    assert.match(doc, /기한 초과.*가이드 위반.*동시에/);
  }
  assert.match(instructions, /outsideGuideViolationItems/);
  assert.match(instructions, /evidenceCoverage/);
  assert.match(instructions, /별도 스킬이 없어도/);
});
