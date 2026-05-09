# C18 Phase 0 SURVEY — Channel WebSocket emission + broadcast/disconnect runtime injection

**Session:** S75 (2026-05-09). **Worktree:** `agent-afec100f667c7a777`. **Baseline:** 10626 / 69 / 1 / 3.

## Per-piece inventory

| Piece | Status | Notes |
|---|---|---|
| `compiler/src/codegen/emit-channel.ts` | **EXISTS, substantial** | 422 LOC. Has `collectChannelNodes`, `emitChannelClientJs`, `emitChannelServerJs`, `emitChannelWsHandlers`. Wired into `emit-server.ts:854-866` and `emit-reactive-wiring.ts:530`. |
| Auto WS endpoint emission `/_scrml_ws/<name>` | **WORKS** | `emitChannelServerJs` emits `export const _scrml_route_ws_<safeName>` with `isWebSocket: true`, `server.upgrade()` handler, optional auth check. Verified by probe. |
| `topic=` defaulting to `name` | **WORKS** | `extractChannelAttrs` defaults `topic = name` when `topic` attribute absent. Verified by probe. |
| Bun.serve WS upgrade integration | **WORKS** | `_scrml_ws_handlers` export with `open(ws)`, `message(ws, raw)`, `close(ws, code, reason)`; `commands/build.js:151-264` discovers and merges across modules. `commands/dev.js:175-191` mirror path. |
| Client IIFE | **WORKS** | `_scrml_ws_<safeName>` IIFE; `new WebSocket(...)` with protocol-relative scheme; auto-reconnect; `onclient:open/close/error` handlers wired; `_scrml_register_cleanup` registered. |
| `onserver:open / message / close` | **WORKS** | Wired into `_scrml_ws_handlers` per-channel branches keyed by `ws.data.__ch`. |
| **Channel-cell auto-sync (V5-strict)** | **GAP** | `extractSharedVars` (line 194) collects only `n.isShared === true` state-decls. Under M19/B19, `<messages> = []` inside a channel body is parsed with `structuralForm: true` and **no `isShared` flag**. Therefore zero sync wire is emitted for canonical v0.next channels. |
| **`broadcast(data)` auto-injection** | **GAP** | `broadcast`/`disconnect` are tokenizer keywords (tokenizer.ts:78), but: (1) symbol-table treats them as undeclared identifiers (`E-SCOPE-001`); (2) emit-server emits the literal `broadcast(...)` call into the route handler with no implementation; (3) no scoping check verifies the call is inside a channel body. Probe confirms `broadcast({type:"new",...})` fires `E-SCOPE-001` from typer. |
| **`disconnect()` auto-injection** | **GAP** | Same as `broadcast`. |
| `E-CHANNEL-001` (missing `name=`) | **WORKS** | `emit-html.ts:809`. |
| `E-CHANNEL-INSIDE-PROGRAM` | **WORKS** (B19) | `symbol-table.ts:5816` `fireChannelInsideProgram`. |
| `E-CHANNEL-SHARED-MODIFIER` | **WORKS** (B19) | `symbol-table.ts:5864` `fireChannelSharedModifier`. |
| `E-CHANNEL-007` (interpolation) | **WORKS** | `validators/attribute-interpolation.ts:47`. |
| **`E-CHANNEL-004`** (broadcast/disconnect outside channel scope) | **GAP** | Not enforced. |
| **`E-CHANNEL-005`** (multi-param onserver:message) | **GAP** | Not enforced. |
| **`E-CHANNEL-006`** (server function as onclient handler) | **GAP** | Not enforced. |
| Server function inside channel body — write to `@channel-cell` | **GAP** | RI fires `E-RI-002` ("server functions cannot mutate `@` reactive variables"). §38.4 says channel cells DO sync server-to-client via `broadcast`/`__sync` wire. RI is channel-blind. |
| Channel-cell read across scopes (channel body ↔ `<program>`) | **WORKS** | Probe shows `${@messages.length}` in `<program>` resolves; classifier hoists across file scope. |

## Existing test coverage

`compiler/tests/unit/channel.test.js` — 23 describe blocks (`§1` … `§23`):
- §1-§6 parse / attribute extraction
- §7 emit-html silences `<channel>`
- §8 E-CHANNEL-001
- §9-§13 client IIFE / sync (sync only fires on `isShared` decls — no V5-strict path)
- §14-§19 emit-channel direct API + URL safe-name
- §20 `broadcast`/`disconnect` keywords (tokenizer-level only)
- §21 protocol-relative URL
- §22 onclient: handlers
- §23 close handler signature

Cross-file integration:
- `tests/integration/p3a-cross-file-multi-page-broadcast.test.js` — verifies wire-route emission across importer pages (V5-strict body). Doesn't probe sync.
- `tests/integration/p3a-pure-channel-file.test.js` — exporter file emits no per-channel artifacts.

**B19 tests** (S69, A1b) lock the placement + `@shared`-rejection error codes.

**No test asserts:**
- V5-strict `<x> = init` inside channel body emits `__sync` wire frames on writes.
- `broadcast(...)` from a channel-scoped server function publishes to subscribers.
- `disconnect()` from a channel-scoped server function disconnects the current client.
- E-CHANNEL-004 / 005 / 006.

## Sample/example coverage

