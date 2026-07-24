# BRIEF — #162 `g-multistatement-line-nonfirst-call-drop` (HIGH, silent codegen data-loss)

**Dispatched:** S284, 2026-07-24 · base `origin/main` `867971bd` · agent `scrml-js-codegen-engineer` (opus, isolation:worktree, bg)
**Change-id:** `multistatement-line-call-drop-2026-07-24` · **Adopter issue:** GH #162 (pjoliver11) · **Gap:** `g-multistatement-line-nonfirst-call-drop`

---

## TASK — fix direction is RULED, do NOT re-litigate it

A call expression that is **not the first statement on a SAME-LINE, space-separated multi-statement run** is silently DROPPED from the emitted JS by the **default/legacy pipeline** (block-splitter + Acorn). Clean build, 0 errors, NO warning. Assignments in the same position survive.

**Fix direction = CONFORMANT-REJECT (bryan-ruled S284).** Make the legacy pipeline **FIRE A HARD DIAGNOSTIC** on a same-line multi-statement run (two statements juxtaposed on one line separated only by whitespace, no `;`/newline), instead of silently swallowing/dropping part of it. This matches the SPEC (§4) and the native parser, which ALREADY rejects it. **Do NOT "make it lower every statement"** — that path was considered and rejected (it would widen a legacy↔native divergence, anti-V1-conformance, and is newly-accepting-beyond-the-contract with no governing sentence). Your job is to REJECT the form, not to make it work.

## CONFIRMED SYMPTOM (findings — PA-reproduced on `f28c35fb`, do not re-derive)

Repro (also at `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/f8a112af-bf6e-482c-bd4f-341731e409a9/scratchpad/repro/issue162.scrml`):
```scrml
${
    function probe() {
        let log = []
        let a = 0
        let b = 0
        if (a == 0) { a = 1 b = 2 log.push("A") }     // assignment assignment CALL
        if (a == 1) { log.push("B") a = 3 }           // CALL assignment
        if (a == 3) { a = 4 log.push("C") b = 5 }     // assignment CALL assignment
        if (a == 4) { log.push("D") }                 // CALL alone — control
        if (a == 4) { log.push("E1") log.push("E2") } // CALL CALL
        return log.join(",")
    }
}
<div id="out">${probe()}</div>
```
Emitted TODAY (`bun compiler/bin/scrml.js compile`): `a = 1; b = 2;` (push A dropped) · `log.push("B"); a = 3;` (kept — call first) · `a = 4; b = 5;` (push C dropped) · `log.push("D");` (kept — alone) · `log.push("E1");` (push E2 dropped). `probe()` returns `"B,D,E1"` — should be `"A,B,C,D,E1,E2"`. Rule: any call NOT first on a same-line multi-statement run is discarded; assignments survive.

## GOVERNING SENTENCE (findings — Rule 4 satisfied)

- **§4 / `E-STMT-MISSING-SEMICOLON`** — "Expected `;` or a newline to end the statement." A same-line space-separated multi-statement run is ILL-FORMED by that rule.
- **The native parser (`--parser=scrml-native`) ALREADY rejects the repro** with 6× `E-STMT-MISSING-SEMICOLON`. Confirm: `bun compiler/bin/scrml.js compile <repro> --parser=scrml-native`. So this is a **legacy↔native conformance bug**: the legacy path silently partial-lowers a form the native path correctly rejects. Your fix brings legacy into conformance with native + §4.

## MECHANISM (HYPOTHESIS — you VERIFY the exact locus; do not trust these blindly)

- The boundary logic is the same path **S167 `75431e9e`** touched — that fix landed in **`compiler/src/ast-builder.js`** (+51 lines), teaching the depth-0 statement-boundary check to recognize assignment + dotted-reactive (`@obj.path=`, `@arr.push()`) forms as boundaries. A **bare LOCAL call-expression-statement start** (`log.push(...)`) was NOT covered. Read `git show 75431e9e` to see the exact boundary block, then find where a same-line juxtaposed statement is currently swallowed/dropped rather than rejected.
- There is an **EXISTING stopgap** at `compiler/src/expression-parser.ts:2943-2951` — a `console.warn("statement boundary not detected — trailing content would be silently dropped: …")`. The codebase already knows this class exists as a `console.warn` (NOT a real diagnostic). Reconcile with / upgrade this — a `console.warn` is not adopter-visible and does not fail the build; the fix must emit a real diagnostic in `result.errors`.
- **CODE-HOME QUESTION (survey + surface, do not decide blind):** the legacy pipeline should fire either (a) the SAME `E-STMT-MISSING-SEMICOLON` code the native parser uses (it already has a §34.1 catalog row and describes exactly this — the cleanest, per named-codes discipline), or (b) a legacy `E-PARSE-*` sibling if wiring the §34.1 native code into the legacy diagnostic stream is structurally wrong. Pick the one that fits the legacy diagnostic machinery; state which and why in `progress.md`. If it needs a NEW §34 row, land the catalog row WITH the impl (named-codes-land-with-impl).

