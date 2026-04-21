import { Deferred } from '../../lib/utils/deferred.js';
import { ValidationError } from '../../lib/utils/errors.js';
import { sleep } from '../../lib/utils/sleep.js';
import { shuffle } from '../../lib/utils/shuffle.js';
import { LamportClock, compareTs } from './lamportClock.js';
import { DeliveryQueue } from './deliveryQueue.js';
import { MatchingEngine } from './matchingEngine.js';
import { Membership } from './membership.js';

class Exchange {
  constructor({ selfId, config, publish, discoverPeers, fetchSnapshot }) {
    this._selfId = selfId;
    this._cfg = config;
    this._publish = publish;
    this._discoverPeers = discoverPeers;
    this._fetchSnapshot = fetchSnapshot;

    this._state = 'BOOTSTRAPPING';
    this._bootBuffer = [];
    this._seen = new Set();
    this._pending = new Map();

    this._clock = new LamportClock(selfId);
    this._membership = new Membership(selfId);
    this._queue = new DeliveryQueue();
    this._engine = new MatchingEngine();

    this._heartbeatTimer = null;
    this._evictionTimer = null;
  }

  get state() { return this._state; }
  get selfId() { return this._selfId; }

  onEvent(ev) {
    if (this._state !== 'READY') { this._bootBuffer.push(ev); return; }
    this._handleEvent(ev);
  }

  startTimers() {
    this._heartbeatTimer = setInterval(() => this._heartbeat(), this._cfg.HEARTBEAT_MS);
    this._evictionTimer = setInterval(() => this._evictionTick(), this._cfg.HEARTBEAT_MS);
  }

  stopTimers() {
    clearInterval(this._heartbeatTimer);
    clearInterval(this._evictionTimer);
    this._rejectAllPending(new Error('node stopping'));
  }

  _rejectAllPending(err) {
    for (const { deferred } of this._pending.values()) deferred.reject(err);
    this._pending.clear();
  }

  async bootstrap() {
    await sleep(this._cfg.BOOTSTRAP_WINDOW_MS);

    let candidates = [];
    try {
      const ids = await this._discoverPeers();
      candidates = ids.filter((id) => id !== this._selfId);
    } catch (err) {
      console.warn(`[exchange] ${this._selfId} discovery failed: ${err.message}`);
    }

    for (const id of candidates) {
      this._membership.touch(id, 0, Date.now());
    }

    if (candidates.length === 0) {
      this._state = 'READY';
      this._flushBootBuffer();
      return;
    }

    this._state = 'SYNCING';
    await this._syncFromPeer(candidates, { requireAhead: false });
  }

  async submitOrder({ side, price, amount }) {
    if (this._state !== 'READY') throw new ValidationError('node is not READY');

    const ts = this._clock.bump();
    const orderId = `${this._selfId}:${ts[0]}`;
    const deferred = new Deferred();
    this._pending.set(orderId, { deferred, ts });

    const ev = { type: 'order', ts, order: { id: orderId, side, price, amount, remaining: amount, ts } };

    try {
      await this._publish(ev);
    } catch (err) {
      // If the event already looped back and resolved, honor it despite the broadcast error.
      if (!this._pending.has(orderId)) return deferred.promise;
      this._pending.delete(orderId);
      throw err;
    }

    return deferred.promise;
  }

  getBook() { return this._engine.serializeBook(); }

  getSnapshot() {
    return {
      book: this._engine.serializeBook(),
      snapshotTs: this._engine.lastAppliedTs,
      knownClock: this._membership.toJSON(),
    };
  }

  async _scheduleResync(reason, attempt = 0) {
    if (this._state !== 'READY') return;

    const candidates = [...this._membership.peerIds()].filter((id) => id !== this._selfId);
    if (candidates.length === 0) return;

    console.log(`[exchange] ${this._selfId} scheduling resync (${reason})${attempt ? ` [retry ${attempt}]` : ''}`);

    this._state = 'SYNCING';
    try {
      const applied = await this._syncFromPeer(candidates, { requireAhead: true });
      if (!applied && attempt < 3) {
        setTimeout(() => this._scheduleResync(reason, attempt + 1), 500 * Math.pow(2, attempt));
      }
    } catch (err) {
      console.error('[exchange] resync failed:', err);
      this._state = 'READY';
      this._flushBootBuffer();
    }
  }

