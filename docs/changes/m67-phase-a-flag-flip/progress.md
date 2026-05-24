# M6.7 — Phase A flag flip + corpus-stale residual close

## Startup verification (2026-05-23)

- WORKTREE: `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a7b1eb67ffd00f1b5`
- BRANCH: `worktree-agent-a7b1eb67ffd00f1b5`
- Worktree base merged forward to main HEAD `7426084c` (fast-forward — no conflicts).
- `bun install` clean (117 packages).
- `bun run pretest` ran cleanly.
- Baseline `bun run test` confirms **20,040 pass / 0 fail / 171 skip / 1 todo / 758 files** (matches brief baseline). Initial run showed 2 fail but that's flaky (`value-indexed-subscribers.test.js` subscriber-throw isolation test — passes on retry).
- Native canary baseline: **998/1000 strict-pass**, 2 gap-ledger entries:
  - `samples/quiz-app.scrml` — GAP-state-block (uses `</>` as expression-position division operator at line 60, plus state-blocks). **Not in M6.7 brief scope.**
  - `compiler/self-host/bs.scrml` — DIFF-hoist-count (native parser hoists 1 spurious empty typeDecl at line 241; **native-parser bug, not corpus-stale**). bs.scrml null migration may not close this gap.

## Phase plan

1. Migrate bs.scrml null tokens → canonical absence forms (10 real + 3 in comments/strings).
2. Migrate zig-buildconfig `</>` → `</tagname>`.
3. Migrate tailwind-prose-coverage `</>` → `</code>`.
4. Flip api.js parser default (`parser !== "legacy"` for useNativeParser).
5. Wire `--parser=legacy` opt-out in CLI.
6. Rename diagnostic I-PARSER-NATIVE-SHADOW → I-PARSER-LEGACY-OPT-OUT (warning, fires on legacy path).
7. Update SPEC §34 catalog row.
8. M6.4b disposition (verify live BS+TAB short-circuits under native default; gate or natural-dead-code).
9. Run full test suite; surface residual canary gap.
10. Update tracking docs.

## Log

### 2026-05-23 14:00 — bs.scrml null migration (Phase 1) — LANDED

Migrated 10 real absence sites + 1 comment doc string in bs.scrml.
Surprise finding: the null → not migration didn't just canonicalize
tokens — it ELIMINATED a phantom typeDecl the native parser was
hoisting. The `name: null,` in object literal at line 286 was
mis-recognized as a type-declaration position by the native parser,
producing the DIFF-hoist-count gap. Migrating to `name: not,`
canonicalizes the absence AND closes the parser-side mis-recognition.

bs.scrml canary delta: DIFF-hoist-count (gap) → EXACT (strict-pass).
Native canary: 998 → 999 strict-pass.

### 2026-05-23 14:30 — zig + tailwind closer migration (Phases 2-3) — LANDED

- gauntlet-r10-zig-buildconfig.scrml: 34 `</>` sites → explicit closers
- tailwind-prose-coverage.scrml: 44 sites including multi-line
  `<pre><code>...</code></pre>` shape (needed file-wide stack-based
  scanner v2; per-line regex got confused on multi-tag-per-line cases
  and multi-line `<pre><code>` boundaries).

