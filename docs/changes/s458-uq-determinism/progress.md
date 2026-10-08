# s458-uq-determinism — progress

Finishes the s457-unquoted-values-and-event branch (round-3 review = LAND-WITH-NITS, one required fix).
Base c89ffb56a + the previous agent's uncommitted `fn-name-rename.ts` (file copy).

## 1. determinism fix — host-global set is a fixed list (ecc84252d)
- `isHostGlobalName` probed `name in globalThis` → the client rename depended on the process running the
  compiler. Reproduced on c89ffb56a: same source, plain Bun → `_scrml_open_3.name + process.name + …`;
  happy-dom globals registered → `open.name + …` (and `process` / `postMessage` / `reportError` left
  un-renamed in BOTH: dangling references to user functions the bundle renamed).
- Now `ECMASCRIPT_GLOBALS` + `WEB_GLOBALS` → `HOST_GLOBAL_NAMES`. Review vs the previous `BROWSER_GLOBALS`:
  `parent` / `top` / `frames` restored (no reason to drop them). Superset check of compiler-emitted free
  host names: (a) corpus sweep — every FREE identifier in the client output of 2688 sources (Acorn +
  resolveProgramReferences): no name that was a host global before is missing from the list; (b) grep of
  every identifier in codegen emitter string text ∩ (happy-dom window names ∪ Bun globalThis):
  `NodeFilter` (emit-each `NodeFilter.SHOW_COMMENT`, a member root in client text) was missing → added;
  `PopStateEvent` added (web constructor seen free in output). The rest of the hits are prose in
  diagnostics or server/tool-only text (`process`, `Bun`, `Buffer`, `ReadableStream` in emit-server /
  emit-tool / log-loc / tenant-egress — the rename runs on the client buffer only).
- Direction of change (plain-Bun compile): a user function named like a Bun/Node-only global
  (`process`, `Bun`, `Buffer`, `postMessage`, `reportError`, `onmessage`, …) or an Object.prototype
  member (`toString`, `constructor`, …) is now renamed as a member root / bare value (was left as written
  → dangling). Corpus: 0 sources affected (see §5).
- Test: `compiler/tests/unit/fn-name-rename-determinism.test.js` — in-process without DOM globals, with
  happy-dom globals, and the CLI in a fresh Bun process → byte-identical client.js, every user fn renamed.
  Fails on c89ffb56a's list.

## 3. nits
- (b) `onclient:error=setV(error.type)` → E-EVENT-UNBOUND for the free `error` (§38.10.1 names that
  listener's event `error`). `findUnboundEventListeners(code, injectedNames)`; the registry's attrName
  picks the names. SPEC §34 E-EVENT-UNBOUND row notes it.
- (c) `when message` / `when error` (parent + worker bundle) messages describe the hook (§4.12.4, §46).
  onclient:* messages now give the §38.10.1 call form (`onclient:open=handle(e)`), not a `${(e) => …}`
  value the channel attribute does not accept (found while doing (c)).
- (a) NOT FIXED — REPORTED: `onclient:open=onOpen(x, 1)` silently shadows a declared `x`. SPEC has no code
  that fits: E-CHANNEL-005 is "`onserver:message` call expression contains more than one parameter"
  (onserver:message only); nothing covers onclient:* arity or a parameter-name collision. Needs a ruling:
  extend E-CHANNEL-005 to onclient:* (>1 argument) and decide whether a collision with a declaration in
  scope is an error (new code) or allowed shadowing.

## 4. follow-up (do NOT do here)
- Once the host-global alias branch lands (compiler references become `_scrml_g.<name>`), the host-global
  exception in `fn-name-rename.ts` `ref()` can go, so every reference to a user binding is renamed in every
  position, and `HOST_GLOBAL_NAMES` can be deleted.
