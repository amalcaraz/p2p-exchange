import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffle } from '../shuffle.js';

test('returns a permutation of the input', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out = shuffle(input);
  assert.equal(out.length, input.length);
  assert.deepEqual([...out].sort((a, b) => a - b), input);
});

test('does not mutate the input', () => {
  const input = [1, 2, 3, 4, 5];
  const snapshot = [...input];
  shuffle(input);
  assert.deepEqual(input, snapshot);
});

test('eventually produces a non-identity ordering', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // 20 shuffles should overwhelmingly include at least one permutation != input
  let sawPermutation = false;
  for (let i = 0; i < 20; i++) {
    const out = shuffle(input);
    if (out.some((v, idx) => v !== input[idx])) { sawPermutation = true; break; }
  }
  assert.ok(sawPermutation);
});
