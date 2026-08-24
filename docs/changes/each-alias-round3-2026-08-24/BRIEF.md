# BRIEF — each-alias round 3: the review's blocker, an alias-validation pair, and a shadow guard

change-id: each-alias-round3-2026-08-24
dispatched: S372-bryan, 2026-08-24
base branch: `worktree-agent-ae080f493c841f360` @ `0e836a70` (10 commits off `origin/main`; merge-base `cb5db9c9`)
gap: g-each-as-alias-unbound-in-fn-body (HIGH) — the branch's own subject
DONE-PROBE: `<each …>` off-spine carriers keep working AND an `if=` on a lift-parsed `<each>` gates correctly, both proven by EXECUTING the shipped runtime chunk

## ⚑ THIS IS A FIX ROUND ON AN EXISTING BRANCH — DO NOT START FROM `main`

The work is complete through round 2 and **operator-approved to land WIDE** (see "The byte decision" below). Your job is the review's findings, not a rebuild. Fetch and continue the branch:

```
git -C "$WORKTREE_ROOT" fetch origin
git -C "$WORKTREE_ROOT" fetch <the local branch — see the dispatch prompt for how it is made reachable>
```

The dispatch prompt names exactly how to reach `0e836a70`. If you cannot reach it, **STOP and report** — do not reimplement from scratch.

## The byte decision is RULED — do not reopen it

The sweep costs **+94,765 runtime bytes corpus-wide (+0.086%)**, reconciling exactly as `+27,038` (giti033, USED) `+4,382` (derived nested-loop, USED) `+63,345` (5 × 12,669, over-pull). **PA-verified to the byte** — I compiled `conformance/cases/control-flow/if-in-dispatched-arm-neg` on both sides and measured `+12,669` exactly.

**bryan ruled: land WIDE, and the over-pull becomes its own arc.** So:
- **Do NOT narrow the sweep to `each`-tagged markup.** That option was considered and rejected: it fails OPEN (re-hides genuine off-spine dead pages).
- **Do NOT try to reclaim the 63KB in this round.** It is a separate, already-ruled arc.

⚑ One correction to the record you should carry: the over-pull is **not** strictly "unused." I measured the client bundle byte-identical base vs head for those cases — only the runtime chunk grows — and of the 9 functions the chunk adds, 8 are never referenced but **one is called**, guarded: `if (typeof _scrml_register_dispatch_remount === "function")`. At base the guard is false and the registration silently skips; at head it fires. Whether that path does anything observable is **unmeasured**. Do not repeat "unused" as fact.

## FINDING 1 — the BLOCKER. ⚑ RELAYED-UNVERIFIED. Produce the reproducer or REFUTE it.

The reviewer reports: **`if=` is silently dropped on every lift-parsed `<each>`** — `<each if=@show …>` with `@show` false renders the full list, exit 0, zero diagnostics, where main "died loudly." Locus `emit-each.ts:3373`.

**I could NOT reproduce the harm.** I tried three fixtures — a top-level `${ lift <ul><each in=@rows if=@show>… }` block, the same inside a `fn` body, and a markup-typed derived cell. Two gated correctly on BOTH sides (0 `<li>` rendered with `@show` false); the third is rejected on both sides. **So the harm is unproven and you must not assume it.**

**What I DID confirm, by reading the branch's own source:** `eachBlockFromMarkupNode` (`emit-each.ts:3363`+) reads `in`, `of`, `key`, `as` — and has **no `if` branch at all**:
```js
if (n === "in") inExprRaw = eachAttrRawText(attr.value);
else if (n === "of") ofExprRaw = eachAttrRawText(attr.value);
else if (n === "key") keyExprRaw = eachAttrRawText(attr.value);
else if (n === "as") { … }
// nothing reads `if`
```
That function is exactly what the sweep newly routes off-spine `<each>` nodes through. **So the mechanism is real; the question is whether any authorable program reaches it with an `if=`.**

**Your task, in this order:**
1. Find the fixture that actually routes an `if=`-bearing `<each>` through `eachBlockFromMarkupNode`. Instrument the function if that is faster than guessing — that is what I would have done next.
2. If it reproduces: fix it (read `if` into the node, consistent with how the structural path carries it) and add a merge-blocker test that EXECUTES and asserts the gate.
3. **If it does NOT reproduce — say so plainly and explain why the omission is unreachable.** A refuted finding is a first-class outcome here and I will take it. Do not manufacture a fix for a shape nobody can write.

