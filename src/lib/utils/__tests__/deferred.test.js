import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Deferred } from '../deferred.js';

describe('Deferred', () => {
  it('exposes a promise that resolves when resolve() is called', async () => {
    const d = new Deferred();
    let resolved = false;
    d.promise.then(() => {
      resolved = true;
    });

    assert.equal(resolved, false);
    d.resolve('hello');
    const result = await d.promise;
    assert.equal(result, 'hello');
  });

  it('exposes a promise that rejects when reject() is called', async () => {
    const d = new Deferred();
    d.reject(new Error('boom'));
    await assert.rejects(d.promise, { message: 'boom' });
  });
});