## SCOPE + THE REGRESSION GUARD (critical — do not over-reject)

**ONLY same-line space-separated multi-statement runs error.** NEWLINE-separated multi-statement MUST stay working — this was empirically disambiguated and is a HARD regression guard:
- `/tmp/.../scratchpad/repro/issue162-newline.scrml` (flat body AND inside an `if` block, calls on separate lines) currently compiles with ALL calls preserved. It MUST still compile clean after your fix with all calls preserved. If your change makes newline-separated calls error, you have over-rejected — back off.
- The intended NEW behavior: same-line multi-statement (INCLUDING same-line multi-assignment `a = 1 b = 2`, which lowers fine today) now errors. That is the ruled cost.

## CORPUS MIGRATION (measure; expected ≈0)

A filtered grep of tracked `samples/`, `examples/`, `stdlib/` found **0** same-line multi-statement `.scrml` sites — so the newly-rejecting change is expected to break ≈0 shipped corpus. VERIFY this: run the FULL suite (`bun run test`) and confirm 0 NEW failures. If any fixture/sample uses the same-line form and now errors, migrate it (add `;` or newlines — mechanical) and note each in `progress.md`. Report the final migrated-file count (assumed-zero ≠ measured-zero).

## VERIFICATION BAR (all required before reporting DONE)

1. **The #162 repro now ERRORS** (a real diagnostic in `result.errors`, adopter-visible) instead of silently emitting `"B,D,E1"`. No more clean-build-wrong-output.
2. **Regression guard GREEN:** `issue162-newline.scrml` still compiles clean, all 4 calls (A/B/C/D) preserved in emitted JS.
3. **Legacy↔native parity:** the legacy pipeline now rejects the same construct the native parser rejects (spot-check both `--parser` modes agree on the repro).
4. **Full suite green:** `bun run test` — 0 new failures (report the number). Any corpus migration noted.
5. **R26:** recompile the two scratchpad repros + at least one real adopter source (`scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`) on your post-fix baseline; confirm no spurious new errors on legitimate newline-separated code.
6. Unit test(s) covering the new diagnostic: same-line multi-assignment errors, same-line assignment-then-call errors, same-line call-then-call errors, AND the newline-separated forms stay clean (the guard). Put them where the legacy-parse diagnostic tests live.

Do NOT mark DONE without 1–6. The PA runs an independent adversarial `/code-review high` + R26 on your branch before landing (S239 gate) — a green self-report is not the bar.

## F4 — CRITICAL STARTUP VERIFICATION + PATH DISCIPLINE (do this FIRST, before any edit)

`[PATH-DISCIPLINE INCIDENT COUNTER: 0]`
1. **Confirm isolation.** Run `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Run `git rev-parse --show-toplevel` — it MUST equal that worktree root. If EITHER is the shared checkout `/home/bryan-maclee/scrmlMaster/scrml`, STOP and report — do not write.
2. **Confirm clean tree** (`git status --short` empty) and note your branch + base SHA.
3. **Deps + fixtures:** `bun install` (worktrees do NOT inherit `node_modules` — the hook fails "cannot find package 'acorn'" otherwise). `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`). Use `bun run test` (chains pretest) for the full-suite baseline, NOT bare `bun test`.
4. **Every write uses a worktree-ABSOLUTE path under the worktree root.** Never a relative path (resolves against the shared checkout via additional-working-dirs), never a `/home/bryan-maclee/scrmlMaster/scrml/...` main-rooted path. Never `cd` into the shared checkout — use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`. Prefer editing via Bash on absolute worktree paths (echo before, `git diff` after) over Edit/Write where practical.
5. **First commit** message: `WIP(multistatement-call-drop): start at $(pwd)` so the PA can verify the prefix on landing.

## CRASH-RECOVERY (mandatory)

Commit after EACH meaningful change (WIP commits expected — the branch is the checkpoint). Maintain an append-only timestamped `progress.md` in the worktree: what you just did, what's next, blockers, and your survey findings (the exact fix locus, the code-home decision, the corpus-migration count). If you die, the branch + progress.md are the only recovery anchor.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first; follow its Task-Shape Routing to the parser/codegen maps. Map stamp is `e8fdd44c` (~8 commits behind HEAD `867971bd` — the intervening S282 landings were audits + test-side + SPEC, low risk to the parser core). Treat map content as a verify-against-source HYPOTHESIS for anything you touch; report the load-bearing finding ("not load-bearing" included).

## REPORT ON DONE

Report: WORKTREE_PATH · final branch tip SHA · files-touched · the exact fix locus (file:line) · the code-home decision (which diagnostic code + why) · corpus-migration count · full-suite result (pass/fail numbers) · the verification-bar results 1–6 · any deferred items. Your final text IS the return value — raw data, not a human-facing message.
