import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, GrenacheError } from '../errors.js';

describe('ValidationError', () => {
  it('defaults to statusCode 400', () => {
    const err = new ValidationError('bad input');
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.message, 'bad input');
    assert.equal(err.statusCode, 400);
    assert.ok(err instanceof Error);
  });
});

describe('GrenacheError', () => {
  it('defaults to statusCode 503', () => {
    const err = new GrenacheError('grape unreachable');
    assert.equal(err.code, 'GRENACHE_ERROR');
    assert.equal(err.message, 'grape unreachable');
    assert.equal(err.statusCode, 503);
    assert.ok(err instanceof Error);
  });
});
