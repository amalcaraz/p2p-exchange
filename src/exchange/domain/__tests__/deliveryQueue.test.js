import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue } from '../deliveryQueue.js';

function ev(T, nodeId, payload = {}) {
  return { ts: [T, nodeId], type: 'order', ...payload };
}

test('enqueue out of order; drain returns events in total order', () => {
  const q = new DeliveryQueue();
  q.enqueue(ev(3, 'a'));
  q.enqueue(ev(1, 'b'));
  q.enqueue(ev(2, 'a'));
  const out = q.drain(10);
  assert.deepEqual(
    out.map((e) => e.ts),
    [
      [1, 'b'],
      [2, 'a'],
      [3, 'a'],
    ]
  );
});

test('ties broken by nodeId', () => {
  const q = new DeliveryQueue();
  q.enqueue(ev(1, 'b'));
  q.enqueue(ev(1, 'a'));
  const out = q.drain(5);
  assert.deepEqual(
    out.map((e) => e.ts),
    [
      [1, 'a'],
      [1, 'b'],
    ]
  );
});

test('drain blocks when head ts > minKnownClock', () => {
  const q = new DeliveryQueue();
  q.enqueue(ev(5, 'a'));
  q.enqueue(ev(7, 'b'));
  const out = q.drain(4);
  assert.deepEqual(out, []);
  assert.deepEqual(q.peek().ts, [5, 'a']);
});

test('drain partially — returns only stable events', () => {
  const q = new DeliveryQueue();
  q.enqueue(ev(1, 'a'));
  q.enqueue(ev(5, 'b'));
  const out = q.drain(3);
  assert.deepEqual(
    out.map((e) => e.ts),
    [[1, 'a']]
  );
  assert.deepEqual(q.peek().ts, [5, 'b']);
});

test('size reflects contents', () => {
  const q = new DeliveryQueue();
  assert.equal(q.size, 0);
  q.enqueue(ev(1, 'a'));
  q.enqueue(ev(2, 'a'));
  assert.equal(q.size, 2);
  q.drain(10);
  assert.equal(q.size, 0);
});
