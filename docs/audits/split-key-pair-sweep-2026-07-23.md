---
status: current
last-reviewed: 2026-07-23
---

# Split-key-pair sweep — S282

**Scope:** `compiler/src/` incl. `codegen/` and `runtime-template.js`, at `main` `9688c5f7`.
**Method:** read-only agent sweep, traced both sides per candidate. Finding #1 additionally
PA-confirmed by compiling and reading the emitted SQL. Class defined at
[[g-split-key-pair-class]]; the live instance is [[g-pgnotify-listen-case-split]].

**The shape:** a lookup key assembled from a source-level cell/engine/state NAME at the write
site and re-assembled **independently** at the read site, with no shared key-builder. Any
transform touching the name splits the pair, and the failure is normally SILENT.

**Result: 14 instances. 10 silent, 4 diagnosed.** The four the `chunk-namespacing` arc already
found and fixed are excluded from this count.

## Ranked

| # | key | write -> read | breaks | silent | status |
|---|---|---|---|---|---|
| 1 | PG NOTIFY channel from `<channel name=>` | `emit-channel.ts:903` -> `:987/:1028` | §38.13 `watches=` feed delivers zero rows | **SILENT** | **CONFIRMED + PA-EMPIRICAL** — see gap |
| 2 | `_scrml_request_<id>` | 8 concat sites -> `emit-lift.js:116`, `emit-reactive-wiring.ts:588` **regex-mine the id back out** | a `<request>` read is never `_scrml_effect`-wrapped, so it never re-renders loading->data | **SILENT** (stuck on the loading value) | CONFIRMED |
| 3 | engine cell name as DOM mount id | `emit-engine.ts:2715` -> `emit-variant-guard.ts:1134` | `if (!_mount) return;` — the dispatcher renders no arm at all | **SILENT** | CONFIRMED |
| 4 | `<compound>.submitted` synth cell | `emit-synth-surface.ts:156` (whole-string encode) -> `emit-event-wiring.ts:818` (base-first encode, then `+ ".submitted"`) | `<formFor>` submit writes an orphan cell; the show-errors-after-submit gate never flips | **SILENT** | CONFIRMED (fires when `encoding.enabled`) |
| 5 | the whole §55 validity surface | `emit-synth-surface.ts` + `emit-validators.ts` -> **three further mirrors**: `reactive-deps.ts:1249`, `emit-bindings.ts:257`, `emit-event-wiring.ts:1224` | any drift and `@form.email.touched` reads `undefined` | **SILENT** | CONFIRMED — self-documented ("same predicate as", "Mirror of"); `emit-expr.ts` comment: *"unregistered key -> undefined at runtime -> REGRESSION"* |
| 6 | cell name as `data-scrml-ref` | `emit-html.ts:2875` -> `emit-bindings.ts:719` | `querySelector` null -> `@el` permanently absent | **SILENT** | CONFIRMED |
| 7 | SSR seed wire marker | `emit-server.ts:4340` -> `runtime-template.js:2531` (`indexOf`/`slice`) | soft-nav loses all server-authoritative state | **SILENT** (the `catch` keeps going) | CONFIRMED |
| 8 | channel-cell name on the `__sync` wire | `emit-logic.ts:1710,2534` -> `emit-channel.ts:766` | frame arrives, matches nothing, cell never syncs | **SILENT** | CONFIRMED — the *set* is shared, the *key string* is not |
| 9 | per-row reconcile key | `emit-ssr-render.ts:313` -> `emit-each.ts:2028`, compared `runtime-template.js:1832` | SSR rows never adopt; full teardown/rebuild on hydrate | **SILENT** (degrades gracefully; flash/perf only) | CONFIRMED — two independent impls of one 3-branch rule |
| 10 | WS upgrade path | `emit-channel.ts:835` -> `:741` | connect 404, reconnect loop | diagnosed | CONFIRMED |
| 11 | each-mount id | `emit-each.ts:2715` + fences -> `runtime-template.js:2192` | `<each>` in an engine/match arm renders empty on arm entry | **SILENT** | CONFIRMED shape, LOW risk — numeric `node.id`, immune to *name* transforms |
| 12 | item-scoped match dispatcher name | `emit-variant-guard.ts:1112` -> `emit-each.ts:968` (hand-rebuilt in another file) | per-item `<match>` inside `<each>` dies | diagnosed (ReferenceError) | CONFIRMED |
| 13 | route+role chunk manifest key | `emit-html.ts:3947` -> `route-splitter.ts:1153` | hover-prefetch no-ops | diagnosed (`console.warn`) | CONFIRMED |
| 14 | `forms.json` MCP descriptor keys | `emit-synth-surface.ts` -> `mcp-descriptors.ts:595` (`encodeKey = (k) => k` hard-stubbed) | descriptor keys mismatch the emitted store under encoding | **SILENT** | CONFIRMED — already documented in-file as a v0 limitation |

## The exemplar to copy

`data-scrml-theme-<cell>` (§65.6). `themeVariantAttr` (`emit-theme-reset.ts:195`) is called by
**both** the CSS selector emitter (`:248`) and the JS attribute setter (`emit-client.ts:1346`).
One builder, two callers, cannot drift. This is the in-repo model for every fix above.

## Checked and CLEAN — do not re-sweep

- **All `__scrml_engine_<var>_*` registries** (`_transitions`/`_timers`/`_idle`/`_msg_arms`/
  `_internal_transitions`/`_history_map`/`_fire_hooks`) — exported builders at
  `emit-engine.ts:345,357,369,381,403,1295,4161`; every definition and lookup calls them.
- `data-scrml-logic` / `-errors-anchor` / `-render-by-tag` / `-bind-*` — the id is a `genVar`
  counter HANDED to the reader through the binding registry, never reconstructed.
- `fnNameMap` (server-fn stub names) — a Map threaded from `emit-functions.ts:1422`.
- `_scrml_engine_arm_state_timers` / `_clear_state_timers` / `_clear_named_timer` — the
  `var::state::n:name` composite is built at three sites but all three are inside
  `runtime-template.js`, one file, one convention. (The codegen-side split was the arc's known
  instance.)
- `__scrml_absent` envelope — a fixed token, not name-derived.
- `scopeId` registries (`_scrml_cleanup_`/`_timer_`/`_input_*_`/`_meta_*`) — runtime-generated
  by `_scrml_create_scope`, never derived from source names.
- `_scrml_default_fns` / `_init_fns` / `_derived_*` — keys handed through the accessor.

## Could not rule out

- `emit-lift.js` (2543 lines) — the request-detection region was read, the file was not, end to end.
- The `native-parser` mirrors — out of scope, and FEATURE-stale by standing note, so a divergence
  there is a separate class.
- Whether `encoding.enabled` is reachable from any shipping build path. Traced to
  `codegen/index.ts:819` (`encoding = false` default) with no CLI or `api.js` plumbing found — so
  **#4 and #14 are latent today**. If a minifier, or the in-flight namespacing arc, ever takes
  that seat, #4 becomes live immediately.

## Disposition

Not filed as 14 separate gaps. The class ([[g-split-key-pair-class]]) plus this audit is the
durable record; #1 is filed on its own because it is confirmed live. The correct fix for the
whole table is structural — one exported key-builder per key, called by both sides, per the
`themeVariantAttr` exemplar — not 14 point repairs.
