import test from 'node:test';
import assert from 'node:assert/strict';
import { sleep } from '../sleep.js';

test('resolves after roughly the given delay', async () => {
  const t0 = Date.now();
  await sleep(30);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 25, `expected >= 25ms, got ${elapsed}`);
});
