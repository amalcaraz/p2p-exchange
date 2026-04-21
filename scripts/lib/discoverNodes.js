import { GrenacheClient } from '../../src/lib/grenache/grenacheClient.js';

// Enumerate the cluster by broadcasting a `whoami` action and collecting
// the nodeId each announcer replies with. Retries if the first call comes
// back empty — Grape's DHT lookup cache is often cold on a freshly-started
// client and the first lookup can return nothing before the announce
// records have propagated.
async function discoverNodes({
  grapeUrl,
  serviceName = 'exchange_peer',
  timeout = 3000,
  maxAttempts = 5,
} = {}) {
  const client = new GrenacheClient({ grapeUrl });
  await client.start();
  try {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { results } = await client.broadcast(serviceName, { action: 'whoami' }, { timeout });
      const ids = (results || []).map((r) => r?.nodeId).filter(Boolean);
      if (ids.length > 0) return ids;
      if (attempt + 1 < maxAttempts) {
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
      }
    }
    return [];
  } finally {
    client.stop();
  }
}

export { discoverNodes };
