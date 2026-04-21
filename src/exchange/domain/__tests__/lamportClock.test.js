import test from 'node:test';
import assert from 'node:assert/strict';
import { LamportClock, compareTs } from '../lamportClock.js';

test('compareTs orders by T then by nodeId', () => {
  assert.ok(compareTs([1, 'a'], [2, 'a']) < 0);
  assert.ok(compareTs([2, 'a'], [1, 'a']) > 0);
  assert.ok(compareTs([1, 'a'], [1, 'b']) < 0);
  assert.ok(compareTs([1, 'b'], [1, 'a']) > 0);
  assert.equal(compareTs([1, 'a'], [1, 'a']), 0);
});

test('bump increments monotonically and returns stamped ts', () => {
  const c = new LamportClock('n1');
  assert.deepEqual(c.bump(), [1, 'n1']);
  assert.deepEqual(c.bump(), [2, 'n1']);
  assert.equal(c.value, 2);
});

test('merge advances clock to max(local, remote) + 1', () => {
  const c = new LamportClock('n1');
  c.merge(5);
  assert.equal(c.value, 6);
  c.merge(3);
  assert.equal(c.value, 7);
});

test('setTo forces the clock (used when loading a snapshot)', () => {
  const c = new LamportClock('n1');
  c.setTo(42);
  assert.equal(c.value, 42);
  assert.deepEqual(c.bump(), [43, 'n1']);
});
