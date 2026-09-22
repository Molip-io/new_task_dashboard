# MOLIP 업무 대시보드 아침 정기 실행문

> 공식 매일 실행문은 이 파일 하나다. `01_AGENT_INSTRUCTIONS.md`의 지침을 적용해 매일 한 번 실행한다. 다른 복사본·예시 문서는 실행 계약으로 사용하지 않는다.

<task>
오늘 `Asia/Seoul` 기준으로 MOLIP 업무 대시보드 통합 분석을 실행해. 당일 원격 규칙 입력을 기준으로 모든 요약 대상 프로젝트와 모든 상위 작업을 분석하고, 검증된 결과를 Notion `업무현황 요약 DB`에 저장해.
</task>

<input_contract>
1. 로컬 파일, 로컬 터미널, `/Volumes/PortableSSD/newtaskdashboard`에는 접근하지 마.
2. Notion `업무현황 요약 DB`에서 `run_id = rule-input:YYYY-MM-DD-morning`인 오늘의 `규칙 입력 / YYYY-MM-DD` 페이지를 찾아.
3. 페이지 속성 `payload`는 위치 안내야. 여기서 `storage = page_code_block`, `marker = MOLIP_AGENT_INPUT_V1`, `runId`를 확인한 뒤, 페이지 본문에서 caption이 `MOLIP_AGENT_INPUT_V1`인 마지막 JSON 코드 블록을 끝까지 읽어 파싱해. 본문 JSON의 `runId`가 오늘의 `YYYY-MM-DD-morning`인지 검증해.
4. 본문 JSON의 `outputSchema`, `projects[].ruleAuditFormat`, `projects[].ruleAuditItems`, `projects[].analysisTargets`, `projects[].specCatalogFormat`, `projects[].specCatalog`가 있는지 검증해. 출력 스키마는 별도 첨부나 로컬 파일이 아니라 본문 JSON의 `outputSchema`를 사용해.
5. 당일 규칙 입력이 없거나 본문 JSON을 끝까지 읽고 파싱할 수 없거나 필수 입력이 누락됐으면 다른 연결 소스만으로 대신 분석하거나 프로젝트 요약을 저장하지 마. 실패 원인과 누락 필드를 구분해 보고하고 종료해.
6. 변경 이력은 `rules.deltas`가 정식 경로야. 최상위 `deltas`가 없어도 `rules.deltas`가 배열이면 유효해. 최상위 `deltas`만 배열인 호환 입력도 허용해. 두 경로가 모두 있으면 배열 내용이 같은지 확인하고 한 번만 사용해. 둘 다 없거나 배열이 아니거나 서로 다르면 입력 계약 오류로 실패해. `[]`는 변경 없음이며 누락이 아니야. 규칙 입력을 수정하거나 다른 출처로 deltas를 재구성하지 마.
</input_contract>

