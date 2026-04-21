import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrenacheClient } from '../../../lib/grenache/grenacheClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../..');

const GRAPE_URL = 'http://127.0.0.1:30001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spawnGrapes() {
  const grapeBin = 'node_modules/grenache-grape/bin/grape.js';
  // Short --dpa (dht_peer_maxAge) so DHT entries from dying nodes age
  // out in seconds, not minutes. Matches the dev:grapes npm script.
  const g1 = spawn(
    process.execPath,
    [
      grapeBin,
      '--dp',
      '20001',
      '--aph',
      '30001',
      '--bn',
      '127.0.0.1:20002',
      '--dpa',
      '10000',
    ],
    { stdio: 'pipe', cwd: ROOT }
  );
  const g2 = spawn(
    process.execPath,
    [
      grapeBin,
      '--dp',
      '20002',
      '--aph',
      '40001',
      '--bn',
      '127.0.0.1:20001',
      '--dpa',
      '10000',
    ],
    { stdio: 'pipe', cwd: ROOT }
  );
  return [g1, g2];
}

function spawnNode(extraEnv = {}) {
  return spawn(
    process.execPath,
    ['--env-file=.env', path.resolve(ROOT, 'src/exchange/index.js')],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
      cwd: ROOT,
    }
  );
}

async function waitForReady(proc, timeoutMs = 8000) {
  let buf = '';
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buf += chunk.toString();
      if (buf.includes('READY')) {
        proc.stdout.off('data', onData);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    setTimeout(
      () => reject(new Error('node did not become READY in time')),
      timeoutMs
    );
  });
}

