import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

test('Given the dashboard pages, When their source is read, Then no control starts a collection', () => {
  assert.doesNotMatch(read('../dashboard/ui/index.html'), /refreshBtn|데이터 다시 수집/);
  assert.doesNotMatch(read('../dashboard/ui/app.js'), /api\/refresh|refreshBtn|pollStatus/);
  assert.doesNotMatch(read('../dashboard/ui/share.html'), /api\/refresh|id="refresh"/);
  assert.doesNotMatch(read('../dashboard/ui/sprint-overview.js'), /refreshBtn/);
});

test('Given a collected snapshot, When the page loads, Then it shows when the data was collected', () => {
  const app = read('../dashboard/ui/app.js');
  assert.match(app, /마지막 수집 \$\{String\(D\.generatedAt\)/);
  assert.match(app, /showCollectedAt\(\)/);
});
