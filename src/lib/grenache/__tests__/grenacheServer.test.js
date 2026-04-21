import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GrenacheServer } from '../grenacheServer.js';

describe('GrenacheServer', () => {
  it('exports a GrenacheServer function', () => {
    assert.equal(typeof GrenacheServer, 'function');
  });
});
