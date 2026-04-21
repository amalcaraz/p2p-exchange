import config from './config.js';
import { GrenacheServer } from '../lib/grenache/grenacheServer.js';
import { GrenacheClient } from '../lib/grenache/grenacheClient.js';
import { getFreePort } from '../lib/utils/getFreePort.js';
import { Exchange } from './domain/exchange.js';
import { ExchangeHandlers } from './api.js';

class ExchangeNode {
  constructor(cfg = config) {
    this._cfg = cfg;
    this._rpcPort = null;
    this._server = null;
    this._rpcClient = null;
    this._exchange = null;
  }

  async start() {
    this._rpcPort = this._cfg.RPC_PORT || (await getFreePort());

    this._server = new GrenacheServer({
      grapeUrl: this._cfg.GRAPE_URL,
      port: this._rpcPort,
    });
    await this._server.start();
    this._server.announce(this._cfg.PEER_SERVICE);
    this._server.announce(
      `${this._cfg.RPC_SERVICE_PREFIX}_${this._cfg.SELF_ID}`
    );

    this._rpcClient = new GrenacheClient({ grapeUrl: this._cfg.GRAPE_URL });
    await this._rpcClient.start();

    this._exchange = new Exchange({
      selfId: this._cfg.SELF_ID,
      config: this._cfg,
      publish: async (ev) => {
        const { err } = await this._rpcClient.broadcastOrdered(
          this._cfg.PEER_SERVICE,
          { action: 'peerEvent', event: ev },
          { timeout: this._cfg.BROADCAST_TIMEOUT_MS }
        );
        if (err) throw err;
      },
      discoverPeers: async () => {
        const { results } = await this._rpcClient.broadcast(
          this._cfg.PEER_SERVICE,
          { action: 'whoami' },
          { timeout: this._cfg.BROADCAST_TIMEOUT_MS }
        );
        return (results || []).map((r) => r?.nodeId).filter(Boolean);
      },
      fetchSnapshot: (peerId) =>
        this._rpcClient.request(
          `${this._cfg.RPC_SERVICE_PREFIX}_${peerId}`,
          { action: 'getSnapshot' },
          this._cfg.SNAPSHOT_TIMEOUT_MS
        ),
    });

    const handlers = new ExchangeHandlers(this._exchange);
    this._server.onRequest((rid, key, payload, handler) => {
      const action = payload?.action;
      if (action === 'submitOrder')
        return handlers.submitOrder(rid, key, payload, handler);
      if (action === 'getBook')
        return handlers.getBook(rid, key, payload, handler);
      if (action === 'getSnapshot')
        return handlers.getSnapshot(rid, key, payload, handler);
      if (action === 'peerEvent')
        return handlers.peerEvent(rid, key, payload, handler);
      if (action === 'whoami')
        return handlers.whoami(rid, key, payload, handler);
      handler.reply(new Error(`unknown action: ${action}`), null);
    });

    this._exchange.startTimers();
    await this._exchange.bootstrap();

    console.log(
      `[exchange] node ${this._cfg.SELF_ID} READY (RPC port ${this._rpcPort})`
    );
  }

  async stop() {
    this._exchange?.stopTimers();
    this._server?.stop();
    this._rpcClient?.stop();
  }
}

// Runtime

try {
  const node = new ExchangeNode();

  const shutdown = async () => {
    await node.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await node.start();
} catch (err) {
  console.error('[exchange] failed to start:', err);
  process.exit(1);
}
