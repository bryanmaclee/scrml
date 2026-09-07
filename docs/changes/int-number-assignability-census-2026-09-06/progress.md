# progress — int/number assignability census

Append-only. Newest entry at the bottom.

## 2026-09-06T~16:40Z — startup gate + reconnaissance

DONE
- Startup gate PASSED. `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ad9d83aa4336c9aa9`,
  toplevel matches, tree clean, `merge-base HEAD origin/main` == `origin/main` == `069e86fd`.
- BRIEF fetched from `scope/s404-int-number-census` and read in full.
- `bun install` (218 pkgs). `bun run pretest` run PLAINLY from worktree CWD; artifact verified
  (20 `.js` under `samples/compilation-tests/*/dist/`, freshly written).
- Baseline suite launched in background.
- Maps read: `primary.map.md` Task-Shape Routing (all 30 rows scanned) + `schema.map.md`
  assignability section.

RECON FINDINGS (verify-against-source, all reproduced by me)
- PA facts CONFIRMED: `type-system.ts:1431` `["int", tPrimitive("integer")]`;
  `fieldTypeEquals` at `:1220` compares primitives by NAME;
  `fieldTypeAssignable` at `:1201`; `hostReceiverKind` at `:3960`.
- ⚑ SCOPE CORRECTION on the PA framing: `fieldTypeEquals` / `fieldTypeAssignable` are the
  §14.8.8 SQL-projection-row-vs-`:struct`-contract width-subtyping path, NOT a general
  argument-assignability path. There is NO argument-assignability code today — §7.5.1 position 3
  is "not checked" and has zero implementation. So the census must MODEL the rule, not run it.
- SPEC §7.5.1 (`SPEC.md:6165-6247`) read in full. Its own figure is
  **"37 new rejections of which all 37 are false positives"** over **1920** corpus `.scrml`.
  The "37 of 40" in circulation is NOT what SPEC says.
- AST shapes confirmed empirically via `runBlockSplitter` -> `runTAB`:
  `function-decl{params:[{name,typeAnnotation}],returnTypeAnnotation}` ·
  `state-decl{typeAnnotation}` · `let-decl`/`const-decl{typeAnnotation}` ·
  `type-decl{typeKind,raw}` · `state{stateType:"schema"}` + text children ·
  `call{callee,args}` · `lit{raw,value,litType}`.
- ⚑ NEW FINDING (report, do not file): `type A = { x: int }` — the canonical no-marker struct
  form — yields `typeKind: ""`, and `buildTypeRegistry` registers it as **`tAsIs()`**, so its
  fields are never resolved through the registry. Only `type B : struct = {...}` yields
  `typeKind: "struct"`. `parseStructBody(raw, reg)` called DIRECTLY resolves it correctly
  (`int` -> `primitive integer`, `int[]` -> array-of-integer, `[int: string]` -> map).
  The in-source comment at `type-system.ts:5988` asserts the opposite
  ("an inline struct alias would already be a `struct` kind via the parser").

NEXT
- Measure full-corpus BS+TAB timing (single-file was BS 8ms / TAB 34ms).
- Write `scripts/int-number-census.ts`.

BLOCKERS
- none.

## 2026-09-06T~17:30Z — instrument built, verified, and re-run. COMPLETE.

DONE
- `scripts/int-number-census.ts` landed (~1200 lines incl. header) with `--summary` / `--json` /
  `--roots=<a,b>` / `--selftest`. 27 selftest checks, all green. Full gate green on every commit
  (29696 pass / 0 fail — identical to baseline).
- Rule 7 satisfied STRUCTURALLY, not waived: `runBlockSplitter` -> `runTAB` + the compiler's own
  `buildTypeRegistry` / `resolveTypeExpr` / `parseStructBody` / `inferExprType` /
  `parseSchemaBlock`. ZERO regex over scrml source text. Measured 2555 files in ~6.5s
  (~2.5 ms/file), so the timing escape hatch the brief allowed was never needed.
- The SPEC's "1920 corpus `.scrml`" IDENTIFIED, not guessed: it is exactly
  `corpus-emit-differential.ts`'s five `DEFAULT_ROOTS` (examples · samples · conformance · stdlib ·
  benchmarks), which excludes `compiler/`. That set counts 1920 at this watermark against 2555 in
  the whole tree. `--roots` reproduces it.

THREE BUGS IN MY OWN INSTRUMENT, all found by checking OUTPUT AGAINST SOURCE, none by the
selftest passing. Each now has a regression anchor.
1. fn-body scope: the `function-decl` branch returned early and descended via the generic key
   loop, so no `let`/`const` inside ANY function body was ever registered. Caught by spot-checking
   `self-host-v2/lex.scrml:115` — `isLineFeed(code)` read `unannotated` while line 114 says
   `const code: int = peekCode(c, 0)`.
