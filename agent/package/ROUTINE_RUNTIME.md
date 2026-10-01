# 아침 루틴 실행 환경

이 문서는 아침 통합 분석을 실행하는 **Claude Code 클라우드 루틴**의 도구와 입출력 경로다. 분석 규칙, 판단 기준, 출력 계약은 `01_AGENT_INSTRUCTIONS.md`와 `02_DAILY_RUN_PROMPT.md`가 정한다.

## 도구

- **Notion**: 아래 `agent/runtime/` 스크립트. 스크립트가 Notion API를 직접 호출한다.
- **Slack**: 루틴에 연결된 Slack 커넥터의 읽기 도구. 실행자 본인 계정 권한으로 동작한다.

저장소 안의 다른 로컬 데이터는 입력이나 근거로 쓰지 않는다. 예: `data/`, `dashboard.sample.json`, 스냅샷 파일, `prompts/`.

필요한 설정:
- `NOTION_TOKEN` 환경변수(대시보드 통합 토큰). 없으면 분석하지 않는다. 사람이 처리할 문제로 failed 보고한다.
- 수집용 `SLACK_TOKEN`(대시보드 수집 봇 토큰)과 `GITHUB_TOKEN`(읽기 전용) 환경변수. 없으면 해당 출처를 뺀 채 수집되고, 수집기가 그 한계를 `sourceHealth`에 남긴다. 분석은 계속한다.
- Slack 커넥터. 연결되지 않았거나 호출이 실패하면 분석은 계속한다. 대신 `sourceStatus`에서 Slack을 확인 불가로 두고 `confidenceLimits`에 남긴다. Slack을 확인하지 못한 것을 "충돌 없음"이나 "근거 없음"으로 쓰지 않는다.

## 실행 순서

### 0. 오늘 수집

```
node agent/runtime/collect.mjs
```

대시보드 수집기를 실행한다. 오늘 규칙 입력(`rule-input:YYYY-MM-DD-morning`)과 대시보드 스냅샷을 Notion에 게시한다. 변경 비교 기준은 Notion에 있는 전날 최신 스냅샷이다. 대시보드 화면(ChatGPT Sites)은 이 스냅샷을 읽는다. 따라서 분석이 실패하더라도 수집은 먼저 끝낸다.

- 수집 결과 JSON의 `status`, `missingTokens`, `preflight`, `errors`를 확인하고 완료 보고에 남긴다. `preflight`는 Notion·Slack·GitHub이 접속 가능하고 토큰이 있는지 수집 전에 점검한 결과다. `ok:false`인 출처는 환경 설정(토큰, 네트워크 허용 도메인)을 사람이 고쳐야 하는 문제로 보고한다. 수집은 그 출처를 뺀 채 계속된다.
- 수집이 실패하면 수집을 재시도하지 않는다. 1단계 입력 읽기로 넘어가 이미 게시된 오늘 입력이 있는지 확인한다.
- 수집기가 로컬에 쓰는 `data/` 파일은 실행 산출물이다. 커밋하지 않고, 분석 입력으로도 쓰지 않는다.

### 1. 입력 읽기

```
node agent/runtime/read-input.mjs --out /tmp/molip-agent/input.json
```

이 스크립트가 01 §3의 기준 페이지·조각 검증을 수행하고 하나의 논리 입력으로 복원한다. 검증 항목은 marker·runId·generationId·payload 속성 일치, 조각 순번·개수, `sectionCounts` 복원, `activeSpecIds`↔`specCatalog` 1:1, `rules.deltas`이다.

종료 코드별 처리:

| 코드 | 의미 | 처리 |
|---|---|---|
| 0 | 입력 준비됨 | 다음 단계로 |
| 2 | 입력 페이지 없음 | 10분 간격 최대 3회 재시도. 계속 없으면 `sourceStatus.ruleEngine=not_available`로 보고하고 종료 |
| 3 | 게시 중 | 10분 간격 최대 3회 재시도. 계속 게시 중이면 failed 보고 |
| 1 | 손상·불일치 | 즉시 failed 보고. 다른 출처로 재구성하지 않는다 |

`/tmp/molip-agent/input.json`은 끝까지 읽는다. 파일이 크면 나눠 읽거나 `node -e`로 필요한 필드를 뽑는다. 일부만 읽고 전체를 읽은 것처럼 판단하지 않는다.

### 2. 근거 대조

허용 범위는 01 §2와 같다. 모두 읽기 전용이다.
- **Notion 페이지**(회의록 URL, 작업·스펙 페이지): `node agent/runtime/notion-page.mjs <URL 또는 ID>`
- **Slack**: 입력 `slackScope.channels`에 있는 채널만 본다.
  - 커넥터 도구 중 채널 읽기(`slack_read_channel`), 스레드 읽기(`slack_read_thread`), 채널·메시지 검색만 쓴다.
  - 본인 계정은 DM·다른 채널도 볼 수 있다. 그래도 허용 채널 밖은 조회하지 않는다.
  - 메시지 발송·예약·초안·반응 추가·캔버스 수정 등 쓰기 도구는 쓰지 않는다.
  - 커넥터 대신 `SLACK_TOKEN`이 설정된 환경이라면 `node agent/runtime/slack-read.mjs history|thread ...`를 써도 된다.
- **Git**: 입력의 `gitEvidence`를 근거로 쓴다. 저장소를 받거나 바꾸지 않는다.

### 3. 결과 작성

`/tmp/molip-agent/analysis.json`에 입력 `outputSchema`를 따르는 전체 결과 JSON을 쓴다.
- `runId`는 `YYYY-MM-DD-morning`이다. 접두사를 붙이지 않는다.
- `generatedAt`은 작성 시각(ISO, `+09:00`)이다.

### 4. 사전 검증

```
node agent/runtime/save-analysis.mjs --dry-run --analysis /tmp/molip-agent/analysis.json --input /tmp/molip-agent/input.json
```

검증 항목은 스키마, 실행 ID, 프로젝트 목록, 프로젝트별 `projectBriefing`과 개조식 항목, `overall.summaryItems`, 스펙 1:1이다. 오류가 0이 될 때까지 결과를 고친다. `failed` 결과는 저장 대상이 아니다.

`warnings`는 개조식 항목에 이름이 없는 진행 중·진행 예정·확인 요청 스펙 목록이다. 현재·다음 빌드 범위에 드는 스펙이면 반드시 항목에 넣는다. 범위 밖(예: 더 뒤 스프린트)이라 뺀 스펙만 남아 있어야 한다.

### 5. 저장과 저장 후 검증

같은 명령에서 `--dry-run`을 뺀다. 스크립트가 차례로 수행하는 일:
1. 입력 세대가 처음 읽은 것과 같은지 재확인한다.
2. `전체 / YYYY-MM-DD`와 `프로젝트명 / YYYY-MM-DD` 페이지를 만들거나 갱신한다. 같은 날짜의 기존 페이지는 갱신하고, 중복은 만들지 않는다.
3. 저장한 JSON을 다시 읽어 비교한다.
4. 대시보드 파서로 오늘 분석으로 인식되는지 확인한다.

스크립트가 실패하면 성공으로 보고하지 않는다. 요약 DB 쓰기는 이 스크립트로만 한다.

### 6. 완료 보고

02 §7 형식으로 세션 마지막 메시지에 짧게 쓴다.

## 금지

- 저장소 파일 수정, git commit·push·PR 생성.
- `collect.mjs`(규칙 입력·스냅샷 게시)와 `save-analysis.mjs`(분석 저장) 밖에서 Notion에 쓰기. 원본 업무 수정.
- Slack 발송. 허용 채널 밖 조회.
