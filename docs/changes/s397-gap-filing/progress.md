# s397-gap-filing — progress

**Dispatch:** BOOKKEEPING. File S397's verified defect backlog into `docs/known-gaps.md`.
No compiler behaviour changed, no code written. Write surface: `docs/known-gaps.md` + this file.

**Base:** `c11db440` (== `origin/main` at dispatch; `git merge-base HEAD origin/main` confirmed equal).
**Branch:** `worktree-agent-aa1b01b88074fa77b`.

---

## Outcome

| | count |
|---|---|
| findings handed over | ~20 (groups A-E) |
| **filed as new entries** | **16** |
| already filed under another id | 3 (addenda recorded, entries NOT edited) |
| did not survive re-verification | 3 (2 not filed at all, 1 filed only in a narrowed form) |
| pre-existing entries corrected in place | 1 (the §7 Bug 15 rotation entry) |

Marker delta measured by `bun scripts/state.ts`: **888 -> 904** tokens; HIGH 78 -> 85,
MED 205 -> 211, LOW 87 -> 90, Nominal 7 (unchanged). `state.ts` does not throw, so there is no
duplicate id with conflicting `sev`/`status`.

---

## The finding that reframed the dispatch

The backlog arrived labelled *"pre-existing / byte-identical to base"*. **It was measured against an
S397 INTERMEDIATE base.** S397 round 3 then landed the §32.2.1 `armBodyStmts` carve-out and the
`liftVar`/`var` de-conflation in `emit-logic.ts` — in exactly the region the A-group findings live.
That was discovered by reading `emit-logic.ts:118-183` while looking for a locus, not by being told.

Every A/B/D finding was therefore re-run on `c11db440` before filing. Three did not survive, and
**all three errors were in the over-reporting direction**. Two of them would otherwise have entered a
900-marker ledger as open defects.

The brief mandated verifying two findings (B5, D6). Eleven were verified by execution in the end,
because the base-staleness discovery made "reported" an unsafe input.

---

## Per-finding disposition

### Filed (16)

| src | id | sev | verified how |
|---|---|---|---|
| A2 | `g-server-boundary-lift-in-arm-returns-the-arm-value-and-strands-the-rest-of-the-handler` | HIGH | executed; emitted `_server.js` read |
| B1 | `g-let-decl-reading-tilde-swallows-the-following-statement-which-is-never-compiled` | HIGH | executed, 2 containers; statement absent from artifact |
| B2 | `g-braceless-if-else-both-lifting-drops-the-else-and-leaks-a-block-scoped-name` | HIGH | executed on the live corpus file; `node --check` run |
| B3+D2 | `g-value-lift-then-loop-in-one-body-pushes-onto-a-scalar-guaranteed-typeerror` | HIGH | executed; **merged — one mechanism, two dispatches found it** |
| D4 | `g-fn-local-tilde-detection-is-a-text-regex-so-member-access-on-tilde-false-fires-e-fn-008` | HIGH | executed; root traced to `type-system.ts:24931` |
| D1 | `g-bare-expr-between-a-lift-loop-and-the-tilde-read-silently-replaces-the-accumulator` | HIGH | executed with a two-limb control (decl vs bare-expr) |
| D3 | `g-while-accumulator-across-a-logic-block-boundary-deletes-the-loop-and-the-following-call-from-the-output` | HIGH | executed on the live corpus file |
| D5 | `g-const-bound-while-emits-raw-scrml-into-the-client-artifact-before-refusing` | MED | executed; `node --check` -> SyntaxError |
| B5 | `g-display-position-call-is-emitted-at-file-scope-and-invoked-again-by-the-render-wiring` | MED | executed; runtime `_scrml_effect` read |
| C2 | `g-codegen-diagnostic-sink-has-no-dedupe-so-one-source-read-can-report-once-per-emission` | MED | sink confirmed structurally; double-emit NOT reproduced (split prov) |
| C3 | `g-exprspan-hard-codes-line-1-col-1-so-only-byte-offsets-are-real` | MED | source read: `expression-parser.ts:984` |
| E1 | `g-semdiff-chunk-namespace-token-discovery-misses-every-non-engine-html-site` | MED | source read both ends; **reported path was wrong, corrected** |
| E2 | `g-match-arm-result-is-not-reliably-a-structured-node-in-the-same-match` | MED | agent-reported; locus = recorded search |
| C4 | `g-three-emit-expr-comments-still-claim-a-failed-build-never-ships-including-two-leak-guards` | LOW | all three sites grepped + read |
| B4 | `g-tilde-typed-must-use-decl-emits-a-phantom-bare-tilde-statement-into-the-ast` | LOW | agent-reported; emission clean at HEAD (masked by the Bug-15 skip) |
| E4' | `g-primary-nav-map-has-no-routing-row-for-the-tilde-accumulator-surface` | LOW | all 13 maps grepped; **stronger claim falsified in the same grep** |

