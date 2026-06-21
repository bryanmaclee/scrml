# phase-b2-samples-curate — progress

Change-id: `phase-b2-samples-curate` (sPA ss11 item 8).
Curating `samples/compilation-tests/` per §D.2: still-compiles / EDIT / DROP / REWRITE.
DROPS = dry-run list only. NOTHING deleted in this dispatch.

## Log (append-only)

- 2026-06-20 START — F4 verified: worktree `agent-a80ecec137a2fb890`, base `0a605d3e`, tree clean. `bun install` + `bun run pretest` OK.
- Live `find` count: **805** `.scrml` files (excl. dist). SCOPE-MAP's 277 is stale (2026-05-05) — trusting live count per brief.
- CLI partition determined: exit 0 = PASS (still-compiles), exit 1 = at least one fatal `error [E-...]`. Warnings/lints/info (incl. `warning [E-DG-002]`) are NON-fatal (exit 0). This matches the diagnostic-stream partition rule (CLI exit 1 ⇔ fatal errors).
- PHASE 1 DONE — 805 swept: **628 PASS / 177 FAIL**. CLASSIFICATION.md + sweep-results.tsv committed (`76d98793`).
- PHASE 2 structural insight: of 177 FAIL, **129 have a paired `.expected.json` sidecar** (gauntlet-s19 fixtures). Sidecar is the intent source-of-truth:
  - **96 expect `error`** = NEGATIVE TESTS (supposed to fail-to-compile). 69 actual-code MATCH expectedCodes (working negative tests, KEEP). 27 MISMATCH: 11 are `expectedCodes:["UNKNOWN"]` (author didn't pin a code; still correctly erroring → KEEP); 16 produce a *different specific* code than pinned = diagnostic drift, NOT sample-curation (the .scrml is still a valid negative test). Several MISMATCH produce `E-CODEGEN-INVALID-JS` instead of a clean upstream rejection = COMPILER diagnostic-staging concern, surfaced in NOTES, out of curation scope.
  - **28 expect `clean`** = positive tests that BROKE → real EDIT/REWRITE/DROP triage.
  - **2 expect `warning`** + **3 blank** = inspect.
  - **48 have NO sidecar** = non-gauntlet samples + gauntlet-s20 → real triage.
- Curation principle: a negative-test `.scrml` that correctly produces an error is doing its job; it is NOT a curation target. Real targets = positive tests (`expected:clean` or no-sidecar) that fail.
- PHASE 2 real-target set built: **63 positive-test fails** (triage-positive.tsv). Negative tests (81: 69 sidecar-error-MATCH + ~12 sidecar/header-error) are correctly-failing → KEEP, NOT curation targets.
- DEEP-INSPECTION of positive fails surfaced a critical split: a large fraction are **COMPILER BUGS** where the sample is CORRECT canonical scrml per SPEC — editing them would mask the bug + violate Rule 2/3. Confirmed via minimal SPEC-canonical reproductions:
  - `E-SCOPE-001` on built-ins NOT whitelisted in the scope resolver: `navigate` (§20.1 "valid inside any function in any context"), `animationFrame` (§6.7.9 compiler-recognized built-in — minimal repro of the §6.7.9 worked example FAILS), `cleanup` (§6.7.3), `transaction` (§8.5.3). SAMPLES CORRECT → BLOCKED-ON-COMPILER-BUG.
  - `E-SCOPE-001` on `fn` — anonymous `fn(x){}` expression (§48.2.1 canonical) not recognized in expr position. SAMPLE CORRECT → BLOCKED.
  - Genuine EDIT/REWRITE confirmed:
    - `<page route="/">` legacy attr → `E-PAGE-ROUTE-ATTR-FORBIDDEN` (§40.8/§47.9.2; route inferred from filepath). EDIT: drop `route=`. (match-as-expression, match-colon-arrow) + their `=>` arms → `:>`.
    - untyped `match` subject (`match c` where c:asIs) → `E-TYPE-025` (§18 requires typed subject). EDIT: annotate param. (test-008-test-enum, gauntlet-s79-*)
    - legacy `<li for items / lift name />` self-closing markup-for → `E-CTX-001`. This is a REMOVED 3rd form (neither Tier-0 `${for{lift}}` nor Tier-1 `<each>`). REWRITE → §17.7 `<each in= as name>`. (gauntlet-s19 phase1/3/4 cluster)
    - `E-COMPONENT-021`: `${...}` ellipsis children-slot in component body CE-Phase-1 can't reparse. Known CE limitation — needs assessment.
- APPLIED EDIT/REWRITE (all recompile clean, exit 0; full test suite green per pre-commit):
  - REWRITE→`<each>` (raw `for`-in-markup, E-CONTROL-FLOW-IN-MARKUP): reactive-encoded-001, channel-basic-001, channel-multiple-001, sql-all-001, sql-in-for-loop-001 (commit bc6b6a2f).
  - REWRITE→`<each>` (legacy `<li for/lift>` markup-for): phase4-for-markup-044, phase3-for-arith-iterable-090, phase1-const-array-type-005, phase1-let-multiline-008, phase1-fn-multiline-011 (commit 6c49b406).
  - EDIT (typed match-subject param E-TYPE-025 + `=>`→`:>`): _helper-types (cascades to phase1-export-reexport-008 + phase1-import-aliased-002), phase1-lin-match-arms-012, test-008-test-enum (commit a69e4c51).
  - EDIT (drop legacy `<page route=>` E-PAGE-ROUTE-ATTR-FORBIDDEN + `=>`→`:>`): match-as-expression, match-colon-arrow (commit ecf25320).
  - EDIT (type bare variants E-VARIANT-AMBIGUOUS + structural `<localCount>` E-STATE-UNDECLARED): phase1-type-enum-inside-program-013, phase1-import-named-001, phase1-reactive-inside-component-018 (commit 2c5b5a9d).
  - EDIT (scrml:utils→scrml:format; `else if`→`else-if=`; single-quote attr→`&quot;`): phase1-import-stdlib-scrml-005, phase4-if-attr-else-043, phase4-attr-special-chars-077 (commit 3a1acb9e).
- DROP candidates identified (tests RETIRED/unsupported surface; NOTHING deleted):
  - `bun.eval()` user-facing surface RETIRED S130 Approach C F-003 (§30.1 note; user-facing → compiler-internal-only; `^{}` closed primitive set = reflect/emit/emit.raw). Affected: meta-bun-eval-001, meta-004-clean-config, meta-005-nested-meta, meta-010-reflect-with-config.
  - raw JS `eval()` — not a scrml surface (§22.12 Approach C closes JS-host eval): gauntlet-r10-solid-spreadsheet.
- BLOCKED-ON-COMPILER (sample is CORRECT canonical scrml per SPEC; editing would mask bug — Rule 2/3): built-in scope-resolver gaps (navigate §20.1, animationFrame §6.7.9, cleanup §6.7.3, transaction §8.5.3); anonymous-fn-expr §48.2.1; match-on-reactive-typed-enum w/ markup-lift arms (gauntlet-s79-*); E-MATCH-012 on `T|not` with not/given arms; E-CODEGEN-INVALID-JS set (trivial valid scrml emitting unparseable JS — e.g. phase1-let-bare-001 `let counter=0`); cross-file component import phase1-use-named-012 (F-COMPONENT-001).
- FINAL classification complete. 63 positive-test fails resolved as:
  - **27 EDIT/REWRITE applied** (all recompile clean, exit 0; full pre-commit suite green every commit). Adds to the above list: lin-lift-014 (function->fn), fn-inside-meta-016 (fn->function), phase2-if-triple-equals-007 (===->== +sidecar), meta-conditional-markup (close malformed emit tags).
  - **9 DROP candidates** (DROP-DRYRUN.md; NOTHING deleted): 4x retired `bun.eval()` user-facing surface (S130 F-003) + zig-buildconfig (bun.eval->E-CG-006) + solid-spreadsheet (raw JS eval) + optchain-method-039 (struct function-field rejected S174) + meta-nested-deep-001 (nested ^{} forbidden §22.11) + r10-bun-admin (E-RI-002 friction artifact).
  - **26 BLOCKED-ON-COMPILER** (kept; sample correct per SPEC; compiler bug/limitation — Rule 2/3): navigate/animationFrame/cleanup/transaction built-in scope gaps; anon-fn-expr; 7x E-CODEGEN-INVALID-JS (trivial valid scrml -> unparseable JS); 3x E-MATCH-012 on T|not; 2x gauntlet-s79 match-on-reactive-enum; 4x E-COMPONENT-021 CE `${...}` children-slot; phase1-use-named-012 cross-file-component-import; meta-compile-time-pure-001 reflect-variant-`.name`-shape (§22.5.4 divergence).
  - **1 reclassified NEGATIVE** (channel-shared-state-001 — documentary retired-modifier test; KEEP).
- DELIVERABLES: CLASSIFICATION.md (updated w/ Phase-2 disposition summary + BLOCKED table), DROP-DRYRUN.md (9 candidates + reasons), progress.md. NO deletions; no dist/ touched; only `.scrml` edits + change-id docs.
- DONE pending final git-clean verification.
