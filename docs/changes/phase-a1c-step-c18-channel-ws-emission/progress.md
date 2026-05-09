# C18 Progress — Channel WebSocket emission + broadcast/disconnect runtime injection

**Session:** S75 (2026-05-09). **Worktree:** `agent-afec100f667c7a777`. **Status:** **READY FOR PA REVIEW.**

## Commit chain

| SHA | Subject | Phase |
|---|---|---|
| `2709aaa` | `docs(c18): Phase 0 SURVEY — channel codegen pre-C18 inventory` | 0 — survey |
| `22da056` | `feat(c18-1): channel-cell auto-sync — V5-strict state-decls inside channel body` | 1 — cell sync |
| `cbcf974` | `feat(c18-2): broadcast/disconnect injection — channel-scoped server fns` | 2 — built-ins injection |
| `05b4974` | `feat(c18-3): wire _scrml_active_server for broadcast() helper` | 3 — runtime plumbing |
| `d343170` | `test(c18): channel-cell auto-sync + broadcast/disconnect injection (+20)` | 4 — tests |

## Files touched (relative to repo root)

- `compiler/src/codegen/emit-channel.ts` — re-pointed `extractSharedVars` to V5-strict `structuralForm:true`; added `extractChannelCells` alias; added `collectChannelFunctionMap` + `collectChannelCellMap`.
- `compiler/src/codegen/emit-server.ts` — channel-fn map + topic map computed per-file; `emitBroadcastInjection` helper inserts `broadcast(data)` / `disconnect()` as locals at the top of each channel-owned route handler body (CSRF + non-CSRF paths).
- `compiler/src/type-system.ts` — extended `LOGIC_SCOPE_GLOBAL_ALLOWLIST` with `broadcast` + `disconnect` (consistent with `replay` precedent).
- `compiler/src/route-inference.ts` — documentary comment on the existing E-RI-002 fire site explaining server-side channel-cell write semantics deferral.
- `compiler/src/commands/build.js` — capture Bun.serve() handle as `_scrml_server` and stash on `globalThis._scrml_active_server` (only when channels exist, gated on `hasWs`).
- `compiler/src/commands/dev.js` — same pattern for the watch/dev server, refreshed after every `server.reload()` / restart fallback.
- `compiler/tests/unit/channel.test.js` — +20 tests across §24/§25/§26.
- `docs/changes/phase-a1c-step-c18-channel-ws-emission/SURVEY.md` — Phase 0 inventory.

## Test count delta

- Baseline (pre-C18): **10626 / 69 / 1 / 3**
- After C18: **10646 / 69 / 1 / 3**
- **Delta: +20 pass, 0 new fails.** The 3 pre-existing fails are unchanged (F-BUILD-002 §3, Bootstrap L3, Self-host tokenizer parity — same as briefing).

## What landed

1. **V5-strict channel-cell auto-sync** — `<x> = init` inside a channel body now triggers the `__sync` wire emission (client `syncShared` effect + server WS-handler `ws.publish`). Pre-C18, this only fired on the retired `@shared` modifier (`isShared:true`), so canonical v0.next channels emitted connected WebSocket but zero sync wire. (F-CHANNEL-001 silent-failure pattern, closed for the cell-sync surface.)

2. **`broadcast(data)` injection** — server functions declared inside a `<channel>` body now get a local `broadcast` defined at the top of their HTTP route handler that publishes JSON-serialized data to the channel's topic via `globalThis._scrml_active_server.publish(topic, msg)`. Helper guards against missing server (no-ops cleanly).

3. **`disconnect()` injection** — symmetric helper; from an HTTP-routed server function it's a no-op (no current client identity), but it's syntactically valid so adopters can author code identical to the `onserver:*` form (where ws-scope is in scope).

4. **Typer allowlist** — `broadcast` / `disconnect` join `replay` in `LOGIC_SCOPE_GLOBAL_ALLOWLIST` so well-formed channel-scoped code compiles clean (no `E-SCOPE-001`).

5. **Build/dev plumbing** — `_scrml_active_server` is set after `Bun.serve()` returns and refreshed after every `server.reload()`. Gated on `hasWs` in build.js so non-channel apps emit identical output (zero pollution).

6. **Multi-channel disambiguation** — each channel's server functions publish to that channel's topic. `topic=` defaults to `name=` per §38.7. Verified by §26 multi-channel test.

## Deferred items (surfaced for follow-up)