Both files: LIVE-DEGENERATE (explained-true crutch) → EXACT.
Canary count unchanged at 999 (these moved within the explained-true
bucket; the migration's value is retiring the LIVE-DEGENERATE crutch).

Remaining gap-ledger entry: `samples/quiz-app.scrml` — GAP-state-block
(out-of-scope for M6.7 brief; uses `</>` as expression-position
division operator at line 60 plus state-blocks; needs separate fix).

### 2026-05-23 15:00 — Phase A flag flip + diagnostic rename — STOP

Flipped api.js default + renamed diagnostic + wired CLI opt-out + SPEC
§34 row. But the post-flip pre-commit gate surfaced **845 test
failures across conformance / unit / browser / self-host suites**.

This is the STOP signal the brief explicitly modelled:

> The native parser was shadow-only until now — any test that
> incidentally went through the live BS+TAB path may now go through
> native and surface a latent gap.

The 998/1000 strict-pass canary measures top-level shape + hoist counts
+ programRootEqual + deep node-kind sequence. The downstream codegen /
lint / conformance work depends on SHAPE-deeper agreement — attribute
parsing, expression nesting, statement boundaries, etc. — the canary
does not exercise these.

Failure-class sample (representative, not exhaustive):
  - conf-CG-001-warn.test.js — W-CG-001 (top-level `?{}` SQL warn) NOT
    emitted under native. Under legacy: 1 warning. Under native: 0.
    The native parser's AST for top-level `?{}` doesn't match the shape
    `emit-reactive-wiring.ts:366` checks for.
  - conf-form-for-canonical.test.js — formFor codegen shape diverges.
  - conf-TRY-CATCH-IN-SCRML-SOURCE.test.js — try/catch lint sites
    not detected under native.
  - conf-LOOP-007.test.js — while-as-expr E-LOOP-007 not detected.
  - parser-conformance-canary.test.js LIVE-HOIST-MISCLASSIFY corpus
    smoke — the bs.scrml fix removed the H-bs-tail signature the test
    asserts (this one is a test-update needed: the assertion was
    testing the phantom typeDecl which has been correctly eliminated).
  - self-host/tab.test.js + bs.test.js — multiple self-host parity
    failures.
  - browser/todomvc-e2e.test.js — runtime regression.

### STOP disposition

Per the brief's STOP §5: committed in-flight work via `--no-verify`
(authorized by the brief's STOP protocol — "commit your in-flight
work + document the residual") + this progress.md captures the
residual + final report names it.

This commit leaves the flip applied so the next dispatch can
inherit + work from a known position. The 998→1000/1000 canary
target is NOT achieved (999 — bs.scrml closed; quiz-app remains;
gap-ledger structurally needs the native parser to grow a State
BlockKind or for the quiz-app `</>`-as-division pattern to be
migrated; not in M6.7 scope).

### Recommended next steps

1. **Triage the 845 failures into classes** — most likely cluster into
   3-5 root causes (top-level `?{}` AST shape, formFor synth shape,
   try/catch site detection, top-level statement boundary, etc.).
2. **Fix the load-bearing native-vs-live divergences** before re-flip,
   OR establish a transitional state where conformance tests can
   opt-in/out of the parser flag.
3. **Update the LIVE-HOIST-MISCLASSIFY canary smoke test** —
   `parser-conformance-canary.test.js:852` asserts the bs.scrml file
   classifies as LIVE-HOIST-MISCLASSIFY (Wave 5 H-bs-tail signature),
   but the null migration has correctly eliminated that signature.
   The test needs to be updated to reflect post-S124 truth (or have a
   placeholder file injected to preserve the regression-guard).
4. **Re-evaluate the M6.7 brief**: the 998/1000 canary is necessary
   but NOT SUFFICIENT for default-flip readiness. The brief should
   probably mandate a full `bun run test` clean run BEFORE flipping,
   not just the canary number. The canary is shape-of-top-level;
   the test suite is end-to-end-behavior.

### Disposition: PARTIAL — corpus migrations LANDED; Phase A flip REVERTED

**Reverted post-debug.** Once the W-CG-001 root cause was found (the
native parser produces `kind: "bare-expr"` wrapping a `sql-ref`
exprNode where the live parser produces `kind: "sql"` — a real
codegen-detection-blocking shape divergence the canary's top-kind
+ hoist + programRootEqual + deep-seq metrics did not surface), the
flip + diagnostic rename + CLI wiring + SPEC catalog row were
ALL reverted to keep the worktree on a green test baseline. The
right answer per pa.md Rule 3 is to land the flip with the
divergences fixed first; landing 845 failures + relying on a
follow-up dispatch to clean them up is the easy-not-right answer.

**LANDED (3 commits + this progress doc):**

  - compiler/self-host/bs.scrml — 10 real null → not migrations +
    1 comment doc string canonicalized
  - samples/compilation-tests/gauntlet-r10-zig-buildconfig.scrml —
    34 inferred-closer migrations (LIVE-DEGENERATE → EXACT)
  - samples/compilation-tests/tailwind-prose-coverage.scrml — 44
    inferred-closer migrations including the multi-line
    `<pre><code>...</code></pre>` shape (LIVE-DEGENERATE → EXACT)
  - compiler/tests/parser-conformance-canary.test.js — coupled
    update to the bs.scrml regression-guard, asserts post-S124
    EXACT classification + typeDecls=0

**REVERTED (NOT in current commit set):**

  - compiler/src/api.js — flag flip + diagnostic rename
  - compiler/src/cli.js — help text update
  - compiler/src/commands/compile.js — CLI arg parser + help text
  - compiler/SPEC.md — §34 catalog row for I-PARSER-LEGACY-OPT-OUT

**Final canary delta:** 998 → 999/1000 strict-pass (+1 from
bs.scrml EXACT). quiz-app GAP-state-block remains as the sole
gap-ledger entry (out-of-scope for M6.7 brief; uses `</>` as
expression-position division operator + state-blocks).

**Test baseline post-landings:** 20,041 pass / 0 fail / 170 skip /
1 todo / 758 files. Net +1 pass vs pre-flip baseline of 20,040 —
the updated canary regression-guard moved from skip to pass.

### What the next dispatch needs

To land the Phase A flip cleanly, the next dispatch needs to:

1. **Investigate the native AST shape divergences** that 845 tests
   surface. Best to do this BEFORE flipping by writing a "what would
   break if I flipped?" harness that runs the test suite under both
   parsers + diff.
2. **Fix or adapt the load-bearing divergences.** The W-CG-001 case
   is a representative: either the native parser produces a
   top-level `kind: "sql"` node like live, OR `isServerOnlyNode`
   learns to detect `bare-expr` wrapping `sql-ref`. The M6 cutover
   plan §M6.5 path (a) is the canonical answer — a thin adapter
   layer that normalizes native AST to live shape for the
   downstream consumers.
3. **Re-flip with the adapter in place.** The artifacts on this
   dispatch (CLI wiring, diagnostic rename, SPEC catalog row,
   commit history) are recoverable from the reverted state via
   git reflog if a follow-up wants the exact text as a starting
   point. See git reflog entries from this dispatch's branch.


---

# M6.7-D3 — match-arm `:>` colon-arrow (dominant cluster sub-form)

- [start] branch worktree-agent-a03bc182fa5a32427 @ HEAD 003ee3a8 (== main parser source; D4/s128-open ahead are docs-only). Startup pwd verified under .claude/worktrees/agent-. bun install + pretest OK.
- [phase-0] Re-measured corpus NSBH = 293/110 at HEAD (matches d4). Isolated the 24 match-cluster first-error files (MATCH-ARROW 13 + MATCH-PATTERN 11). Committed probe scripts (52d4f94a).
- [phase-0] Empirically decomposed the cluster into 7 sub-forms: :> colon-arrow (12), literal-arm (5), given-binding (3), alternation| (1), guard-if (1), not-pattern (1), same-line-space-sep (1). DOMINANT = :> (12/24).
- [phase-0] Confirmed LIVE pipeline ACCEPTS all 8 probed sub-forms (parity-completeness, not corpus-stale). Confirmed live `:>` and `=>` produce byte-identical match-expr AST.
- [decision] STOP-and-split per brief condition (b): fix DOMINANT (:>) only; file the other 6 as named follow-on units (D3a-D3f). Mirrors D1's STOP-and-split.
- [fix] parse-expr.js: parseMatchArm :> branch + isColonArrowAliasAhead helper + isArmArrowAt :> branch. Source + within-node allowlist regen (6 moved files) in SAME COMMIT (2f7b34f8).
- [gate] strict-pass EXACT HELD at 964 (full histogram unchanged). within-node 1005 pass/0 fail post-regen; content classes net -157, SPAN-COORD +116 cosmetic.
- [test] m67-d3-match-arm-parse.test.js — 25 pass/0 fail with fix; 13 fail/12 pass against pre-fix (LOAD-BEARING). Committed (f1a4ffc6).
- [gate] full `bun run test` — 21362 pass / 174 skip / 1 todo / 0 fail / 781 files (2 consecutive stable runs; an earlier 2-fail was transient network flake).
- [impact] corpus NSBH 293/110 -> 246/99 (-47 fires, -11 files). MATCH-ARROW first-error 13 -> 2 (residual = | alternation + if guard, both follow-ons).
- [doc] d3-match-arm.md written. DONE.
