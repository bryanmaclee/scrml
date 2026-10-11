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
