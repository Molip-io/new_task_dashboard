# 몰입 업무현황 대시보드

Notion(작업현황 DB·회의록·프로젝트 리스트), Slack 프로젝트 대화, 프로젝트 Git 커밋을 매일 자동 수집해 프로젝트 진행·관리 누락·변화를 한 화면에서 확인하는 읽기 전용 대시보드입니다.

판정 가능한 사실은 구조화된 데이터와 규칙으로 계산하고, AI는 그 결과와 출처를 읽기 쉬운 문장으로만 요약합니다. 출처가 충돌하거나 관계 데이터가 없으면 임의로 해결하지 않고 `확인 필요` 또는 `판단 제한`으로 표시합니다.

## 실행

```bash
node server.mjs          # http://localhost:5678
```

토큰 설정 전에는 샘플 데이터가 표시됩니다.

## 최초 설정 (1회)

### 1. Notion 통합 토큰
1. https://www.notion.so/my-integrations → **새 통합** 생성 (워크스페이스: 몰입)
2. 기능: 콘텐츠 읽기·삽입·업데이트 + 사용자 정보 읽기(이름 표시용)
3. 노션에서 **몰입 최상위 페이지** → `⋯` → **연결** → 방금 만든 통합 추가
   (하위의 프로젝트 리스트·작업 현황·회의록·업무현황 요약 DB에 자동 상속)

### 2. Slack 봇 토큰
1. https://api.slack.com/apps → **Create New App**
2. OAuth & Permissions → Bot Token Scopes: `channels:read`, `channels:history`, `users:read`
   (비공개 채널이면 `groups:read`, `groups:history` 추가)
3. 워크스페이스에 설치 → `xoxb-...` 토큰 복사
4. 수집할 채널(몰입_피자레디 등)에 봇 초대: 채널에서 `/invite @봇이름`

### 3. .env 작성
```bash
cp .env.example .env   # 열어서 Notion·Slack·GitHub 토큰 입력
```

퇴사자 Notion 사용자 ID는 `.env`의 `IGNORED_NOTION_USER_IDS`에 쉼표로 추가합니다. 해당 사용자만 연결된 진행 중 작업항목은 숨기지 않고 `담당자 재지정 필요`로 표시합니다.

### 4. Git 저장소 연결

Notion **프로젝트 리스트 DB**의 `git` 속성에 GitHub 저장소 URL을 입력합니다. 대시보드는 저장소를 복제하지 않고 GitHub API로 기본 브랜치, 최근 push, 열린 PR의 활동을 수집합니다. 비공개 저장소는 `.env`의 `GITHUB_TOKEN`에 `repo` 읽기 권한이 필요하며, 로컬에서는 토큰이 없을 때 현재 `gh` 로그인을 보조 수단으로 사용합니다.

`config.json`의 `git.repositories`는 특정 프로젝트를 로컬 저장소로 대체해야 할 때만 사용합니다.

```json
"git": {
  "sinceDays": 30,
  "repositories": [
    { "name": "pizzaready-client", "path": "/absolute/path/to/repo", "project": "피자레디" }
  ]
}
```

작업항목과 커밋을 연결하려면 Notion 작업항목의 `Git 키` 속성 값을 커밋 제목에 포함합니다. 연결되지 않은 커밋은 프로젝트별 한 건의 관리 항목으로 집계합니다. Git은 진행 근거일 뿐이며 Git 활동만으로 Notion 상태를 자동 변경하지 않습니다.

### 5. 내장 에이전트 통합 분석 연결

기본 수집은 별도 OpenAI API를 호출하지 않습니다. 규칙 엔진은 분석 대상을 축약해 Notion **업무현황 요약 DB**의 `규칙 입력 / YYYY-MM-DD` 페이지에 게시합니다. 웹 에이전트는 로컬 파일에 접근하지 않고 이 원격 스냅샷과 연결된 Notion·Slack·GitHub만 사용해 통합 분석을 작성합니다. 다음 요약 동기화에서 최신 성공 결과를 대시보드와 병합합니다.

에이전트에는 [`prompts/업무대시보드_에이전트_실행지시.md`](prompts/업무대시보드_에이전트_실행지시.md)와 [`docs/에이전트_규칙엔진_하이브리드_설계.md`](docs/에이전트_규칙엔진_하이브리드_설계.md)를 전달하고 Notion 요약 DB 쓰기, Slack·Git 읽기 권한을 연결합니다.

직접 OpenAI API 방식은 선택적 대체 경로입니다. 별도 과금을 감수하고 사용할 때만 `.env`에서 `AI_SUMMARY_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`을 설정합니다.

## 데이터 갱신

- **자동**: 서버 실행 중이면 매일 `config.json`의 `scheduleTime`(기본 07:30)에 수집
- **에이전트 요약 동기화**: `summarySyncTime`(기본 09:00) 이후 당일 분석이 저장될 때까지 10분 간격으로 요약 DB만 확인
- **수동**: 대시보드 우상단 **↻ 새로고침** 버튼, 또는 `node collect.mjs`
- 직접 AI 호출 없이 규칙·에이전트 입력만 갱신: `node collect.mjs --no-ai`

