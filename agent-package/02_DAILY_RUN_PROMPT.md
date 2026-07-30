# MOLIP 업무 대시보드 아침 정기 실행문

오늘 `Asia/Seoul` 기준으로 MOLIP 업무 대시보드 통합 분석을 실행해줘.

1. 로컬 파일, 로컬 터미널, `/Volumes/PortableSSD/newtaskdashboard`에는 접근하지 마.
2. Notion `업무현황 요약 DB`에서 `run_id = rule-input:YYYY-MM-DD-morning`인 오늘의 `규칙 입력 / YYYY-MM-DD` 페이지를 찾아.
3. 해당 페이지의 `payload`를 JSON으로 파싱하고 `runId`가 오늘의 `YYYY-MM-DD-morning`인지 검증해.
4. `payload.outputSchema`, `payload.projects[].ruleAuditItems`, `payload.projects[].analysisTargets`가 있는지 검증해. 출력 스키마는 별도 첨부나 로컬 파일이 아니라 `payload.outputSchema`를 사용해.
5. 당일 규칙 입력이 없거나 payload를 끝까지 읽고 파싱할 수 없거나 필수 입력이 누락됐으면 다른 연결 소스만으로 대신 분석하거나 프로젝트 요약을 저장하지 마. 실패 원인과 누락 필드를 구분해 보고하고 종료해.
6. `rules.metrics`와 `project.ruleStats`는 원본 참고값으로 보존해. 최종 가이드 위반·미기입·총 작업 집계는 요약 체크 true 프로젝트의 `ruleAuditItems` 전체에 상태별 규칙과 프로젝트 상속 규칙을 적용해 `ruleMetrics`로 별도 계산해.
7. `analysisTargets`의 작업 상세는 같은 `workItemId`의 `ruleAuditItems`와 결합해 읽어. `analysisTargets`를 우선순위대로 확인하고, `analysisScope.targetLimit`을 넘거나 범위 밖인 Slack 채널·Notion 페이지·GitHub 저장소를 확장 탐색하지 마.
8. 관련 회의록은 `Structured Meeting Evidence` 스킬로 근거를 추출한 뒤 Notion·Slack·GitHub와 대조해. 스킬의 회의록 판단을 프로젝트 최종 상태로 사용하지 마.
9. 같은 필드의 출처가 직접 충돌하면 최신을 단정하지 말고 양쪽 주장과 링크·시각·짧은 발췌를 보존해 `confirmation_required`로 기록해. 한 출처에 언급이 없는 것은 충돌로 만들지 마.
10. 데이터 확인만 필요한 충돌은 대표 결정으로 올리지 마. 대표 선택에 따라 우선순위·진행·출시·범위가 달라질 때만 질문형 `decisionsForCEO`로 작성해.
11. `payload.outputSchema`에 맞춰 전체 결과를 작성해. `analysisStatus`는 `success | partial | failed`, 출처 상태는 `success | partial | failed | not_available`만 사용해.
12. `업무현황 요약 DB`에 `전체 / YYYY-MM-DD` 1건과 요약 대상 프로젝트별 `프로젝트명 / YYYY-MM-DD` 1건을 저장해. 같은 `run_id` 또는 같은 `기준일 + 프로젝트명` 페이지가 있으면 새로 만들지 말고 갱신해.
13. `프로젝트명 = 규칙 입력` 또는 `run_id`가 `rule-input:`으로 시작하는 페이지는 수정하지 마.
14. 전체 페이지 본문에는 스키마와 일치하는 전체 JSON 결과를 하나의 JSON 코드 블록으로 저장해.
15. 저장한 페이지를 다시 읽어 속성·페이지 수·JSON 파싱 여부를 검증해. 대시보드 재동기화는 시스템이 별도로 수행하므로 로컬 명령을 실행하지 마.

마지막에는 아래 항목만 간결하게 보고해.

- 분석 실행 ID
- `success` / `partial` / `failed`
- 생성한 페이지 수와 갱신한 페이지 수
- Notion / Slack / meetingNotes / GitHub / ruleEngine 상태
- 출처 충돌 수
- 원본 집계와 최종 보정 집계 차이, 특히 `guideViolationWorkItems`의 `원본값 → 보정값`
- 프로젝트 상속·프로젝트 누락·상태별 예외·`RULE_NOT_EVALUATED` 건수
- 대시보드 요약 동기화 대기 여부
- 사람이 설정해야 할 DB 속성·연결 권한·원격 규칙 입력 문제

원문 대화나 긴 분석 본문은 완료 보고에 반복하지 마.
