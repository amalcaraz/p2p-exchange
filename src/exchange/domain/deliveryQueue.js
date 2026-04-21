import { compareTs } from './lamportClock.js';

class DeliveryQueue {
  constructor() {
    this._events = [];
  }
  get size() {
    return this._events.length;
  }

  enqueue(event) {
    this._events.push(event);
    this._events.sort((a, b) => compareTs(a.ts, b.ts));
  }

  peek() {
    return this._events[0] ?? null;
  }

  drain(minKnownClock) {
    const out = [];
    while (this._events.length > 0 && this._events[0].ts[0] <= minKnownClock) {
      out.push(this._events.shift());
    }
    return out;
  }
}

export { DeliveryQueue };