<analysis_contract>
6. `rules.metrics`와 `project.ruleStats`는 원본 참고값으로 보존해. 최종 가이드 위반·미기입·총 작업 집계는 요약 체크 true 프로젝트의 `ruleAuditItems` 전체에 아래 규칙과 프로젝트 상속 규칙을 적용해 `ruleMetrics`로 별도 계산해.
7. 진행 중인 상위항목 아래의 `완료` 하위 작업항목은 상위 진행률·상태 계산 근거로만 사용할 수 있고 규칙 평가·출처 대조·요약 대상에서는 제외해. `완료`, `일시 정지`, `정지`, `중단` 상태인 상위항목의 모든 하위항목은 수집·규칙 평가·출처 대조·요약·저장 집계에서 제외해. 입력에 남아 있어도 활성 분석 대상으로 되살리지 말고 제외 건수만 `excludedStatusWorkItems`에 기록해.
8. 상위항목은 모든 수집 대상 상태에서 프로젝트·스프린트·작업명·작업 내용 설명·담당자·상태가 필수야. 담당자에는 프로젝트 리스트 DB의 `PD` 전원과 `팀장` 전원이 있어야 해. 설명·담당자 기준을 읽거나 판정할 수 없으면 `RULE_NOT_EVALUATED`로 기록해. 단, `project.sprintRequired = false`면 스프린트는 필수가 아니야.
9. 하위항목은 모든 수집 대상 상태에서 프로젝트·스프린트·작업명·상태가 필수야. `시작 전`에는 이것만 검사해. `확인 요청`은 댓글에 프로젝트 PD 또는 작업 완료처리 담당자 태그가 있어야 하며 댓글·멘션을 읽을 수 없으면 `RULE_NOT_EVALUATED`로 기록해. `진행 예정`, `진행 중`, `검토중`, `추가 진행`은 메인 담당자·우선순위·시작날짜~Dead Line·브랜치도 필수야. 단, `project.sprintRequired = false`면 스프린트 누락 비트와 `sprintRelation = not-applicable`을 정상으로 처리해.
10. 당일 `rules.briefingScope`를 전사 공용 현재 스프린트 기준으로 사용하고, 그 기준으로 제공된 프로젝트 `currentSprints`와 작업 `sprintRelation`을 그대로 사용해. 현재 스프린트의 `시작 전`은 `진행 준비 필요 항목`, 지난 스프린트의 `시작 전`은 `지난 스프린트 미착수`로 집계해. 미래 스프린트의 `시작 전`은 진행 준비 및 상세 필드 위반에서 제외하고 공통 필수 항목만 검사해. 관계를 판정할 수 없으면 추정하지 말고 `RULE_NOT_EVALUATED`로 기록해. `briefingScope.mode = unset`이면 스프린트 기반 지표를 0건으로 해석하지 말고, `project.sprintRequired = false`인 프로젝트에는 이 관계 규칙을 적용하지 마.
11. `진행 준비 필요 항목`에는 담당자·우선순위·기간·브랜치를 입력하고 빠른 시일 내 `진행 예정`으로 변경하라는 다음 행동을 남겨. 이 범주는 가이드 위반과 별도이며 공통 필수 항목도 누락한 작업은 두 범주에 동시에 포함할 수 있어.

<!-- GUIDE_METRIC_SCOPE_V2 -->
11-1. `rules.briefingMetrics`는 mixed-by-metric 집계야. `inProgressWorkItems`, `overdueWorkItems`, `progressSetupRequiredItems`는 선택 스프린트의 활성 하위 작업 기준이고, `guideViolationWorkItems`는 선택 스프린트의 활성 상위 작업과 하위 작업을 함께 센다. 같은 하위 작업이 기한 초과이면서 가이드 위반이면 두 지표에 동시에 포함할 수 있고, 기한 초과라는 이유로 가이드 위반에서 빼지 마. `briefingScope.guideUnit = parent-and-child-items`, `guideOverlapAllowed = true`, `outsideGuideViolationItems`, `unknownGuideViolationItems`가 제공되면 그대로 해석해. `확인필요` 전체 수치와 현재 스프린트 수치가 다르면 선택 범위·상위/하위·중복·선택 밖·스프린트 분류 불가를 먼저 분리하고, 동일 스프린트·동일 항목의 분류 자체가 다를 때만 규칙 불일치 후보로 다뤄.

<grounding_rules>
12. `ruleAuditItems`는 보정 집계 전용 압축 행이고 `analysisTargets`는 추가 심층 대조용이야. 둘을 작업 ID로 결합하려고 하지 마. 수집기가 프로젝트 전체에서 직접 연결해 둔 `sourceEvidence`는 `analysisScope.targetLimit`과 무관하게 `specCatalog` 전체에 적용해. `evidenceRole = recent_execution`은 현재 실제 진행 근거로, `evidenceRole = persistent_context`는 현재 리뷰·피드백·handoff·역할·완료 기준을 해석하는 업무 맥락으로, `evidenceRole = project_operation`은 `specId = null`인 프로젝트 전체의 빌드·QA/리뷰·배포/출시·데이터 상태 근거로 사용해. `project_operation`은 특정 스펙에 억지로 연결하지 말고 원문에 직접 명시된 상태만 기록해. 수집된 운영 근거가 없으면 `없음`으로 단정하지 말고 `현재 수집 범위에서 확인 불가`로 기록해. persistent context 자체를 blocker로 만들지 말고, 과거 합의와 다른 현재 실행에 재작업·지연·정체 같은 직접 영향이 확인될 때만 위험 후보로 연결해. 커넥터를 이용한 추가 탐색만 `analysisTargets` 우선순위와 `analysisScope.targetLimit`을 따르고 범위 밖 Slack 채널·Notion 페이지·GitHub 저장소로 확장하지 마.
13. 회의록 본문에서 이미 연결된 발췌는 `sourceEvidence` 전체를 사용해. 추가 심층 대조 대상으로 선정된 `meetingReferences` 링크만 읽고 `Structured Meeting Evidence` 스킬로 근거를 추출한 뒤 Notion·Slack·GitHub와 대조해. 스킬의 회의록 판단을 프로젝트 최종 상태로 사용하지 마.
14. 같은 필드의 출처가 직접 충돌하면 최신을 단정하지 말고 양쪽 주장과 링크·시각·짧은 발췌를 보존해 `confirmation_required`로 기록해. 한 출처에 언급이 없는 것은 충돌로 만들지 마.
15. 데이터 확인만 필요한 충돌은 대표 결정으로 올리지 마. 직접 출처에 대표의 선택·승인 요청이 있고 선택에 따라 우선순위·진행·출시·범위와 후속 작업이 달라질 때만 질문형 `decisionsForCEO`로 작성해. `지난 스프린트 미착수 19건을 현재 스프린트 진행 준비 81건보다 우선 정리할까요?`처럼 규칙 수치나 작업 건수만 비교한 질문은 만들지 말고, 조건을 충족하는 안건이 없으면 빈 배열로 저장해.
</grounding_rules>

