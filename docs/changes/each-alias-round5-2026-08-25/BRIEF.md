# BRIEF — each-alias round 5: the opener-`if=` gate is broken for ITEM-SCOPED predicates

change-id: each-alias-round5-2026-08-25
dispatched: S375-bryan, 2026-08-25
base branch: `origin/feat/each-alias-round4` @ `e94ce54b` (round-4 tip; 13 commits off `origin/main`)
gap: g-each-as-alias-unbound-in-fn-body (HIGH) — the branch's subject; R5-1 below is a NEW regression the round-4 fix introduced
DONE-PROBE: `bun compiler/bin/scrml.js compile docs/changes/each-alias-round5-2026-08-25/repro-item-scoped.scrml --output-dir /tmp/r5probe 2>&1 | grep -qE 'E-EACH-OPENER-IF-ITEM-SCOPED|error' && echo PASS || echo FAIL`

---

## ⚑ THIS IS A FIX ROUND ON AN EXISTING BRANCH — DO NOT START FROM `main`

The work is complete through round 4 and **operator-approved to land WIDE**. Your job is R5-1/R5-2/R5-3
below, not a rebuild.

**Step 1, before anything else — reach the base and this brief:**

```
git -C "$WORKTREE_ROOT" fetch origin feat/each-alias-round4 brief/s375-each-alias-round5
git -C "$WORKTREE_ROOT" checkout -B each-alias-r5 FETCH_HEAD   # see note
git -C "$WORKTREE_ROOT" checkout origin/brief/s375-each-alias-round5 -- docs/changes/each-alias-round5-2026-08-25/
```

Your worktree is cut from `origin/main`, **not** from this brief's branch and **not** from the round-4
tip — so neither is present until you fetch. Base your work branch on
`origin/feat/each-alias-round4` (`e94ce54b`). Verify with
`git -C "$WORKTREE_ROOT" log --oneline -1` → must read `e94ce54b fix(each): ROUND-4 F3 …`.
**If you cannot reach `e94ce54b`, STOP and report** — do not reimplement from scratch.

## The byte decision is RULED — do not reopen it

The sweep costs **+94,765 runtime bytes corpus-wide (+0.086%)**. bryan ruled: **land WIDE, and the
over-pull becomes its own arc** (`g-chunk-reachability-is-approximated-not-computed`, HIGH, filed).
Do NOT narrow the sweep to `each`-tagged markup (it fails OPEN). Do NOT try to reclaim the 63 KB here.

---

## FINDING R5-1 — the BLOCKER. **PA-REPRODUCED BY EMISSION. Direction measured on both sides.**

`emitEachOpenerIfGuardLines` (`emit-each.ts:3366`) lowers the opener predicate with
`lowerEachExpr(raw, scopeVar)` and emits the guard **inside `_scrml_effect(...)` but OUTSIDE
`_scrml_reconcile_list`'s per-item callbacks** — i.e. at a point where no item variable is bound.
For an ITEM-SCOPED predicate that produces broken output two different ways.

I compiled both fixtures on `e94ce54b` and on `origin/main` `8731799d`. Fixtures are committed
beside this brief as `repro-item-scoped.scrml` and `repro-atdot-scoped.scrml`.

### Case A — `as`-alias predicate. **REGRESSION.**

```scrml
<each in=@rows as it key=it if=it>
```

Emits, at `_scrml_listing_2` in the `.client.js`:

```js
_scrml_mount_track(_scrml_effect(() => {
  // SPEC 17.1.2 opener if= — gate the WHOLE list; collection stays unread while false.
  if (!(it)) {                                   // <-- `it` is a FREE IDENTIFIER here
    _scrml_each_clear(_scrml_each_mount_1);
    return;
  }
  const _scrml_each_items_2 = _scrml_cs_reactive_get("rows");
  ...
  _scrml_reconcile_list(
    _scrml_each_mount_1,
    _scrml_each_items_2,
    (it, _scrml_each_idx) => it,                 // <-- `it` first binds HERE, 13 lines later
```

