import test from 'node:test';
import assert from 'node:assert/strict';
import { Orderbook } from '../orderbook.js';

function order(id, side, price, amount, ts) {
  return { id, side, price, amount, remaining: amount, ts };
}

test('bids sort by price desc, asks by price asc', () => {
  const b = new Orderbook();
  b.addOrder(order('a', 'buy', 100, 1, [1, 'x']));
  b.addOrder(order('b', 'buy', 101, 1, [2, 'x']));
  b.addOrder(order('c', 'sell', 110, 1, [3, 'x']));
  b.addOrder(order('d', 'sell', 105, 1, [4, 'x']));
  const snap = b.serialize();
  assert.deepEqual(
    snap.bids.map((o) => o.id),
    ['b', 'a']
  );
  assert.deepEqual(
    snap.asks.map((o) => o.id),
    ['d', 'c']
  );
});

test('FIFO within same price level', () => {
  const b = new Orderbook();
  b.addOrder(order('a', 'buy', 100, 1, [2, 'x']));
  b.addOrder(order('b', 'buy', 100, 1, [1, 'x']));
  assert.deepEqual(
    b.serialize().bids.map((o) => o.id),
    ['b', 'a']
  );
});

test('removeOrder by id returns true/false', () => {
  const b = new Orderbook();
  b.addOrder(order('a', 'buy', 100, 1, [1, 'x']));
  assert.equal(b.removeOrder('a'), true);
  assert.equal(b.removeOrder('a'), false);
  assert.equal(b.serialize().bids.length, 0);
});

test('cross: taker buy fills against cheapest ask, partial fill rests', () => {
  const b = new Orderbook();
  b.addOrder(order('mk', 'sell', 100, 2, [1, 'x']));
  const taker = order('tk', 'buy', 100, 3, [2, 'y']);
  const trades = b.cross(taker);
  assert.equal(trades.length, 1);
  assert.deepEqual(trades[0], {
    maker: 'mk',
    taker: 'tk',
    price: 100,
    amount: 2,
    ts: [2, 'y'],
  });
  assert.equal(taker.remaining, 1);
  assert.equal(b.serialize().asks.length, 0);
});

test('cross: does not cross when prices do not meet', () => {
  const b = new Orderbook();
  b.addOrder(order('mk', 'sell', 105, 1, [1, 'x']));
  const taker = order('tk', 'buy', 100, 1, [2, 'y']);
  const trades = b.cross(taker);
  assert.deepEqual(trades, []);
  assert.equal(taker.remaining, 1);
});

test('serialize / loadSnapshot round-trip', () => {
  const b = new Orderbook();
  b.addOrder(order('a', 'buy', 100, 2, [1, 'x']));
  b.addOrder(order('b', 'sell', 110, 3, [2, 'y']));
  const snap = b.serialize();
  const b2 = new Orderbook();
  b2.loadSnapshot(snap);
  assert.deepEqual(b2.serialize(), snap);
});
