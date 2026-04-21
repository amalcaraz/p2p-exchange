import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Mutex } from '../mutex.js';

describe('Mutex', () => {
  it('acquire returns a release function', async () => {
    const mutex = new Mutex();
    const release = await mutex.acquire();
    assert.equal(typeof release, 'function');
    release();
  });

  it('serializes concurrent async operations', async () => {
    const mutex = new Mutex();
    const log = [];

    const operation = async (id) => {
      const release = await mutex.acquire();
      try {
        log.push(`${id}:start`);
        await new Promise((r) => setTimeout(r, 10));
        log.push(`${id}:end`);
      } finally {
        release();
      }
    };

    await Promise.all([operation('A'), operation('B'), operation('C')]);

    assert.deepStrictEqual(log, [
      'A:start',
      'A:end',
      'B:start',
      'B:end',
      'C:start',
      'C:end',
    ]);
  });

  it('concurrent increments produce sequential values (no duplicates)', async () => {
    const mutex = new Mutex();
    let counter = 0;

    const increment = async () => {
      const release = await mutex.acquire();
      try {
        const current = counter;
        await new Promise((r) => setTimeout(r, 5));
        counter = current + 1;
        return counter;
      } finally {
        release();
      }
    };

    const results = await Promise.all([increment(), increment(), increment()]);

    results.sort((a, b) => a - b);
    assert.deepStrictEqual(results, [1, 2, 3]);
    assert.equal(counter, 3);
  });

  it('allows re-acquisition after release', async () => {
    const mutex = new Mutex();
    const release1 = await mutex.acquire();
    release1();
    const release2 = await mutex.acquire();
    release2();
  });
});