`_scrml_effect` has no `try`/`catch`, so the `ReferenceError` propagates out of the module body —
**whole client dead**. Compile is **exit 0, zero diagnostics**.

**Measured direction:** at `origin/main` the same source emits **zero guards** — the list renders
ungated (fail-OPEN) but the page is ALIVE. So round 4 converted fail-open into a dead page. **This is
a REGRESSION, and I established it by compiling both sides on a fixture where base actually renders.**
⚑ The prior session recorded this as "regression framing UNCONFIRMED" because their fixture was
already dead at base from the chunk-pruning gap. That caveat is now discharged — but note *why* it was
right to record it: do not inherit my verdict either, re-run the two compiles yourself first.

### Case B — the canonical `@.` sigil. **NOT a regression, but a live fail-OPEN gap.**

```scrml
<each in=@rows key=@. if=@.>
```

Emits **zero guard lines** — `grep -c 'opener if=' → 0`, on BOTH sides. The §17.1.2 gate silently
vanishes on `@.`, which §17.7.3 makes THE canonical current-item sigil. Same emission at base, so it
is pre-existing, not caused by round 4. It is an instance of R5-3 below.

### ⚑ The design question — answer it, do NOT paper over it

**SPEC §17.1.2.1 says an opener `if=` on `<each>` gates the WHOLE list and that "the iterated
collection is not read" while false.** An ITEM-scoped predicate at that position is a *category
error*: there is no item at the moment the gate must decide, so there is nothing coherent to lower.

So the fix is probably **NOT** "bind the item and make it work" — that is newly-ACCEPTING (a one-way
door, base §8) for a shape that cannot mean anything under the governing sentence. It is far more
likely **"refuse it with a named diagnostic"**, which is newly-REJECTING and therefore reversible.
Apply the base FORK RULE in order: limit-vs-widen → **limit wins**; fail-open-vs-closed → **closed
wins**; reversible → **newly-rejecting is the reversible direction**; root-vs-position → fix it where
the predicate is classified, not per call site.

**REQUIRED before you write the fix — the governing-sentence gate (base Rule 4).** Read §17.1.2,
§17.1.2.1, §17.1.2.3 and §17.7.3 **in full** and either (a) QUOTE the sentence that governs an
item-scoped predicate in opener position, with its section number, or (b) record explicitly
*"searched §17.1.2, §17.1.2.1, §17.1.2.3, §17.7.3 — no governing sentence found."* Outcome (b) is a
FINDING, not a formality: it makes this a RULING for bryan rather than a fix you may scope yourself.
**If you land in (b), implement the fail-CLOSED diagnostic anyway** (it is the reversible direction and
it replaces a dead page), and say plainly in your report that the *shape* question is owed to bryan.

**REQUIRED — measure the migration.** A newly-rejecting change owes a measured corpus count, not an
assumption. Grep `samples/`, `examples/`, `conformance/cases/`, `stdlib/` and `docs/` for `<each`
openers carrying `if=`, and classify each as program-scoped (must keep working) vs item-scoped (newly
rejected). **Report the count and the file list.** Assumed-zero is not measured-zero.

**Both scoping directions must keep their current correct behaviour** — the branch's own
`g-each-opener-if-lift-path.test.js` covers the program-scoped `if=@show` case across 11 carriers.
Those must stay green, and note that **every one of them uses a scope-var-free predicate**, which is
exactly why this class survived four rounds.

---

## FINDING R5-2 (MED) — the factory-name validator is one name short of its own claim

`EACH_FACTORY_ALWAYS_EMITTED` holds only `document`, but `_itemFrag` is emitted just as
unconditionally in the per-item factory. So `as _itemFrag` passes all four validator arms and then
produces the exact *"This is a compiler defect … please report it"* message the validator exists to
prevent. Either add the name, or — better, and preferred — derive the set from the emitter rather than
hand-maintaining a list, since a hand-maintained list of names the emitter unconditionally binds is the
same approximation-walker shape this session is converging elsewhere. If you derive it, say how.

## FINDING R5-3 (LOW) — the guard emitter fails OPEN on an unrecognised value shape

