import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { getFreePort } from '../getFreePort.js';

test('returns a port that is actually free', async () => {
  const port = await getFreePort();
  assert.ok(port > 0 && port < 65536, `port ${port} out of range`);
  // re-bind to prove the port is usable
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(port, '127.0.0.1', () => s.close(resolve));
  });
});

test('two consecutive calls return different ports', async () => {
  const a = await getFreePort();
  const b = await getFreePort();
  assert.notEqual(a, b);
});
