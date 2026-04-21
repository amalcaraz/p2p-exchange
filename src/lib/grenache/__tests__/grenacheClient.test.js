import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GrenacheClient } from '../grenacheClient.js';

describe('GrenacheClient', () => {
  it('exports a GrenacheClient function', () => {
    assert.equal(typeof GrenacheClient, 'function');
  });
});