`emitEachOpenerIfGuardLines` returns `[]` when `lowerEachExpr` yields empty — silently dropping the
gate. §17.1.2.3 names fail-OPEN as the dangerous direction for exactly this attribute. Case B above is
a live instance. Make the drop loud (a named diagnostic) rather than silent. A bareword `if` and the
`@.` sigil are both reachable inputs; there may be others — enumerate what you find rather than
claiming closure.

---

## Owed at landing, but OUT of your write-set — report, do not write

- The **§34 catalog row for `E-EACH-AS-ALIAS-INVALID`** (round 4 emits the code; the row is unwritten).
  Ready-to-paste text is in `docs/changes/each-alias-round3-2026-08-24/`. `compiler/SPEC.md` is not
  yours — hand me the row text and I will land it.
- Any NEW code you mint in R5-1/R5-3 needs its own §34 row + a Rule 4b `prov=` field. **Name the code
  and hand me the row**; do not edit SPEC.
- **Six gap entries** the round-4 agent asked to have authored, plus anything you find. I own
  `docs/known-gaps.md` this session — report entries, do not write them.

## Method requirements

- **Mount the SHIPPED runtime chunk** (`result.runtimeFilename`), never `runtime-template.js`. A
  browser-tier check that evals the full `SCRML_RUNTIME` template masks every chunk-pruning defect —
  this is the S371 correction and it has already masked a filed row once.
- **Execute the bundle.** "The marker is present in the emitted text" is not verification; a load-time
  `ReferenceError` kills the page with the marker sitting right there. R5-1 is precisely that shape.
- ⚑ **Vary the declaration form before concluding.** A measurement taken on one declaration form did
  not hold for another twice in the last two sessions, and a fix was approved on the narrow reading
  both times. Vary `as`-alias vs `@.` vs member-access (`@.on`, `it.on`) vs program-scoped.
- **Corpus differential both sides** from `git worktree add` project roots — **exit 2 is
  NOT-A-VALID-COMPARISON, never "no differences."** The existing round-4 delta should survive; a NEW
  artifact means you moved something — stop and report.
- **Bite-prove each fix independently on the COMMITTED state.** **No `git stash`** — a mid-flight stash
  destroyed real work at S365.
- **NEVER `--no-verify`**, and never override `core.hooksPath`.

## Crash recovery — read this, the last round lost its report to it

Commit after **every** meaningful unit; WIP commits are expected and the branch is your only anchor.
Append timestamped lines to `docs/changes/each-alias-round5-2026-08-25/progress.md` as you go.

⚑ **The round-4 agent stalled at 600s during REPORTING, not during work** — all its fixes were
committed and its worktree clean, but the report never arrived, so its differential and bite proof are
unverified to this day. **Write your final report into `progress.md` and COMMIT IT before you emit it
as your reply.** If you stall, the record survives.

## Write-set — HARD BOUNDARY

**MAY write:** `compiler/src/codegen/emit-each.ts` · `compiler/src/codegen/emit-client.ts` ·
`compiler/src/codegen/emit-lift.js` · `compiler/src/validators/attribute-allowlist.ts` ·
`compiler/src/attribute-registry.js` · test files under `compiler/tests/` ·
`docs/changes/each-alias-round5-2026-08-25/progress.md`.

**MUST NOT write:** `compiler/SPEC.md` · `docs/known-gaps.md` · `compiler/src/ast-builder.js` ·
`compiler/src/type-system.ts` · `compiler/src/api.js` · `compiler/src/codegen/emit-event-wiring.ts` ·
`compiler/src/codegen/emit-expr.ts` · `.claude/maps/`.

## Final report

WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · **R5-1: the governing-sentence gate outcome, quoted or
recorded-as-searched** · **R5-1 direction-of-change + the MEASURED migration count and file list** ·
per-finding disposition · DIFFERENTIAL (count + exit code) · BITE_PROOF per fix (what you executed,
not what you grepped) · any code you minted + its §34 row text · gap entries you want me to author ·
DEFERRED · **anything in this brief you found to be WRONG** — three of four rule-shape instructions in
a sibling dispatch yesterday were the PA's error, and the dispatch out-measured me every time. Say so.
