import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBaseDashboard } from '../lib/base-dashboard.mjs';
import { buildManagementDashboard } from '../lib/dashboard-model.mjs';

test('Given shared and explicitly assigned meeting rows, When project candidates are built, Then partial project names do not cross project boundaries', () => {
  const dashboard = buildBaseDashboard({
    notion: {
      projects: [{ name: '피자레디' }, { name: '포지 앤 포춘' }],
      summaryRows: [],
      meetings: [
        { project: '', title: '공유 회의 후보' },
        { project: '피자레디', title: '피자레디 회의' },
        { project: '피자', title: '부분 이름 회의' },
        { project: '포지 앤 포춘', title: '포지 회의' },
      ],
    },
    slack: {}, errors: [], dashboardUrl: 'http://localhost:5678',
  });

  const pizza = dashboard.projects.find(project => project.name === '피자레디');

  assert.deepEqual(pizza.meetings.map(meeting => meeting.title), ['공유 회의 후보', '피자레디 회의']);
});

test('meeting titles prevent cross-project evidence while generic notes remain spec candidates only', () => {
  const base = buildBaseDashboard({
    notion: {
      projects: [{ name: '피자레디' }, { name: '포지 앤 포춘' }], summaryRows: [],
      meetings: [
        { project: '', title: 'Pizza Ready 주간 회의', content: 'AOS 빌드 60.1 배포 완료', date: '2026-09-21', url: 'https://notion.test/pizza' },
        { project: '', title: '포지앤포춘 주간 스크럼', content: '스프린트 3.5 빌드 QA 진행', date: '2026-09-22', url: 'https://notion.test/forge' },
        { project: '', title: '공통 주간 회의', content: '빌드 출시 완료, D1 50%', date: '2026-09-23', url: 'https://notion.test/generic' },
        { project: '피자레디', title: '포지앤포춘과 공유한 회의', content: '피자 빌드 준비', date: '2026-09-20', url: 'https://notion.test/explicit' },
      ],
    }, slack: {}, errors: [], dashboardUrl: 'http://localhost',
  });
  const forge = base.projects.find(project => project.name === '포지 앤 포춘');
  assert.deepEqual(forge.meetings.map(meeting => meeting.url), ['https://notion.test/forge', 'https://notion.test/generic']);
  const dashboard = buildManagementDashboard({ base, tasks: [], workItems: [], issues: [], git: { commits: [] } });
  const ops = dashboard.projects.find(project => project.name === '포지 앤 포춘').projectOperations;
  assert.equal(ops.latestBuild.source, 'meeting');
  assert.equal(ops.latestBuild.url, 'https://notion.test/forge');
  assert.equal(ops.latestRelease, null);
  assert.equal(ops.latestData, null);
  assert.deepEqual(ops.evidence.map(item => item.url), ['https://notion.test/forge']);
});
