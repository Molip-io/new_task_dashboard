# STYLESEED.md — 디자인 락 (모든 UI 작업 전 재확인)

이 파일은 대시보드 UI의 확정된 디자인 결정입니다. UI를 수정하는 모든 에이전트/개발자는
이 값을 따르고, 임의로 변경하지 않습니다.

## 브랜드 컬러 (MOLIP 로고 기반) — 2026-08-06 액센트 확장
- 로고: 코랄 핑크 → 페리윙클 블루 그라데이션. 토큰 `--brand-grad`
  (`linear-gradient(135deg, var(--brand-pink), var(--blue))`).
- **브랜드 그라데이션 허용 위치는 이 목록으로 한정**한다. 새 위치 추가는 이 문서 갱신과 함께:
  1. `.eyebrow` 브랜드 마크(MOLIP · WORK MANAGEMENT)
  2. KPI 숫자 — **중립 지표만** (아래 예외 규칙 참조)
  3. 진행 바 `.progress span`
  4. 활성 탭 밑줄 `nav#tabs button.active` (2px, `background-size: 100% 2px`)
  5. 선택된 KPI 타일의 2px 링 (`.kpi.selected::after`, mask로 테두리만)
  6. 통합 분석 요약 좌측 바 `.analysis-summary::before`
  7. 상위 작업 키커 `.spec-kicker` 텍스트
- 그 외 기능 액센트는 **브랜드 블루 1개**: 링크·포커스 링·`.decision`/`.issue-row` 좌측 바.
  - 다크: `#8ea6f4` / 라이트: `#4a63cf`
- 핑크 단독 사용 금지(그라데이션 안에서만). 다크 `#f2879c` / 라이트 `#d9556f`.
- 상태색(red/orange/yellow/green)은 시맨틱 상태 전달에만. 장식·강조 금지.
- "정상"/"완료"/기본 상태는 상태색이 아닌 **중립 회색**.
- **KPI 숫자 색 규칙 (중요)**: 문제 0건인 중립 지표만 `--brand-grad`.
  `.kpi.error`/`.kpi.warning`은 그라데이션을 끄고(`-webkit-text-fill-color: currentColor`)
  상태색(red/orange)을 쓴다. 5개 전부 그라데이션으로 칠하면 위험 신호가 죽는다.

## 테마 (라이트/다크)
- 다크 기본, `<html data-theme="light|dark">`로 전환. 토큰은 style.css `:root`(다크)와
  `:root[data-theme="light"]`(라이트) 두 블록에서만 정의.
- 초기값: localStorage `dashboard-theme` → 없으면 `prefers-color-scheme`.
- 헤더의 테마 버튼은 전환 대상을 라벨로 표시("라이트 모드"/"다크 모드").
- 컴포넌트에 hex 하드코딩 금지 — 반드시 토큰 참조 (두 테마 모두 자동 대응).

## 상태 표시
- 이모지(🔴🟠🟡🔵🟢⚪⚠) 사용 금지.
- **컬러 닷(9px 원) + 텍스트** 조합: `<span class="dot {tone}"></span>텍스트`.
  `error`/`warning`만 3px 발광 링(`box-shadow`)을 더한다. 나머지 톤은 플랫.
- JS에서는 `badge(라벨, 톤)` 헬퍼가 `.status`(닷+텍스트) 마크업을 생성. 필 배경 `.badge`는
  샘플 데이터 표시·탭 카운트 등 비상태 라벨 전용.

## 레이아웃 — 벤토 그리드 (2026-08-05 확정)
- 브리핑 탭은 6컬럼 벤토 그리드(`.bento`, gap 10px). 데이터 신뢰가 항상 가장 길어
  **2행 높이 우측 레일**로 두고 왼쪽을 채운다:
  판단 `span-4` · 데이터 신뢰 `span-2 row-2` · 막힌 것 `span-4` · 달라진 것 `span-6`.
  (신뢰를 1행에 두면 판단 카드 하단에 사공간 ~270px 발생 — 이 배치로 해결)
