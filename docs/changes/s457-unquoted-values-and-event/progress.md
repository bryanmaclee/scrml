# progress — s457-unquoted-values-and-event

Append-only. Times local (2026-10-07/08).

## startup
- worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1d9d34bac78c568c`, base `0c1a1b081` = origin/main (#1345 merged).
- bun install + pretest OK (samples/compilation-tests/dist populated). Brief archived as first commit 48ae2d61a.
- Frozen base copy for differentials: `.tmp/base` (git archive HEAD); corpus capture via `scripts/corpus-emit-differential.ts`.

## repro on base (0c1a1b081)
- `onclick=@count = @count + 1` -> `_scrml_cs_reactive_set("count", _scrml_cs_reactive_get("count"))`, exit 0 (the `+ 1` dropped).
- `if=fn(1).ok` -> E-CODEGEN-INVALID-LOGIC (`if ((function(1)))`) — loud, but the condition is lost.
- `title=fmt(1).trim()` -> `title=fmt(1)` wired as a "title" EVENT LISTENER + a stray `trim` attribute, exit 0.
- `onclick=fn(1) .then(g)` -> handler `fn(1)` + stray `then g` attributes, exit 0.
- `onclick=@big = @n > 1` -> handler `big = n`, ` 1>` leaks into the body text, exit 0.
- `title=@msg + "x"` -> `<p title="msg" x>`, exit 0.
- `oninput=f(event.target.value)` / `onclick={ f(event.type) }` / `onclick=${ f(event.type) }` -> all wrapped `function(event) { … event … }`.
- call-ref ARGS are never scope-checked (`onclick=f(nope)` compiles clean) — pre-existing, noted.
- #1345 did NOT rename the handler wrapper parameter (`function(event)` at every site).

## implementation (WIP, uncommitted until the gate is green)
- tokenizer.ts: ONE unquoted-value reader (head -> postfix chain -> continuation/refusal) replacing the
  separate `!`, `(…)`, `[…]`, ident/call/not/assignment/condition-reject branches; #1345's
  readBareValueTail folded in (its postfix predicate kept). New refusal reasons on ATTR_OP_REJECT:
  operator (non-handler), stray (text that cannot begin an attribute), gt (handler expression before
  a spaced `>`). `derived=` (§51.0.J) left exactly as before.
- ast-builder.js: ATTR_OP_REJECT messages per reason/attr class; `;` after a non-handler bare value ->
  E-ATTR-MULTI-STATEMENT (§5.2.4 listed it as not-yet-detected); E-ATTR-UNQUOTED-OPERATOR added to
  SUBPARSE_FORWARDED_CODES (else an <each>/engine/match refusal would silently drop the attribute).
  Arrow-handler prelude `const p = event` -> `const p = _scrml_event` (also for p === "event").
- validators/reserved-prefix.ts: the prelude's INIT exempt (compiler text), binder still checked.
- type-system.ts: E-EVENT-UNBOUND (findUnboundHandlerEventRef + checkHandlerEventBinding); the two
  handler-scope `event` binds removed.
- codegen: wrapper parameter `event` -> `_scrml_event` in emit-event-wiring / emit-variant-guard /
  emit-lift / emit-each (33 lines; dispatcher + worker/message listeners untouched — no user text).
- component-expander.ts: the S440 N4 `event`-prop shadowing removed (a prop `event` is now substituted).
- DECISION (implementation reading, flagged): the non-function `${…}` handler value is included in
  E-EVENT-UNBOUND (same compiler-written listener; §5.2.1 already says the event needs `${(e) => …}`).
- DECISION: an operator after a NON-handler unquoted value is REFUSED (cluster-A widened), not read
  whole (§5.1's three forms); spaced `>` refused only after a handler EXPRESSION (`serve=7878 >` is fine).

## corpus measurement (by compile: scripts/corpus-emit-differential.ts, 2425 sources, base 0c1a1b081 vs head-wip1)
- E-EVENT-UNBOUND: 24 files / 35 sites — samples 6 files / 18 sites + examples/23-trucking-dispatch
  components 2 files / 4 sites (both already fail standalone with E-CODEGEN-INVALID-LOGIC, so the compile
  diff did not show them; found by grep) = 22 adopter-corpus sites (matches the brief's 22) + 18 conformance
  cases (the s441 E-EVENT-CONTROL-AFTER-AWAIT vehicles, all `${ …; event… }` statement lists).
- E-ATTR-UNQUOTED-OPERATOR new in 2 already-failing files: nested-comments.scrml (`class:active=@x == y`
  inside a component body — was silently truncated), multi-stmt-handler-in-each-row-pos (cascade on the
  E-MULTI tail — FIXED: the tail after a handler `;` is no longer re-refused).
- ok->fail: 5 (2 conformance pos cases + 3 samples), all E-EVENT-UNBOUND, all migrated.
- Lift markup: TS never visited lifted handlers -> E-EVENT-UNBOUND added for lift-expr (structured +
  string-fallback `{ … }` value).
- migration: 22 adopter sites -> `${(e) => …}` (brief recipe); 18 conformance cases -> `${(event) => { … }}`
  (keeps each case's body byte-identical; description note appended).

## gates before commit 1
- unit+integration+conformance: 30029 pass / 1 fail (semdiff fixture used Angular `(click)={…}` junk —
  now refused; fixture fixed to `onclick={…}`) -> 0 fail after the fix.
- conformance/run.ts: 1354/1404 pass + 50 xfail (8 new s457 cases pass, 4 with runtime).
- types:check OK; SPEC-INDEX + FACTS regenerated (scripts).

## commit 1 landed — c2fd93e6a (pre-commit hook: 32277 pass / 0 fail)

## round 2 — `>=` (adversarial self-review)
- found: `onclick=@big = @n>=2` still dropped `>=2` (the reader stopped at `>`; the block splitter had kept
  `>=` in the value — issue #28). A first fix read every `>=` on and broke `<button onclick=calculate()>=</>`
  (a button LABELLED `=`; the tokenizer sees the whole element text) — caught by the corpus differential
  (2 calculator samples OK->FAIL). Final: `splitterKeepsGtEq` mirrors block-splitter `inUnquotedValue`, so the
  tokenizer reads `>=` on exactly where the splitter kept it, and a spaced `>=` the splitter closed the tag at
  is the `gt` refusal. Both calculators compile again.

## commit 2 landed — b55385ed0 (hook: 32283 pass / 0 fail)

## round 3 (resumed after an API network outage; uncommitted edits reviewed and kept)
- final corpus differential (base 0c1a1b081 vs b55385ed0, 2433 sources): ok->fail 0, fail->ok 0, syntax-failing 0;
  of 1450 sources compiling on both sides, 1442 byte-identical after mapping `_scrml_event`->`event`
  (+ the base compiler-root path); the 8 that differ = 7 migrated sources + s450-attr-multi-statement-neg
  (`title=(() => {…})()` — the IIFE call after the paren group was DROPPED on base, the title got the
  function; now invoked: semantics-changed, a fix). load-new/load-detail: the migration also fixed a
  pre-existing unsubstituted prop (`onAddressInput(event)` -> `_scrml_setOriginAddress_34(e)`).
- E-EVENT-UNBOUND scope: lift markup (structured + string fallback) added; file-level `for (event of …)` /
  `<each as event>` binders suppress it.
- SPEC illustrations moved to the function form: §5.2.1 call-ref text, §5.4 bind: expansion table +
  desugar sentence + worked example, §13.2 E-EVENT-CONTROL-AFTER-AWAIT example.
- also migrated: samples/gauntlet-r11-zig-buildconfig.scrml (2 sites; already fails for unrelated reasons),
  docs/website/pages/articles/realtime-and-workers.scrml snippet (`onmousemove=moveCursor(event.clientX, …)`).
- browser tier: 46 new failures were `function(event)` pins + sources using `event`; pins updated, sources
  migrated (s450 / s454 / match-in-each) -> `browser-baseline.ts --check` PASS (48 asserted).
- ci.yml gate steps run: types, pretest, root-level parser/native, e2e-render-map, no-default-arm lint,
  self-host-v2 slices m1/m2/m1-lowered/m3/m4/codec, v2 lexer, todomvc compile + node --check, snippet gate,
  compile floor — all exit 0. SPEC-INDEX / FACTS / bootstrap-conformance regenerated by script.

## commit 3 landed — 3b5f5e08f. S458 differential review: DO-NOT-LAND (F1-F6)

## fix round (S458)
- F1/F2 ONE reader: the reader moved to NEW compiler/src/unquoted-attr-value.ts (readUnquotedAttrValue +
  unquotedRejectDiagnostic, pure, string offsets only). Callers: tokenizer.ts tokenizeAttributes (TAB);
  native-parser/tag-frame.js tokenizeAttributeRegion (component bodies, <match> arms, engine bodies, meta
  emit — its own pre-s457 copy of `!`/`(`/`[`/ident-call/bare-assign readers deleted; `raw` runs to the
  opener's `>`); ast-builder `_parseLiftAttrValueShared` (lifted markup, read from the logic block's raw
  text; falls back to the token reader only when the block's offsets do not index its raw text — e.g. an
  auto-lifted markup-RHS decl — residual reported). Refusal diagnostics: tag-frame → ctx.diagnostics
  (skipped for aborted/malformed phantom openers); meta-eval reports them under their own code.
- F3/F4: E-EVENT-UNBOUND moved OFF the source AST onto the emitted listener: NEW
  codegen/listener-event-check.ts (Acorn + js-async-analysis resolveScopes); a free `event` inside a
  function whose first param is `_scrml_event`; span from a listener-text → attribute registry the two
  colouring entry points fill. type-system.ts reverted to base except the two `event` binds removed.
  A user top-level `function event` stands the check down (pre-rename text; the rename resolves it).
- F5: stray/operator refusals on literal text (`href=https://…`, `width=100%`) suggest the quoted form;
  the shown value is cut at the next `name=` (no swallowed attributes in the fix text).
- F6: component-expander reports E-ATTR-UNQUOTED-OPERATOR / E-ATTR-MULTI-STATEMENT from a body re-parse
  as themselves (not E-COMPONENT-021 → 020/035 cascade); parseAttributes marks a refused value
  `absent+_refused` so E-ATTR-013 does not fire on it. nested-comments.scrml then reaches the
  PRE-EXISTING recursive-component stack overflow (base crashes identically).
- newly-rejecting by folding the lift reader in: unquoted operator CONDITIONS in lifted markup
  (`lift <li if=@a != b>`), which cluster-A always forbade but the lift reader accepted. Corpus (by
  compile, head compiler on base corpus): benchmarks/todomvc/app.scrml (2 sites) — migrated to `if=(…)`;
  tests: select-row fixture, todomvc §B.3 fixture, g-lift-per-item-if browser test (3) — migrated.

## commit 4 landed — 158dc1a27 (hook: 32305 pass / 0 fail)

## final measurement (three captures, 2425/2433 sources)
- A = base compiler + base corpus (0c1a1b081); B = 158dc1a27 compiler + migrated corpus;
  C = 158dc1a27 compiler + BASE corpus.
- A vs B: ok->fail 0, fail->ok 0, NO diagnostic-code change in any source; syntax-failing 0 both.
  Artifacts: 1450 compiled on both sides, 1442 byte-identical after mapping `_scrml_event`->`event`;
  the 8 that differ = 7 migrated sources + s450-attr-multi-statement-neg (IIFE call now kept — a fix).
  benchmarks/todomvc compiles byte-identical with `if=(…)`.
- A vs C (the expected-migration set): E-EVENT-UNBOUND in 26 sources (18 conformance cases, 6 samples,
  2 trucking-dispatch pages via the 2 component files) + E-ATTR-UNQUOTED-OPERATOR in
  benchmarks/todomvc (2) = EXACTLY the migrated set. Migrated beyond it (invisible to the compile because
  the file already fails for other reasons / is outside the roots): samples/gauntlet-r11-zig-buildconfig
  (2 sites), docs/website/pages/articles/realtime-and-workers.scrml (1 snippet).
- gates: unit+integration+conformance 30066/0; conformance/run.ts 1354/1404 + 50 xfail; root-level
  parser/native 2239/0; e2e-render-map 259/0; self-host-v2 slices 2016/0 + lowered 99/0; browser-baseline
  --check PASS (48); todomvc compile + node --check OK; snippet gate, compile floor, no-default-arm lint,
  types gate, FACTS / SPEC-INDEX / bootstrap-conformance current.

## S458 re-review of c243a4741 = LAND-WITH-NITS — round 3
- merged origin/main (#1351-#1354) at 591b594f4: SPEC §34 conflict = two adjacent rows (main's
  E-ATTR-INTERP-EXECUTABLE + this branch's E-ATTR-UNQUOTED-OPERATOR) combined; derived docs regenerated.
- (c) fn-name-rename.ts `ref()`: a free reference to a user function is renamed in EVERY position (member
  root, bare value) — except host-global names (`name in globalThis` or a browser-global list), which keep
  the legacy call positions (the sibling host-alias arc). E-EVENT-UNBOUND moved AFTER the rename
  (emit-client `runEventUnboundCheck`, both branches), no stand-down; registry lookups un-rename the text.
- F7 component-expander `spacedGtHandlerRefusals`: the spaced-`>` refusal judged on the body text BEFORE
  normalizeTokenizedRaw (which strips the space) with the same shared reader.
- (d) parseExprWithMarkupValues: the markup VALUE's verbatim text is recovered from the enclosing block's
  raw (`_alignToSourceText` — the expression is often the TOKEN-JOINED rendering `onclick = f ( x )`, whose
  whitespace is synthetic), its refusals FORWARDED (were discarded). The lift reader's silent fallback is
  gone: text rebuilt from token offsets, else refused. (First attempt used the token-joined text →
  6620×2 bogus refusals + a 165 s compile of gauntlet-r10-odin-filebrowser, caught by the hook's
  expr-parity timeout; alignment fixes both: 2 s, clean.)
- listeners: channel onclient:open/close/error bind the call's parameter name (§38.10.1) else
  `_scrml_event`; worker `when message` (bundle + parent) / `when error` take `_scrml_event`; all record
  their source attribute; the worker bundle is checked too. Other emitters: bind: listeners (compiler
  text only), SSE onmessage/named events (compiler callback only), engine timers / poll / request
  callbacks (no event object; a free `event` there is an ordinary free reference — `event` is in the TS
  global allowlist: follow-up gap), dispatcher (compiler only).
- <each>/lift: a function VALUE invoked by the row wrapper `(fn)(_scrml_event)` is the author's listener —
  judged as at top level.
- E-ATTR-010 names a computed index (`@drafts[@cid]`); synthetic re-parse spans named in the
  E-EVENT-UNBOUND message (component / match arm / emit); duplicate listener reports deduped.

## round 3 landed — c25422240 (hook 32597 / 0)
- corpus vs main c4eb2c589 (A = main compiler+corpus, B = c25422240 + migrated corpus, C = c25422240
  compiler on main corpus; 2468/2476 sources): A→B no compile-outcome or diagnostic change in any source,
  syntax-failing 0. Artifacts: 1466 compiled on both, 1456 identical after mapping `_scrml_event`; the 10
  that differ = 7 migrated sources + s450-attr-multi-statement-neg (IIFE call kept, a fix) +
  examples/13-worker (when message/error listener `_scrml_event`) + channel-basic-001 (`onopen =
  (_scrml_event) =>`). A→C = exactly the migrated set (26 E-EVENT-UNBOUND sources + todomvc 2).
- gates: unit+integration+conformance (hook) 32597/0; conformance/run.ts 1381/1431 + 50 xfail; root-level +
  e2e-render-map 2498/0; self-host slices 2016/0; browser-baseline PASS (48); todomvc compile + node
  --check; snippet gate; compile floor; types gate; FACTS / SPEC-INDEX / bootstrap-conformance current.

## S458 round-3 finish — see docs/changes/s458-uq-determinism/progress.md
- determinism fix (fixed host-global list, NodeFilter added, parent/top/frames restored), onclient:error `error` covered, hook-specific E-EVENT-UNBOUND messages; onclient:* arity/collision diagnostic REPORTED (no SPEC code fits).
- follow-up: once the host-global alias branch lands (compiler refs become `_scrml_g.<name>`), drop the host-global exception in fn-name-rename.ts `ref()` so every reference to a user binding is renamed.
