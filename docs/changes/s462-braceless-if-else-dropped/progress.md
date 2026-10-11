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
