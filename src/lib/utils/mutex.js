import { Deferred } from './deferred.js';

class Mutex {
  constructor() {
    this._tail = Promise.resolve();
  }

  async acquire() {
    const prev = this._tail;
    const deferred = new Deferred();
    this._tail = deferred.promise;

    return prev.then(() => () => deferred.resolve());
  }
}

export { Mutex };
