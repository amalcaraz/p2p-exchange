# P2P Distributed Exchange

A small peer-to-peer orderbook built on [Grenache](https://github.com/bitfinexcom/grenache). Every node keeps its own full replica of the book; orders are stamped with a Lamport clock, broadcast over Grenache RPC, delivered in total order on every node, and applied by a deterministic matching engine. All replicas stay bit-identical.

There is no pub/sub — every broadcast is a `client.broadcast()` (which fans out via Grenache's `map`) to the shared `exchange_peer` RPC service that every node announces. See the note at the bottom about why.

## Prerequisites

- Node >= 22

## Install

```bash
npm install
```

## Run

Three terminals:

```bash
# terminal 1: two Grape DHT nodes (short TTL so dead entries age out fast)
npm run dev:grapes

# terminal 2: fork N exchange nodes (default 3, IDs + ports auto-assigned)
npm run dev:cluster -- 5

# terminal 3: fire a stress scenario (60 random concurrent orders by default)
npm run test-exchange                 # 60 orders in 3 waves of 20
npm run test-exchange -- 300          # or any count
```

Each node auto-generates a `SELF_ID`, binds an ephemeral RPC port, announces `exchange_peer`, and discovers the rest of the cluster with a `whoami` broadcast. No per-node config.

### Interactive CLI

```bash
npm run cli
```

Drops you into a REPL. It polls `whoami` every second to keep a fresh peer list, and lets you target nodes individually:

```
exchange> nodes                              # list discovered nodes
exchange> use <id-prefix>                    # pick one as the active node
exchange> submit buy 100 3                   # submit a limit order to the active node
exchange> book [id-prefix]                   # fetch the orderbook
exchange> snapshot [id-prefix]               # full snapshot (book + clocks)
exchange> stress 200                         # 200 random orders across all nodes
exchange> converge                           # fetch the book from every node and compare
exchange> help
```

## Tests

```bash
npm run test:unit          # pure domain + utils, ~50 tests, <1 s
npm run test:integration   # 3 scenarios, spawn real Grapes + nodes, ~50 s
npm test                   # both
```

The integration scenarios are: 3-node convergence under concurrent load, evicted-and-resumed node resync, and late-join snapshot.

## Config

Everything has sensible defaults. Only `GRAPE_URL` usually needs to be set. See `.env.example` for all knobs (`HEARTBEAT_MS`, `PEER_EVICTION_MS`, `BOOTSTRAP_WINDOW_MS`, `SNAPSHOT_TIMEOUT_MS`, `BROADCAST_TIMEOUT_MS`, etc.).

## Known limitations

- **Submit latency is bounded by the slowest live peer.** `submitOrder` only returns after the order has been totally-ordered-delivered. That's the price of strong consistency — there isn't a clever way around it short of weakening the consistency model.
- **Simple failure detector.** A peer silent for `PEER_EVICTION_MS` gets evicted, which unblocks the delivery queue. Under a network partition this can evict a live peer; it re-admits cleanly and triggers a resync when it comes back. A phi-accrual detector with quorum eviction would be better.
- **No persistence.** If every node dies simultaneously the book is gone. A restart joins as a fresh peer and catches up via snapshot. Fix: periodic snapshots to disk.
- **No auth.** Any caller can submit; any caller can cancel anything. Fix: signed orders keyed by originator.
- **Single trading pair, limit orders only.** No market or stop orders, no fees, no self-trade prevention.
- **Broadcast is whole-batch-retry.** Grenache's `map` uses `async.map` under the hood, which fails the whole batch on a single destination error. Our `client.broadcast()` wrapper retries; successful destinations dedupe via the `seen` set. Occasional wasted sends, but no custom per-destination protocol.
- **Bootstrap takes ~10 s if Grapes still hold stale entries** from a previous cluster run. The DHT TTL (`--dpa 10000`) is set low to keep this short; it's still an observable wait.
- **Port-0 fallback.** Grenache's WS transport doesn't expose the OS-assigned port after `listen(0)`, so we pre-allocate a free port via Node's `net` module. Tiny race window between close and rebind is accepted.

## Notes

Some thoughts on the design choices and what could still be improved, in no particular order:

- **Ordering was the central problem.** My first thought was a centralised sequencer that would hand out a global nonce based on receive time. Simple, fair to wall-clock, trivially consistent — but it turns the whole thing back into a centralised system with a single point of failure, which defeats the point. I spent a while looking at alternatives and settled on a Lamport logical clock. It has its own drawbacks — concurrent orders can be applied in an order that doesn't match the wall-clock arrival order, because it depends on each peer's internal clock — but that only matters inside very short windows, and in exchange we get strong consistency across replicas without coupling everything to one node. There are more sophisticated consensus protocols that smooth out those edge cases (total-order broadcast with vector clocks, Raft, etc.), but for the scope of this challenge Lamport feels like the right trade-off.

- **The orderbook could be faster.** It's a plain sorted array per side right now. A realistic implementation would keep `{asks: Map<Price, Order[]>, bids: Map<Price, Order[]>}` plus a sorted price ladder — or go straight to an AVL / red-black tree for the ladder — to get `O(log n)` inserts and `O(1)` best-price access. For a single-pair demo the arrays are fine.

- **The delivery queue could also be faster.** Same story: it's a sorted-insert array today. A proper min-heap keyed on `(T, nodeId)` would be a better fit.

- **More order types would be interesting.** Market orders, stop orders, IOC/FOK flags, maker/taker fees, self-trade prevention. None of those are hard to bolt onto the current matching engine, but each is a rabbit hole and I kept the scope to limit orders only.

- **Pub/sub was my first attempt at the broadcast layer.** I hit a bug in Grenache's sub client where subscribing to a topic would only connect to a single publisher instead of fanning out. I worked around it by hand-rolling the lookup + per-dest subscribe, but it added complexity without giving me much over the alternative. Moving to `rpcClient.broadcast()` (a thin wrapper over Grenache's `map`) on the shared service name turned out cleaner — it naturally fans out to every announcer, and broadcasts share the same transport / retry machinery as single-target RPCs.
