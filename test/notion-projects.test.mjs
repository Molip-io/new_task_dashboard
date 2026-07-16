import assert from 'node:assert/strict';
import test from 'node:test';

import { parseProjectRows } from '../lib/notion-collector.mjs';

test('Given a selected Notion project with a Git property, When project rows are parsed, Then the Git URL is preserved', () => {
  const rows = [{
    _id: 'pizza',
    이름: '피자레디',
    git: 'https://github.com/MolipLtd/Pizza-Idle.git',
    요약: true,
  }];

  const [project] = parseProjectRows(rows, { slackDaysDefault: 3 });

  assert.equal(project.gitUrl, 'https://github.com/MolipLtd/Pizza-Idle.git');
});

test('Given a project without a Git property, When project rows are parsed, Then the Git URL is explicitly null', () => {
  const rows = [{ _id: 'other', 이름: '다른 프로젝트', 요약: true }];

  const [project] = parseProjectRows(rows, { slackDaysDefault: 3 });

  assert.equal(project.gitUrl, null);
});