2. Expression spans are SEGMENT-RELATIVE: `call.span.line` restarts at 1 per fragment, so every
   call site cited `file.scrml:1`. Now cites the nearest enclosing non-expression node; 274 of 276
   carry a real line (the 2 residual are in `lex.scrml`).
3. Param annotations were resolved in the CALLER's registry instead of the callee's — silently
   lossy for any file-local alias.

ANSWERS (whole tree, 2555 files / the 5-root 1920 set in parens)
- Q1: 349 int occurrences across 154 files (251 / 116). fn-param 115 (85) · schema-column 76 (63) ·
  struct-field 57 (41) · state-cell 49 (37) · fn-return 28 (25) · let-const-decl 24 (0).
  Nesting: direct 319 · map-value 17 · array-element 10 · deeper 2 · union-member 1.
  Spelling: `int` 245 / `integer` 104. 71 fn decls with >=1 int param across 26 files.
- Q2: 276 arguments (120) at an int-annotated param across 21 files (14).
- Q3: STRICT 228 of 276, 169 integral (93 of 120, 43 integral).
  PROVABLE 195 of 276, 169 integral, ZERO non-numeric (69 of 120, 43 integral, ZERO non-numeric).
- Q4: ZERO of 100 (81). No int-typed value reaches a `number` param anywhere in the corpus.

BLOCKERS
- none. Instrument is re-runnable and self-verifying.

## 2026-09-06T~18:40Z — FIX ROUND (S239 adversarial pass: 4 HIGH / 3 MED / 5 LOW). COMPLETE.

DONE — all 12 addressed, each verified against source before changing behaviour.
- HIGH1 enum-variant payloads had no bucket (41 whole-tree / 36 five-root sites absent). Added an
  enum decl pass + `enum-payload` position+nesting. `integerNestings` deliberately STOPS at nominal
  types: reached by NAME a struct/enum is a USE, not a declaration; recursing would double-count.
- HIGH2 the omission was masked by a clean all-clear — `parseStructBody` returns an EMPTY map for an
  enum raw and `structBodiesParsed++` fired anyway, so "900 of 900" was perfect while a whole
  position kind contributed zero. Real split: 239 struct / 659 enum / 661 zero-field (REPORTED).
- HIGH3 `resolveTypeExpr` has no `throw`, so the catch-based counter was dead and
  "resolver refused: 0" was false. Added an asIs-by-NAME counter on BOTH sides (43 annotation +
  31 param, 11 distinct names).
  ⚑ VERIFIED the floor is EMPTY: none of the 11 names is int-bearing (4 are enums with no int
  payload — DriverStatus/InvoiceStatus/LoadStatus/Status, 43 decls total; 7 have NO declaration
  anywhere — Draft/Feeling/Frobnicate/ModeMachine/Signal/Validated/any). So Q1-Q4 are NOT floored
  by this cause and **Q4's zero survives**.
- HIGH4 lexical bare-name lookup could let `let cell` answer `@cell`. Strip now applies to the
  state-cell lookup only. Latent as the PA predicted — it can only INFLATE
  provableRejectionsNonNumeric, which measures 0. Q3 conclusion unaffected; NOT "corrected".
- MED: per-field spelling returns "mixed" instead of guessing (corpus has zero mixed bodies, so the
  tally is now provably right, not merely plausible); `--roots` deduped; registry-build throw
  counted and falls back to BUILTIN_TYPES (an empty Map cannot resolve `int` at all).
- LOW: repair counters count every fixpoint pass; `not` provability from `inferExprType`;
  struct-field/schema-column citations LABELLED `decl-head`; duplicate fn names counted (29);
  truncation floor now guards filesPARSED too.
- Selftest 27 -> 37, incl. one NAMED regression anchor per HIGH.

⚑ RECONCILED the 71-vs-74 discrepancy I left unflagged last round (PA was right to call it):
a line-grep's `\b` matches `int[`, so `interpDepths: int[]` reads as an int param to grep and not
to the resolver. Exactly 3 fns — mkState / popDepth / emitInterpStart in self-host-v2/lex.scrml.
71 + 3 = 74. Both numbers right about different questions; now reported in-tool so it never needs
re-deriving.

NUMBERS THAT MOVED (whole tree | 5-root): int occurrences 349->390 | 251->287; files 154->189 |
116->147; annotation sites reached 2257->2541 | 1566->1787; struct bodies 900->239 | 688->192;
NEW enum bodies 659 | 494. Q2/Q3/Q4 UNCHANGED in every bucket.

BLOCKERS
- none.