async function killAll(procs) {
  for (const p of procs) {
    try {
      p.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  await sleep(300);
}

// Broadcast a whoami and collect replies — every live announcer returns its id.
async function discoverNodeIds(timeout = 3000) {
  const client = new GrenacheClient({ grapeUrl: GRAPE_URL });
  await client.start();
  try {
    const { results } = await client.broadcast(
      'exchange_peer',
      { action: 'whoami' },
      { timeout }
    );
    return (results || []).map((r) => r?.nodeId).filter(Boolean);
  } finally {
    client.stop();
  }
}

function randomOrder() {
  return {
    side: Math.random() < 0.5 ? 'buy' : 'sell',
    price: 90 + Math.floor(Math.random() * 21), // 90..110
    amount: 1 + Math.floor(Math.random() * 5), // 1..5
  };
}

test(
  '3-node convergence under concurrent load (60 random orders in 3 waves)',
  { timeout: 120_000 },
  async (t) => {
    const NODE_COUNT = 3;
    const WAVES = 3;
    const ORDERS_PER_WAVE = 20; // 60 total — enough to stress, small enough to settle quickly

    const grapes = spawnGrapes();
    t.after(() => killAll(grapes));
    await sleep(800);

    const nodes = Array.from({ length: NODE_COUNT }, () => spawnNode());
    t.after(() => killAll(nodes));
    await Promise.all(nodes.map((n) => waitForReady(n, 12_000)));
    await sleep(2000); // allow pub/sub mesh to fully connect

    const client = new GrenacheClient({ grapeUrl: GRAPE_URL });
    await client.start();
    t.after(() => client.stop());

    const submit = (o) =>
      client.request('exchange_peer', { action: 'submitOrder', ...o }, 30_000);

    // Submit in waves so the delivery queue has a chance to drain between bursts.
    // A single 60-order burst puts enough pressure on the Lamport stability check
    // (each submitOrder only resolves once its own order is totally-ordered-delivered)
    // that per-RPC latency grows quadratically with burst size.
    let totalTrades = 0;
    for (let w = 0; w < WAVES; w++) {
      const orders = Array.from({ length: ORDERS_PER_WAVE }, randomOrder);
      const results = await Promise.allSettled(orders.map(submit));
      const failed = results.filter((r) => r.status === 'rejected');
      assert.equal(
        failed.length,
        0,
        `wave ${w}: ${failed.length} failed; first: ${failed[0]?.reason?.message}`
      );
      totalTrades += results.reduce(
        (s, r) => s + (r.value?.trades?.length ?? 0),
        0
      );
      await sleep(500);
    }

    await sleep(3000); // final settle

    const nodeIds = await discoverNodeIds(1500);
    assert.ok(
      nodeIds.length >= NODE_COUNT,
      `expected >= ${NODE_COUNT} live node IDs, saw ${nodeIds.length}: ${nodeIds.join(', ')}`
    );

    const books = await Promise.all(
      nodeIds.map((id) =>
        client.request(`exchange_rpc_${id}`, { action: 'getBook' }, 15_000)
      )
    );
    for (let i = 1; i < books.length; i++) {
      assert.deepEqual(
        books[i],
        books[0],
        `book from node ${nodeIds[i]} diverges from node ${nodeIds[0]}`
      );
    }

    assert.ok(
      totalTrades > 0,
      'expected at least one trade across 60 random orders'
    );
  }
);

test(
  'evicted-then-resumed node resyncs from a live peer',
  { timeout: 60_000 },
  async (t) => {
    // Use a short eviction threshold so the freeze window can cross it quickly.
    const SHORT_EVICTION = { PEER_EVICTION_MS: '500' };

    const grapes = spawnGrapes();
    t.after(() => killAll(grapes));
    await sleep(800);

    const nodes = [
      spawnNode(SHORT_EVICTION),
      spawnNode(SHORT_EVICTION),
      spawnNode(SHORT_EVICTION),
    ];
    t.after(() => killAll(nodes));
    await Promise.all(nodes.map((n) => waitForReady(n, 12_000)));
    await sleep(2000); // mesh stabilise

    const client = new GrenacheClient({ grapeUrl: GRAPE_URL });
    await client.start();
    t.after(() => client.stop());

    const submit = (o) =>
      client.request('exchange_peer', { action: 'submitOrder', ...o }, 30_000);

    // Seed initial state across the cluster.
    await Promise.all([
      submit({ side: 'sell', price: 100, amount: 5 }),
      submit({ side: 'buy', price: 99, amount: 3 }),
    ]);
    await sleep(1500);

    // Freeze the third node — kernel will still buffer some TCP traffic, but the
    // frozen process cannot advance its Lamport clock or reply to anything.
    const victim = nodes[2];
    victim.kill('SIGSTOP');

    // Wait well past PEER_EVICTION_MS so the other nodes evict it.
    await sleep(2000);

    // Target the two live nodes specifically so submissions can't hit the frozen one.
    const liveIds = await discoverNodeIds(1500);
    assert.ok(
      liveIds.length >= 2,
      `need >=2 live node ids while one is frozen, got ${liveIds.length}: ${liveIds.join(',')}`
    );
    const liveSubmit = (id, o) =>
      client.request(
        `exchange_rpc_${id}`,
        { action: 'submitOrder', ...o },
        30_000
      );
    await Promise.all([
      liveSubmit(liveIds[0], { side: 'sell', price: 101, amount: 2 }),
      liveSubmit(liveIds[1], { side: 'buy', price: 98, amount: 1 }),
      liveSubmit(liveIds[0], { side: 'sell', price: 102, amount: 4 }),
    ]);
    await sleep(1500);

    // Resume the victim. It should detect that its once-known peers have gone
    // silent (past the eviction window), evict them, then immediately re-admit
    // them when their next heartbeat arrives — which is the signal to resync.
    victim.kill('SIGCONT');

    // Give the resync ample time to complete: eviction tick (≤250 ms) + next
    // heartbeat from a peer + getSnapshot RPC + apply.
    await sleep(5000);

    // Pull books from every node that is now advertising itself. Include a
    // modest loop in case the frozen node takes slightly longer to rejoin.
    let books, allIds;
    for (let attempt = 0; attempt < 5; attempt++) {
      allIds = await discoverNodeIds(1500);
      if (allIds.length >= 3) {
        books = await Promise.all(
          allIds.map((id) =>
            client.request(`exchange_rpc_${id}`, { action: 'getBook' }, 15_000)
          )
        );
        const ref = JSON.stringify(books[0]);
        if (books.every((b) => JSON.stringify(b) === ref)) break;
      }
      await sleep(1000);
    }
    assert.ok(
      allIds.length >= 3,
      `expected 3 live node ids after resume, got ${allIds.length}: ${allIds?.join(',')}`
    );
    for (let i = 1; i < books.length; i++) {
      assert.deepEqual(
        books[i],
        books[0],
        `book from ${allIds[i]} diverges from ${allIds[0]} after resync`
      );
    }
  }
);

test(
  'late-joining node gets a snapshot and converges',
  { timeout: 40_000 },
  async (t) => {
    const grapes = spawnGrapes();
    t.after(() => killAll(grapes));
    await sleep(800);

    // 3 initial nodes
    const initial = [spawnNode(), spawnNode(), spawnNode()];
    t.after(() => killAll(initial));
    await Promise.all(initial.map((n) => waitForReady(n, 12_000)));
    await sleep(1500); // allow pub/sub mesh to fully connect

    const client = new GrenacheClient({ grapeUrl: GRAPE_URL });
    await client.start();
    t.after(() => client.stop());

    const submit = (o) =>
      client.request('exchange_peer', { action: 'submitOrder', ...o });
    await Promise.all([
      submit({ side: 'sell', price: 100, amount: 5 }),
      submit({ side: 'sell', price: 102, amount: 3 }),
      submit({ side: 'buy', price: 99, amount: 2 }),
      submit({ side: 'buy', price: 101, amount: 1 }),
    ]);
    await sleep(1000);

    // record the common book from the 3 existing nodes
    const pre = await client.request('exchange_peer', { action: 'getBook' });

    // spawn a 4th node and wait for it to reach READY
    const late = spawnNode();
    t.after(() => killAll([late]));
    await waitForReady(late, 12_000);
    await sleep(1500); // allow late node's pub/sub to connect and snapshot to apply

    // sample 10 books across the now-4-node cluster
    const books = [];
    for (let i = 0; i < 10; i++)
      books.push(await client.request('exchange_peer', { action: 'getBook' }));
    for (let i = 0; i < books.length; i++) {
      assert.deepEqual(
        books[i],
        pre,
        `book #${i} diverges from the pre-join snapshot`
      );
    }

    // submit one more order; all four nodes must still converge
    await submit({ side: 'buy', price: 100, amount: 1 });
    await sleep(1000);
    const after = [];
    for (let i = 0; i < 10; i++)
      after.push(await client.request('exchange_peer', { action: 'getBook' }));
    for (let i = 1; i < after.length; i++) assert.deepEqual(after[i], after[0]);
  }
);
