# MOLIP 업무 대시보드 아침 정기 실행문

오늘 `Asia/Seoul` 기준으로 MOLIP 업무 대시보드 통합 분석을 실행해줘.

1. 로컬 파일, 로컬 터미널, `/Volumes/PortableSSD/newtaskdashboard`에는 접근하지 마.
2. Notion `업무현황 요약 DB`에서 `run_id = rule-input:YYYY-MM-DD-morning`인 오늘의 `규칙 입력 / YYYY-MM-DD` 페이지를 찾아.
3. 페이지 속성 `payload`는 위치 안내야. 여기서 `storage = page_code_block`, `marker = MOLIP_AGENT_INPUT_V1`, `runId`를 확인한 뒤, 페이지 본문에서 caption이 `MOLIP_AGENT_INPUT_V1`인 마지막 JSON 코드 블록을 끝까지 읽어 파싱해. 본문 JSON의 `runId`가 오늘의 `YYYY-MM-DD-morning`인지 검증해.
4. 본문 JSON의 `outputSchema`, `projects[].ruleAuditFormat`, `projects[].ruleAuditItems`, `projects[].analysisTargets`, `projects[].specCatalogFormat`, `projects[].specCatalog`가 있는지 검증해. 출력 스키마는 별도 첨부나 로컬 파일이 아니라 본문 JSON의 `outputSchema`를 사용해.
5. 당일 규칙 입력이 없거나 본문 JSON을 끝까지 읽고 파싱할 수 없거나 필수 입력이 누락됐으면 다른 연결 소스만으로 대신 분석하거나 프로젝트 요약을 저장하지 마. 실패 원인과 누락 필드를 구분해 보고하고 종료해.
6. `rules.metrics`와 `project.ruleStats`는 원본 참고값으로 보존해. 최종 가이드 위반·미기입·총 작업 집계는 요약 체크 true 프로젝트의 `ruleAuditItems` 전체에 아래 규칙과 프로젝트 상속 규칙을 적용해 `ruleMetrics`로 별도 계산해.
7. 진행 중인 상위항목 아래의 `완료` 하위 작업항목은 상위 진행률·상태 계산 근거로만 사용할 수 있고 규칙 평가·출처 대조·요약 대상에서는 제외해. `완료`, `일시 정지`, `정지`, `중단` 상태인 상위항목의 모든 하위항목은 수집·규칙 평가·출처 대조·요약·저장 집계에서 제외해. 입력에 남아 있어도 활성 분석 대상으로 되살리지 말고 제외 건수만 `excludedStatusWorkItems`에 기록해.
8. 상위항목은 모든 수집 대상 상태에서 프로젝트·스프린트·작업명·작업 내용 설명·담당자·상태가 필수야. 담당자에는 프로젝트 리스트 DB의 `PD` 전원과 `팀장` 전원이 있어야 해. 설명·담당자 기준을 읽거나 판정할 수 없으면 `RULE_NOT_EVALUATED`로 기록해. 단, `project.sprintRequired = false`면 스프린트는 필수가 아니야.
9. 하위항목은 모든 수집 대상 상태에서 프로젝트·스프린트·작업명·상태가 필수야. `시작 전`에는 이것만 검사해. `확인 요청`은 댓글에 프로젝트 PD 또는 작업 완료처리 담당자 태그가 있어야 하며 댓글·멘션을 읽을 수 없으면 `RULE_NOT_EVALUATED`로 기록해. `진행 예정`, `진행 중`, `검토중`, `추가 진행`은 메인 담당자·우선순위·시작날짜~Dead Line·브랜치도 필수야. 단, `project.sprintRequired = false`면 스프린트 누락 비트와 `sprintRelation = not-applicable`을 정상으로 처리해.
10. 프로젝트의 `currentSprints`와 작업의 `sprintRelation`을 사용해. 현재 스프린트의 `시작 전`은 `진행 준비 필요 항목`, 지난 스프린트의 `시작 전`은 `지난 스프린트 미착수`로 집계해. 미래 스프린트의 `시작 전`은 진행 준비 및 상세 필드 위반에서 제외하고 공통 필수 항목만 검사해. 관계를 판정할 수 없으면 추정하지 말고 `RULE_NOT_EVALUATED`로 기록해. `project.sprintRequired = false`인 프로젝트에는 이 스프린트 관계 규칙을 적용하지 마.
11. `진행 준비 필요 항목`에는 담당자·우선순위·기간·브랜치를 입력하고 빠른 시일 내 `진행 예정`으로 변경하라는 다음 행동을 남겨. 이 범주는 가이드 위반과 별도이며 공통 필수 항목도 누락한 작업은 두 범주에 동시에 포함할 수 있어.
12. `ruleAuditItems`는 보정 집계 전용 압축 행이고 `analysisTargets`는 추가 심층 대조용이야. 둘을 작업 ID로 결합하려고 하지 마. 수집기가 프로젝트 전체에서 직접 연결해 둔 `sourceEvidence`는 `analysisScope.targetLimit`과 무관하게 `specCatalog` 전체에 적용해. 커넥터를 이용한 추가 탐색만 `analysisTargets` 우선순위와 `analysisScope.targetLimit`을 따르고 범위 밖 Slack 채널·Notion 페이지·GitHub 저장소로 확장하지 마.
13. 회의록 본문에서 이미 연결된 발췌는 `sourceEvidence` 전체를 사용해. 추가 심층 대조 대상으로 선정된 `meetingReferences` 링크만 읽고 `Structured Meeting Evidence` 스킬로 근거를 추출한 뒤 Notion·Slack·GitHub와 대조해. 스킬의 회의록 판단을 프로젝트 최종 상태로 사용하지 마.
14. 같은 필드의 출처가 직접 충돌하면 최신을 단정하지 말고 양쪽 주장과 링크·시각·짧은 발췌를 보존해 `confirmation_required`로 기록해. 한 출처에 언급이 없는 것은 충돌로 만들지 마.
15. 데이터 확인만 필요한 충돌은 대표 결정으로 올리지 마. 대표 선택에 따라 우선순위·진행·출시·범위가 달라질 때만 질문형 `decisionsForCEO`로 작성해.
16. `payload.outputSchema`에 맞춰 전체 결과를 작성해. `analysisStatus`는 `success | partial | failed`, 출처 상태는 `success | partial | failed | not_available`만 사용해. `ruleMetrics`에는 `progressSetupRequiredItems`, `pastSprintNotStartedItems`, `futureSprintExcludedItems`, `ruleNotEvaluatedItems`, `excludedStatusWorkItems`도 기록해.
17. 각 프로젝트의 `specCatalog` 모든 행에 `specSummaries`를 1건씩 작성해. 각 행은 같은 `specId`의 `sourceEvidence`를 최신순으로 먼저 읽고 아래 순서로 작성해.
    - `summary` 1문장: 무엇을 만들거나 해결하려는지 + 현재 실제로 진행 중인 산출물
    - `summary` 2문장: 근거로 확인된 선행 입력·검토·협업 요청. 요청만 있고 제공 여부가 없으면 `요청됨 · 제공 여부 확인 필요`로 구분
    - `blockers`: 선행 작업 대기, 승인·결정 대기, 후속 일정에 영향을 주는 지연, 명시된 미해결 이슈처럼 확인된 실행 병목만 최대 3건. 우선순위·기간·브랜치·담당자·설명 누락은 제외
    - `nextAction`: 담당 역할·산출물·완료 조건이 포함된 다음 업무 행동 1건. 근거가 없으면 `null`
    - `evidence`: 직접 연결되는 Notion·Slack·회의록·GitHub 근거만 최대 6건
    - `sourceEvidence`가 있으면 `summary`에 근거의 구체 명사나 산출물을 최소 1개 포함해. 상태·건수·완료율·기한 초과 수만 나열하거나 `직접 연결된 근거가 확인됐다`, `다음 상태로 진행`, `다음 완료 지점 확인` 같은 일반 문구를 쓰면 안 돼.
    - 저장 전에 모든 요약을 다시 검사해. `[R&D] AI 기반 UI Prefab 자동화 툴 1차 제작`은 `포지앤포춘 기준 레이어그룹·레이어 상세 규칙 구성`처럼 근거에 적힌 실제 진행을 포함해야 하며, `스프린트 미지정·활성 작업 1건·완료율 50%`만 쓴 결과는 폐기하고 다시 작성해.
