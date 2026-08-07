import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPersistentContexts } from '../lib/slack-context.mjs';
import { buildSpecInsights } from '../lib/spec-insights.mjs';

const NOW = Date.parse('2026-08-07T00:00:00Z');

function thread(messages) {
  return extractPersistentContexts({
    channel: 'pizzaready',
    projectName: '피자레디',
    recentDays: 7,
    now: NOW,
    messages,
  });
}

test('Given an older Slack workflow agreement, When historical context is extracted, Then it is marked persistent_context', () => {
  const contexts = thread([
    { ts: '1', time: '2026-07-20T00:00:00Z', text: '[피자레디] 3D & UI 아트 피드백 절차 변경', url: 'https://slack/parent' },
    {
      ts: '2', threadTs: '1', time: '2026-07-20T01:00:00Z',
      parentText: '[피자레디] 3D & UI 아트 피드백 절차 변경',
      text: '시안 리뷰에서 피드백을 취합하고 GO 또는 재작업 여부를 결정하기로 합의했습니다.',
      url: 'https://slack/reply',
    },
  ]);

  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].evidenceRole, 'persistent_context');
  assert.equal(contexts[0].topicKey, 'review_feedback');
  assert.match(contexts[0].excerpt, /재작업 여부/);
});

test('Given a historical suggestion without agreement, When context is extracted, Then it is excluded', () => {
  const contexts = thread([
    { ts: '1', time: '2026-07-20T00:00:00Z', text: '[피자레디] 피드백은 한 번에 모아서 전달하면 좋을 것 같아요.', url: 'https://slack/suggestion' },
    { ts: '2', time: '2026-07-20T02:00:00Z', text: '[피자레디] 리뷰 방식은 결정 필요', url: 'https://slack/pending' },
  ]);
  assert.deepEqual(contexts, []);
});

test('Given a historical progress report, When context is extracted, Then it is excluded', () => {
  const contexts = thread([
    { ts: '1', time: '2026-07-20T00:00:00Z', text: '숨겨진 사원 리소스를 전달했습니다.', url: 'https://slack/progress' },
  ]);
  assert.deepEqual(contexts, []);
});

test('Given a project-wide art workflow agreement, When specs are linked, Then only a role-relevant active spec receives it', () => {
  const contexts = thread([
    { ts: '1', time: '2026-07-20T00:00:00Z', text: '[피자레디] 3D & UI 아트 피드백 절차 변경', url: 'https://slack/parent' },
    {
      ts: '2', threadTs: '1', time: '2026-07-20T01:00:00Z',
      parentText: '[피자레디] 3D & UI 아트 피드백 절차 변경',
      text: '초기 정합성을 확인하고 시안 리뷰에서 취합한 뒤 적용하기로 합의했습니다.',
      url: 'https://slack/reply',
    },
  ]);
  const project = {
    name: '피자레디',
    specs: [
      { id: 'hidden', title: '라이브 이벤트 - 숨겨진 사원', tasks: [{ id: 'art', title: '온보딩 리소스 전달', status: '진행 중', team: '아트' }] },
      { id: 'dev', title: '서버 이벤트 보상', tasks: [{ id: 'dev-task', title: '보상 API 개발', status: '진행 중', team: '개발' }] },
    ],
  };
  const insights = buildSpecInsights({ project, persistentContexts: contexts });
  assert.equal(insights[0].evidence.filter(item => item.evidenceRole === 'persistent_context').length, 1);
  assert.equal(insights[1].evidence.filter(item => item.evidenceRole === 'persistent_context').length, 0);
});

test('Given Hidden Temple current evidence and an older Pizzaready art agreement, When the packet is built, Then recent execution and persistent context coexist', () => {
  const contexts = thread([
    { ts: '1', time: '2026-07-20T00:00:00Z', text: '[피자레디] 3D & UI 아트 피드백 절차 변경', url: 'https://slack/parent' },
    {
      ts: '2', threadTs: '1', time: '2026-07-20T01:00:00Z',
      parentText: '[피자레디] 3D & UI 아트 피드백 절차 변경',
      text: '초기 정합성 확인 후 시안 리뷰에서 피드백을 취합하고 GO 또는 재작업을 결정하기로 합의했습니다.',
      url: 'https://slack/reply',
    },
  ]);
  const [insight] = buildSpecInsights({
    project: {
      name: '피자레디',
      specs: [{
        id: '35fb4a46-5003-8016-82f4-d45d09802f54', title: '라이브 이벤트 - 숨겨진 사원',
        tasks: [{ id: 'resource', title: '온보딩 리소스 전달', status: '진행 중', team: '아트' }],
      }],
    },
    slackChannels: [{ channel: 'pizzaready', messages: [{ time: '2026-08-06', text: '숨겨진 사원 트윙클 리소스를 전달했습니다.' }] }],
    persistentContexts: contexts,
    commits: [{ workItemId: 'resource', committedAt: '2026-08-05', message: '숨겨진 사원 온보딩 리소스 추가', shortHash: 'abc123' }],
  });
  assert.equal(insight.specId, '35fb4a46-5003-8016-82f4-d45d09802f54');
  assert.ok(insight.evidence.some(item => item.evidenceRole === 'recent_execution' && item.source === 'slack'));
  assert.ok(insight.evidence.some(item => item.evidenceRole === 'persistent_context'));
});

test('Given newer context for the same workflow topic, When specs are linked, Then the newer agreement replaces the older one', () => {
  const contexts = [
    { source: 'slack', evidenceRole: 'persistent_context', topicKey: 'review_feedback', projectMatch: true, timestamp: '2026-07-10', title: '#pizza', excerpt: '아트 피드백은 취합하기로 합의했습니다.', url: 'old' },
    { source: 'slack', evidenceRole: 'persistent_context', topicKey: 'review_feedback', projectMatch: true, timestamp: '2026-07-25', title: '#pizza', excerpt: '아트 피드백 방식은 리뷰 미팅에서 확정하기로 변경했습니다.', url: 'new' },
  ];
  const [insight] = buildSpecInsights({
    project: { name: '피자레디', specs: [{ id: 's', title: '숨겨진 사원 아트', tasks: [{ id: 'a', title: '아트 리소스', status: '진행 중', team: '아트' }] }] },
    persistentContexts: contexts,
  });
  assert.deepEqual(insight.evidence.filter(item => item.evidenceRole === 'persistent_context').map(item => item.url), ['new']);
});
