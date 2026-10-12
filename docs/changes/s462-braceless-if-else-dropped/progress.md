# progress — s462-braceless-if-else-dropped

- [x] brief archived (d3876edeb)
- [x] reproduced (base d3876edeb == origin/main a9aa81eff + brief): library / client / server all drop
      the same-line else. AST: the braceless consequent is ONE bare-expr `a . push ( 1 ) else a . push ( 2 )`;
      acorn keeps `a.push(1)`. else-if chain → middle `if` an unconditional sibling, final else gone;
      `if (a) if (b) x else y` loses `y`; `foo() else bar()` / `x = 1 else 2` / `return 1 else 2`
      compile with the else dropped. Separate-line and `; else` spellings were already correct (S437).
- [x] SPEC read. §50.2.1: `if-stmt-logic ::= 'if' '(' condition-expr ')' block else-clause?`
      (block required; `else-clause` undefined). §49.2.1 `loop-body ::= '{' loop-statement* '}'`.
      §17.6.1: a bare if-statement gets "Standard if-statement semantics". But §49.2.3 / §34
      E-CONDITION-HEAD-UNPARENTHESIZED prose presume braceless bodies compile, impl#1 (#933, #1106)
      and the bootstrap (parse.scrml parseBlockOrStmt) both implement them. Census: 3,225 braceless
      if-bodies in 189 files. → took the LEGAL path (non-rejecting); SPEC grammar gap filed
      (g-spec-if-stmt-grammar-omits-braceless-body-s462) with a ratify recommendation.
- [x] fix + tests (3bfeec600; conformance tweak a1587b487)
- [x] bootstrap probed: keeps the same-line else; rejects `; else` (E-SCOPE-001) and misdiagnoses an
      unclaimed else as E-SCOPE-001 — both filed as gaps.
- [x] corpus differential (scripts/corpus-emit-differential.ts; base = git archive d3876edeb,
      head = git archive a1587b487, roots examples,samples,conformance,stdlib,benchmarks + ext/
      {giti,flogence,gauntlet-r25} copied read-only into both trees; 2920 sources each side, the 3
      new s462 cases mirrored into base). Verdict line reads INCOMPARABLE only because archives have
      no git revision. Results: 0 newly failing · 2 newly passing (the new s462 cases) · 3 code
      changes (all s462 cases) · 216 content diffs = 210 path-only (capture-tree name baked into
      server.js `_scrml_project_root` / chunk headers; equal after normalizing) + 6 real:
      3 conformance handler artifacts (callback-prop-pass-not, nested-server-write-awaited,
      inline-handler-server-call-condition-runtime) now lower a single-line if/else handler through
      the statement path — same control flow, else-if as nested else{if}, `(null)()` as `null()`;
      the 3 floStyle "real" ones are path-only too (chunk hash of a path-bearing header).
      Syntax: 0 failing both sides. ⇒ NO pre-existing corpus site changed behaviour: zero
      previously-miscompiled sites in the measured corpus. Line census agrees: zero same-line
      non-`;` braceless if…else sites outside the new s462 cases (comment/`<code>` text only).
- [x] merged origin/main 2f78ff59b (a2f571def): known-gaps + FACTS conflicts resolved by hunk
      (both entry sets kept), gap counts + FACTS regenerated, master-list.md = origin/main.
- [x] adversarial pass found two more sites of the same drop on base, fixed + pinned (fd8f3b01f):
      `for (…) { if (c) lift x else lift 0 }` ran the else-lift UNCONDITIONALLY; the markup
      value-form `${ if (@c) "yes" else "no" }` rendered "" for false.
- [x] gates (merge head a2f571def unless noted): pre-commit 34886 pass/0 fail/58 skip (and the hook
      on fd8f3b01f) · tracking tiers (after pretest) 5681/0/10 skip · browser-baseline --check
      PASS 48 (two PARSER DISAGREES interleave flakes, re-run) · s34-census --check-new --base
      2f78ff59b PASS · host-global-scan --check PASS · facts / spec-index / bootstrap-conformance /
      severity --check PASS · snippet-gate PASS · corpus-compile-floor PASS · types-gate PASS ·
      delta-lint PASS · conflict-marker-gate PASS.
- [x] merged origin/main 37e50e881 (md phase 1 + Q21) → 682f0725e; FACTS / bootstrap-conformance
      took theirs + regenerated, known-gaps both entry sets kept by hunk + counts regenerated,
      master-list.md = origin/main. stdlib/md/index.scrml: zero braceless same-line if…else
      sites; its library emit is byte-identical with/without this fix.
