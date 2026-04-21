import test from 'node:test';
import assert from 'node:assert/strict';
import { ExchangeHandlers } from '../api.js';

function makeReply() {
  const calls = [];
  return { calls, reply: (err, res) => calls.push({ err, res }) };
}

test('submitOrder forwards to node.submitOrder and replies with result', async () => {
  const node = {
    submitOrder: async (o) => ({ orderId: 'n1:1', trades: [], remaining: o.amount }),
  };
  const h = new ExchangeHandlers(node);
  const r = makeReply();
  await h.submitOrder(null, null, { side: 'buy', price: 100, amount: 1 }, r);
  assert.equal(r.calls[0].err, null);
  assert.deepEqual(r.calls[0].res, { orderId: 'n1:1', trades: [], remaining: 1 });
});

test('submitOrder validates payload', async () => {
  const node = { submitOrder: async () => ({}) };
  const h = new ExchangeHandlers(node);
  const r = makeReply();
  await h.submitOrder(null, null, { side: 'xxx', price: 100, amount: 1 }, r);
  assert.ok(r.calls[0].err);
  assert.match(r.calls[0].err.message, /side/);
});

test('getBook returns node.getBook()', async () => {
  const node = { getBook: () => ({ bids: [], asks: [] }) };
  const h = new ExchangeHandlers(node);
  const r = makeReply();
  await h.getBook(null, null, null, r);
  assert.deepEqual(r.calls[0].res, { bids: [], asks: [] });
});

test('getSnapshot returns node.getSnapshot()', async () => {
  const node = {
    getSnapshot: () => ({ book: { bids: [], asks: [] }, snapshotTs: [0, ''], knownClock: { n: 0 } }),
  };
  const h = new ExchangeHandlers(node);
  const r = makeReply();
  await h.getSnapshot(null, null, null, r);
  assert.deepEqual(r.calls[0].res.snapshotTs, [0, '']);
});

test('peerEvent forwards the wrapped event to node.onEvent and acks', async () => {
  const seen = [];
  const node = { onEvent: (ev) => seen.push(ev) };
  const h = new ExchangeHandlers(node);
  const r = makeReply();
  const ev = { type: 'order', ts: [1, 'a'], order: { id: 'a:1', side: 'buy', price: 100, amount: 1 } };
  await h.peerEvent(null, null, { event: ev }, r);
  assert.deepEqual(seen, [ev]);
  assert.deepEqual(r.calls[0].res, { ok: true });
});

test('whoami replies with node.selfId', async () => {
  const node = { selfId: 'abc123' };
  const h = new ExchangeHandlers(node);
  const r = makeReply();
  await h.whoami(null, null, null, r);
  assert.deepEqual(r.calls[0].res, { nodeId: 'abc123' });
});
