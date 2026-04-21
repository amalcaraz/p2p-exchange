import { Orderbook } from './orderbook.js';

class MatchingEngine {
  constructor() {
    this._book = new Orderbook();
    this.lastAppliedTs = [0, ''];
  }

  apply(event) {
    this.lastAppliedTs = event.ts;
    if (event.type === 'order') return this._applyOrder(event.order);
    if (event.type === 'cancel') return this._applyCancel(event.orderId);
    return [];
  }

  serializeBook() {
    return this._book.serialize();
  }

  loadSnapshot(snap) {
    this._book.loadSnapshot(snap);
  }

  _applyOrder(o) {
    const taker = { ...o, remaining: o.remaining ?? o.amount };
    const trades = this._book.cross(taker);
    if (taker.remaining > 0) this._book.addOrder(taker);
    return trades;
  }

  _applyCancel(orderId) {
    this._book.removeOrder(orderId);
    return [];
  }
}

export { MatchingEngine };
