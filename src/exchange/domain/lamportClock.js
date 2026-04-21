function compareTs(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] < b[1]) return -1;
  if (a[1] > b[1]) return 1;
  return 0;
}

class LamportClock {
  constructor(nodeId) {
    this._nodeId = nodeId;
    this._value = 0;
  }
  
  get value() { return this._value; }

  bump() {
    this._value += 1;
    return [this._value, this._nodeId];
  }

  merge(remoteT) {
    this._value = Math.max(this._value, remoteT) + 1;
  }

  setTo(t) { this._value = t; }
}

export { LamportClock, compareTs };
