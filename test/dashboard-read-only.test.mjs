import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import handler from '../dashboard/api/app.mjs';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; },
  };
}

test('Given a request to start collection from the page, When the API handles it, Then it refuses and says who collects', async () => {
  for (const method of ['POST', 'GET']) {
    const response = responseRecorder();
    await handler({ url: '/api/refresh', method, headers: {} }, response);
    assert.equal(response.statusCode, 410);
    assert.match(JSON.parse(response.body).message, /아침 루틴/);
  }
});

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