18. `업무현황 요약 DB`에 `전체 / YYYY-MM-DD` 1건과 요약 대상 프로젝트별 `프로젝트명 / YYYY-MM-DD` 1건을 저장해. 같은 `run_id` 또는 같은 `기준일 + 프로젝트명` 페이지가 있으면 새로 만들지 말고 갱신해.
19. `프로젝트명 = 규칙 입력` 또는 `run_id`가 `rule-input:`으로 시작하는 페이지는 수정하지 마.
20. 전체 페이지 본문에는 스키마와 일치하는 전체 JSON 결과를 하나의 JSON 코드 블록으로 저장해.
21. 저장한 페이지를 다시 읽어 속성·페이지 수·JSON 파싱 여부를 검증해. 대시보드 재동기화는 시스템이 별도로 수행하므로 로컬 명령을 실행하지 마.

마지막에는 아래 항목만 간결하게 보고해.

- 분석 실행 ID
- `success` / `partial` / `failed`
- 생성한 페이지 수와 갱신한 페이지 수
- Notion / Slack / meetingNotes / GitHub / ruleEngine 상태
- 출처 충돌 수
- 원본 집계와 최종 보정 집계 차이, 특히 `guideViolationWorkItems`의 `원본값 → 보정값`
- `진행 준비 필요 항목`, `지난 스프린트 미착수`, 미래 스프린트 제외, 수집 제외 상태 건수
- 프로젝트 상속·프로젝트 누락·상태별 예외·`RULE_NOT_EVALUATED` 건수
- 대시보드 요약 동기화 대기 여부
- 사람이 설정해야 할 DB 속성·연결 권한·원격 규칙 입력 문제

원문 대화나 긴 분석 본문은 완료 보고에 반복하지 마.
