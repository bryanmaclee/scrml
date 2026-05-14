# events.map.md
# project: scrmlts
# updated: 2026-05-13T23:00:00Z  commit: 71305fe

## Status

No external event bus, EventEmitter, Kafka, RabbitMQ, or pubsub infrastructure detected in the compiler source. The compiler is a pure transformation tool (scrml → HTML/JS/CSS) without runtime event brokering in the compiler process itself.

## Runtime Pub/Sub (in compiled output)

The compiler EMITS WebSocket pub/sub code into compiled server output. This is output of the compiler, not the compiler's own architecture.

### WebSocket Topics (compiler/src/codegen/emit-channel.ts, emit-server.ts)

| Mechanism | Where emitted | Pattern |
|-----------|---------------|---------|
| ws.subscribe(ws.data.__topic) | emit-channel.ts | Server subscribes the WebSocket to a topic on connect |
| ws.publish(ws.data.__topic, raw) | emit-channel.ts | Server broadcasts to all subscribers of a topic |
| _scrml_srv.publish(topicExpr, msg) | emit-server.ts | Server function publishes data to a channel topic |

### Channel Placement Rules (v0.3, S87 Insight 30)

Two canonical placements for `<channel>`:
1. **Inside `<program>`** — standard v0.3 placement. Cross-page shared state.
2. **PURE-CHANNEL-FILE** — file-top `<channel>` in a file with NO `<program>`. Module-file dispensation per §38.1 + engine-parity precedent. Does NOT fire `E-CHANNEL-OUTSIDE-PROGRAM`.

Violation shape that fires `E-CHANNEL-OUTSIDE-PROGRAM`: `<channel>` at file-top in a file that ALSO contains `<program>` as a sibling.
Violation shape that fires `E-CHANNEL-INSIDE-PAGE`: `<channel>` inside `<page>`.

Channel placement pre-check enforced by shared AST walker in `compiler/src/validators/ast-walk.ts`.

### §36 Input Device Event Model (NEW S89 — CLOSED)

`<keyboard id=...>`, `<mouse id=...>`, `<gamepad id=...>` elements compile to input-state capture loops. These are NOT pub/sub channels — they are polled-state mirrors captured via requestAnimationFrame event handlers. Input state is addressed by id and read as reactive cells in scrml source. Duplicate `id=` within a scope fires E-INPUT-005.

### meta.emit() Runtime Placement (compiler/src/runtime-template.js)

The runtime has a `meta.emit()` mechanism for compile-time-controlled DOM injection at ^{} block positions. One-way compiler-to-DOM; not pub/sub.

### _scrml_effect / _scrml_reactive_subscribe (runtime-template.js)

Reactive subscriptions in compiled client runtime:
- `_scrml_reactive_subscribe(name, fn)` — subscribe to a named reactive cell; fires on set
- `_scrml_effect(fn)` — run fn reactively; subscribes to all cells accessed during execution

## Bus Type

None in the compiler process. Compiled outputs use Bun's WebSocket pub/sub API (topic-based) for channel features.

## Tags
#scrmlts #map #events #websocket #pubsub #reactive #channels #s89 #pure-channel-file #input-devices

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
