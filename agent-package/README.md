# MOLIP 통합 브리핑 에이전트 설정

에이전트에 등록할 공식 문서는 두 개뿐이다.

1. `01_AGENT_INSTRUCTIONS.md`를 에이전트 기본 지침으로 등록한다.
2. `02_DAILY_RUN_PROMPT.md`를 매일 아침 정기 실행문으로 등록한다.

## 배포 전 조건

이 문서의 manifest/조각 입력 규약은 대시보드 수집기가 다음 형식을 게시하는 버전에서만 사용할 수 있다.

- 기준 페이지: `run_id=rule-input:YYYY-MM-DD-morning`, 본문 caption `MOLIP_AGENT_INPUT_V1`
- 조각 페이지: 기준 페이지가 지정한 URL, 본문 caption `MOLIP_AGENT_INPUT_PART_V1`
- manifest의 `status=ready`와 조각 전체의 run ID·generation ID·순번·개수 검증

현재 배포된 수집기가 이 형식을 아직 게시하지 않으면 새 지침만 적용해도 입력을 읽을 수 없다. 이 경우 `dashboard-snapshot`이나 다른 원본으로 대체하지 말고 failed로 중단한다. 수집기 코드 지원 및 배포가 완료된 뒤 두 문서를 함께 교체한다.

에이전트는 로컬 프로젝트 파일이나 `data/agent-input.json`을 읽지 않는다. Notion 업무현황 요약 DB의 검증된 기준 페이지와 그 페이지가 지정한 조각만 분석 입력이다. 분석은 모든 조각을 읽고 검증한 경우에만 저장한다.