  async _syncFromPeer(candidates, { requireAhead }) {
    let snap = null;
    for (const peerId of shuffle(candidates)) {
      try {
        const s = await this._fetchSnapshot(peerId);
        if (!s) continue;

        if (requireAhead && compareTs(s.snapshotTs, this._engine.lastAppliedTs) <= 0) continue;

        snap = s;
        break;
      } catch { /* try next */ }
    }

    if (!snap) {
      console.warn(`[exchange] ${this._selfId} no snapshot source found; keeping current state`);

      this._state = 'READY';
      this._flushBootBuffer();

      return false;
    }

    this._engine.loadSnapshot(snap.book);
    this._engine.lastAppliedTs = snap.snapshotTs;
    this._clock.setTo(snap.snapshotTs[0]);
    this._membership.loadSnapshotClock(snap.knownClock, Date.now());

    this._state = 'READY';
    this._flushBootBuffer();
    this._resolvePendingFromSnapshot(snap.snapshotTs);

    return true;
  }

  _flushBootBuffer() {
    const buffered = this._bootBuffer;
    this._bootBuffer = [];
    for (const ev of buffered) this._handleEvent(ev);
  }

  _handleEvent(ev) {
    if (!ev?.ts) return;
    if (compareTs(ev.ts, this._engine.lastAppliedTs) <= 0) return;

    const key = `${ev.ts[0]}:${ev.ts[1]}`;
    if (this._seen.has(key)) return;
    
    this._seen.add(key);
    const [T, P] = ev.ts;
    this._clock.merge(T);
    const { readmitted } = this._membership.touch(P, T, Date.now());
    if (ev.type === 'order' || ev.type === 'cancel') this._queue.enqueue(ev);
    this._drain();
    if (readmitted) this._scheduleResync(`re-admitted peer ${P}`);
  }

  _drain() {
    const events = this._queue.drain(this._membership.minKnownClock());

    for (const ev of events) {
      if (compareTs(ev.ts, this._engine.lastAppliedTs) <= 0) continue;
      const trades = this._engine.apply(ev);
      this._resolvePending(ev, trades);
    }
  }

  _resolvePending(ev, trades) {
    if (ev.type !== 'order') return;

    const entry = this._pending.get(ev.order.id);
    if (!entry) return;

    const book = this._engine.serializeBook();
    const resting = book.bids.concat(book.asks).find((o) => o.id === ev.order.id);
    const remaining = resting?.remaining ?? 0;

    entry.deferred.resolve({ orderId: ev.order.id, trades, remaining });
    this._pending.delete(ev.order.id);
  }

  _resolvePendingFromSnapshot(snapshotTs) {
    if (this._pending.size === 0) return;

    const book = this._engine.serializeBook();
    const byId = new Map();
    for (const o of book.bids) byId.set(o.id, o);
    for (const o of book.asks) byId.set(o.id, o);

    for (const [orderId, { deferred, ts }] of this._pending) {
      if (compareTs(ts, snapshotTs) > 0) continue;
      const resting = byId.get(orderId);
      const remaining = resting?.remaining ?? 0;
      deferred.resolve({ orderId, trades: [], remaining });
      this._pending.delete(orderId);
    }
  }

  _heartbeat() {
    const ts = this._clock.bump();
    Promise.resolve(this._publish({ type: 'heartbeat', ts })).catch((err) => {
      console.warn(`[exchange] ${this._selfId} heartbeat publish failed: ${err.message}`);
    });
  }

  _evictionTick() {
    const evicted = this._membership.evictStale(Date.now(), this._cfg.PEER_EVICTION_MS);
    if (evicted.length > 0) this._drain();
  }
}

export { Exchange };
