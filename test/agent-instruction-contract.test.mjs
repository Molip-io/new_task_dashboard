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
    assert.match(document, /persistent_context/);
    assert.match(document, /recent_execution/);
    assert.match(document, /project_operation/);
    assert.match(document, /현재 수집 범위에서 확인 불가/);
    assert.match(document, /blocker로 만들지/);
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

test('Given the daily run input, When deltas are validated, Then the established rules path is accepted without reconstruction', () => {
  const documents = [
    read('../agent-package/02_DAILY_RUN_PROMPT.md'),
    read('../docs/reviewed-daily-run.md'),
    read('../prompts/업무대시보드_에이전트_실행지시.md'),
  ];
  for (const document of documents) {
    assert.match(document, /rules\.deltas.*정식/);
    assert.match(document, /최상위 `deltas`가 없어도/);
    assert.match(document, /둘 다.*배열이 아니거나.*서로 다르면/);
    assert.match(document, /다른 출처.*deltas.*재구성|다른 출처로 deltas를 재구성/);
  }
});

test('Given the copy-ready agent prompt, When used alone, Then it includes the complete execution lifecycle', () => {
  const prompt = read('../prompts/업무대시보드_에이전트_단일실행문.md');
  for (const phrase of [
    '오늘 입력 검증', '분석 대상', 'buildRelease', '빌드 성과·실험 결과',
    '저장 전 검증', '저장·저장 후 검증', '완료 보고',
  ]) assert.match(prompt, new RegExp(phrase.replace(/[·]/g, '·')));
  assert.match(prompt, /`rules\.deltas`가 정식 경로/);
  assert.match(prompt, /규칙 입력 페이지를 수정하지 않는다/);
});


test('Given the scoped briefing, When guide metrics are interpreted, Then mixed units and guide overlap are explicit contracts', () => {
  const documents = [
    read('../agent-package/01_AGENT_INSTRUCTIONS.md'),
    read('../agent-package/02_DAILY_RUN_PROMPT.md'),
    read('../prompts/업무대시보드_에이전트_실행지시.md'),
  ];
  for (const document of documents) {
    assert.match(document, /rules\.briefingScope/);
    assert.match(document, /briefingMetrics/);
    assert.match(document, /상위 작업.*하위 작업|상위 작업 \+ 하위 작업/);
    assert.match(document, /기한 초과.*가이드 위반.*동시|동시에 포함/);
    assert.match(document, /outsideGuideViolationItems/);
    assert.match(document, /unknownGuideViolationItems/);
    assert.match(document, /확인필요/);
  }
});
