import { GrenacheClient } from '../src/lib/grenache/grenacheClient.js';
import { sleep } from '../src/lib/utils/sleep.js';
import { discoverNodes } from './lib/discoverNodes.js';

const GRAPE_URL = process.env.GRAPE_URL || 'http://127.0.0.1:30001';
const PEER_SERVICE = process.env.PEER_SERVICE || 'exchange_peer';
const RPC_SERVICE_PREFIX = process.env.RPC_SERVICE_PREFIX || 'exchange_rpc';

const ORDER_COUNT = Number(process.argv[2] ?? 60);
const WAVE_SIZE = Number(process.env.WAVE_SIZE ?? 20);  // batch to keep per-RPC latency tame
const WAVE_GAP_MS = Number(process.env.WAVE_GAP_MS ?? 500);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 3000);
const SUBMIT_TIMEOUT_MS = 30_000;

function randomOrder() {
  return {
    side: Math.random() < 0.5 ? 'buy' : 'sell',
    price: 90 + Math.floor(Math.random() * 21),  // 90..110
    amount: 1 + Math.floor(Math.random() * 5),   // 1..5
  };
}

function summariseBook(book) {
  const count = (side) => side.length;
  const volume = (side) => side.reduce((s, o) => s + o.remaining, 0);
  return {
    bids: count(book.bids), bidsVol: volume(book.bids),
    asks: count(book.asks), asksVol: volume(book.asks),
  };
}

async function main() {
  console.log(`[test] discovering live nodes on ${GRAPE_URL}...`);
  const nodeIds = await discoverNodes({ grapeUrl: GRAPE_URL, serviceName: PEER_SERVICE });
  if (nodeIds.length === 0) {
    console.error('[test] no nodes discovered — start the cluster first (npm run dev:grapes && npm run dev:cluster -- 3)');
    process.exit(1);
  }
  console.log(`[test] found ${nodeIds.length} node(s): ${nodeIds.join(', ')}`);

  const client = new GrenacheClient({ grapeUrl: GRAPE_URL });
  await client.start();

  const waves = Math.ceil(ORDER_COUNT / WAVE_SIZE);
  console.log(`[test] submitting ${ORDER_COUNT} random orders in ${waves} wave(s) of up to ${WAVE_SIZE} (via ${PEER_SERVICE})...`);
  const t0 = Date.now();
  let ok = 0, failed = 0, totalTrades = 0, firstFailure = null;
  let submitted = 0;
  for (let w = 0; w < waves; w++) {
    const batch = Math.min(WAVE_SIZE, ORDER_COUNT - submitted);
    const orders = Array.from({ length: batch }, randomOrder);
    const results = await Promise.allSettled(
      orders.map((o) => client.request(PEER_SERVICE, { action: 'submitOrder', ...o }, SUBMIT_TIMEOUT_MS))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') { ok++; totalTrades += r.value?.trades?.length ?? 0; }
      else { failed++; if (!firstFailure) firstFailure = r.reason?.message; }
    }
    submitted += batch;
    if (w + 1 < waves) await sleep(WAVE_GAP_MS);
  }
  const elapsed = Date.now() - t0;
  console.log(`[test] ${ok}/${ORDER_COUNT} ok, ${failed} failed, ${totalTrades} trades, ${elapsed}ms`);
  if (failed > 0) console.log('[test] first failure:', firstFailure);

  console.log(`[test] settling for ${SETTLE_MS}ms before sampling books...`);
  await sleep(SETTLE_MS);

  console.log(`[test] fetching books from each node specifically...`);
  const books = await Promise.all(
    nodeIds.map((id) => client.request(`${RPC_SERVICE_PREFIX}_${id}`, { action: 'getBook' }, 15_000))
  );

  const ref = JSON.stringify(books[0]);
  const allMatch = books.every((b) => JSON.stringify(b) === ref);
  console.log(`[test] convergence across ${nodeIds.length} nodes: ${allMatch ? 'PASS' : 'FAIL'}`);
  for (let i = 0; i < nodeIds.length; i++) {
    const s = summariseBook(books[i]);
    const match = JSON.stringify(books[i]) === ref;
    console.log(`  node ${nodeIds[i]}  bids=${s.bids} (vol ${s.bidsVol})  asks=${s.asks} (vol ${s.asksVol})  ${match ? '' : 'DIVERGED'}`);
  }

  client.stop();
  process.exit(allMatch ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