16. `payload.outputSchema`에 맞춰 전체 결과를 작성해. `analysisStatus`는 `success | partial | failed`, 출처 상태는 `success | partial | failed | not_available`만 사용해. `ruleMetrics`에는 `progressSetupRequiredItems`, `pastSprintNotStartedItems`, `futureSprintExcludedItems`, `ruleNotEvaluatedItems`, `excludedStatusWorkItems`도 기록해.
    - 규칙 입력에 `PLANNED_START_DATE_PASSED`가 있으면 `진행 예정` 상태인데 시작일이 이미 지난 가이드 위반이야. 실제 착수했다면 `진행 중`으로 변경하고 미착수라면 시작일을 조정하는 관리 조치로 설명해.
17. 각 프로젝트의 `specCatalog` 모든 행에 `specSummaries`를 1건씩 작성해. 각 행은 같은 `specId`의 `sourceEvidence`에서 recent execution과 필요한 persistent context를 함께 읽고 아래 순서로 작성해. 최신순만으로 잘라내지 마.
    - `summary` 1문장: 무엇을 만들거나 해결하려는지 + 현재 실제로 진행 중인 산출물
    - `summary` 2문장: 근거로 확인된 선행 입력·검토·협업 요청. 요청만 있고 제공 여부가 없으면 `요청됨 · 제공 여부 확인 필요`로 구분
    - `blockers`: 선행 작업 대기, 승인·결정 대기, 후속 일정에 영향을 주는 지연, 명시된 미해결 이슈처럼 확인된 실행 병목만 최대 3건. 우선순위·기간·브랜치·담당자·설명 누락은 제외
    - `nextAction`: 담당 역할·산출물·완료 조건이 포함된 다음 업무 행동 1건. 근거가 없으면 `null`
    - `evidence`: 직접 연결되는 Notion·Slack·회의록·GitHub 근거만 최대 6건
    - `sourceEvidence`가 있으면 `summary`에 근거의 구체 명사나 산출물을 최소 1개 포함해. 상태·건수·완료율·기한 초과 수만 나열하거나 `직접 연결된 근거가 확인됐다`, `다음 상태로 진행`, `다음 완료 지점 확인` 같은 일반 문구를 쓰면 안 돼.
    - 저장 전에 모든 요약을 다시 검사해. `[R&D] AI 기반 UI Prefab 자동화 툴 1차 제작`은 `포지앤포춘 기준 레이어그룹·레이어 상세 규칙 구성`처럼 근거에 적힌 실제 진행을 포함해야 하며, `스프린트 미지정·활성 작업 1건·완료율 50%`만 쓴 결과는 폐기하고 다시 작성해.
    - 모든 `specCatalog` 행과 모든 상위 작업에 같은 출처 기반 실행 위험 규칙을 적용해. 위험 유형은 `dependency`(선행 작업·승인 대기), `schedule`(일정·납기 영향), `scope`(범위·요구사항 미확정), `quality`(반복 검증·재작업), `handoff`(전달·협업 문제), `technical`(빌드·연동·배포 장애) 여섯 가지야.
    - 스펙명·작업항목명·ID로 직접 연결되고, 원문에 현재 실행 영향이 명시되며, 같은 스레드·회의의 후속 문장에서 해결되지 않은 경우만 `blockers`에 기록해. 단순 아이디어·개선 희망과 이미 해결된 과거 이슈는 제외해. `sourceEvidence.attentionType`은 후보값이므로 발췌를 확인해.
    - `nextAction`은 위험 원인에 맞춰 담당 역할·산출물·완료 조건을 포함해. 사람 이름이나 완료 여부를 추정하지 마. 여러 파트의 실행 순서, 현재 스프린트 주요 산출물, 출시·배포 일정에 영향을 주는 해결되지 않은 위험만 `overall.topRisks`에 올려.
