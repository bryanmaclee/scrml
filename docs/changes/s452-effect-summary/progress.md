# progress — s452-effect-summary (append-only)

- start: base 6538da913; bun install + pretest OK; BRIEF archived.

## M0 — shadow (effects.scrml + summarize + differential)

- MAP (`.claude/maps/primary.map.md`, stamp d3e660a08): read the bootstrap rows; NOT load-bearing — the
  DD's inventory (W1–W11 line ranges) was the operative map; every row re-read in source at 6538da913.
- DD-vs-code corrections (no step became ill-defined):
  1. W5 (clientReach) and W6 (unresolvedReach) do NOT use W3's edge set: they follow only FUNCTION
     references and STOP at a server callee ("judged on its own"); W5 also seals server callers. One
     uniform edge set (DD §"Recursion": "Build the call graph once … including the IMPLICIT edges")
     cannot reproduce their messages. The engine therefore closes each DIMENSION over its own edge
     list (a per-dimension policy over ONE graph, ONE fixpoint, ONE SCC order) — writes/writesOpen:
     every reference; client/routeOpen: function refs, server callees cut; waits: function refs;
     clock: function CALLS; noValue: `return <call>` edges.
  2. W1's clock set follows CALLS only (no function values). The M0 run found the difference (inline
     program in slice-m4/effect.test.js: `const g = ping` — a function value of a clock reader). The
     clock dimension follows calls (§48.6.2 is a rule about calls; a function value is refused in the
     bootstrap). Regression test in effects-shadow.test.js.
  3. The witness each walker reports is a BREADTH-FIRST one (fewest references, then earliest
     reference). The engine's atoms keep the shortest path per key under that order (depth, then
     the reference-index path lexicographically, then the own site) — proven equal by the shadow.
  4. The DD's `Fx` sketch has a `server` own dimension and `returns: Value|NoValue|Diverges`. Built:
     `server` = the own facts (sqls / modifier), not closed; `returns` = a `noValue` dimension (atoms,
     so the chain is available); nothing in the bootstrap produces `Diverges` — not built.
  5. The summary is NOT stored in `Tables` in M0–M3 (Tables is exported to lower; attaching Fx to Core is
     M5). It is a value analyze computes and hands to its passes.
- Built: `compiler/self-host-v2/effects.scrml` (237 L — FxAtom, path order, closeDim, Tarjan sccOrder,
  atomChain); analyze.scrml +502 L (summarize, own-fact helpers ownNoValue/retCallsOf, the shadow
  `effectsShadow`); `slice-m4/effects-shadow.test.js` (the differential over the 9 slice programs and
  every counter case as written + its §66 twin; G7 pinned; the clock-edge regression);
  `slice-m4/diag-diff.js` + the SCRML_BOOT_DIAG_LOG hook in `slice-m1/harness.js` (every `analyze`
  call of every slice test and counter case → one JSON line; also logs the shadow).
- RESULT: shadow test 5/5 (counter inputs: 0 disagreements). Hook run: every slice test + counter,
  2566 distinct analyze inputs, diagnostics IDENTICAL to base (6538da913); shadow disagreements over
  every inline test program: exactly 1 — `typer-s440.test.js` `function w() -> string { return u() }`
  (W9: walker yields, summary no value) = G7's second form, as expected.
- Slices: m1 99/0, m2 462/0, m3 60/0, m4 1105/0, codec 92/0, m1 lowered 99/0; counter PASS 120 /
  FAIL 48 / UNSUPPORTED 622 (= base); severity --check current; counter doc --check current; lint 0.
- Lines: +502 analyze (0 deleted), +237 effects.scrml, +27/-1 harness, test/tool +257.

## M1 — writes as queries (W3)

- Replaced: W3's own fixpoint — `fnSummaries` (the per-pass witness propagation), `propagated`,
  `gainedWitness`, `summaryOf`, `directWitness`, `directUWitness`, the `FnSummary` type, and
  effectPass's lazy `needSums` build — by two queries over the summary: `writeWitness(sum, i)` /
  `openWitness(sum, i)` (the first atom of `writes` / `writesOpen`, its chain rebuilt from the
  back-pointers). `refDiags` / `valueRefDiags` / `valueDiags` / `effectPass` read the summary;
  the "no write summary" fail-closed branch is now "no callable in the summary" (nodeIdx < 0).
  `scan*` / `constructionScan` / `scanValue` stay — they ARE the direct-fact extractor.
  analyze() computes the summary once, after the scope pass, before effectPass.
- Shadow: W3 comparisons deleted (the walker is gone).
- Differential: 2566 inputs, diagnostics IDENTICAL to base; shadow lines = the 1 G7 line (as M0).
- Slices all green (m1 99, m2 462, m3 60, m4 1105, codec 92, m1 lowered 99); counter PASS 120 /
  FAIL 48 / UNSUPPORTED 622 (= base); lint 0.
- Lines (analyze.scrml): +40 / −156.

## M2 — placement as queries (W4–W7)

