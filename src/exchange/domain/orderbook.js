import { compareTs } from './lamportClock.js';

class Orderbook {
  constructor() {
    this._bids = []; // sorted: price desc, ts asc
    this._asks = []; // sorted: price asc, ts asc
  }

  addOrder(order) {
    const list = this._sideList(order.side);

    let i = 0;
    while (i < list.length && this._compare(order.side, list[i], order) <= 0)
      i++;

    list.splice(i, 0, order);
  }

  removeOrder(id) {
    for (const list of [this._bids, this._asks]) {
      const i = list.findIndex((o) => o.id === id);
      if (i >= 0) {
        list.splice(i, 1);
        return true;
      }
    }

    return false;
  }

  cross(taker) {
    const opposite = taker.side === 'buy' ? this._asks : this._bids;
    const trades = [];

    while (taker.remaining > 0 && opposite.length > 0) {
      const top = opposite[0];
      const crosses =
        taker.side === 'buy'
          ? taker.price >= top.price
          : taker.price <= top.price;

      if (!crosses) break;

      const amount = Math.min(taker.remaining, top.remaining);
      trades.push({
        maker: top.id,
        taker: taker.id,
        price: top.price,
        amount,
        ts: taker.ts,
      });
      taker.remaining -= amount;
      top.remaining -= amount;

      if (top.remaining === 0) opposite.shift();
    }
    return trades;
  }

  serialize() {
    const clone = (o) => ({ ...o });
    return { bids: this._bids.map(clone), asks: this._asks.map(clone) };
  }

  loadSnapshot(snap) {
    this._bids = snap.bids.map((o) => ({ ...o }));
    this._asks = snap.asks.map((o) => ({ ...o }));
  }

  _sideList(side) {
    return side === 'buy' ? this._bids : this._asks;
  }

  _compare(side, a, b) {
    if (a.price !== b.price)
      return side === 'buy' ? b.price - a.price : a.price - b.price;
    return compareTs(a.ts, b.ts);
  }
}

export { Orderbook };