- [x] FINAL gates on 682f0725e: pre-commit 35103 pass/0 fail/58 skip · tiers 5685/0/10 skip ·
      browser-baseline PASS 48 (first try) · s34-census --check-new --base 37e50e881 PASS ·
      host-global-scan PASS · facts/state/spec-index/bootstrap-conformance/severity --check PASS ·
      snippet-gate PASS · corpus-compile-floor PASS · conflict-marker PASS · types-gate PASS.

## Review round 1 (S239 verdict FIX on 113b123a2)
- [x] merged origin/main 1c1e9eee5 (a3d9e33f8); FACTS + bootstrap-conformance regenerated, master-list = origin/main.
- [x] MUST-FIX regression (if/else handler + template `${@n}`): fixed by option (b) at the root — the
      STRUCTURAL template emitter (expression-parser records quasi source + parsed `${…}` exprs,
      non-enumerable; emit-expr `emitTemplateLitStructured`). Client: templates whose source has `@`;
      server: structural first, scanner fallback. S437 r5 bar executed (regex/comment quotes,
      nested `\${`/`` \` `` escapes, multi-line, nested arrow templates): all equal base.
      Closes carried HIGH g-client-template-interpolation-lowering-needs-a-structural-emitter:
      5 xfail cases XPASS → marks removed; i81 F2 test updated (value attr now binds);
      meta-type-registry-001 now compiles (its E-META-001 was this). (4b14e4fcb)
- [x] handler reroute extended to ANY nested if-with-else (`{ if (@c) if (@d) a else b }`,
      `{ while (…) if (@c) a else b }`); pins split so the bootstrap grades the nested one (PASS).
- [x] value-position `for … else` → own message; for/lift control test narrowed (parse-only);
      for/lift else-body drop filed HIGH (pre-existing; not small: no general for/lift emitter consumes it).
- [x] gaps filed (see known-gaps); `o.else()` NOT reproduced (member `.else` / `?.else` / `.else()` in
      if-arms, handlers and returns all compile and run identically to base).
- [x] corpus differential round 2 (base archive 1c1e9eee5, head archive 4b14e4fcb, 2933 sources each,
      ext giti/flogence/gauntlet-r25): 0 newly failing · 10 newly passing (s462 cases, the 5 ex-xfail
      template cases, gauntlet-s20-meta/meta-type-registry-001) · 218 content diffs = 210 path-only + the
      3 known handler restructures + s437-r5 value-attr (now bound) + floStyle path-only chunk hashes;
      0 syntax delta. Server-template structural switch: byte-identical after path normalization.
      flogence app.scrml W-AUTH-001 appeared/disappeared between captures — not reproducible
      (14 on both sides compiled directly): capture noise under load.

## Review round 2 (S239 verdict FIX on 845d9e41e, S465)
- [x] 2026-10-11T17:40Z brief archived (d27f86d79); worktree on 845d9e41e (non-destructive switch, not reset).
- [x] 2026-10-11T17:50Z F1 [HIGH] reproduced in Chromium (reviewer driver): every if/else / multi-line / `;`-sequence
      handler writing a nested path or index (`@o.a.b`, `@p2.x`, `@xs[0]`, `<each>` row `@rows[0].v`, `onclick=${…}`,
      inside `<program>`, braceless) → `_scrml_deep_set is not defined` per click. Root: `detectRuntimeChunks`
      (emit-client.ts) never walked `attr.value.handlerBlock.stmts`. Fix: `case "markup"` walks every attribute's
      handler statement list exactly like a function body (`walkAttrHandlerBlocks`). Multi-line + `;`-sequence
      handlers (broken on base too) fixed by the same line. Sweep (c11 families: structural ==, match, index set,
      spread, compound, `?.`, `is .V`, delete): all run correctly in Chromium; a ground-truth scan of EVERY reviewer
      probe output (250 cases, c1–c17 + r2) finds 0 `_scrml_*(` calls without a shipped definition on head
      (base: 4). Pinned: unit/s462-handler-runtime-helpers-shipped.test.js (fails 10/18 without the fix) +
      browser/browser-handler-if-else-helpers-s462.browser.test.js (executed, both arms; fails 14/16 without).
- [x] 2026-10-11T18:00Z F2 [MED] SPEC decision: YES. §14.10: "A bare variant reference SHALL be resolved by the
      compiler when the type at the position can be inferred from one of: … a previously-declared cell or local
      with a known type (`@cell = .V` where `@cell: T`) … or any other position where the type is fixed by the
      surrounding declaration." §66.3 rule 5 (S462 amendment, reading (a)): "a QUALIFIED unit variant `E.V`
      (§14.10: legal everywhere) is a **literal** of `E`" — so `<col> = Col.Red` has the known type `Col`, and
      E-VARIANT-AMBIGUOUS was wrong on BOTH paths. Fixed at the shared root (type-system.ts): the hoisted cell
      pre-bind records `variantCtxEnum` for an unannotated qualified-variant (or payload-construction) initializer;
      a bare-variant write uses it as the §14.10 context. `resolvedType` is untouched (asIs) → no other check moves.
      Handler (one-line, braceless, multi-line, `;`-seq) AND function-body forms now compile and run (Chromium:
      Blue/Red). Newly-accepting at exactly the positions that fired E-VARIANT-AMBIGUOUS before. Direction notes
      (deliberate, §14.10-conformant): in an if/else handler a variant the enum lacks is now E-TYPE-063 (base
      emitted the string "Green" silently), and `.V` written into a string-initialised cell is E-VARIANT-AMBIGUOUS
      (§14.10: "SHALL fail … no type context at all") — base never type-checked if/else handler bodies.
- [x] out-of-scope (a) template-initialised cell drops the interpolation: already filed
      (g-interpolated-template-initializer-on-a-state-cell-is-silently-discarded, open; now renders "d " for the cell
      form, "" for const). (b) `?{x}` text → placeholder: already filed (g-sql-placeholder-clobbers-string-literals-s457).
      (f) for/lift body condition no re-render: NEW g-for-lift-item-does-not-rerender-on-body-condition-cell-s465.
- [x] 2026-10-11T19:40Z corpus differential round 3 (base = git archive origin/main 1c1e9eee5, head = git archive
      31bfdca17; roots examples,samples,conformance,stdlib,benchmarks; 2809 / 2816 sources; ext/giti + ext/flogence NOT
      in this container — skipped). Verdict line INCOMPARABLE only because archives carry no git revision.
      0 newly failing · 5 newly passing (the round-1 template cases + meta-type-registry-001) · 170 content diffs =
      165 path-only (equal after normalizing the capture dir name / runtime hash / chunk token) + 5 real = the SAME
      known round-1 restructures (callback-prop-pass-not, nested-server-write-awaited,
      inline-handler-server-call-condition-runtime, s437-r5-template-cell-read-value-attr .client.js + .html).
      ⇒ F1 and F2 change NO corpus artifact and reject NO corpus source (F2's two newly-rejecting edges measured 0).
- [x] gates on 9d61a1fa2: pre-commit suite (see report) · tracking tiers (`compiler/tests/*.test.js` +
      e2e-render-map, after pretest) 2498 pass / 0 fail · s34-census --check-new --base origin/main PASS ·
      host-global-scan PASS · facts (regenerated in 9d61a1fa2) / spec-index / bootstrap-conformance / severity /
      state --check PASS · types-gate PASS (182 diagnostics, unchanged) · snippet-gate PASS · corpus-compile-floor
      PASS · conflict-marker PASS · delta-lint PASS. browser-baseline --check: 1 "new" failure
      (each-alias-in-lifted-markup "a nested <each> under an element in a lifted each row", JSON parse "bad" —
      order-dependent: passes alone and paired with the new test) — IDENTICAL on origin/main 1c1e9eee5 in this
      container, so pre-existing/environmental; baseline NOT re-recorded.

## Review round 3 (S239 re-review of acfc64d3, S465 — owner absent)
- [x] 2026-10-11T20:10Z brief archived verbatim (1acba0714); worktree reset to acfc64d3b (asserted). origin/main = 1c1e9eee5 (unmoved — no merge needed).
- [x] 2026-10-11T20:40Z F1 [HIGH] reproduced in Chromium (puppeteer chrome 146, served out dir, pruned runtime): every `<match>`-arm
      handler shape → `_scrml_deep_set is not defined` on acfc64d3 (13/13 shapes incl. the reviewer repro). Root: emit-client
      `detectRuntimeChunks` `case "match-block"` regex-probed `armsRaw` for `<each`; arm bodies are AST only after emit-match
      `buildMatchArms`. Fix: the case walks `matchBlockArmBodies(node, fileAST)` (new export = the memoized `buildMatchArms`
      bodies — the exact nodes codegen emits; the HTML pass already populated the cache before chunk detection, so calling it
      first changes nothing). Regex probe removed (Rule 7); each-bearing arms now reach `case "each-block"` structurally.
- [x] Sweep of OTHER bodies parsed only at emit time (grep buildAST / nativeParseFile / splitBlocks / runBlockSplitter /
      parseExprToNode in codegen/): engine `(state × message)` arm bodies + engine opener `effect=` — BOTH dangled
      `_scrml_deep_set` (on origin/main too). Fixed: emit-engine lowers both from one parser `parseEngineSynthLogicBody`, and
      `engineDeferredStatementBodies(meta)` hands the chunk walk the same parse (engine-decl case). Probed clean (no helper
      dangles): `!{}` arm handlers (fn / nested / handler), engine `:` shorthand arms, match-statement arms, if=/lift/when;
      the `parseExprToNode` re-parses are expression positions (no statement-level helper). All pinned in the unit guard.
- [x] Chromium result (head): 18/19 PASS; `<match>` nested in a `<match>` arm renders no inner arm on base AND head →
      filed g-match-nested-in-match-arm-inner-arm-never-renders-s465 (MED). `{…}` handler in a markup-value ternary is
      E-CODEGEN-INVALID-LOGIC on base and head → filed g-markup-value-ternary-brace-handler-codegen-invalid-s465 (LOW).
- [x] 2026-10-11T21:10Z F1 committed 8b9120a3b (gate: only the known env-only files failed; conf-MARKUP-001 hook timeout +
      tenant-floor-project-set under load passed on re-run).
- [x] F2 [PA DECISION] round-2 enum-context widening REMOVED: compiler/src/type-system.ts restored to origin/main byte-for-byte
      (`variantCtxEnum` / `qualifiedVariantInitEnum` gone). `prov=pa-ruled:S465` newly-rejecting vs origin/main: a bare variant
      written from an if/else handler into an UNANNOTATED cell (`<col> = Col.Red` / `<col> = "Red"` / `<sh> = Sh.Circle(2)`)
      is now E-VARIANT-AMBIGUOUS, exactly as the function-body form always was; a non-member variant into an ANNOTATED cell
      from a handler is E-TYPE-063 (does not depend on the removed code — same check as the function body). Governing
      §14.10 (SPEC.md:13800): "A bare variant reference SHALL be resolved by the compiler when the type at the position can be
      inferred from one of: … a previously-declared cell or local with a known type (`@cell = .V` where `@cell: T`) …";
      SPEC.md:13802: "A bare variant reference SHALL fail with `E-VARIANT-AMBIGUOUS` when the position's type is a union or
      otherwise ambiguous (e.g., `let x = .Small` with no annotation …)". Corpus measured: 0 (see differential below).
      Annotated `<col>: Col = .Red` compiles and runs in Chromium (one-line / braceless / multi-line / fn body: Blue, Red).
- [x] Corpus differential round 4 (base = git archive origin/main 1c1e9eee5, head = git archive 8b9120a3b + restored
      type-system.ts; roots examples,samples,conformance,stdlib,benchmarks,ext; ext = scrml-support gauntlet-r25 (4 files);
      ext/giti + ext/flogence NOT in this container — skipped). 2813 base / 2820 head sources. Verdict INCOMPARABLE only
      because archives carry no git revision. 0 newly failing · 5 newly passing (round-1 template cases + meta-type-registry-001)
      · 6 diagnostic-code changes, all those same round-1 sources losing an error/warning · 0 sources gain E-VARIANT-AMBIGUOUS
      or E-TYPE-063 · 1 text-only change (s450-attr-multi-statement-pos: same codes, same messages — capture-path noise).
- [x] F2 committed b0927db36. types-gate then caught (e7e3a3db5): the F1 refactor had left the message-arm parse-FAILURE
      fallback referencing a removed `inner` local (TS2304 → compile-time ReferenceError on that path) — fixed via a shared
      `messageArmInnerSource`; and the new `typeof import("./emit-match.ts")` pulled emit-match into the checked program,
      surfacing a pre-existing TS2554 (collectMatchBlocks top-level `walk()` without `eachIterVar`) — now passes `null`
      (every reader tests `typeof === "string"`; behaviour unchanged).
- [x] 2026-10-11T23:30Z FINAL gates on e7e3a3db5: pre-commit 32880 pass / 10 fail / 132 skip — the 10 are the known env-only
      files (dev-db-no-side-file ×5, promote-safety-harness ×1, headless-serve-bind-host ×1 — the SAME 7 fail on origin/main
      in this container; tenant-floor-project-set ×3 under load — passes alone) · tracking tiers (after pretest) 2498/0 ·
      browser-baseline --check: 1 "new" = each-alias-in-lifted-markup nested-each JSON "bad" — IDENTICAL on origin/main in
      this container (re-measured), baseline NOT re-recorded · s34-census --check-new --base origin/main PASS ·
      host-global-scan --check exit 0, 0 violations · facts (regen) / state / spec-index / bootstrap-conformance / severity
      --check PASS · types-gate OK 182 unchanged · snippet-gate 128/0 · corpus-compile-floor PASS · conflict-marker PASS ·
      delta-lint PASS.

## Review round 4 (S239 re-review of cf4b0a6e, S465 — owner absent)
- [x] 2026-10-11 brief archived verbatim (01d30d11c); worktree reset to cf4b0a6e6 (asserted); merged origin/main 41af4153a (docs-only) → 620d91424.
- [x] [HIGH] reproduced in Chromium on cf4b0a6e: the reviewer repro + 36 of 43 lifted shapes (component `${ if … { lift } }`,
      `onclick=${…}`, `${ lift }`, `${ for … { lift } }`; `<match>` arm bare / if-wrapped lift) × (if/else, braceless, multi-line,
      `;`-seq, index set, delete) → `_scrml_deep_set is not defined`. (compound `+=`/`-=` used another lowering and worked on base.)
- [x] ROOT fix per PA direction (no fifth walk case). Registration at the ~1,400 helper-call emit sites across 85 files was judged
      the same "remember it at every site" failure mode, so the authority is the EMITTED TEXT read against an index DERIVED from
      the runtime itself: runtime-chunks.ts `RUNTIME_HELPER_DEFINING_CHUNK` (every column-0 `_scrml_*` declaration of every
      non-stdlib chunk → that chunk; ambiguity refused, pinned empty) + `chunksForEmittedHelpers(text, chunks)` (word-bounded
      references; quoted / member / `typeof`-guarded-on-the-same-line / client-declared names excluded). emit-client
      `gateChunksByEmittedReference` applies it at both existing call sites (emitted lines, then the FINAL body before the late
      re-assembly), so any emitter that writes a helper call ships its chunk — including emitters added later. The pre-emit walk
      and the POST_EMIT table stay (non-`_scrml_` triggers: error classes, `animationFrame`; non-helper chunk choices).
- [x] first cut over-included (`utilities` on 800 runtimes, `ifmount` on 76) via the second use in
      `typeof _scrml_x !== "undefined" && _scrml_x` / `if (typeof _scrml_x === "function") _scrml_x(…)`; refined to treat a use on
      its guard's own line as part of the idiom (pinned).
- [x] Chromium (playwright chromium, file://, pruned runtime): r4 matrix 43/43 correct on head (both arms), 36 dangled on base;
      reviewer rv/ c1–c17 (227 cases, re-run on the refined head): 227/227 identical outcomes head vs base; c5's 15 page
      errors are file:// CORS on server fetches, SAME on base.
- [x] Corpus inertness (base = git archive cf4b0a6e6, head = same + the two codegen files; roots examples,samples,conformance,
      stdlib,benchmarks; 2816 sources / 8481 artifacts each; ext/giti + ext/flogence NOT in this container — skipped): after
      normalizing the capture dir names and runtime hash, 8480 / 8481 byte-identical; the ONE difference is
      stdlib/data/form-for's runtime gaining `messages` — its client calls `_scrml_labels_register(map)` unguarded (a previously
      missing chunk). 0 newly failing / 0 newly passing / 0 diagnostic-code changes / 0 syntax delta. An offline re-run of the
      helper index over every head client.js finds 0 runtime helpers referenced without their chunk.
- [x] NEW gap g-component-lift-dollar-braceless-else-ce-reparse-rejects-s465 (MED, pre-existing on cf4b0a6e): braceless
      `onclick=${ if (c) a else b }` on lifted markup inside a component is E-COMPONENT-021 (native-parser CE re-parse).
- [x] code + tests committed 93b60f7af (pre-commit suite: 32926 pass / 10 fail / 132 skip — the known env-only set:
      dev-db-no-side-file ×5, tenant-floor-project-set ×3 (24/24 alone), promote-safety-harness ×1, headless-serve-bind-host ×1).
- [x] FINAL gates on 93b60f7af + this entry: pre-commit as above · tracking tiers (after pretest) 2498 / 0 · types-gate OK 182
      unchanged · s34-census --check-new --base origin/main PASS · host-global-scan --check exit 0 · facts (regenerated in
      93b60f7af) / state / spec-index / bootstrap-conformance / severity --check PASS · snippet-gate 128/0 · corpus-compile-floor
      PASS · conflict-marker PASS · delta-lint PASS. browser-baseline --check: "PARSER DISAGREES" ×3 (49 vs 48 — the interleave
      flake); a direct tier run diffed against FAILURE-BASELINE.json: 1 new = each-alias-in-lifted-markup nested-each (the same
      order-dependent env failure as r2/r3; 8/8 alone), 0 gone. Baseline NOT re-recorded.