## FINDING 2 — `as` alias validation, and it is a PAIR pointing opposite ways

- **Lift path (this branch):** `readEachAsAlias` accepts any bareword, so `as data-id` now **hard-fails** with `E-CODEGEN-INVALID-LOGIC`, a message naming neither `as` nor the alias. It compiled clean on main. The validator's identifier-regex exemption cannot cover it because `isOpenAttrPrefix("data-")` eats the warning first.
- **Structural/BS path (pre-existing, recorded as NEW-1 in the branch's own round-2 notes):** the SAME source at top level compiles at exit 0 and emits `(data, _scrml_each_idx) => data-id` — **a subtraction of two undefined names.** Silently wrong, which is worse.

**Both are the same missing rule: an `as` alias must be a valid identifier.** Fix the lift path here with a NAMED diagnostic that says `as` and says the alias. ⚑ `ast-builder.js` is **OUT of your write-set** (see below), so the BS path is not yours to fix — **file it** with the reproducer and say so.

## FINDING 3 — no shadow guard on the alias

The alias becomes the per-item factory parameter with no shadow check: `as document` → `TypeError: document.createDocumentFragment is not a function`, dead bundle, exit 0. Pre-existing on the structural path, **newly reachable via lift**, which makes the reachability yours. A named diagnostic on a shadowing alias is the fix; reuse whatever reserved/global-shadow machinery already exists rather than inventing a list.

## FINDING 4 — two tests are VACUOUS

In `compiler/tests/unit/each-as-alias-attr-allowlist.test.js:107`, the `fn-body carrier` and `ternary-markup carrier` tests pass whether or not the exemption exists (reverting it gives 4 pass / 3 fail and those two still pass), because VP-1 never reaches either carrier — a genuinely bogus attribute in a `fn` body emits no `W-ATTR-001` either. `CONSISTENCY` is half-blind for the same reason. **Either make them bite or delete them.** A test that cannot fail is worse than no test: it reads as coverage.

## FINDING 5 (PLAUSIBLE, not confirmed) — a closure claim in a comment is false

The sweep's comment claims "a fifth carrier tomorrow is covered without a fifth edit." The reviewer says it stops at any `STRUCTURAL_AST_KINDS` node, and `return-stmt` / `lift-expr` are both on that list — they work only because they happen to be spine roots. No live repro was found. **Verify; if true, correct the comment.** A false closure claim in a comment is how the next author stops looking.

## Method requirements

- **Mount the SHIPPED runtime chunk** (`result.runtimeFilename`), never `runtime-template.js`.
- ⚑ **Vary the declaration form before concluding.** This cost two rounds on a sibling dispatch today: a measurement taken on a markup-typed field (`= <input/>`) did not hold for a literal-initialised one (`= ""`), and a fix was approved on the narrow reading. When a fixture has a declaration form, vary it.
- Corpus differential both sides from `git worktree add` project roots — **exit 2 is NOT-A-VALID-COMPARISON, never "no differences."** Expect the existing delta to survive; a NEW artifact means you moved something, so stop and report.
- Bite-prove each fix independently on the COMMITTED state. **No `git stash`** — a mid-flight stash destroyed real work at S365.

## Write-set — HARD BOUNDARY

**MAY write:** `compiler/src/codegen/emit-each.ts` · `compiler/src/codegen/emit-client.ts` · `compiler/src/validators/attribute-allowlist.ts` · test files under `compiler/tests/` · `docs/changes/each-alias-round3-2026-08-24/progress.md` · the branch's existing `docs/changes/each-as-alias-in-fn-body-2026-08-24/progress.md`.

**MUST NOT write:** `compiler/src/ast-builder.js` (the BS-path alias bug is FILED, not fixed here) · `docs/known-gaps.md` (the PA owns the ledger this session — report your entries and I will author them) · `compiler/SPEC.md` · `compiler/src/type-system.ts` · `compiler/src/api.js` · `compiler/src/codegen/emit-event-wiring.ts` · `compiler/src/codegen/emit-expr.ts` (a sibling dispatch holds the last two).

## Crash recovery

Commit after every meaningful unit — WIP commits expected, the branch is your only anchor. Append timestamped lines to `progress.md`. NEVER `--no-verify`.

## Final report

WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · **FINDING 1 VERDICT (reproduced / REFUTED, with the fixture either way)** · per-finding disposition · DIFFERENTIAL (count + exit code) · BITE_PROOF per fix · DIRECTION_OF_CHANGE · gap entries you want me to author · DEFERRED.
