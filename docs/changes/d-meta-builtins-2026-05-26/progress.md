---
session: S133 Fire #6 (Phase-0 STOP) → Fire #12 (PROCEED) — D: rewriteBunEval retirement (Cluster B-code Site 1)
started: 2026-05-26 (Fire #6) — landed: 2026-05-26 (Fire #12)
worktrees:
  - /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a803f755db729e19a (Fire #6 — STOP)
  - /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-ad582bd9f22fc894b (Fire #12 — PROCEED)
base-shas:
  - c5a27b7364800218d4f1a497e476cd5aece67e76 (Fire #6 — pre-Step-A)
  - 9f86cfcd23d52eb4c76d5a1686188a71a005e74d (Fire #12 — post-Step-A 80b168e6)
---

# Progress log

## Phase 0 — Startup verification (Fire #6, 2026-05-26)

- [done] pwd / git-status / worktree-root identity / bun install / bun run pretest — clean
- [done] Baseline tests: 14569 pass / 88 skip / 1 todo / 0 fail (close to brief's 14576 target; minor S132/S133 drift)

## Phase 0 — Empirical verification (MANDATED STOP GATE)

Brief premise: "5 meta-eval.ts callers + 1 rewrite.ts:1985 caller are provably no-ops on cleansed user input." Per [[feedback_cookbook_vs_empirical]] — verify before deletion.

### Surface area (grep)

7 active call-sites confirmed (matches S130 progress doc):
- `compiler/src/meta-eval.ts:37` (import)
- `compiler/src/meta-eval.ts:267` (bare-expr serializer)
- `compiler/src/meta-eval.ts:272` (let-decl)
- `compiler/src/meta-eval.ts:277` (const-decl)
- `compiler/src/meta-eval.ts:326` (return-stmt)
- `compiler/src/meta-eval.ts:336` (html-fragment)
- `compiler/src/codegen/rewrite.ts:2023` (clientPasses Pass 4)
- `compiler/src/codegen/rewrite.ts:528` (function definition)

### Function contract (rewrite.ts:528-557)

Early-return at line 530: `if (!expr.includes("bun") || !/\bbun\s*\.\s*eval\b/.test(expr)) return expr;`

The function IS a no-op on input containing no literal `bun.eval` token.

### Empirical reproducer — meta-block callers

```scrml
<page>
  ^{
    const year = bun.eval("new Date().getFullYear()");
    emit(`<p>Year: ${year}</p>`);
  }
</page>
```

Result with current code (HEAD c5a27b73):
- META_BUILTINS check in meta-checker.ts:117 PASSES (still contains `"bun"`)
- meta-eval.ts:277 const-decl serializer calls `rewriteBunEval` on `bun.eval("new Date().getFullYear()")` → folds to `2026`
- bodyCode becomes `const year = 2026; emit(\`<p>Year: ${year}</p>\`);`
- `new Function("emit", "reflect", bodyCode)` runs cleanly
- Output: `<p>Year: 2026</p>`
- **NO diagnostic emitted; user code silently accepted.**

### Empirical reproducer — what happens AFTER deletion (simulated)

`bun` is NOT a Bun global (only `Bun` is — verified via `bun run` probe). So `bodyCode` containing literal `bun.eval(...)` reaching `new Function(...)` throws `ReferenceError: bun is not defined` → emits `E-META-EVAL-001`.

### Conclusion (Fire #6) — the 5 meta-eval callers are NOT no-ops

**They are silent compile-time folders for user-written `^{ bun.eval(...) }`.** Deleting them changes user-observable behavior from "silently fold + emit literal" to "E-META-EVAL-001 compile-time failure."

This contradicts the brief's "provably no-ops on cleansed user input" premise. Per the brief's STOP directive ("If you find a call that ISN'T provably a no-op — that's a Phase-0 STOP"), proceed no further.

### Root cause — META_BUILTINS gap (S130-deferred sub-task A)

The S130 progress doc explicitly identified this dependency:
> "1. **META_BUILTINS gap** — meta-checker.ts:117 still includes `"bun"`, `"process"`, `"Bun"`, `"console"` per S114-era contents. Per SPEC §22.12 line 13826 (S130 amendment): these are NOT in the post-S130 META primitive set. Removing `"bun"` from META_BUILTINS would fire E-META-001 on any user `^{}` containing `bun.eval(...)`, neutralizing the meta-eval.ts caller paths."

SPEC §22.4 (line 14687 — S114 Approach C ratification): **"JS-host ambient globals (`bun`, `process`, `setInterval`, `fetch`, etc.) are NOT in the META_BUILTINS set and trigger `E-META-001`."**

Current `META_BUILTINS` (meta-checker.ts:117-156) violates §22.4 by including `bun` / `process` / `Bun` / `console`.

### Correct sequence (per S130 progress doc + SPEC §22.4)

- **Step A (PREREQUISITE):** amend `meta-checker.ts:117` META_BUILTINS to remove `bun` / `process` / `Bun` / `console`. After this, user-written `^{ bun.eval(...) }` fires `E-META-001` at meta-checker time. The 5 meta-eval.ts callers truly become no-ops (input never reaches them with `bun.eval` content).
- **Step B (THIS DISPATCH'S SCOPE):** retire `rewriteBunEval` function + 6 callers + 12 tests.

This brief skipped Step A.

### rewrite.ts:1985 Pass 4 caller — separate analysis

The `clientPasses` Pass 4 caller fires on the string-rewrite FALLBACK path only (`exprNode`-missing legacy AST). Tree-walker `emitExpr` does NOT call `rewriteBunEval`. Empirical reproducer:

```scrml
<page>
  <state>
    @x = ""
  </state>
  <p>Result: ${@x + bun.eval("'!'")}</p>
</page>
```

Result with current code:
- E-CG-006 server-only-pattern guard catches the residue: `bun.eval("'!'")` survives all client passes (tree-walker bypasses Pass 4) and reaches client.js emission — caught.

So **Pass 4 IS already a no-op for the §30.2 markup-interpolation path** (tree-walker bypass). It would only fire on a fallback path with `bun.eval`, which itself would be caught downstream by E-CG-006.

This Pass 4 caller IS safer to remove independently of META_BUILTINS — its deletion does NOT change observable behavior for currently-valid user input (no path reaches it with `bun.eval` content; E-CG-006 catches what survives).

However, function retirement requires ALL callers gone. Removing Pass 4 alone leaves the function definition (still importable from meta-eval.ts).

## Decision (Fire #6) — STOP, report findings

Per brief's STOP directive: 5 of the 6 callers are NOT provably no-ops on currently-accepted user input. Proceeding would change observable user-facing behavior in a non-SPEC-compliant way (firing E-META-EVAL-001 instead of the SPEC-normative E-META-001).

No deletions performed. No tests removed. Final tree clean.

## Recommendation for follow-on dispatch

Single combined dispatch:
1. Amend `compiler/src/meta-checker.ts:117` META_BUILTINS: remove `bun`, `process`, `Bun`, `console`. Per SPEC §22.4 ratification, these should fire E-META-001.
2. Verify no existing test depends on these being in META_BUILTINS (grep test files).
3. THEN do this brief's deletion plan (6 callers + function + 12 tests).
4. Net result: E-META-001 fires at meta-checker stage on user `^{ bun.eval(...) }` (correct SPEC behavior), `rewriteBunEval` retired (correct cleanup).

Alternate (if Step A is genuinely out-of-scope for v0.6.x): leave function + callers in place as defense-in-depth until Step A lands. The current behavior (silent fold of user `bun.eval` in `^{}`) is buggy per SPEC §22.4 but at least non-leaky.

---

## Phase 0 RE-VERIFY (Fire #12, 2026-05-26 post-Step-A 80b168e6)

Step A landed (commit `80b168e6`) — META_BUILTINS narrowed (removed `bun`, `process`, `Bun`, `console`). Bug 17 simultaneously surfaced (known-gaps HIGH) — SPEC §22.12 line 14687 reads as categorical but `checkMetaBlock` early-returns on runtime meta blocks (those without `reflect`/`emit`), bypassing META_BUILTINS gating.

Brief mandated empirical re-verify on TWO shapes:

### COMPILE-TIME shape verification (post-Step-A)

```scrml
<program>
  ${ ^{ const year = bun.eval("new Date().getFullYear()"); emit(`<p>Year: ${year}</p>`) } }
</program>
```

Compiled at `/tmp/d-step-b-test/compile-time.scrml`:
- **E-META-001 fires** on `bun` identifier (Step A regression test §11b/§18b confirmed) ✓
- **E-META-005 fires** (phase-separation violation — compile-time API + runtime-only value) ✓
- Compilation FAILS at MC stage → 2 errors

### RUNTIME shape verification (post-Step-A)

```scrml
<program>
  ${ ^{ const year = bun.eval("new Date().getFullYear()") } }
  <p>Year: ${@year}</p>
</program>
```

Compiled at `/tmp/d-step-b-test/runtime.scrml`:
- **`isServerOnlyNode` (collect.ts:467-474) classifies the meta block as server-only** via `SERVER_CONTEXT_META_PATTERNS` regex match on `/\bbun\.eval\s*\(/` (collect.ts:349)
- **W-CG-001 emitted** (Top-level meta block suppressed from client output)
- Output `runtime.client.js` is EMPTY of any reference to `bun.eval` or its rewritten literal
- **`rewriteBunEval` is NEVER called on this path** — the runtime meta block is not compile-time-classified, so `evaluateMetaBlock` (which invokes `serializeNode` and the 5 callers) is gated out at meta-eval.ts:564

### Decisive empirical test — replace function with identity

To definitively prove DEAD vs MASK, I replaced `rewriteBunEval` with `return expr;` (identity) and ran the full test suite (`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`):

- **14,567 pass / 11 fail**
- **All 11 failures in `compiler/tests/unit/bun-eval.test.js`** — the direct unit tests of the function (§1, §2, §3, §4, §6, §7, §8, §9 × 3 sub-assertions, §10, §11, §12). §5 passthrough passes since identity is correct for no-bun input.
- **Zero e2e/integration/conformance failures** — `meta-bun-eval-001.scrml` (compile-time `^{}` containing `bun.eval`) still compiles via `expr-parity.test.js` with the new E-META-001/E-META-005 diagnostic profile (compileScrml returns errors but does NOT throw → test passes).

### Bug 17 orthogonality check

`rewriteBunEval` only handles literal `bun.eval(` text. SPEC §22.12 categorical phrasing also covers `process`, `setInterval`, `fetch`. Empirical: a runtime meta block with `const x = process` slips through to client.js as `const x = process;` (will throw ReferenceError in browser). This is Bug 17 in action — **not affected by `rewriteBunEval` either direction**. The Bug 17 fix (extending META_BUILTINS gating to runtime meta blocks) is INDEPENDENT of this retirement.

### Decision (Fire #12) — DEAD, PROCEED

Evidence summary:
1. Post-Step-A, COMPILE-TIME `bun.eval(...)` in `^{}` triggers E-META-001 at MC stage; the meta-eval.ts callers still execute (pipeline doesn't bail on diagnostics) but their output is discarded
2. Post-Step-A, RUNTIME `bun.eval(...)` in `^{}` is caught by `SERVER_CONTEXT_META_PATTERNS` in `isServerOnlyNode`; meta block suppressed; `rewriteBunEval` never invoked on this path
3. Full test suite with identity `rewriteBunEval`: zero e2e/integration/conformance failures (only the direct unit tests fail, which are themselves slated for deletion)
4. SPEC §22.12 + §30.1 explicitly RETIRE the user-facing `bun.eval()` surface (S130 ratification F-003); generated output SHALL NOT contain `bun.eval()` calls
5. Bug 17 is orthogonal — `rewriteBunEval` doesn't mask it; deletion doesn't surface it

## Deletion executed (Fire #12)

1. ✓ Removed `rewriteBunEval` calls from `compiler/src/meta-eval.ts` (5 sites: bare-expr, let-decl, const-decl, return-stmt, html-fragment)
2. ✓ Removed `rewriteBunEval` import from `compiler/src/meta-eval.ts:37`
3. ✓ Removed Pass 4 caller from `compiler/src/codegen/rewrite.ts:2023` clientPasses array; replaced with retirement comment
4. ✓ Retired `rewriteBunEval` function body (rewrite.ts:528-557); kept retirement comment block with SPEC §22.12 + §30.1 + Bug 17 cross-refs
5. ✓ Updated 4 docs references in rewrite.ts (lines 1961, 1978, 2068, 2230) to retirement context
6. ✓ Deleted `compiler/tests/unit/bun-eval.test.js` (12 tests)

### Post-deletion baseline

- **14,566 pass / 88 skip / 1 todo / 0 fail** (14,655 tests across 752 files in 41.86s)
- Pre-deletion (instrumentation-clean): 14,578 pass
- Delta: −12 (matches deleted test count exactly)
- Brief expected `14,578 − 12 = 14,566`. EXACT MATCH.

### Out-of-scope artifacts (NOT touched)

- `compiler/self-host/cg-parts/section-rewrite.js` + `section-emit-wiring.js` still reference `rewriteBunEval` — per agent contract, self-host is DEFERRED post-v1.0.0 (B4); not touching
- `docs/known-gaps.md`, `docs/changelog.md`, `docs/changes/phase2-cluster-B-code-2026-05-25/progress.md` — historical narratives; left as-is (S132/S133 history)
- `SERVER_CONTEXT_META_PATTERNS[2]` `bun.eval` regex in collect.ts:349 — the original Cluster B-code Step C was an OPTIONAL retirement of this defense-in-depth pattern. Per brief NOT in this dispatch's scope. **NB: Keeping this regex is the load-bearing reason runtime `bun.eval(...)` doesn't reach client.js post-deletion.** Retiring it later would require Bug 17 fix to land first.
- Bug 17 itself — surfaced separately in known-gaps; design call open (a/c/d options); independent dispatch
