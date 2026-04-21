import readline from 'node:readline';
import { GrenacheClient } from '../src/lib/grenache/grenacheClient.js';

const GRAPE_URL = process.env.GRAPE_URL || 'http://127.0.0.1:30001';
const PEER_SERVICE = process.env.PEER_SERVICE || 'exchange_peer';
const RPC_SERVICE_PREFIX = process.env.RPC_SERVICE_PREFIX || 'exchange_rpc';
const REDISCOVER_MS = Number(process.env.REDISCOVER_MS ?? 1000);

const client = new GrenacheClient({ grapeUrl: GRAPE_URL });

// Track discovered nodes and the last time the whoami broadcast saw each.
const peers = new Map();
let current = null;
let rediscovering = false;
let rediscoverTimer = null;

async function rediscover() {
  if (rediscovering) return;
  rediscovering = true;
  try {
    const { results } = await client.broadcast(PEER_SERVICE, { action: 'whoami' }, { timeout: 2000 });
    const now = Date.now();
    for (const r of results || []) {
      if (r?.nodeId) peers.set(r.nodeId, now);
    }
  } catch {
    // ignore transient errors; we'll try again on the next tick
  }
  rediscovering = false;
}

function help() {
  console.log(`
commands:
  nodes                              list discovered nodes (active = *)
  use <id-prefix>                    select a node for subsequent commands
  submit <buy|sell> <price> <amount> submit a limit order to the current node
  book [id-prefix]                   fetch orderbook from given / current node
  snapshot [id-prefix]               fetch full snapshot from given / current node
  stress <n>                         fire n random orders across all known nodes
  converge                           fetch a book from every node and check they agree
  help                               show this message
  quit | exit                        leave
`);
}

function resolveNode(prefix) {
  if (!prefix) return current;
  const matches = [...peers.keys()].filter((id) => id.startsWith(prefix));
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) { console.log(`no node matches "${prefix}"`); return null; }
  console.log(`ambiguous prefix "${prefix}": ${matches.join(', ')}`); return null;
}

async function callNode(id, action, payload = {}) {
  if (!id) { console.log('no current node — run "nodes" then "use <id>"'); return null; }
  try {
    return await client.request(`${RPC_SERVICE_PREFIX}_${id}`, { action, ...payload }, 10_000);
  } catch (err) {
    console.log(`error calling ${id}: ${err.message}`);
    return null;
  }
}

function formatBook(book) {
  const top = (side, dir) => side.slice(0, 10).map((o) => `  ${dir} ${o.price.toString().padStart(4)} x ${o.remaining}  (${o.id})`).join('\n');
  return [
    `asks (${book.asks.length}):`,
    top(book.asks, 'ask') || '  (empty)',
    `bids (${book.bids.length}):`,
    top(book.bids, 'bid') || '  (empty)',
  ].join('\n');
}

async function cmd_nodes() {
  if (peers.size === 0) { console.log('no nodes seen yet'); return; }
  const now = Date.now();
  for (const [id, ts] of [...peers.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const age = ((now - ts) / 1000).toFixed(1);
    const marker = id === current ? '*' : ' ';
    console.log(`  ${marker} ${id}   last seen ${age}s ago`);
  }
}

async function cmd_submit(args) {
  const [side, priceStr, amountStr] = args;
  if (!['buy', 'sell'].includes(side) || !Number(priceStr) || !Number(amountStr)) {
    console.log('usage: submit <buy|sell> <price> <amount>'); return;
  }
  const res = await callNode(current, 'submitOrder', {
    side, price: Number(priceStr), amount: Number(amountStr),
  });
  if (res) console.log(JSON.stringify(res, null, 2));
}

async function cmd_book(args) {
  const id = resolveNode(args[0]);
  if (!id) return;
  const res = await callNode(id, 'getBook');
  if (res) console.log(`\nnode ${id}\n${formatBook(res)}`);
}

async function cmd_snapshot(args) {
  const id = resolveNode(args[0]);
  if (!id) return;
  const res = await callNode(id, 'getSnapshot');
  if (res) console.log(JSON.stringify(res, null, 2));
}

async function cmd_stress(args) {
  const n = Number(args[0]) || 50;
  const ids = [...peers.keys()];
  if (ids.length === 0) { console.log('no nodes'); return; }
  const t0 = Date.now();
  const jobs = Array.from({ length: n }, (_, i) => {
    const target = ids[i % ids.length];
    const order = {
      side: Math.random() < 0.5 ? 'buy' : 'sell',
      price: 90 + Math.floor(Math.random() * 21),
      amount: 1 + Math.floor(Math.random() * 5),
    };
    return client.request(`${RPC_SERVICE_PREFIX}_${target}`, { action: 'submitOrder', ...order }, 30_000);
  });
  const results = await Promise.allSettled(jobs);
  const ok = results.filter((r) => r.status === 'fulfilled');
  const trades = ok.reduce((s, r) => s + (r.value?.trades?.length ?? 0), 0);
  console.log(`stress: ${ok.length}/${n} ok, ${trades} trades, ${Date.now() - t0}ms`);
}

async function cmd_converge() {
  const ids = [...peers.keys()];
  if (ids.length === 0) { console.log('no nodes'); return; }
  const books = await Promise.all(ids.map((id) => callNode(id, 'getBook')));
  const ref = JSON.stringify(books[0]);
  const allMatch = books.every((b) => b && JSON.stringify(b) === ref);
  console.log(`convergence across ${ids.length} nodes: ${allMatch ? 'PASS' : 'FAIL'}`);
  for (let i = 0; i < ids.length; i++) {
    const b = books[i];
    if (!b) { console.log(`  ${ids[i]}  (request failed)`); continue; }
    const match = JSON.stringify(b) === ref;
    console.log(`  ${ids[i]}  bids=${b.bids.length} asks=${b.asks.length}  ${match ? '' : 'DIVERGED'}`);
  }
}

async function handle(line) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd) return;
  switch (cmd) {
    case 'nodes':    return cmd_nodes();
    case 'use': {
      const id = resolveNode(args[0]);
      if (id) { current = id; console.log(`now using ${id}`); }
      return;
    }
    case 'submit':   return cmd_submit(args);
    case 'book':     return cmd_book(args);
    case 'snapshot': return cmd_snapshot(args);
    case 'stress':   return cmd_stress(args);
    case 'converge': return cmd_converge();
    case 'help':     help(); return;
    case 'quit':
    case 'exit':
      await shutdown(0);
      return;
    default:
      console.log(`unknown command "${cmd}". type "help".`);
  }
}

async function shutdown(code = 0) {
  if (rediscoverTimer) clearInterval(rediscoverTimer);
  try { client.stop(); } catch {}
  process.exit(code);
}

async function main() {
  await client.start();

  console.log('[cli] discovering nodes...');
  await rediscover();
  // keep the map fresh in the background
  rediscoverTimer = setInterval(rediscover, REDISCOVER_MS);

  if (peers.size === 0) {
    console.log('[cli] no nodes yet — start a cluster with "npm run dev:cluster -- 3" in another terminal.');
  } else {
    current = [...peers.keys()][0];
    console.log(`[cli] found ${peers.size} node(s); current = ${current}`);
  }
  help();

  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, prompt: 'exchange> ',
  });
  rl.prompt();
  rl.on('line', async (line) => {
    try { await handle(line); } catch (err) { console.error(err); }
    rl.prompt();
  });
  rl.on('close', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
}

main().catch((err) => { console.error(err); shutdown(1); });
