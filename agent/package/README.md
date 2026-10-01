# MOLIP 통합 브리핑 에이전트 설정

에이전트에 등록할 공식 문서는 두 개뿐이다.

1. `01_AGENT_INSTRUCTIONS.md`를 에이전트 기본 지침으로 등록한다.
2. `02_DAILY_RUN_PROMPT.md`를 매일 아침 정기 실행문으로 등록한다.

Claude Code 클라우드 루틴으로 실행할 때는 위 두 문서에 `ROUTINE_RUNTIME.md`(도구 대응표)를 함께 적용한다. 루틴은 `agent/runtime/` 스크립트로 Notion 입력을 읽고 결과를 저장한다.

## 입력 형식

- 기준 페이지: `run_id=rule-input:YYYY-MM-DD-morning`, 본문 caption `MOLIP_AGENT_INPUT_V1`
- 조각 페이지: 기준 페이지가 지정한 URL, 본문 caption `MOLIP_AGENT_INPUT_PART_V1`
- manifest의 `status=ready`와 조각 전체의 run ID·generation ID·순번·개수 검증

에이전트는 로컬 프로젝트 파일이나 `data/agent-input.json`을 읽지 않는다. Notion 업무현황 요약 DB의 검증된 기준 페이지와 그 페이지가 지정한 조각만 분석 입력이다. 분석은 모든 조각을 읽고 검증한 경우에만 저장한다.
