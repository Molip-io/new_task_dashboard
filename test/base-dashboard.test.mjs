import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBaseDashboard } from '../lib/base-dashboard.mjs';

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
