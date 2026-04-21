import test from 'node:test';
import assert from 'node:assert/strict';
import { Membership } from '../membership.js';

test('self is always a member; minKnownClock starts at 0', () => {
  const m = new Membership('self');
  assert.equal(m.minKnownClock(), 0);
  assert.deepEqual([...m.peerIds()].sort(), ['self']);
});

test('touch admits unknown peer and updates knownClock + lastSeenAt', () => {
  const m = new Membership('self');
  m.touch('a', 3, 1000);
  m.touch('a', 5, 1001);
  m.touch('b', 4, 1002);
  assert.deepEqual([...m.peerIds()].sort(), ['a', 'b', 'self']);
  assert.equal(m.minKnownClock(), 0); // self still 0
});

test('touch(self, ts) advances self knownClock — own events loop back the same path', () => {
  const m = new Membership('self');
  m.touch('a', 5, 1000);
  m.touch('self', 4, 1005);
  assert.equal(m.minKnownClock(), 4);
  m.touch('self', 10, 1010);
  assert.equal(m.minKnownClock(), 5);
});

test('evictStale removes peers silent longer than threshold but never self', () => {
  const m = new Membership('self');
  m.touch('a', 5, 1000);
  m.touch('b', 5, 2000);
  m.touch('self', 5, 1000);
  const evicted = m.evictStale(2500, 1000);
  assert.deepEqual(evicted, ['a']);
  assert.deepEqual([...m.peerIds()].sort(), ['b', 'self']);
  assert.equal(m.minKnownClock(), 5);
});

test('loadSnapshotClock replaces knownClock and keeps lastSeenAt for known peers', () => {
  const m = new Membership('self');
  m.touch('a', 3, 1000);
  m.loadSnapshotClock({ self: 10, a: 9, b: 7 }, 2000);
  assert.equal(m.minKnownClock(), 7);
  // 'b' should get lastSeenAt = now so it is not instantly evicted
  const evicted = m.evictStale(2500, 1000);
  assert.deepEqual(evicted, []);
});

test('touch flags re-admission of a previously-evicted peer', () => {
  const m = new Membership('self');
  m.touch('a', 5, 1000);
  // 'a' goes silent — evict after crossing the threshold
  const evicted = m.evictStale(3000, 1000);
  assert.deepEqual(evicted, ['a']);
  // first touch after eviction: flagged
  const r1 = m.touch('a', 12, 4000);
  assert.equal(r1.readmitted, true);
  // subsequent touches: no longer flagged
  const r2 = m.touch('a', 13, 4100);
  assert.equal(r2.readmitted, false);
});

test('touch does not flag re-admission for brand-new peers', () => {
  const m = new Membership('self');
  const r = m.touch('a', 5, 1000);
  assert.equal(r.readmitted, false);
});

test('loadSnapshotClock clears stale eviction flags', () => {
  const m = new Membership('self');
  m.touch('a', 5, 1000);
  m.evictStale(3000, 1000);     // flag 'a' as evicted
  m.loadSnapshotClock({ self: 10, a: 9 }, 5000);
  // 'a' is back via the snapshot — a subsequent message from 'a' must NOT
  // trigger another resync.
  const r = m.touch('a', 11, 5100);
  assert.equal(r.readmitted, false);
});
