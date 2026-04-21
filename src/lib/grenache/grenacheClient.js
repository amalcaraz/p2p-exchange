import { createRequire } from 'node:module';
import { GrenacheError } from '../utils/errors.js';
import { Mutex } from '../utils/mutex.js';

const require = createRequire(import.meta.url);
const Link = require('grenache-nodejs-link');
const { PeerRPCClient } = require('grenache-nodejs-http');

const MAP_RETRIES = 3;
const MAP_RETRY_DELAY_MS = 1000;

class GrenacheClient {
  constructor({ grapeUrl }) {
    this._grapeUrl = grapeUrl;
    this._link = null;
    this._peer = null;
    this._sendMutex = new Mutex();
  }

  async start() {
    this._link = new Link({ grape: this._grapeUrl, lruMaxAgeLookup: 1000 });
    this._link.start();
    this._peer = new PeerRPCClient(this._link, {});
    this._peer.init();
    console.log('[grenache-client] started');
  }

  stop() {
    if (this._peer) this._peer.stop();
    if (this._link) this._link.stop();
    console.log('[grenache-client] stopped');
  }

  async broadcast(serviceName, payload, { timeout = 10000, limit } = {}) {
    const mapOpts = limit ? { timeout, limit } : { timeout };
    let last = { err: null, results: [] };
    for (let attempt = 0; attempt <= MAP_RETRIES; attempt++) {
      last = await new Promise((resolve) => {
        this._peer.map(serviceName, payload, mapOpts, (err, results) => {
          resolve({ err, results: results ?? [] });
        });
      });
      if (!last.err) return last;
      if (attempt < MAP_RETRIES) {
        await new Promise((r) =>
          setTimeout(r, MAP_RETRY_DELAY_MS * Math.pow(2, attempt))
        );
      }
    }
    return last;
  }

  async request(serviceName, payload, timeout = 10000) {
    return new Promise((resolve, reject) => {
      this._peer.request(
        serviceName,
        payload,
        { timeout, retry: MAP_RETRIES },
        (err, result) => {
          if (err)
            reject(
              new GrenacheError(
                `Request to ${serviceName} failed: ${err.message}`
              )
            );
          else resolve(result);
        }
      );
    });
  }

  async broadcastOrdered(serviceName, payload, opts = {}) {
    const release = await this._sendMutex.acquire();
    try {
      return await this.broadcast(serviceName, payload, opts);
    } finally {
      release();
    }
  }
}

export { GrenacheClient };
