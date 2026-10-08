# progress — s457-host-global-alias

Append-only. Times local (2026-10-07/08).

## startup
- worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ade1ea0d759a13c9d`, base `0c1a1b081` = origin/main (includes #1345).
- bun install + pretest OK; brief committed as first WIP commit (dd3113008).

## reproduction (base 0c1a1b081)
- client: user `function fetch` + any server fn -> `_scrml_fetch_with_csrf_retry` calls `_scrml_fetch_6(path, {...})`
  (the user's function); user `function document` -> click dispatcher `while (t && t !== _scrml_document_7)`,
  `_scrml_nav_rewire(_scrml_document_7)`, `(_scrml_root || _scrml_document_7).querySelector`.
- client, second path (not via the rename): a user top-level `const location = "here"` is emitted as
  `const location = "here";` in the chunk IIFE, so EVERY compiler reference to `location` in that chunk
  (member positions included) reads the user's value.
- server: a server function called by another server function gets an in-process peer callable
  `async function <name>` at MODULE scope -> `server function Response` shadows `Response` for the whole
  bundle (`new Response(...)` on every route). `server function globalThis` is accepted today.

## design
- ONE alias: `const _scrml_g = globalThis;` — compiler references are spelled `_scrml_g.<name>`
  (late-bound property read on the captured global object, so a later polyfill / instrumentation /
  test mock of e.g. `fetch` is still seen exactly as a bare reference sees it; per-name capture at
  load would silently bypass them — semantics change). `_scrml_g` is in the reserved `_scrml_`
  namespace (§47.1.1), so no user binding can declare or reference it.
- Defined: client — top of the runtime core chunk (always included; the runtime is its own classic
  script / ESM module / embedded outside the chunk IIFE, so no user binding reaches it);
  server / library / tool / worker artifacts — a prologue line in each module that uses it.
- The runtime's own text is NOT rewritten: it is outside every scope a user binding is emitted into
  (separate script; embedded runtime sits outside the chunk IIFE; the rename pass fences it).
- Base corpus capture: .tmp/cap-base (2425 sources, 7084 artifacts, 0 syntax-failing).

## implementation (22:00-22:30)
- runtime-template.js: `const _scrml_g = globalThis;` is the first runtime binding (core chunk, always shipped).
- NEW codegen/host-global-alias.ts: HOST_GLOBAL_ALIAS, HOST_GLOBAL_NAMES, HOST_GLOBAL_ALIAS_DECL,
  withHostGlobalAlias (prologue for server / library / tool / worker artifacts),
  aliasHostGlobalsInRuntimeText (runtime text inlined into a user-reachable artifact).
- fn-name-rename.ts: the scope walk factored into rewriteFreeRefs(code, policy); the rename is one
  policy, NEW aliasFreeGlobalRefs is the other (same reader, so the two cannot disagree on "free").
- Emitter string literals rewritten by a TS-AST codemod (.tmp/codemod.ts, not shipped): every host
  global inside an emitted-JS literal in compiler/src/codegen -> `_scrml_g.<name>`; skipped:
  matchers (includes/replace/test/...), JSON.stringify'd data, diagnostics (CGError/Error/throw),
  name lists, type positions, method definitions, declarations, member names, nested strings and
  comments of the emitted code. Excluded files: runtime-chunks.ts (markers), runtime-esm.ts (runtime),
  emit-machine-property-tests.ts (generated bun tests), emit-html chunk-activation file (own script).
  Hand fixes: emitted nested templates (`\${location.host}`, `\${JSON.stringify(...)}`, sqlite
  `String(e)`), the matchers that read emitted text (emit-server `return new Response(` mediation
  mark; emit-event-wiring anchor re-scope + the `document` scope literal; emit-reactive-wiring
  lift-wrapper hoist regex).
- Server copies of runtime text aliased: SERVER_URL_SHAPE_HELPER, SSR_URL_GUARD_HELPER,
  SERVER_VALUE_NATIVE_MAP_HELPER, SERVER_STRUCTURAL_EQ_SOURCE.
- E-CG-016: `globalThis` joins the reserved server bindings (`routes`, `fetch`) — the alias reads it.
- NEW test compiler/tests/unit/s457-host-global-alias.test.js — 437 pass after the server-copy fix.
- Pre-existing, NOT changed: `server function eval` / top-level `const eval` are refused only by the
  emitted-artifact gate (E-CODEGEN-INVALID-LOGIC "compiler defect", strict-mode binding) — base too.

## test triage (22:40-01:00)
- First full gate after the codemod: 459 fail / 7 errors. Classes: (a) emitted-shape pins
  (spelling), (b) no-runtime harnesses that evaluate emitted code (needed a `_scrml_g`
  stand-in), (c) harnesses that stubbed host globals by SHADOWING them (`new Function("fetch", …)`)
  -> now a view of the global object (NEW compiler/tests/helpers/host-view.js), (d) real
  compiler follow-ups the tests caught: serve-target tool TDZ (embedded server bundle's alias
  line after the bind helper -> strip + re-declare once), protect-flow's egress analysis on
  `_scrml_g.Promise.resolve` (E-PROTECT-006 false positive on mounthydrate-redacts -> protect-flow
  de-aliases), conformance adapter's `new WebSocket` / `new EventSource` detection, the
  serve-target bind helpers (listen.js toString -> aliased), `new EventSource` missed by the
  codemod (not in the probe's global list).
- (a) fixed by a failure-driven fixer (.tmp/tfix.ts: rewrite a failing pin only when the
  RECEIVED text contains the aliased spelling); (b)-(c) by hand per harness.
- Vacuous negatives: `not.toContain("new Response")` etc. would now pass for the wrong reason;
  swept (tcodemod dry-run over every test + a negative-assertion filter) and re-pinned 27 sites.
- Runtime size: the client runtime gzip gates are knife-edge (SPA counter < 16384 B). The
  explanatory comment moved out of the shipped runtime text into runtime-template.js source;
  the shipped cost is the one line `const _scrml_g = globalThis;`.
- Gate at this point: 30426 pass / 0 fail / 0 errors (unit+integration+conformance).

## verification after 4d4710091 (2026-10-08)
- Chromium (puppeteer, `scrml dev`): program with user `function fetch`, `function document`,
  top-level `const location`, server peers `Response` / `JSON`. HEAD: count 7, server call 11,
  location "user-location", no page errors (a favicon 404 only). BASE 0c1a1b081: count "", srv "",
  `TypeError: (_scrml_root || _scrml_document_14).querySelector is not a function`,
  `_scrml_resp.json is not a function` (the server call ran the user's `fetch`).
- Corpus differential (2425 sources, 7084 artifacts each side): 4320 byte-identical, 2764 identical
  once the alias spelling is undone, 0 other, 0 compile-status changes (1450 compiled both sides).
- Free host-global references left in emitted artifacts (runtime + `_scrml/` shim modules excluded):
  only author-written ones (entry + imported module sources), `undefined`, the alias line's own
  `globalThis`, and the foreign-seal helper's `typeof require` (module context, not a global).
- Root-level tests 2239/0, e2e-render-map 259/0, self-host-v2 slices m1/m2/m3/m4/codec + lowered m1
  green after re-pinning two slice-codec emitted-shape reads.

## follow-ups found by the wider tiers (2026-10-08)
- Runtime alias is `var _scrml_g` (was `const`): chunk scripts read it ACROSS script boundaries,
  like `var _scrml_modules`; a global-eval loader (browser-multifile-import's faithful separate-
  script model) does not share a top-level `const` between evals.
- `scrml fix` client-server-call / sql-failable read impl#1's Promise.all batches from emitted
  client JS: `promiseAllBatches` now recognises `_scrml_g.Promise.all` (without it the fix would
  have REWRITTEN batched calls it must only list — commands test caught it).
- Conformance adapter: the SSR host view forwards writes to the real global (the adapter seeds
  `globalThis.__scrml_session_store` for the authenticated viewer); `bun conformance/run.ts`
  1346 pass + 50 xfail of 1396 (= base).
- SPA-counter runtime gzip: base 16375 B vs the <16384 gate (9 B margin, pre-existing knife edge).
  The alias line costs ~10 B; one shipped provenance tag shortened in the core chunk comment ->
  16382 B. Margin 2 B.
- Browser tier name-set gate PASS (48 asserted); self-host-v2 slices green; root-level 2239/0;
  e2e-render-map 259/0; lsp+commands 718/0; bootstrap-conformance current; compile-floor PASS;
  snippet-gate 122/0; types-gate unchanged; SPEC-INDEX OK.
