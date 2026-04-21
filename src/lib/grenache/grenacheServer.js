import { createRequire } from 'node:module';
import { GrenacheError } from '../utils/errors.js';

const require = createRequire(import.meta.url);
const Link = require('grenache-nodejs-link');
const { PeerRPCServer } = require('grenache-nodejs-http');

const LISTEN_RETRIES = 3;
const LISTEN_RETRY_DELAY_MS = 500;
const ANNOUNCE_INTERVAL_MS = 5000; // matches Grape's --dpa 10000 TTL

class GrenacheServer {
  constructor({ grapeUrl, port }) {
    this._grapeUrl = grapeUrl;
    this._port = port;
    this._link = null;
    this._peer = null;
    this._transport = null;
    this._announcedServices = [];
  }

  async start() {
    for (let attempt = 0; attempt <= LISTEN_RETRIES; attempt++) {
      try {
        this._link = new Link({ grape: this._grapeUrl });
        this._link.start();
        this._peer = new PeerRPCServer(this._link, {});
        this._peer.init();
        this._transport = this._peer.transport('server');
        this._transport.listen(this._port);
        console.log(`[grenache-server] listening on port ${this._port}`);
        return;
      } catch (err) {
        if (attempt === LISTEN_RETRIES) {
          throw new GrenacheError(`Failed to start server: ${err.message}`);
        }
        await new Promise((r) =>
          setTimeout(r, LISTEN_RETRY_DELAY_MS * Math.pow(2, attempt))
        );
      }
    }
  }

  stop() {
    for (const name of this._announcedServices) {
      this._link.stopAnnouncing(name, this._transport.port);
    }
    this._announcedServices = [];
    if (this._peer) this._peer.stop();
    if (this._link) this._link.stop();
    console.log('[grenache-server] stopped');
  }

  announce(serviceName) {
    this._link.startAnnouncing(serviceName, this._transport.port, {
      interval: ANNOUNCE_INTERVAL_MS,
    });
    this._announcedServices.push(serviceName);
  }

  onRequest(handler) {
    this._transport.on('request', handler);
  }
}

export { GrenacheServer };
