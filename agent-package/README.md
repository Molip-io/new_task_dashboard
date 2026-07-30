# MOLIP 업무 대시보드 에이전트 적용 순서

1. `01_AGENT_INSTRUCTIONS.md` 내용을 에이전트의 기본 지침으로 교체한다.
2. `skills/structured-meeting-evidence/SKILL.md`를 기존 회의록 스킬 대신 등록한다.
3. `02_DAILY_RUN_PROMPT.md` 내용을 매일 아침 자동 실행문으로 사용한다.
4. `agent-analysis.schema.json`과 `에이전트_규칙엔진_하이브리드_설계.md`를 에이전트 참조 파일로 첨부한다.
5. Notion·Slack·GitHub 연결과 Notion `업무현황 요약 DB` 쓰기 권한을 확인한다.

중요: 웹 에이전트는 로컬 프로젝트와 `data/agent-input.json`에 접근하지 않는다. 대시보드 수집기가 매일 Notion `업무현황 요약 DB`에 게시하는 `규칙 입력 / YYYY-MM-DD` 페이지의 `payload`만 규칙 입력으로 사용한다. 당일 원격 입력이 없으면 분석을 저장하지 않고 실패로 보고한다.