</analysis_contract>

<write_contract>
18. `업무현황 요약 DB`에 `전체 / YYYY-MM-DD` 1건과 요약 대상 프로젝트별 `프로젝트명 / YYYY-MM-DD` 1건을 저장해. 같은 `run_id` 또는 같은 `기준일 + 프로젝트명` 페이지가 있으면 새로 만들지 말고 갱신해.
19. `프로젝트명 = 규칙 입력` 또는 `run_id`가 `rule-input:`으로 시작하는 페이지는 수정하지 마.
20. 전체 페이지 본문에는 스키마와 일치하는 전체 JSON 결과를 하나의 JSON 코드 블록으로 저장해.
</write_contract>

<verification_loop>
21. 저장한 페이지를 다시 읽어 속성·페이지 수·JSON 파싱 여부를 검증해. 대시보드 재동기화는 시스템이 별도로 수행하므로 로컬 명령을 실행하지 마.
</verification_loop>

<compact_output_contract>
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
</compact_output_contract>


## PROJECT_BRIEFING_TEMPORAL_V1 · 현재 상태 검증

- 기준일은 실행 시각의 Asia/Seoul 날짜다. 규칙 입력의 generatedAt은 자료 수집 시각이며 오늘 날짜로 바꾸지 않는다. 기준일보다 오래된 입력이면 분석 한계에 명시한다.
- 프로젝트 브리핑의 목적은 현재 전달된 빌드와 다음 준비 빌드, 남은 검증을 설명하는 것이다. 먼저 프로젝트별 근거를 시간순으로 대조한 뒤 currentProgress / buildRelease / data를 작성한다.
- 스프린트는 작업 범위, build version은 전달 산출물의 식별자다. 숫자가 같아도 동일 대상으로 합치지 않는다. buildRelease는 '현재 마지막으로 확인된 전달·배포 빌드 → 다음 준비 빌드 → 다음 단계·남은 검증' 순서로 스프린트·빌드 버전·플랫폼·전달 대상을 구분한다. 없는 값은 미확인으로 남긴다.
- 예정 → 준비 → 전달 완료 → QA → 심사 → 스토어 배포는 서로 다른 상태다. 전달을 출시로, QA 일부 성공을 전체 완료로 승격하지 않는다. Git 커밋/태그만으로 빌드 전달을 확정하지 않는다.
- '오늘/내일/이번 주'는 원문 작성 시각 기준 절대 날짜로 풀어 쓴다. 부모 글과 답글의 날짜·발췌를 분리한다. parentContext는 과거 맥락이며 답글 날짜로 재확인된 사실이 아니다. 답글이 직접 확인한 내용만 새 증거로 사용한다.
- 기준일이 지난 예정일은 완료·실패·지연의 증거가 아니다. 같은 프로젝트·스프린트·버전·플랫폼·전달 대상의 후속 전달/취소/수정 기록을 대조하고 결과가 없으면 'YYYY-MM-DD 전달 예정 기록, 이행 여부 미확인'으로 기록한다. 예정 기록을 현재 현황의 대표 문장으로 복사하지 않는다.
- 최근 7일 빈도는 자료 탐색 보조일 뿐 현재 출시 상태 판정 기준이 아니다. 마지막 확인된 전달 빌드는 더 오래되어도 확인 날짜와 함께 유지한다. 새로운 준비 빌드는 별도 표시하며 이전 전달 사실을 지우지 않는다.
- 허용된 채널과 연결된 스레드/회의록에서 후속 결과를 확인한다. 입력 발췌가 잘렸거나 마지막 상태를 확인할 수 없으면 buildRelease에 확인된 사실만 남기고 confidenceLimits에 제한을 기록한다. 정보 부족을 실행 병목으로 바꾸지 않는다. 새 분석에서는 프로젝트 `confirmationRequired` 내용을 작성하지 않는다. 당일 outputSchema가 레거시 필드를 required로 요구하면 `[]`만 넣고 UI에는 노출하지 않는다.
- 각 상태 주장에 날짜·출처·원문 링크를 evidence로 연결한다. 나중에 작성된 문서가 옛 버전을 설명할 수도 있으므로 문서 작성일과 사건 날짜를 구분한다. 같은 대상의 순차 상태 변경은 모순이 아니며, 동시점에 서로 양립 불가한 주장만 sourceConflicts에 남긴다.
- 저장 전 검증: (1) 기준일 현재형 주장에 직접 근거가 있는가 (2) 지난 예정일이 현재처럼 남아 있는가 (3) 스프린트와 빌드 번호를 섞었는가 (4) 전달/QA/출시를 구분했는가 (5) 이전 빌드와 다음 빌드를 구분했는가. 실패하면 다시 작성하고, 근거가 부족하면 partial과 확인 제한으로 기록한다.
- 검증 예시: 9월21일 기준 스프린트3의 빌드 버전 3.5가 전달되어 있고 스프린트3.5 빌드를 준비 중이면 두 대상을 분리한다. 9월3일 '오늘 슈센에 빌드를 전달하기로 한 날'을 현재 상태로 출력하면 실패다. 이는 검증 사례이며 실제 프로젝트 상태로 상수 삽입하지 않는다.

