// test/health.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/app';

test('GET /health returns 200', async () => {
  const app = buildApp();

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/health',
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.db, 'ok');
  assert.equal(body.redis, 'ok');
  assert.equal(body.cron.status, 'ok');
  assert.equal(typeof body.cron.schedulers, 'number');

  await app.close();
});