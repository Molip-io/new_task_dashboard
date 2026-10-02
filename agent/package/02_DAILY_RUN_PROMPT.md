# MOLIP 업무 대시보드 아침 정기 실행문

오늘 `Asia/Seoul` 기준 MOLIP 업무 대시보드 통합 분석을 실행해. 「MOLIP 업무 대시보드 통합 분석 에이전트 지침」 전체를 적용하고, 도구와 입출력 경로는 `ROUTINE_RUNTIME.md`를 따라. 별도 실행문·외부 스킬은 필요 없어.

1. **오늘 입력 검증**
Notion 업무현황 요약 DB(`351b4a46-5003-80ff-8b85-f772cb93da32`)의 기준 페이지 `run_id=rule-input:YYYY-MM-DD-morning`(caption `MOLIP_AGENT_INPUT_V1`, `packet.format=manifest-v1`)와 그 페이지가 지정한 조각(caption `MOLIP_AGENT_INPUT_PART_V1`)을 지침 §3대로 하나의 입력으로 복원해. marker·runId·generationId·상태, 조각 순번·개수, `projectMeta`, `sectionCounts`·`totalItems`, `activeSpecIds`↔`specCatalog` 1:1 검증을 모두 통과한 입력만 써.

재구성된 입력의 `runId=YYYY-MM-DD-morning`, `outputSchema`, `rules.metrics`, `projects`, `sourceHealth`, 프로젝트별 감사 행·형식·대조 대상·스펙 목록·형식을 확인해.

입력·조각이 없거나 불완전하면 외부 출처나 `dashboard-snapshot`으로 재구성하지 말고 요약을 저장하지 않은 채 failed로 종료해. `manifest-v1`이 `publishing`이면 게시 완료를 기다리는 입력이므로 분석하지 마.
`rules.deltas`가 정식 경로야. 최상위 `deltas`가 없어도 유효하며 최상위 배열만 있는 호환 입력도 허용해. 둘 다 있으면 같은 배열이어야 해. 둘 다 없거나 제공된 값이 배열이 아니거나 서로 다르면 실패해. `rules.comparison.available=true`일 때만 `[]`는 변경 없음이고, false면 비교 불가야. `observedCompleteAt`은 완료를 처음 관찰한 시각이지 실제 완료일이 아니야.

2. **기준 고정과 전체 범위 해석**
기준 페이지와 모든 조각의 pageId·partId·runId·generationId·generatedAt·본문 식별 정보를 기록해. 저장 직전에 같은 세대의 기준 페이지와 모든 조각이 바뀌지 않았는지 재확인해. 중복 입력 내용이 달라 정본을 확정할 수 없으면 합치거나 임의 선택하지 마. 감사 행은 `ruleAuditFormat.columns`와 `indexedValues`로 먼저 복원하고 모든 요약 대상의 `ruleAuditItems`에 지침의 상태별 규칙을 적용해. `rules.metrics` 원본과 보정 `ruleMetrics`를 구분해. ID 없는 감사 행을 다른 목록에 순서로 결합하지 마.
활성 집계에서 제외된 완료·중지 업무도 전달 완료·해소된 병목·유효한 합의의 역사적 근거로 사용할 수 있어. 활성 업무로 다시 세지는 마. `rules.briefingScope.mode=unset`이면 스프린트 관계 지표를 0건으로 해석하지 말고 미평가로 남겨. 그래도 전사·프로젝트 상황 분석은 계속하며 미설정 자체를 회사 위험으로 올리지 마.
`briefingMetrics`의 진행 중·기한 초과·진행 준비는 활성 하위 작업, 가이드 위반은 활성 상위 작업 + 하위 작업 기준이야. 기한 초과와 가이드 위반에 동시에 포함될 수 있어. 선택 범위·선택 밖·미분류 수치를 섞지 마.

3. **직접 근거와 회의록 검토**
전체 `specCatalog`와 `sourceEvidence`를 읽고 recent_execution·persistent_context·project_operation을 구분해. 추가 대조는 허용 출처와 `analysisScope.targetLimit` 안에서 우선순위를 정해. 관련 `meetingReferences`와 허용된 회의록에서 현재 진행·빌드·성과의 합의와 후속 결과를 확인해. 제목·수집 정상·contentChecked만으로 본문을 검토했다고 하지 마. 발췌가 잘렸거나 결론이 빠지면 연결 원문을 읽고, 못 읽으면 제한을 남겨. 출처별 인용 개수를 억지로 채우지 마. 입력 `sourceHealth`의 회의 ID `meetings`, 출력 `sourceStatus.meetingNotes`, evidence의 `source=meeting`을 구분해.