## PROJECT_BRIEFING_OUTCOMES_V2 · 빌드 상태와 성과

- `buildRelease`: 현재 마지막으로 확인된 전달·배포 빌드 → 다음 준비 빌드 → 다음 단계·남은 검증을 **2~3문장**으로 종합한다. 먼저 두 빌드를 별도로 판정하고 날짜·대상은 보존한다. Slack 원문·인사·멘션·체크리스트를 길게 복사하지 않는다. 일반 담당 변경/아트 실험은 `currentProgress` 대상이며 출시 사실이 아니다.
- `data`: **현재 전달·배포 빌드의 성과 지표와 A/B 실험 결과**다. Notion/Slack 정상 여부, 수집 시각, 분석 갱신 여부, 작업 수는 넣지 않는다. 출처 상태는 `sourceHealth`/스키마의 출처 상태 영역에만 둔다.
- 지표는 대상 빌드, 플랫폼·국가, 관찰 기간, 코호트/실험군, 수치·단위·분모를 확인한다. 직접 확인된 부분만 짧게 요약하고 비교 조건이 다르면 개선/악화를 단정하지 않는다. 빠진 조건은 `confidenceLimits`에 쓴다. 해당 빌드에 연결된 성과 근거가 전혀 없으면 `data=null`이다.
- D1 retention은 설치 코호트와 D1 관찰 완료 여부를 확인한다. RV는 총 횟수, 사용자당, DAU당 등 원문 집계 단위를 유지한다. 값·분모·표본을 만들어내지 않는다.
- A/B는 실험명, 주요 판단 지표, 그룹별 결과, 표본/판정 근거를 구분한다. 수치가 높다는 이유만으로 승리 그룹으로 확정하지 않는다. 원문이 잠정/관찰 중이면 그대로 쓰고 공식 승리 판정과 적용 결정도 구분한다.
- 일일 고객 피드백 리포트는 빌드·출시·성과 지표가 아니다. 해당 빌드와 직접 연결된 품질 보조 근거일 때만 사용하고, D1·RV·A/B 결과를 대신하지 않는다. 과거 빌드/버전 불명 지표를 현재 빌드 성과로 전용하지 않는다.
- 프로젝트 브리핑에 `confirmationRequired` 내용을 새로 작성하거나 UI에 노출하지 않는다. 레거시 스키마가 required로 요구할 때만 `[]`을 넣는다. 정보 부족은 `confidenceLimits`, 실제 실행 차단은 `projects[].blockers`, 근거 있는 확인 행동은 `nextActions.kind=suggested_check`로 구분한다.
- 검증: 원문 나열, 성과 대신 출처 상태, 빌드/스프린트 혼동, 근거 없는 수치·승리 판정, 형식적인 확인 항목이 있으면 저장 전에 다시 작성한다. 출력 필드 이름과 타입은 당일 `outputSchema`를 유지한다.

