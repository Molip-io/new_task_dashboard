import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('Given linked evidence, When agent instructions are applied, Then metric-only summaries are explicitly rejected', () => {
  const instructions = read('../agent-package/01_AGENT_INSTRUCTIONS.md');
  const dailyPrompt = read('../agent-package/02_DAILY_RUN_PROMPT.md');

  for (const document of [instructions, dailyPrompt]) {
    assert.match(document, /sourceEvidence/);
    assert.match(document, /구체 명사|구체적인 목표/);
    assert.match(document, /포지앤포춘.*레이어그룹/);
    assert.match(document, /스프린트 미지정/);
    assert.match(document, /완료율 50%/);
    assert.match(document, /다시 작성/);
  }
});
