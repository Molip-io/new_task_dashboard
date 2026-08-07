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

test('Given any project or parent work item, When the agent classifies source-backed execution risks, Then one general risk contract applies instead of example-specific rules', () => {
  const instructions = read('../agent-package/01_AGENT_INSTRUCTIONS.md');
  const dailyPrompt = read('../agent-package/02_DAILY_RUN_PROMPT.md');

  for (const document of [instructions, dailyPrompt]) {
    assert.match(document, /모든 `specCatalog`|모든 상위 작업/);
    for (const risk of ['선행 작업·승인 대기', '일정·납기 영향', '범위·요구사항 미확정', '반복 검증·재작업', '전달·협업 문제', '빌드·연동·배포 장애']) {
      assert.match(document, new RegExp(risk));
    }
    assert.match(document, /직접 연결/);
    assert.match(document, /해결되지 않은/);
    assert.match(document, /담당 역할.*산출물.*완료 조건/);
  }
});

test('Given the daily agent run, When its prompt is executed, Then input, analysis, grounding, writes, verification, and reporting are explicit contracts', () => {
  const dailyPrompt = read('../agent-package/02_DAILY_RUN_PROMPT.md');

  for (const block of ['task', 'input_contract', 'analysis_contract', 'grounding_rules', 'write_contract', 'verification_loop', 'compact_output_contract']) {
    assert.match(dailyPrompt, new RegExp(`<${block}>[\\s\\S]*<\\/${block}>`));
  }
});