- Replaced: W5 `clientReach`, W6 `unresolvedReach`, W7 `asyncReach` (three hand-rolled
  `pass < n + 2` fixpoints), `directClient`, `reachOf`, the `ReachOf` type, and placePass's own
  placement computation (direct + the Ambient→Client upgrade) and its SECOND body scan (W4's
  `fnFacts` call per function) — by the summary's one placement (`sum.places`) and three queries:
  `clientReachOf` / `routeOpenOf` / `waitsOf` (the witnesses of `client` / `routeOpen` / `waits`).
  `fnFacts` is now called once per function, by `summarize` (the extractor).
- Shadow: W4–W7 comparisons deleted.
- Differential: 2566 inputs, diagnostics IDENTICAL to base; shadow = the 1 G7 line.
- Slices all green (same counts as M1); counter PASS 120 / FAIL 48 / UNSUPPORTED 622; lint 0.
- Lines (analyze.scrml): +47 / −196.
- Not done (DD Cost "8 → 1 body walks"): `sqlsInBlock` / `readsInBlock` / `domsInBlock` are still
  separate own-fact walkers beside `scanBlock`; merging them into the one scan is not required by
  the DD's M2 text ("W4-W7 become queries over one placement; delete three fixpoints and the second
  scanBlock") and is left for a later step.

## M3 — the binder's decisions move to a post-summary rules pass; W8 / W9 / W1 deleted; G7 closed

- Mechanism: phaseB runs before any summary exists, so the binder RECORDS each summary-dependent
  decision (`AS.pend`, `addPending`) with the diagnostic(s) it would report and `at` = the
  diagnostic list's length at that moment; `rulesPass(sum, st)` (right after `summarize`, before
  placePass) decides each by a query and splices its diagnostic back at `at`. The diagnostics keep
  the binder's order exactly (proven: every base input IDENTICAL). A rolled-back `st` (a binder
  helper that returns an older state) drops its pendings with its diagnostics — same as before.
  Rules: `IfNoValue` (E-ERROR-012), `ServerOrDead` (U1b refusal vs E-ERROR-013), `IfClock` (the
  clock refusal in an initializer / markup / attribute), `PureCall` (E-FN-003's clock clause).
- Deleted: W8 `mayRunOnServer` (→ `serverTriggeredFn` = the summary's own `server` fact, the same
  predicate placement uses); W9 `fnYieldsValue` + `callYieldsNothing` (→ `yieldsNoValue` = the
  `noValue` dimension; the syntactic helpers blockYieldsOnAllPaths / blockHasBareReturn /
  declaresVoid stay as the own-fact extractor `ownNoValue`); W1 `clockFns` + `calledNames` +
  `anyIn` + `FnCalls` + `Globals.clock` (→ `readsClock` = the `clock` dimension; `blockClock` and
  its helpers stay as the own-fact extractor). The M0 shadow (`effectsShadow`) and
  effects-shadow.test.js are deleted — no walker is left to compare.
- G7 CLOSED: `noValue` is transitive through `return <call>` (retCallsOf → edges). Tests
  (slice-m4/effects-summary.test.js): the DD probe `function g() { return nothing() }` +
  `load("x") !{ _ :> g() }` → E-ERROR-012; the declared form `function g() -> string { return
  nothing() }` → E-ERROR-012; two wrappers deep; through recursion; negative twins clean. Verified
  the three G7 tests FAIL on the M2 analyze.scrml and pass on M3. Fail direction: an unknown callee
  now yields NO value (fail closed; the walker failed open — DD G10).
- Newly-firing E-ERROR-012 from G7 over the existing corpus: NONE (no slice program, slice-test
  inline program or counter case exercises it; the typer-s440 `w() -> string { return u() }` has
  no arm calling `w`).
- Differential: all 2566 base inputs IDENTICAL; the only differences are 10 inputs analyzed AFTER
  only = the new test file's programs. Counter: 1301 cases, zero bucket moves, PASS 120 / FAIL 48 /
  UNSUPPORTED 622. Slices: m1 99, m2 462, m3 60, m4 1112 (+12 new − 5 retired shadow), codec 92,
  m1 lowered 99 — all 0 fail. severity --check current; lint 0.
- Lines: analyze.scrml +150 / −163 (incl. −85 of M0 shadow; walkers deleted: W1 ≈ 45, W8 8,
  W9 ≈ 40 incl. comments; added: rulesPass + pendings ≈ 95, call-site recorders ≈ 30);
  effects-shadow.test.js −159; effects-summary.test.js +190.
- Known reading (not a change on the corpus): three binder sites compare `diags.length` before and
  after resolving an expression (resolveEffectDep 6724, `<errors of=>` 7202, star attrs 7344). A
  deferred diagnostic is not counted there. Only the `<errors of=@x[f()]>` shape (a call inside an
  index of the `of=` place, of a clock reader) could see it: it would now also run the validity
  checks after the clock refusal (an added refusal, never a silence).
