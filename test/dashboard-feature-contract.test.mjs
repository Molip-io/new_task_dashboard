import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const prototypePath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);
const apiPath = new URL('../api/app.mjs', import.meta.url);
const collectorPath = new URL('../lib/notion-collector.mjs', import.meta.url);
const collectPath = new URL('../collect.mjs', import.meta.url);
const managementPath = new URL('../public/dashboard-management.js', import.meta.url);
const presentersPath = new URL('../public/dashboard-presenters.js', import.meta.url);
const designPath = new URL('../DESIGN.md', import.meta.url);
const meetingSkillPath = new URL('../agent-package/skills/structured-meeting-evidence/SKILL.md', import.meta.url);
const prototype = fs.readFileSync(prototypePath, 'utf8');
const app = fs.readFileSync(appPath, 'utf8');
const api = fs.readFileSync(apiPath, 'utf8');
const notionCollector = fs.readFileSync(collectorPath, 'utf8');
const collector = fs.readFileSync(collectPath, 'utf8');
const management = fs.readFileSync(managementPath, 'utf8');
const presenters = fs.readFileSync(presentersPath, 'utf8');
const ui = `${app}\n${presenters}`;
const viewModel = fs.readFileSync(new URL('../public/dashboard-view-model.js', import.meta.url), 'utf8');
const design = fs.readFileSync(designPath, 'utf8');
const meetingSkill = fs.readFileSync(meetingSkillPath, 'utf8');
const specInsights = fs.readFileSync(new URL('../lib/spec-insights.mjs', import.meta.url), 'utf8');

test('Given the executive briefing, When reading its sections, Then one integrated analysis and the daily delta remain without duplicate issue lists', () => {
  const analysis = presenters.indexOf('1. 에이전트 통합 분석');
  const changed = presenters.indexOf('2. 어제와 달라진 것');

  assert.ok(analysis >= 0);
  assert.ok(changed > analysis);
  assert.doesNotMatch(presenters, /현재 관리상 막힌 것|대표가 확인할 판단/);
  assert.doesNotMatch(presenters, /decisionsForCEO|notionSummary\?\.decision/);
});

test('Given incomplete source data, When showing trust, Then the dashboard exposes concrete collection status without an inferred dependency conclusion', () => {
  assert.match(app, /데이터 수집 상태/);
  assert.match(app, /Notion 설정 확인/);
  assert.match(management, /Git URL 미입력/);
  assert.doesNotMatch(app, /의존관계/);
});

test('Given no prior snapshot, When rendering deltas, Then the dashboard shows an explicit empty state', () => {
  assert.match(presenters, /snapshotComparison\?\.reason/);
});

test('Given a read-only dashboard, When rendering decisions, Then no decision recording control exists', () => {
  assert.doesNotMatch(prototype, /결정 저장/);
  assert.match(presenters, /이 화면은 읽기 전용입니다/);
});

test('Given the requested navigation and terminology, When rendering the dashboard, Then work items are consistent and waiting impact is removed', () => {
  for (const menu of ['브리핑', '프로젝트', '담당자', '확인필요']) assert.match(prototype, new RegExp(menu));
  assert.match(app, /작업항목/);
  assert.doesNotMatch(app, /열린 자식 일감|팀 대기 영향|waitingOnMe|waitImpact/);
});

test('Given the accepted review, When reading the design, Then all P0 requirements are normative', () => {
  for (const requirement of ['계획 대비 기준선', '상태·기간 일치', '데이터 신선도', '전일 스냅샷']) {
    assert.match(design, new RegExp(`\\*\\*${requirement}\\*\\*`));
  }
  assert.match(design, /결정 안건 승격 규칙/);
  assert.match(design, /동일 ID와 동일 필드의 이전 값과 현재 값을 비교/);
  assert.doesNotMatch(design, /기본 정렬은 열린 자식 일감 수/);
  assert.doesNotMatch(design, /진행 중인데 7일간 편집 없음/);
});

test('Given Agent spec summaries, When reading the project-card contract, Then Agent narrative is preferred and exact IDs define the link', () => {
  assert.match(app, /analysisStatus: D\.ai\?\.analysisStatus/);
  assert.match(app, /sourceComparisonStatus: D\.ai\?\.sourceComparison\?\.status/);
  assert.match(app, /현재 확인된 실행 blocker 없음/);
  assert.match(app, /근거에서 다음 완료 지점을 특정할 수 없음/);
  assert.doesNotMatch(app, /통합 분석상 확인된 실행 병목 없음/);
  assert.match(viewModel, /item\.specId && item\.specId === spec\.id/);
  assert.doesNotMatch(viewModel, /normalizedSpecKey\(item\.title\)/);
});