## Vercel 배포

기존 `task-dashboard` Vercel 프로젝트를 교체할 때는 `vercel.json`의 단일 Node Function이 정적 화면·API·인증을 함께 처리합니다. 로컬 파일은 영구 저장소로 사용하지 않고, 화면용 최신 데이터는 Notion `업무현황 요약 DB`의 `dashboard-snapshot:YYYY-MM-DD` 페이지에 gzip+base64로 압축 저장합니다.

프로덕션 필수 환경변수:

- `NOTION_TOKEN`: 요약 DB 읽기·삽입·업데이트
- 대시보드 로그인: 현재 비활성화되어 있어 웹 UI와 일반 API는 인증 없이 접근합니다. 민감한 데이터를 외부에 공개하기 전 인증을 다시 추가해야 합니다.
- `CRON_SECRET`: Vercel Cron 전용 Bearer 비밀값
- `SLACK_TOKEN`: 선택 프로젝트 Slack 수집
- `GITHUB_TOKEN`: 비공개 GitHub 저장소 활동 수집

Vercel Cron은 UTC `22:30`에 실행되어 `Asia/Seoul` 기준 다음 날 `07:30`에 수집합니다. 웹 에이전트는 로컬에 접근하지 않고 Notion에 게시된 원격 규칙 입력만 읽습니다.

## 동작 방식

```
collect.mjs
 ├─ Notion REST API
 │   ├─ 프로젝트 리스트 DB  → 수집 대상·슬랙 채널·조회기간 설정
 │   ├─ "작업 현황" DB 자동 탐색 → 전 프로젝트 작업 (상태/담당자/마감일)
 │   ├─ "회의록" DB 자동 탐색   → 최근 14일 회의
 │   └─ 업무현황 요약 DB       → 기존 에이전트 요약 재활용
 ├─ Slack API → 프로젝트 채널 최근 N일 대화
 ├─ GitHub API → Notion의 git URL에서 최근 커밋·push·PR 활동 수집
 ├─ 규칙 처리
 │   ├─ `요약`이 체크된 프로젝트만 포함
 │   ├─ `일시 정지` 스펙·일감과 그 하위 일감은 수집 결과에서 제외
 │   ├─ 스펙→작업항목 2단계 계층·완료율·미배정 큐 계산
 │   ├─ 날짜·완료일·기한 초과·최신화·재작업·지연 기록 검증
 │   ├─ Notion 갱신과 Git 활동 불일치·연결 실패 검증
 │   ├─ 출처별 성공 시각과 Notion 필수 속성 세팅 검사
 │   └─ 전날 스냅샷과 상태·기한·담당 변화 비교
 ├─ data/agent-input.json → 로컬 진단용 규칙 패킷(웹 에이전트는 접근하지 않음)
 ├─ 업무현황 요약 DB의 규칙 입력 페이지 → 웹 에이전트용 원격 규칙 스냅샷
 ├─ 업무현황 요약 DB → 내장 에이전트의 최신 성공 분석을 읽어 병합
 ├─ data/dashboard.json → 웹 UI가 표시
 └─ data/snapshots/YYYY-MM-DD.json → 다음 수집의 전일 비교 기준
```

수집 설정(채널·조회 기간·키워드)은 노션 **프로젝트 리스트 DB**에서 관리 — 코드 수정 불필요.

담당자별 작업은 최상위 스펙의 공통 담당자를 중복 집계하지 않고 실제 작업항목 담당자만 집계합니다. 이 수치는 성과 순위가 아니라 기한 초과·최신화 누락·업무 집중을 찾아 재계획하기 위한 정보입니다.

## 첫 화면 판단 순서

1. 대표가 확인할 판단 — 기존 Notion·AI 요약에 명시된 판단 질문만 최대 5개
2. 현재 관리상 막힌 것 — 기한·데이터·최신화·연결 문제 우선
3. 어제와 달라진 것 — 저장된 전일 스냅샷이 있을 때만 표시

최상단에는 마지막 수집 시각, Notion·Slack·회의록·통합 분석 성공 여부, Notion 필수 속성 상태, Git 저장소 연결 상태를 고정 표시합니다. 메뉴는 `브리핑 / 프로젝트 / 담당자 / 확인필요`이며, 프로젝트에서는 프로젝트 전체 완료율 대신 스프린트별 완료율과 기한 초과를 보고 확인필요에서 관리 문제를 프로젝트별로 확인합니다.

실제 Slack 알림 발송은 하지 않습니다. 매 수집 후 `data/sync-event.json`에 `dashboardSyncCompleted` 이벤트만 기록하므로, 이후 notifier를 연결할 수 있습니다.

Notion·Slack 출처 대조는 내장 에이전트가 수행합니다. 대조가 실행되지 않았거나 일부 출처가 실패하면 `충돌 없음`으로 처리하지 않고 `대조 미실행` 또는 `부분 분석`으로 표시합니다. Notion 토큰이 없으면 실제 수집 대신 샘플 데이터가 표시됩니다.