4. **상황 중심 브리핑 작성**
모든 프로젝트에 `projectBriefing`을 반드시 작성해. 호환 스키마에서 선택형이어도 새 분석의 필수 조건이야.
- `briefingSprint`: `projects[].sprintSchedules`에 개발 중·테스트 중 일정이 있으면 그 스프린트들을 `basis=schedule`로 써. 없을 때만 최근 7일의 실제 진행 근거로 판단해 `basis=recent-activity`로 써. 일정이 있으면 `progress`로 목표일 대비 진행을 쓰고, `rules.deltas`의 `spec.sprint`·`schedule.due` 변경은 회의록·Slack에서 이유를 찾아 붙여(못 찾으면 "이유 미확인"). 병목은 `bottlenecks.confirmationWaits`, 회의록의 미결 "대표 결정 필요"(첫 회의일·대기 일수), 일정의 `dueChanges`·`replans`로 써. 진행 중인 스프린트는 모두 넣고, 근거가 없으면 `undetermined`로 두고 공용 설정으로 대체하지 마. 스프린트 수치는 `sprintCounts`에서 판단한 스프린트의 값을 쓰고, `ruleMetrics`는 규칙 엔진 기준을 유지해.
- `projects[].delayEvidence`는 기한 초과 작업의 작업 페이지 댓글이야. 사유가 부족하면 `nextActions`에 `suggested_check`로만 적고 규칙 수치는 바꾸지 마.
- `currentProgress`: 무엇을 하는가 → 확인된 진척 → 남은 작업 → 다음 중요한 단계. 숫자·상태만 나열하지 마.
- `buildRelease`: 마지막 확인된 전달·배포 빌드 → 다음 준비 빌드 → 다음 검증·전달 단계를 짧게 종합해. 스프린트·빌드 버전·플랫폼·대상을 구분하고 최신 APK를 출시 완료로 추정하지 마. 지난 예정일·부모 글의 오늘 문구를 현재 상태로 복사하지 마. 같은 스레드에서 같은 대상의 현재 상태는 가장 나중 답글의 완료·결과 보고를 쓰고, 부모 글의 요청 값은 요청 당시 기록으로만 써. 출시 상태를 `미확인`·`예정`으로 쓰기 전에는 허용 채널에서 그 버전 번호로 이후 공지를 찾아(키워드는 버전 번호와 배포·릴리즈·심사 같은 상태어, 필터는 `in:<#채널 ID>`·`after:`, 안 되면 그 날짜 이후 채널 기록) 찾은 가장 나중 보고를 써. 오래된 마지막 전달 사실은 날짜와 함께 유지해.
- `data`: 현재 빌드와 연결된 D1·RV·ARPDAU·퍼널·A/B 등 성과와 실험 결과만 써. 빌드·기간·코호트·단위·분모·비교 조건을 확인해. 출처 정상·로그 적재 오류·QA 점검·고객 피드백 건수로 대체하지 마. 해당 빌드의 성과 근거가 없으면 `null`이야. 단순 수치 우세를 승리 그룹으로 만들지 마.
- 실제 미해결 실행 차단만 `projects[].blockers`에 써. `projectBriefing.nextActions`는 합의 `agreed`와 AI 확인 제안 `suggested_check`를 구분해. 정보 부족은 `confidenceLimits`에 써. 새 `confirmationRequired` 내용은 만들지 말고 레거시 required일 때만 `[]`을 넣어.
- 개조식 항목: `currentProgressItems`·`buildReleaseItems`·`dataItems`와 `overall.summaryItems`를 지침 「개조식 항목」대로 써. 한 항목에 한 사실, 상태·날짜·조건 유지, "여러 ~"로 뭉뚱그리지 말고 현재·다음 스프린트의 진행 중·진행 예정·확인 요청 스펙은 이름으로 빠짐없이 넣어.
- 처음 읽는 사람 기준: `overall.summaryItems` 첫 항목은 `오늘 대표가 볼 것: …`으로 시작해. 확인이 필요한 사안마다 담당 역할이 있는 `suggested_check`를 두고, 버전은 처음 나올 때 스프린트와 대응시키고, 비율은 입력의 `progress.label`·`sprintCounts[].label` 문구를 그대로 쓰고, 같은 수치는 한 번만, 요약과 상세의 확인 수준은 같게 써. 나머지는 지침 「처음 읽는 사람 기준」대로 써.
`projects[].summary`는 currentProgress의 압축본, `overall.summary`는 회사 흐름·주요 위험·판단 맥락의 종합이야. 전체 스펙에 `specSummaries`를 1:1로 쓰고 같은 specId의 직접 근거만 사용해. 목표·확인된 진행/완료·현재 작업·남은 작업이 드러나게 해. 행동에는 담당 역할·산출물·완료 조건을 쓰되 근거 없는 이름·합의·기한은 만들지 마.

5. **저장 전 검증과 수정**
당일 outputSchema의 필드·형식·제한을 검증해. 모든 프로젝트 브리핑·스펙 1:1, 입력 범위·시각, 원본/보정 집계, 근거 링크, 현재/다음 빌드 구분, 실제 빌드 KPI, 미해결 병목과 합의/제안 구분을 다시 확인해. 숫자 나열·원문 복사·출처 상태를 성과로 쓴 문장은 다시 작성해. 저장 직전 기준 페이지와 모든 조각이 처음 읽은 동일 `generationId`인지 확인해. 하나라도 바뀌거나 읽을 수 없으면 결과를 저장하지 말고 failed로 보고해. 더 최신 입력으로 만든 기존 결과를 덮어쓰지 마.

6. **저장·저장 후 검증**
검증된 결과를 `전체 / YYYY-MM-DD` 1건과 프로젝트별 `프로젝트명 / YYYY-MM-DD`에 저장해. 같은 날짜·프로젝트는 갱신하고 중복 생성하지 마. 규칙 입력과 dashboard-snapshot 페이지는 수정하지 마. 전체 페이지의 완전한 결과 JSON 코드 블록은 하나로 유지하고 기존 분석 JSON 속성이 있으면 같은 결과와 일치시켜. JSON runId에는 rule-input: 등의 접두사를 붙이지 마.
저장한 페이지를 다시 읽어 속성·페이지 수·JSON 파싱·스키마·실행 ID·프로젝트/스펙 누락을 검증해. 실패하면 성공이라고 보고하지 마. 대시보드 재동기화는 서버가 수행하므로 확인 없이 화면 반영 완료라고 하지 마.

7. **완료 보고**
실행 ID / success·partial·failed, 생성·갱신 페이지 수, 출처 상태와 충돌 수, 스프린트 기준·주요 제한, 의미 있는 원본→보정 차이, 동기화 대기 여부, 사람이 처리해야 할 연결·권한·입력 문제만 짧게 보고해. 미검토는 0건이나 정상으로 표시하지 마.

END_MOLIP_DAILY_PROMPT