test('Given the refined dashboard workflow, When reading the UI contract, Then projects group specs by sprint and people or checks do not expose completed work', () => {
  assert.match(app, /프로젝트 → 스프린트 → 상위 작업 → 작업항목/);
  assert.doesNotMatch(app, /스펙/);
  assert.match(app, /\$\('#loading'\)\.classList\.add\('hidden'\)/);
  assert.match(app, /new Map\(\(spec\.tasks \|\| \[\]\)\.map/);
  assert.match(app, /<details class="sprint-group"/);
  assert.match(app, /group\.overdueCount/);
  assert.doesNotMatch(app, /완료율 <b>\$\{project\.stats\.completionRate/);
  assert.doesNotMatch(app, /progress[^\n]*project\.stats\.completionRate/);
  assert.doesNotMatch(presenters, /project\.stats\.completionRate/);
  assert.match(app, /data-project-card=/);
  assert.match(app, /data-people-filter="project"/);
  assert.match(app, /data-person-detail-filter="sprint"/);
  assert.match(app, /groupIssuesByProjectItem/);
  assert.match(app, /관리 확인/);
  assert.doesNotMatch(app, /Notion 갱신|최신화 필요/);
});

test('Given a project spec, When its card opens, Then an integrated state briefing appears before the Notion work-item list', () => {
  for (const label of ['브리핑', '막힌 점', '다음 행동', '최근 근거', 'Notion 작업항목']) assert.match(app, new RegExp(label));
  const briefing = app.indexOf('spec-kicker"><span>브리핑');
  const evidence = app.indexOf('최근 근거', briefing);
  const workItems = app.indexOf('Notion 작업항목', evidence);
  assert.ok(briefing >= 0 && evidence > briefing && workItems > evidence);
  assert.doesNotMatch(app, /spec-kicker"><span>현재 진행/);
  assert.match(app, /spec-work-items-toggle/);
  assert.match(app, /<span class="toggle-open">열기<\/span><span class="toggle-close">접기<\/span> <span aria-hidden="true">→<\/span>/);
  for (const source of ['Notion', 'Slack', '회의록', 'Git']) assert.match(app, new RegExp(source));
  assert.doesNotMatch(app, /현재 확인된 직접 병목 없음/);
  assert.match(meetingSkill, /Spec Linking Rules/);
  assert.match(meetingSkill, /specId/);
  assert.doesNotMatch(app, /class="spec-type"/);
  assert.doesNotMatch(app, /지금 이 스펙|이 스펙의 Notion/);
  assert.doesNotMatch(specInsights, /구조와 배치.*폴리싱/);
});

test('Given collection health, When reading the briefing contract, Then concrete source status stays in the trust line without a dependency-coverage card', () => {
  assert.match(app, /데이터 수집 상태/);
  assert.match(app, /Notion/);
  assert.match(app, /Slack/);
  assert.match(app, /회의록/);
  assert.doesNotMatch(presenters, /수집·커버리지 공백|의존관계 검토|확정 일정 위험|관리 데이터 부족/);
});

test('Given the simplified briefing, When reading its KPI contract, Then five accessible drill-down metrics remain', () => {
  for (const detail of ['projects', 'work-items', 'setup', 'overdue', 'guide']) assert.ok(presenters.includes(`kpi('${detail}'`));
  const kpiStart = presenters.indexOf('<div class="kpis">');
  const kpiEnd = presenters.indexOf('</div>', kpiStart);
  const kpiRow = presenters.slice(kpiStart, kpiEnd);
  assert.ok(kpiRow.indexOf("kpi('projects'") < kpiRow.indexOf("kpi('work-items'") );
  assert.ok(kpiRow.indexOf("kpi('work-items'") < kpiRow.indexOf("kpi('overdue'") );
  assert.ok(kpiRow.indexOf("kpi('overdue'") < kpiRow.indexOf("kpi('guide'") );
  assert.ok(kpiRow.indexOf("kpi('guide'") < kpiRow.indexOf("kpi('setup'") );
  assert.match(presenters, /진행 준비 필요 항목/);
  assert.match(app, /briefingDetail/);
  assert.match(app, /aria-expanded/);
  assert.doesNotMatch(presenters, /kpi\([^\n]*missingDateWorkItems|kpi\([^\n]*needsCheckProjects|kpi\([^\n]*recentGitProjects|kpi\([^\n]*gitNotionMismatchProjects/);
  assert.doesNotMatch(ui, /Notion 작업관리 상태|프로젝트별 관리 상태/);
});

test('Given management issues, When reading task and confirmation UI, Then actions and categories explain what to fix', () => {
  assert.match(app, /data-management-check/);
  assert.match(presenters, /권장 처리/);
  assert.match(app, /data-check-filter="category"/);
  for (const category of ['진행 준비', '가이드 위반', '일정 위험', '데이터 불일치', '연동 문제']) assert.match(app, new RegExp(category));
  assert.match(app, /기한 초과는 일정 위험이며/);
});

test('Given a work-item risk list, When sharing it with Slack, Then one concise bulk-copy control and item links are available', () => {
  assert.match(presenters, /data-copy-slack/);
  assert.match(ui, />복사</);
  assert.doesNotMatch(`${app}\n${presenters}`, /공유 링크 복사|data-copy-share-url/);
  assert.match(app, /data-copy-link/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /checkProject/);
  assert.match(app, /checkCategory/);
  assert.match(app, /checkIssue/);
});

test('Given Git collection health, When reading the trust line, Then it can open concrete repository details', () => {
  assert.match(app, /data-briefing-detail="git"/);
  for (const status of ['Git 인증 필요', 'Git URL 미입력', 'Git 부분 수집', 'Git 수집 실패', '최근 활동 없음']) {
    assert.match(`${app}\n${management}`, new RegExp(status));
  }
});

test('Given a serverless refresh, When Notion hydration is expensive or the platform returns plain text, Then the refresh path stays bounded and reports a readable error', () => {
  assert.match(notionCollector, /hydrateBodies = true/);
  assert.match(notionCollector, /checkComments = true/);
  assert.match(collector, /notionOptions/);
  assert.match(api, /hydrateBodies: false/);
  assert.match(api, /checkComments: true/);
  assert.match(api, /hydrateMeetingBodies: false/);
  assert.match(api, /hydrateSummaryBodies: false/);
  assert.match(app, /response\.text\(\)/);
  assert.match(app, /서버 수집 실패/);
  const notion = fs.readFileSync(new URL('../lib/notion.mjs', import.meta.url), 'utf8');
  assert.match(notion, /NOTION_REQUEST_TIMEOUT_MS/);
  assert.match(notion, /MAX_RATE_LIMIT_RETRIES/);
});