- `samples/compilation-tests/channel-basic.scrml` — minimal sample, `<channel>` nested inside `<program>` body and uses unflagged state-decl outside channel. Mostly compile-shape smoke.
- `examples/15-channel-chat.scrml` — uses **outdated `@shared` modifier** (v1 syntax). Will fire `E-CHANNEL-SHARED-MODIFIER` under M19/B19. Out-of-scope for C18; example freshness is a separate concern.
- `examples/23-trucking-dispatch/channels/*.scrml` — uses canonical V5-strict shape per file inspection. Pure-channel files imported by `app.scrml`.
- `examples/08-chat.scrml` — uses `@shared` (outdated).

## `runtime/channels.js` status

**No top-level `runtime/` directory exists.** The "runtime" is inlined into emitted JS via `emit-channel.ts` (client IIFE; server `_scrml_ws_handlers`) and `runtime-template.js` (the SCRML_RUNTIME shared inline). This is consistent with the rest of A1c which inlines per-emit rather than shipping a runtime library — see C5/C6/C7/C16 patterns.

C18 adds:
- A small **server-side helper block** for channel-scoped server functions, defining `broadcast` / `disconnect` as locals (closure capture of the current channel's topic + ws).
- Emission of **`__sync` wire frames** on writes to V5-strict cells declared inside a channel body — both directions (server → all clients via `ws.publish`; client → server via the IIFE's `syncShared`).

No new `runtime/channels.js` needed; everything lives in `emit-channel.ts` and the surrounding emitters consistent with the project's inline-runtime pattern.

## Spec interpretation — ambiguities + decisions

§38.6 normative: `broadcast(data)` SHALL publish to all subscribers of the channel's active topic; available "in every server function and onserver:* handler declared inside a `<channel>` lexical scope." **Single argument, single topic** — no ambiguity.

§38.6.1 normative: `onserver:message=handler(param)` parameter-binding is "JSON.parse(event.data)" assignment. Already handled by `extractChannelHandlers` + `emitChannelWsHandlers` body emission.

§38.4 normative: state-decls inside a channel body emit `{__type:"__sync", __key:<name>, __val:<value>}` wire frames. **Both directions** are spec-implied (line 15677): "The receiving end (server-side router for client-originated writes; client-side IIFE for server-originated writes) updates the corresponding cell."

**No spec amendments needed.** §38 is comprehensive.

## What changed in v0.next that broke channel codegen

`@shared` was retired in M19/B19 (S57-S69). The codegen was never re-pointed: `extractSharedVars` still scans for `isShared:true`, which never matches V5-strict state-decls. Result: **canonical v0.next channels emit a connected WebSocket but no synchronization** — silent failure when the user writes to a channel cell.

This is the exact "silent failure" pattern flagged by F-CHANNEL-001 in earlier sessions; the surface for state cells specifically is what's gone untested.

## Estimated revised scope

The SCOPE row's 4-6h estimate is roughly accurate. The work breaks into:

1. **Re-point `extractSharedVars` → `extractChannelCells`** — collect every state-decl inside a channel body (regardless of `isShared`). ~30 min.
2. **Channel-cell auto-sync wire emission** — both client write→server (already works for `isShared`; just rename the path) and server write→all clients via `ws.publish`. ~1.5h.
3. **`broadcast` / `disconnect` injection in server functions inside channel scope** — 
   - tag fnNode `_channelOwner: name` during AST collection (extends `collectChannelNodes` or adds a sibling pass).
   - emit-server prefixes the route handler body with local `broadcast`/`disconnect` definitions when the function is channel-owned.
   - RI: skip `E-RI-002` on assignments to channel-owned cells from channel-owned server functions (cells now legitimately mutate via broadcast wire).
   - Symbol-table: register `broadcast`/`disconnect` as in-scope inside channel-owned function bodies.
   ~2-2.5h.
4. **E-CHANNEL-004 enforcement** — symbol-table scan or codegen-time check. ~30 min.
5. **Tests** — ~25-40 new unit + integration:
   - V5-strict cell sync on write (client → wire → server publish; server → wire → client receive)
   - broadcast() inside channel-scoped server function publishes
   - disconnect() inside channel-scoped server function closes
   - E-CHANNEL-004 negative cases (broadcast outside channel)
   - server function inside channel body assigns `@cell` without `E-RI-002`
   - end-to-end: client write → broadcast → second-client receive simulated via WS handler invocation
   ~1.5h.

**Total: ~5-6h.** No depth-of-survey-discount expected; the shipped piece (route + IIFE + handlers) is correct, but the auto-sync + broadcast injection legitimately needs new code. About 60% of the spec surface ships pre-C18; C18 closes the remaining 40%.

## Out of scope (deferred)

- E-CHANNEL-005 / E-CHANNEL-006 — diagnostics for malformed handler attribute calls. **DEFER** — these are A1b territory (B-step), not codegen. They don't block any user code today (probe shows zero diagnostics for malformed attributes — they just degrade silently). Surface for follow-up B step.
- W-CHANNEL-001 (static `topic=not` warning) — also A1b/typer territory.
- Topic = `not` runtime semantics (§38.6.2 dynamic subscription/unsubscription) — needs runtime topic-state tracking; substantial new piece. **DEFER**, suspect-flag as scope creep beyond C18 row. Not blocked by C18.
- Example freshness (`examples/15-channel-chat.scrml`, `examples/08-chat.scrml`) — uses outdated `@shared` syntax. Triage separately.

## Plan

Proceed with phases 1-5 above. Estimated 5-6h, will surface at end with revised hour count.
