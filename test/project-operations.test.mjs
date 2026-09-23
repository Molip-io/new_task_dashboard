import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProjectOperations } from '../lib/project-operations.mjs';

test('Given recent project Slack lifecycle messages, When operations are built, Then build QA release and data evidence are classified', () => {
  const messages = [
    ['2026-09-04T09:00:00.000Z', 'SP3 업로드 빌드 공유 완료 · APK와 TestFlight 전달'],
    ['2026-09-04T10:00:00.000Z', 'Fun QA 및 디렉터 리뷰 진행 후 검수 예정'],
    ['2026-09-04T11:00:00.000Z', 'AOS 마켓 업로드 완료, iOS 자동 출시'],
    ['2026-09-04T12:00:00.000Z', 'CPI 테스트 결과 지표와 이벤트 로그 확인'],
  ].map(([time, text], index) => ({ time, text, url: `https://slack.test/${index}` }));
  const operations = buildProjectOperations([{ channel: 's2_forge_and_fortune', messages }]);

  assert.ok(operations.latestBuild);
  assert.ok(operations.latestQa);
  assert.ok(operations.latestRelease);
  assert.ok(operations.latestData);
  assert.ok(operations.evidenceCount >= 4);
  assert.equal(operations.evidence.every(item => item.evidenceRole === 'project_operation'), true);
});

test('a recent thread reply does not redate or prepend an old build plan', () => {
  const ops = buildProjectOperations([{channel:'builds',messages:[
    {time:'2026-09-03T00:00:00Z',text:'9/3 오늘 슈센에 빌드를 전달하기로 한 날입니다',url:'https://slack.test/parent'},
    {time:'2026-09-21T00:00:00Z',text:'스프린트3.5 빌드 준비 중',parentText:'9/3 오늘 슈센에 빌드를 전달하기로 한 날입니다',threadTs:'1788393600',url:'https://slack.test/reply'},
  ]}]);
  assert.equal(ops.latestBuild.excerpt,'스프린트3.5 빌드 준비 중');
  assert.equal(ops.latestBuild.parentContext.timestamp,'2026-09-03T00:00:00.000Z');
  assert.equal(ops.events.find(e=>e.url.endsWith('/parent')).timestamp,'2026-09-03T00:00:00Z');
});

test('a generic reply to a build thread cannot become a new build event', () => {
  const ops = buildProjectOperations([{channel:'builds',messages:[{time:'2026-09-21T00:00:00Z',text:'감사합니다',parentText:'9/3 빌드 전달 예정',threadTs:'1788393600'}]}]);
  assert.equal(ops.latestBuild,null);
});

test('last release survives a busy newer QA window', () => {
  const messages=[{time:'2026-09-03',text:'스프린트3 빌드 버전 3.5 출시 완료',url:'https://slack.test/release'},...Array.from({length:15},(_,i)=>({time:`2026-09-21T01:${String(i).padStart(2,'0')}:00Z`,text:'스프린트3.5 QA 준비',url:`https://slack.test/qa/${i}`}))];
  const ops=buildProjectOperations([{channel:'builds',messages}]);
  assert.equal(ops.latestRelease.url,'https://slack.test/release');
  assert.ok(ops.evidence.some(e=>e.url==='https://slack.test/release'));
});

test('explicit later delivery keeps its own words and links the original plan as context', () => {
  const ops=buildProjectOperations([{channel:'builds',messages:[{time:'2026-09-04T00:00:00Z',text:'전달 완료했습니다',parentText:'9/3 스프린트3 빌드 버전 3.5 전달 예정',threadTs:'1788393600',url:'https://slack.test/delivered'}]}]);
  assert.equal(ops.latestBuild.excerpt,'전달 완료했습니다');
  assert.equal(ops.latestBuild.timestamp,'2026-09-04T00:00:00Z');
  assert.match(ops.latestBuild.parentContext.excerpt,/스프린트3 빌드 버전 3.5/);
  assert.notEqual(ops.latestBuild.parentContext.timestamp,ops.latestBuild.timestamp);
});