- KPI 5타일은 같은 gap의 상단 밴드. 드릴다운 상세는 밴드 아래 전폭.
- 반응형: ≤1000px에서 전폭 + `row-2` 해제, ≤640px에서 KPI 2컬럼. KPI는 5→3→2컬럼.
- 인터랙션 어포던스: 클릭형 타일은 hover에 inset 1px 링, 선택 시 브랜드 그라데이션 2px 링.
  접이식 행(`details`) summary에는 `▾/▴` 표시.

## 표면(서피스) — 레이어드 (2026-08-06 확정, 이전 "평면 단색" 규정 대체)
- **테두리 대신 그라데이션 + 헤어라인 + 리프트**로 층을 만든다. 카드에 `border` 금지.
- 카드·타일·툴바·확인필요 그룹: `background: var(--panel-grad)` +
  `box-shadow: var(--hairline), var(--lift)`.
  - `--panel-grad` 다크 `#1c2132 → #161b28` / 라이트 `#ffffff → #f7f9fd`
  - `--hairline` = 상단 밝은 1px + **하단 1px**. 하단 헤어라인 빼면 카드 아래쪽 경계가
    배경에 녹아 카드가 짧게 끝난 것처럼 보인다(실측으로 확인된 문제) — 지우지 말 것.
  - 그라데이션 끝색은 `--bg`와 최소 2단계 밝기 차를 유지한다(다크 `#161b28` vs `#0b0d12`).
- 카드 안 우물(well) 영역(인용·액션·미니 통계·표 헤더)은 `--well`(반투명 흰/검 그라데이션).
  반투명이므로 어떤 부모 위에서도 자동으로 한 층 들어가 보인다.
- 카드 내부 구획선만 `--line-soft` 실선 허용.

## 형태
- Radius 4단: 카드 `20px` · 우물/스펙 `14px`(`--radius-well`) ·
  컨트롤(버튼/셀렉트/인풋) `10px` · 배지/닷 `pill(999px)`.
- 컨트롤 높이 통일: padding `8px 12px`, font-size 13px.

## 타입 스케일 (2026-08-06 확대, 9단)
`11 / 12 / 13 / 14 / 16 / 23 / 25 / 40px` + KPI 숫자 `46px`.
- `40px` = h1(`font-weight: 800`, `letter-spacing: -.05em`) · `25px` = 섹션 h2 ·
  `23px` = 신뢰 미니타일·스펙 진행률 숫자 · `16px` = 카드 h3·프로젝트·담당자·상위 작업 제목 ·
  `14px` = 판단/이슈 행 제목 · `13px` = 본문·컨트롤 · `12px` = 보조 · `11px` = 메타·배지·글리프.
- 이 9개 외 크기 사용 금지. 장식 글리프(`▾`, `→`)도 스케일 안에서 고른다.
- 모바일(≤640px): h1 `25px` · h2 `23px` · KPI 숫자 `40px`로만 축소. 다른 단계는 그대로.

## 간격 — 밀도 우선 (2026-08-06, 8px 그리드 완화)
허용 값: `4 / 6 / 7 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 28px`.
- 카드 padding `16px 18px` · KPI padding `18px`(min-height 124px) ·
  벤토·KPI gap `10px` · 리스트 gap `6px` · 표 행 padding `7px 12px` ·
  body padding `20px 28px 56px`.
- **밀도와 타이포 확대는 서로 상쇄된다**: 실측상 브리핑 총높이 886→861px(-25px)뿐.
  화면당 정보량을 더 늘리려면 KPI 타일 크기부터 줄여야 한다.

## 모션 — "Calm"
- `150ms ease-out`, hover·탭 전환·아코디언 펼침에만. 콘텐츠 표시를 지연시키는 모션 금지.
- `prefers-reduced-motion: reduce` 시 전체 비활성.