## DELTAS_INPUT_CONTRACT_V1

변경 이력의 정식 경로는 `rules.deltas`다. 기존 수집기 계약이므로 최상위 `deltas`가 없다는 이유로 실패 처리하지 않는다. 호환 입력으로 최상위 `deltas`만 있는 경우도 허용한다. 둘 중 하나에 배열이 있으면 입력을 그대로 읽고, 둘 다 있으면 두 배열의 내용이 같은지 확인하고 한 번만 사용한다. 둘 다 누락되거나 제공된 값이 배열이 아니거나 서로 다르면 실패 처리한다. `[]`는 변경 없음이며 누락이 아니다. 분석 에이전트는 이를 위해 규칙 입력 페이지를 수정하거나 외부 출처로 변경 이력을 재구성하지 않는다.

## PROJECT_BRIEFING_DATA_QUALITY_AND_INPUT_LOCK_V2

아래 규칙은 프로젝트 브리핑을 작성할 때 앞선 일반적인 요약 규칙보다 우선해.

- `data`에는 현재 전달·배포 빌드에 연결된 D1·D7·RV·ARPDAU·퍼널·A/B 등 성과 지표와 실험 결과만 써. 로그 누락·이벤트 적재 오류·비정상 값 사용자 수·QA 점검·Notion/Slack 수집 상태·작업 수는 성과 지표가 아니므로 `data`에 쓰지 마. 해당 빌드의 성과 근거가 없으면 `data=null`로 두고 필요한 제한만 `confidenceLimits`에 기록해.
- 데이터 오류가 실제 실험·출시 판단을 막는다는 직접 근거가 확인된 경우에만 그 영향을 `blockers`에 기록해. 오류 점검 자체를 빌드 성과로 표현하지 마.
- 지표를 쓸 때 빌드 버전, 플랫폼·국가, 관찰 기간, 코호트·실험군, 수치·단위·분모를 확인해. 조건이 빠지면 확인된 범위만 쓰고 제한을 남겨. 단순 수치 우세를 A/B 승리 그룹으로 확정하지 마.
- 같은 `run_id`의 규칙 입력 페이지가 여러 개면 `pageId`, 본문 `generatedAt`, 규칙·프로젝트·근거 내용을 비교해. 생성 시각만 다른 동일 본문이면 최신 페이지를 기준으로 삼고, 근거·범위·규칙이 다르면 임의 선택하지 말고 입력 충돌로 실패 또는 `partial`을 기록해.
- 분석 시작 후 입력 페이지가 다시 생성·갱신되면 처음 읽은 입력을 기준으로 분석을 계속해. 저장 직전에 `pageId`·`generatedAt`·내용 지문을 다시 확인하고 달라졌다면 최신 입력까지 분석했다고 쓰지 말고 `confidenceLimits`에 기준 시각과 이후 입력 미반영을 남겨.
- `agent-analysis:`·`dashboard-snapshot:` 접두사는 Notion 저장 페이지 조회용 식별자야. 결과 JSON의 `runId`는 반드시 `YYYY-MM-DD-morning`으로 유지해.
- 같은 날짜의 분석·스냅샷 페이지가 여러 개면 첫 행을 임의 선택하지 말고 내용·생성 시각·실행 ID를 비교해. 결정할 수 없으면 `partial`과 최신성 제한을 남겨. 중복 페이지를 임의 삭제하지 마.
- 분석 저장 후 더 최신 입력·근거가 생기면 이전 결과를 현재 결과처럼 표시하지 마. 분석 시각과 입력 기준 시각을 함께 남겨 다음 실행에서 갱신할 수 있게 해.

저장 전 “이 값은 현재 빌드 성과인가, 아니면 수집·데이터 품질 상태인가?”를 확인해. 후자면 `data`에서 제거해. 또한 어느 입력 페이지를 기준으로 했는지 `pageId`·`generatedAt`·실행 ID로 재현되지 않으면 성공으로 보고하지 마.
