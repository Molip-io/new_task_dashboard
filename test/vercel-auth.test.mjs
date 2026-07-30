import assert from 'node:assert/strict';
import test from 'node:test';
import handler, { requestIsAuthorized } from '../api/app.mjs';

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; },
  };
}

test('Given the public dashboard, When a normal request arrives, Then access is allowed without credentials', () => {
  assert.equal(requestIsAuthorized({ headers: {} }, '/'), true);
  assert.equal(requestIsAuthorized({ headers: {} }, '/api/dashboard'), true);
});

test('Given a cron request, When authorization is checked, Then only CRON_SECRET bearer access is accepted', () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-secret';
  try {
    assert.equal(requestIsAuthorized({ headers: { authorization: 'Bearer cron-secret' } }, '/api/cron/collect'), true);
    assert.equal(requestIsAuthorized({ headers: { authorization: 'Bearer wrong' } }, '/api/cron/collect'), false);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test('Given the public dashboard, When the web root is requested, Then the shell is served without credentials', async () => {
  const response = responseRecorder();
  await handler({ url: '/', method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.match(String(response.body), /업무현황 대시보드/);
});
