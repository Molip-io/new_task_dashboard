# MOLIP 업무 대시보드 아침 정기 실행문

오늘 `Asia/Seoul` 기준으로 MOLIP 업무 대시보드 통합 분석을 실행해줘.

1. 로컬 파일, 로컬 터미널, `/Volumes/PortableSSD/newtaskdashboard`에는 접근하지 마.
2. Notion `업무현황 요약 DB`에서 `run_id = rule-input:YYYY-MM-DD-morning`인 오늘의 `규칙 입력 / YYYY-MM-DD` 페이지를 찾아.
3. 해당 페이지의 `payload`를 JSON으로 파싱하고 `runId`가 오늘의 `YYYY-MM-DD-morning`인지 검증해.
4. 당일 규칙 입력이 없거나 payload를 읽고 파싱할 수 없으면 다른 연결 소스만으로 대신 분석하거나 프로젝트 요약을 저장하지 마. `failed`, `ruleEngine: not_available`, `당일 원격 규칙 입력 없음 또는 payload 해석 불가`만 보고하고 종료해.
5. 완료율, 기한 초과, 가이드 위반, 수집 상태 수치는 재계산하지 말고 원격 규칙 입력 값을 그대로 사용해.
6. 프로젝트별 `analysisTargets`를 우선순위대로 확인하고, 범위 밖 Slack 채널·Notion 페이지·GitHub 저장소를 확장 탐색하지 마.
7. 관련 회의록은 `Structured Meeting Evidence` 스킬로 근거를 추출한 뒤 Notion·Slack·GitHub와 대조해. 스킬의 회의록 판단을 프로젝트 최종 상태로 사용하지 마.
8. 같은 필드의 출처가 직접 충돌하면 최신을 단정하지 말고 양쪽 주장과 링크·시각·짧은 발췌를 보존해 `confirmation_required`로 기록해. 한 출처에 언급이 없는 것은 충돌로 만들지 마.
9. 데이터 확인만 필요한 충돌은 대표 결정으로 올리지 마. 대표 선택에 따라 우선순위·진행·출시·범위가 달라질 때만 질문형 `decisionsForCEO`로 작성해.
10. 첨부된 `agent-analysis.schema.json`에 맞춰 전체 결과를 작성해. `analysisStatus`는 `success | partial | failed`, 출처 상태는 `success | partial | failed | not_available`만 사용해.
11. `업무현황 요약 DB`에 `전체 / YYYY-MM-DD` 1건과 요약 대상 프로젝트별 `프로젝트명 / YYYY-MM-DD` 1건을 저장해. 같은 `분석 실행 ID` 또는 같은 `기준일 + 프로젝트명` 페이지가 있으면 새로 만들지 말고 갱신해.
12. `프로젝트명 = 규칙 입력` 또는 `run_id`가 `rule-input:`으로 시작하는 페이지는 수정하지 마.
13. 전체 페이지 본문에는 스키마와 일치하는 전체 JSON 결과를 하나의 JSON 코드 블록으로 저장해.
14. 저장한 페이지를 다시 읽어 속성·페이지 수·JSON 파싱 여부를 검증해. 대시보드 재동기화는 시스템이 별도로 수행하므로 로컬 명령을 실행하지 마.

마지막에는 아래 항목만 간결하게 보고해.

- 분석 실행 ID
- `success` / `partial` / `failed`
- 생성한 페이지 수와 갱신한 페이지 수
- Notion / Slack / meetingNotes / GitHub / ruleEngine 상태
- 출처 충돌 수
- 대시보드 요약 동기화 대기 여부
- 사람이 설정해야 할 DB 속성·연결 권한·원격 규칙 입력 문제

원문 대화나 긴 분석 본문은 완료 보고에 반복하지 마.