### Already filed — addenda recorded, entries NOT edited (3)

- **C1 -> `g-cli-emits-artifacts-on-failed-compile`** (MED, open, RULED S354 (b)). Locus already exact
  (`api.js:2962,2967`). Independently re-confirmed twice this pass (two probes exited 1 and each wrote
  a full artifact set; one artifact does not parse). **S397 assesses HIGH vs the entry's MED — recorded,
  not applied**, because re-ranking an entry with a landed ruling is the ruler's call. Adjacent:
  `g-compiler-writes-unverifiable-client-bundle-to-disk-under-e-cg-001`.
- **D6 -> `g-tilde-lin-enforcement-does-not-fire-on-spec-own-examples`** (HIGH, open). ⚑ Do NOT open a
  second id: **SPEC §32.2.1 cross-references this id BY NAME**, so it is load-bearing in a normative
  document. D6 is the TRACE that entry explicitly asks for (it says *"CAUSE NOT TRACED … a fix must
  start by tracing that"*). Verified exhaustively: `tilde-init`/`tilde-ref` have four consumers
  (`type-system.ts:18426`/`:18435`/`:18744`/`:18750`) and **zero producers** anywhere in
  `compiler/src/` or `compiler/native-parser/`. Only `tilde-decl` is ever constructed. The apparent
  producers are hand-built object literals in `compiler/tests/unit/type-system.test.js` — synthetic AST
  fixtures, which is exactly why the pass has passing unit tests and never fires on real source.
- **E3 -> `g-fn-params-typed-string-actually-objects`** (MED, open, no locus). Locus verified as
  `compiler/src/types/ast.ts:827`. Proposed for addition; not applied. The existing MED is the better
  call than S397's LOW.

### Not filed — did not survive re-verification (3)

- **A1 (loop in an if-as-expression arm emits `.push()`, crashing both paths) — FIXED at `c11db440`.**
  Emits `_scrml_tilde_4 = "done"` / `= "neg"` — plain assignments. Closed by the round-3 carve-out.
- **A3 (post-decl repoint makes a `const`/`let` initialize `~`) — does not reproduce as stated.**
  `for (x of xs) { lift x }` / `const other = 5` / `return ~` returns the array; §32.2's bullet is
  honoured. ⚑ **Residual:** the row also named twins in `emitForExprDecl` / `emitMatchExprDecl` — the
  decl-FORM contexts — which were NOT probed. Re-probe those two before re-filing.
- **E4 as stated ("ZERO rows across all 13 nav maps") — FALSIFIED.** `domain.map.md` carries the §32
  row at `:68`, `tilde-decl` at `:1009`, `_emitForStmtWithTilde` at `:1823-1836` and the
  `tildeContext.var` narrative at `:2359-2394`; hit count identical at `8e278c73` and `c11db440`, so
  it was present when all three reporting dispatches ran. Filed only in its narrowed, verified form.

---

## Deferred / owed elsewhere

1. **`g-tilde-lin-enforcement-does-not-fire-on-spec-own-examples` wants its "CAUSE NOT TRACED"
   paragraph replaced** with the zero-producers trace. Owner-edit, not a filing-pass edit.
2. **`g-cli-emits-artifacts-on-failed-compile` sev MED-vs-HIGH** needs a ruling.
3. **`g-fn-params-typed-string-actually-objects` wants `locus=compiler/src/types/ast.ts:827`.**
4. **A3's decl-FORM twins** (`emitForExprDecl` / `emitMatchExprDecl`) were never probed by anyone.
5. **D4's wider blast radius** — the fn-accumulator dispatch reported that `return ~.length`,
   `const acc = ~ … return acc` and an early in-loop `return ~` ALL false-fire. This pass re-ran only
   `const n = ~.length`. The regex predicts the member-access forms; it does NOT obviously predict
   `const acc = ~`. Measure the full set before scoping a fix.
6. **C2's double-emission limb** was not reproduced; a plain `server function` emits only the route
   handler. The peer-callable classification needs a different shape.
7. **B4's AST-level phantom node** was not confirmed — `buildAST` is not callable on source text
   (it consumes block-splitter output), so an AST dump needs a proper harness.

---

## Gates

- `bun scripts/state.ts` — no throw (the duplicate-id-with-conflicting-sev/status check is the
  correctness gate for this dispatch). 888 -> 904 markers, all 16 new ones parsed.
- `bun scripts/state.ts --write` then `--check` — run AFTER the last content edit, per the
  generated-doc gate.
- Pre-commit ran the docs-only fast path (staged change is a single `.md`).

## Commits

1. `2c5ce22a` — the §S397 section + the Bug-15 in-place correction.
2. (this file + the regenerated §0 counts follow.)