test('RV, ARPDAU and A/B outcome messages survive collection without becoming release facts', () => {
  for (const text of ['RV 4회/DAU', 'ARPDAU $0.12', 'A/B B그룹 잠정 우세', '보상형 광고 4회/인']) {
    const ops = buildProjectOperations([{ channel: 'metrics', messages: [{ time: '2026-09-21', text }] }]);
    assert.equal(ops.latestData.excerpt, text);
    assert.equal(ops.latestRelease, null);
    assert.equal(ops.latestBuild, null);
  }
});

test('customer feedback reports never become build, release, or KPI events', () => {
  const ops = buildProjectOperations([{ channel: 'pizza-ready', messages: [
    { time: '2026-09-21T02:00:00Z', url: 'https://slack.test/feedback', text: 'Pizza Ready 일일 피드백 리포트 (9/20) Overall Summary 총 인입수: 158건 부정 감정 비율: 24.7% Critical 이슈 발생건수: 9건' },
    { time: '2026-09-20T02:00:00Z', url: 'https://slack.test/release', text: 'AOS 60.1.0 배포 완료' },
  ] }]);
  assert.equal(ops.latestBuild.url, 'https://slack.test/release');
  assert.equal(ops.latestRelease.url, 'https://slack.test/release');
  assert.equal(ops.latestData, null);
  assert.ok(!ops.evidence.some(item => item.url === 'https://slack.test/feedback'));
});

test('qualified project meetings expose late build and metric decisions independently of spec names', () => {
  const ops = buildProjectOperations([], [{
    title: '포지앤포춘 주간 스크럼', date: '2026-09-22', url: 'https://notion.test/meeting', contentChecked: true,
    content: `${'광맥 색상 방향을 논의했다. '.repeat(40)}\n스프린트 3.5 빌드 V3 제출 전 QA 필요.\n빌드 3.5 D1 32%, 설치 코호트 9/19 기준.`,
  }]);
  assert.equal(ops.source, 'meeting');
  assert.equal(ops.latestBuild.timestamp, '2026-09-22');
  assert.match(ops.latestBuild.excerpt, /V3 제출 전 QA 필요/);
  assert.match(ops.latestData.excerpt, /D1 32%/);
  assert.equal(ops.latestLifecycleSignal.source, 'meeting');
  assert.ok(ops.evidence.every(item => item.source === 'meeting' && item.title === '포지앤포춘 주간 스크럼' && item.url === 'https://notion.test/meeting'));
  assert.ok(ops.evidence.every(item => !item.excerpt.includes('광맥 색상')));
});

test('confirmed delivery wording survives newer build and release plans', () => {
  const ops = buildProjectOperations([{ channel: 'builds', messages: [
    { time: '2026-09-03', text: '스프린트 3 빌드 3.5 전달 완료', url: 'https://slack.test/delivery' },
    ...Array.from({ length: 12 }, (_, index) => ({ time: `2026-09-22T12:${String(index).padStart(2, '0')}:00Z`, text: '스프린트 3.5 빌드 QA 후 출시 예정', url: `https://slack.test/plan/${index}` })),
  ] }]);
  assert.ok(ops.evidence.some(item => item.url === 'https://slack.test/delivery'));
  assert.match(ops.latestBuild.excerpt, /출시 예정/);
});

test('a qualified meeting remains available when more recent Slack covers every lifecycle category', () => {
  const messages = Array.from({ length: 15 }, (_, index) => ({ time: `2026-09-23T12:${String(index).padStart(2, '0')}:00Z`, text: '빌드 QA 출시 예정 및 D1 지표 수집 준비', url: `https://slack.test/recent/${index}` }));
  const ops = buildProjectOperations([{ channel: 'builds', messages }], [{ title: '프로젝트 주간 회의', date: '2026-09-22', content: '빌드 QA 승인 대기', url: 'https://notion.test/meeting' }]);
  assert.equal(ops.source, 'mixed');
  assert.ok(ops.evidence.some(item => item.source === 'meeting' && item.url === 'https://notion.test/meeting'));
  assert.equal(ops.latestBuild.source, 'slack');
});
