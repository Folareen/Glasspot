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
  assert.deepEqual(response.json(), {
    status: 'ok',
    db: 'ok',
  });

  await app.close();
});