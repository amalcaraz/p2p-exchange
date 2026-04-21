import { randomUUID } from 'node:crypto';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const config = Object.freeze({
  GRAPE_URL: process.env.GRAPE_URL || 'http://127.0.0.1:30001',
  RPC_PORT: num(process.env.RPC_PORT, 0),
  PEER_SERVICE: process.env.PEER_SERVICE || 'exchange_peer',
  RPC_SERVICE_PREFIX: process.env.RPC_SERVICE_PREFIX || 'exchange_rpc',
  HEARTBEAT_MS: num(process.env.HEARTBEAT_MS, 250),
  PEER_EVICTION_MS: num(process.env.PEER_EVICTION_MS, 2000),
  BOOTSTRAP_WINDOW_MS: num(process.env.BOOTSTRAP_WINDOW_MS, 1000),
  SNAPSHOT_TIMEOUT_MS: num(process.env.SNAPSHOT_TIMEOUT_MS, 5000),
  BROADCAST_TIMEOUT_MS: num(process.env.BROADCAST_TIMEOUT_MS, 2000),
  SELF_ID: process.env.SELF_ID || randomUUID().slice(0, 8),
});

export default config;
