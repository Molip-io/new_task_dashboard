import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpecInsights } from '../lib/spec-insights.mjs';

test('Given directly linked source activity, When spec insights are built, Then current state, blockers, action, and evidence stay with that spec', () => {
  const project = { specs: [{
    id: 'spec-1', title: '익스프레스', status: '진행 중', url: 'https://notion.so/spec',
    tasks: [
      { id: 'task-1', title: '익스프레스 기획', status: '확인 요청', team: '기획', assignees: ['a'], notionUpdatedAt: '2026-08-04T08:00:00Z', url: 'https://notion.so/task', overdueDays: 2 },
      { id: 'task-2', title: '익스프레스 개발', status: '진행 중', team: '개발', assignees: ['b'], notionUpdatedAt: '2026-08-03T08:00:00Z', overdueDays: 0 },
    ],
  }] };
  const [insight] = buildSpecInsights({
    project,
    slackChannels: [{ channel: 'pizzaready', messages: [
      { time: '2026-08-05T01:00:00Z', user: 'a', text: '익스프레스 기획 범위를 오늘 확정합니다.' },
      { time: '2026-08-05T02:00:00Z', user: 'b', text: '다른 시스템 작업입니다.' },
    ] }],
    meetings: [{ title: '주간 회의', date: '2026-08-04', content: '익스프레스 기획 범위와 개발 일정을 정리했습니다.', url: 'https://notion.so/meeting' }],
    commits: [{ workItemId: 'task-2', shortHash: 'abc12345', committedAt: '2026-08-05T03:00:00Z', author: 'b', message: '익스프레스 개발', url: 'https://github.com/commit' }],
  });

  assert.match(insight.summary, /활성 작업 2건/);
  assert.match(insight.blockers.join(' '), /기한 초과/);
  assert.match(insight.nextAction, /지연 사유/);
  assert.deepEqual(new Set(insight.evidence.map(item => item.source)), new Set(['notion', 'slack', 'meeting', 'git']));
  assert.ok(insight.evidence.every(item => !item.excerpt.includes('다른 시스템')));
});

test('Given a Slack thread reply whose parent names the work, When evidence is matched, Then the reply keeps the parent context', () => {
  const [insight] = buildSpecInsights({
    project: { specs: [{
      id: 'spec-1', title: '라이브 이벤트 마법 가마솥', status: '진행 중',
      tasks: [{ id: 'task-1', title: '마법 가마솥 보상 밸런스', status: '진행 중', team: '기획' }],
    }] },
    slackChannels: [{ channel: 'forge', messages: [{
      time: '2026-08-05', user: 'a', parentText: '마법 가마솥 보상 밸런스 논의', text: '수치는 오늘 다시 공유할게요.',
    }] }],
  });

  assert.equal(insight.evidence.filter(item => item.source === 'slack').length, 1);
  assert.match(insight.evidence.find(item => item.source === 'slack').excerpt, /마법 가마솥 보상 밸런스/);
  assert.match(insight.evidence.find(item => item.source === 'slack').excerpt, /수치는 오늘/);
});

test('Given Slack links to a Notion work item, When the visible message omits its title, Then the linked ID connects the latest thread progress without duplicating the root', () => {
  const taskId = '3b4b4a46-5003-800c-85ac-d970054bfbb7';
  const root = `<https://app.notion.com/p/UI-UI-2-${taskId.replaceAll('-', '')}|UI 연구> 하위 항목을 추가했습니다.`;
  const [insight] = buildSpecInsights({
    project: { specs: [{
      id: '3b3b4a46-5003-81e1-9428-e0b6a078b12c', title: 'UI 자동화 연구', status: '진행 중',
      tasks: [{ id: taskId, title: 'UI 시안 자동화', status: '진행 중', team: '개발' }],
    }] },
    slackChannels: [{ channel: 'ai', messages: [
      { time: '2026-08-04', text: 'UI 자동화 연구를 위해 샘플과 제작 규칙을 요청합니다.' },
      { time: '2026-08-05', text: root },
      { time: '2026-08-06', parentText: root, text: '레이어 그룹 상세 규칙을 구성하고 있습니다.' },
    ] }],
  });

  const slack = insight.evidence.filter(item => item.source === 'slack');
  assert.equal(slack.length, 2);
  assert.match(slack[0].excerpt, /레이어 그룹 상세 규칙/);
  assert.match(slack[1].excerpt, /샘플과 제작 규칙/);
});

test('Given a generic meeting title with relevant body text, When evidence is matched, Then the body excerpt is shown', () => {
  const [insight] = buildSpecInsights({
    project: { specs: [{
      id: 'spec-1', title: '비밀 과자점 온보딩', status: '진행 중',
      tasks: [{ id: 'task-1', title: '온보딩 연출', status: '진행 중', team: '아트' }],
    }] },
    meetings: [{ title: '주간 회의', date: '2026-08-05', content: '비밀 과자점 온보딩 연출은 목요일에 확인합니다.' }],
  });

  const evidence = insight.evidence.find(item => item.source === 'meeting');
  assert.ok(evidence);
  assert.match(evidence.excerpt, /비밀 과자점/);
});

test('Given a generic spec name, When unrelated source activity exists, Then it is not force-matched as evidence', () => {
  const [insight] = buildSpecInsights({
    project: { specs: [{ id: 'spec-1', title: '버그수정', status: '진행 중', tasks: [{ id: 'task-1', title: '개발', status: '진행 중', team: '개발' }] }] },
    slackChannels: [{ channel: 'general', messages: [{ time: '2026-08-05', text: '다른 프로젝트 버그 수정 완료' }] }],
    meetings: [{ title: '개발 회의', date: '2026-08-05' }],
    commits: [{ shortHash: 'deadbeef', committedAt: '2026-08-05', message: '개발 수정' }],
  });

  assert.deepEqual(insight.evidence, []);
});

test('Given a broad live-event mention and overlapping source or resource words, When evidence is matched, Then it is not attached to a specific cauldron work item', () => {
  const [insight] = buildSpecInsights({
    project: { specs: [{
      id: 'spec-1', title: '라이브 이벤트 - 마법 가마솥', status: '진행 예정',
      tasks: [{ id: 'task-1', title: '궁극의 비법 소스 리소스 대응 (마법 가마솥)', status: '진행 예정', team: '기획' }],
    }] },
    slackChannels: [{ channel: 'pizza', messages: [{
      time: '2026-08-05', text: '비밀 과자점 팝업은 과자집 리소스를 활용하여 디저트 컨셉으로 적용했습니다.',
    }] }],
    meetings: [{ title: '전략 회의', date: '2026-08-05', content: '본사·공장·농장·라이브 이벤트 등을 월드맵 오브젝트로 구성합니다.' }],
  });

  assert.deepEqual(insight.evidence, []);
});

test('Given in-progress and planned work together, When the next action is derived, Then the active completion point is checked first', () => {
  const [insight] = buildSpecInsights({
    project: { specs: [{
      id: 'spec-1', title: '숨겨진 사원', status: '진행 중',
      tasks: [
        { id: 'task-1', title: '기능 개발', status: '진행 중', team: '개발' },
        { id: 'task-2', title: '후속 연출', status: '시작 전', team: '아트' },
      ],
    }] },
  });

  assert.match(insight.nextAction, /다음 완료 지점/);
});
