class Membership {
  constructor(selfId) {
    this._self = selfId;
    this._clock = new Map([[selfId, 0]]);
    this._lastSeen = new Map();
    this._wasEvicted = new Set();
  }

  peerIds() {
    return this._clock.keys();
  }

  has(peerId) {
    return this._clock.has(peerId);
  }

  get(peerId) {
    return this._clock.get(peerId);
  }

  touch(peerId, ts, now) {
    const readmitted = !this._clock.has(peerId) && this._wasEvicted.has(peerId);

    const prev = this._clock.get(peerId) ?? 0;
    if (ts > prev) this._clock.set(peerId, ts);
    else if (!this._clock.has(peerId)) this._clock.set(peerId, 0);

    this._lastSeen.set(peerId, now);

    if (readmitted) this._wasEvicted.delete(peerId);
    return { readmitted };
  }

  evictStale(now, thresholdMs) {
    const evicted = [];
    for (const [peer, t] of this._lastSeen) {
      if (peer === this._self) continue;

      if (now - t > thresholdMs) {
        evicted.push(peer);
        this._clock.delete(peer);
        this._lastSeen.delete(peer);
        this._wasEvicted.add(peer);
      }
    }
    return evicted;
  }

  loadSnapshotClock(snapshotClock, now) {
    this._clock = new Map(Object.entries(snapshotClock));
    this._clock.set(this._self, snapshotClock[this._self] ?? 0);

    for (const peer of this._clock.keys()) {
      if (peer !== this._self) this._lastSeen.set(peer, now);
    }

    for (const peer of this._clock.keys()) this._wasEvicted.delete(peer);
  }

  minKnownClock() {
    let min = Infinity;
    for (const t of this._clock.values()) if (t < min) min = t;
    return min === Infinity ? 0 : min;
  }

  toJSON() {
    return Object.fromEntries(this._clock);
  }
}

export { Membership };