| Item | Why deferred | Suggested follow-up |
|---|---|---|
| **Server-side `@cell = expr` semantics** (§38.4 line 15677) — the spec requires writes to channel-cells from server fns to emit `__sync` frames. Server-side `_scrml_reactive_set` is a client-only runtime symbol, so the emit is broken at runtime. | Implementing this requires either (a) a per-channel server-side state Map with read-substitution, or (b) rewrite `@cell = expr` to a `broadcast({__type:"__sync",...})` call. Either is ~3-4h of new code, beyond the C18 4-6h budget. | Follow-up step (suggest C18b or fold into a future channel-runtime closer step). E-RI-002 remains as the gate; adopters can use the Phoenix-style pattern (server fn takes args + calls `broadcast`). |
| **E-CHANNEL-004** — `broadcast()` / `disconnect()` outside any channel scope. | Today the typer allowlist lets these compile clean anywhere; emitted code references undefined runtime symbols out of channel scope (it would silently no-op or throw). | A1b/codegen check that scans bare-expr bodies for `broadcast`/`disconnect` callees inside non-channel-owned functions; surface follow-up B-step. |
| **E-CHANNEL-005** — `onserver:message=handler(p1, p2)` (multi-param). | A1b/typer territory; not C18 (codegen). | Follow-up B-step. |
| **E-CHANNEL-006** — `onclient:* = serverFn(...)` declared as `server function`. | Same. | Follow-up B-step. |
| **W-CHANNEL-001** — static `topic=not` warning. | Same. | Follow-up B-step. |
| **§38.6.2 dynamic `topic=@var` runtime** — subscribe/unsubscribe on every write to `@var`. | Substantial new piece (topic-state tracking + dynamic ws.subscribe/unsubscribe). | Defer to a topic-runtime closer step. |
| **`onserver:*` handlers' `disconnect()` semantics** — close `ws` directly. | C18's emit-channel.ts WS-handler emit doesn't yet inject `disconnect` for `onserver:close` etc. The C18 SCOPE focused on `server function` injection; the symmetric `onserver:*` handler injection is a small follow-up. | Follow-up — extend `emitChannelWsHandlers` to wrap `onserver:*` invocations in a closure providing `broadcast` (= `ws.publish`) + `disconnect` (= `ws.close`). |
| **Example freshness** — `examples/15-channel-chat.scrml` and `examples/08-chat.scrml` use the retired `@shared` modifier; they will fire `E-CHANNEL-SHARED-MODIFIER` under M19/B19. | Out of C18 scope (example-file freshness). | Surface separately. |

## Spec amendments

**None.** §38 is comprehensive for the C18-scope surface. The deferred items above are all enforcement gaps (the spec already specifies the intended behavior); the gaps surfaced for follow-up dispatches.

## Load-bearing answer — what was already there pre-C18, what was the actual gap, time vs estimate

**Pre-C18 (substantial):**
- `compiler/src/codegen/emit-channel.ts` (422 LOC) — `collectChannelNodes`, `emitChannelClientJs` (IIFE with WebSocket connect, reconnect, onclient handlers, cleanup), `emitChannelServerJs` (WS upgrade route export), `emitChannelWsHandlers` (Bun.serve() websocket: option object).
- `compiler/src/commands/build.js` + `dev.js` — discovery + merge of `_scrml_ws_handlers` exports across modules, wiring into Bun.serve() websocket: option.
- B19 placement validation (channels file-level), `@shared` retirement.
- 23 channel.test.js describe blocks covering parse + IIFE shape + URL safety + auto-reconnect + onclient handlers.

**The actual gap (3 pieces):**
1. `extractSharedVars` only matched `isShared:true` (the retired v1 modifier); V5-strict structural-form decls — the canonical v0.next shape — never matched. **Silent failure: connected WS, zero sync wire.**
2. `broadcast` / `disconnect` were tokenizer keywords but had no semantic anchor — symbol-table fired E-SCOPE-001; codegen emitted literal `broadcast(...)` referencing nothing.
3. Bun.serve() handle was not exposed for HTTP-route handlers to call publish().

**Time vs estimate:** ~5h focused work for ~5-6h SCOPE estimate — at the bottom of the band. The depth-of-survey-discount expectation didn't materialize: each gap legitimately needed implementation. About 60% of §38's spec surface shipped pre-C18; C18 closed the wire-layer half (cell sync + broadcast injection). The other deferred items are post-C18 enforcement work.

## Reviewer cherry-pick guide (PA / S67 protocol)

```
git checkout main
git checkout agent/c18-channel-ws-emission -- \
  compiler/src/codegen/emit-channel.ts \
  compiler/src/codegen/emit-server.ts \
  compiler/src/type-system.ts \
  compiler/src/route-inference.ts \
  compiler/src/commands/build.js \
  compiler/src/commands/dev.js \
  compiler/tests/unit/channel.test.js \
  docs/changes/phase-a1c-step-c18-channel-ws-emission/SURVEY.md \
  docs/changes/phase-a1c-step-c18-channel-ws-emission/progress.md
# verify: bun run test → 10646 / 69 / 1 / 3
# commit per S67 protocol
```
