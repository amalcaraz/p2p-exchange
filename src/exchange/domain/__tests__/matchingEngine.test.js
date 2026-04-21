import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchingEngine } from '../matchingEngine.js';

function orderEv(id, side, price, amount, ts) {
  return { type: 'order', ts, order: { id, side, price, amount, remaining: amount, ts } };
}
function cancelEv(orderId, ts) { return { type: 'cancel', ts, orderId }; }

test('apply: single order inserted, no trades', () => {
  const e = new MatchingEngine();
  const trades = e.apply(orderEv('a', 'buy', 100, 2, [1, 'x']));
  assert.deepEqual(trades, []);
  assert.deepEqual(e.lastAppliedTs, [1, 'x']);
  assert.equal(e.serializeBook().bids.length, 1);
});

test('apply: crossing order produces trade and leaves remainder on book', () => {
  const e = new MatchingEngine();
  e.apply(orderEv('mk', 'sell', 100, 2, [1, 'x']));
  const trades = e.apply(orderEv('tk', 'buy', 100, 5, [2, 'y']));
  assert.equal(trades.length, 1);
  assert.deepEqual(trades[0], { maker: 'mk', taker: 'tk', price: 100, amount: 2, ts: [2, 'y'] });
  const book = e.serializeBook();
  assert.equal(book.asks.length, 0);
  assert.equal(book.bids.length, 1);
  assert.equal(book.bids[0].remaining, 3);
});

test('apply: cancel removes a resting order', () => {
  const e = new MatchingEngine();
  e.apply(orderEv('a', 'buy', 100, 1, [1, 'x']));
  e.apply(cancelEv('a', [2, 'x']));
  assert.deepEqual(e.lastAppliedTs, [2, 'x']);
  assert.equal(e.serializeBook().bids.length, 0);
});

test('deterministic replay: identical sequence -> identical book + trades', () => {
  const seq = [
    orderEv('a', 'buy', 100, 3, [1, 'x']),
    orderEv('b', 'sell', 101, 2, [2, 'y']),
    orderEv('c', 'sell', 100, 2, [3, 'z']),
    cancelEv('b', [4, 'y']),
  ];
  const e1 = new MatchingEngine();
  const e2 = new MatchingEngine();
  const t1 = seq.map((ev) => e1.apply(ev));
  const t2 = seq.map((ev) => e2.apply(ev));
  assert.deepEqual(t1, t2);
  assert.deepEqual(e1.serializeBook(), e2.serializeBook());
});

test('snapshot + replay equals full replay', () => {
  const first = [orderEv('a', 'buy', 100, 3, [1, 'x']), orderEv('b', 'sell', 101, 2, [2, 'y'])];
  const rest = [orderEv('c', 'sell', 100, 2, [3, 'z'])];
  const full = new MatchingEngine();
  [...first, ...rest].forEach((ev) => full.apply(ev));

  const mid = new MatchingEngine();
  first.forEach((ev) => mid.apply(ev));
  const snap = mid.serializeBook();
  const lastTs = mid.lastAppliedTs;

  const restarted = new MatchingEngine();
  restarted.loadSnapshot(snap);
  restarted.lastAppliedTs = lastTs;
  rest.forEach((ev) => restarted.apply(ev));

  assert.deepEqual(restarted.serializeBook(), full.serializeBook());
  assert.deepEqual(restarted.lastAppliedTs, full.lastAppliedTs);
});
