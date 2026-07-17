# REINTEGRATE — sPA ss75: conformance authoring, control-flow §17 + linear §35

**List:** `spa-lists/ss75-conformance-control-flow-linear-17-35.md`
**Branch:** `spa/ss75` · **Tip:** `7b7da562` · **Base:** `752574d9` · **Merged current main `8d537c3f` (S260) — clean**
**Worktree:** `../scrml-spa-ss75` · **Not pushed. Main never advanced by me.**
**Progress detail (READ THIS — the findings are the real output):** `spa-lists/ss75.progress.md`

> **Main moved under this list and I re-verified against it.** You (S260) landed `fefbdeaa`
> *"spec(§34): correct catalog rows vs impl"* + `0887e18f` (edits `ast-builder.js` **and**
> `type-system.ts`) while my dispatches ran. Since that is exactly the surface my findings sit on, I
> merged `8d537c3f` into `spa/ss75` (**clean, zero conflicts** — main touches neither `control-flow/` nor
> `linear/`) and **re-ran every probe against merged main**. **8 of 9 findings survive; 1 sub-claim you
> already fixed is withdrawn** (details below). Post-merge: **run.ts 691/691, bridge 692 pass / 0 fail.**

## Bottom line

**24 cases landed across 12 of 14 codes; 2 codes parked; run.ts 687/687, 0 fail.**

But the headline is not the corpus. **Three tier-1 §17/§35 diagnostics are unenforceable today, and two
of them are dead code that has never fired in any version.** The "UNCOVERED" label on this list was
hiding real soundness holes — golden-capturing would have papered over all of them with green cases.
Both dispatches hit the "SANITY-CHECK vs SPEC → do NOT enshrine" wall and correctly refused.

## Verification (sPA-run, not taken from agent reports)

- **Post-merge with main `8d537c3f`:** `bun conformance/run.ts` → **691/691 pass, 0 fail**; gated bridge
  → **692 tests, 0 fail**. (Pre-merge: 687/687 and 688 — 663 baseline + 15 control-flow + 9 linear.)
- Both agents independently reported the full gate green (20453 / 20446 pass, 0 fail)
- Every commit non-empty (`git show --stat` per SHA); branch diff touches **only**
  `conformance/cases/{control-flow,linear}/`, `docs/changes/ss75-*`, `spa-lists/ss75*`.
  **No compiler-source touched. No main leak** (verified both directions).
- **Both blockers re-probed on merged main** — still SILENT. Findings are current, not base-stale.

## Landed — per-item

| # | Code | Cases | SHA (cherry-picked onto `spa/ss75`) |
|---|---|---|---|
| 1 | `E-CTRL-001` | `ctrl-001-orphan-else-{pos,neg}` | `042a9224` |
| 2 | `E-CTRL-002` | `ctrl-002-orphan-else-if-{pos,neg}` | `23e9a469` |
| 3 | `E-CTRL-003` | `ctrl-003-extend-past-else-{pos,neg}` | `937d7641` |
| 4 | `E-CTRL-004` | `ctrl-004-else-on-state-opener-neg` — **neg only** | `471c9f77` |
| 5 | `E-CTRL-005` | `ctrl-005-else-and-if-same-element-{pos,neg}` | `5b1b2918` |
| 6 | `E-CTRL-011` | `ctrl-011-for-in-{pos,neg}` | `81e2be69` |
| 7 | `E-CONTROL-FLOW-IN-MARKUP` | `ctrl-012-bare-control-flow-in-markup-{pos,neg}` | `020849ea` |
| 8 | `E-LOOP-007` | `loop-007-while-as-expr-{pos,neg}` | `2a76604e` |
| 9 | `E-LIN-001` | `lin-001-never-consumed-{pos,neg}` | `8608c02a` |
| 10 | `E-LIN-002` | `lin-002-consumed-in-loop-{pos,neg}` + `lin-002-double-use-pos` | `e39d9a3d` + `7610107f` (sPA) |
| 11 | `E-LIN-003` | `lin-003-branch-asymmetry-{pos,neg}` | `30295944` |
| 12 | `E-LIN-006` | `lin-006-deferred-ctx-{pos,neg}` | `07ed9063` |

## PARKED

| # | Code | Reason |
|---|---|---|
| 4 (pos) | `E-CTRL-004` | **Dead code — provably unreachable.** Needs a compiler-source fix. Neg landed; pos written, ready on a ruling. |
| 13 | `E-TILDE-001` | **Structurally unreachable** — the AST nodes the checker keys on are produced by nothing. |
| 14 | `E-TILDE-002` | Same. |

## The three blockers (all sPA-verified independently — static + empirical)

### A. `E-CTRL-004` has never been able to fire [SOUNDNESS HOLE] — *re-verified on `8d537c3f`*

`ast-builder.js` breaks out of the chain scan unless `sibling.kind === "markup"` (`:17575`), then asks at
`:17578` whether that same kind is `"state"` / `"state-constructor-def"`. **Provably always false.**
(Lines are **current-main**; `0887e18f` shifted them from `17566`/`17569` — the structure is unchanged.)

```scrml
${ <flag> = true }
<p if=@flag>yes</>
<counter else> = 0        // §17.1.1 + §17:10403 + §34:18296 ALL mandate Error
```
→ emits **`["W-PROGRAM-001"]`** only. **`E-CTRL-004`: SILENT.** `else` on a state opener is silently
accepted today. **Likely fix: hoist the E-CTRL-004 test above the `:17566` guard.**

### B. `E-TILDE-001/002` are structurally unreachable — and *look* covered [THE R26 TRAP]

`type-system.ts` dispatches E-TILDE on AST kinds `tilde-init` / `tilde-ref`. **No producer anywhere in
`compiler/src` or `compiler/native-parser` constructs them.** The parser gates `~` behind a value-lift
window (outside it, `~` is bitwise NOT). 14 probe shapes — including SPEC §32.5/§32.7 **verbatim invalid
examples** — emit zero E-TILDE codes.

**Why this matters beyond the two codes:** `compiler/tests/unit/type-system.test.js:1747+` hand-builds
`{kind:"tilde-init"}` AST literals, so the codes **appear covered and stay green over a dead path**.
`emit-expr.ts:702-713` carries a `null /* ~ orphaned */` codegen fallback *because* E-TILDE-001 never
fires, and `tilde-carry-forward.test.js:192` already documents the gap verbatim. Authoring negs here
would have been **false-green** — passing because the feature is dead, not because the shape is legal.

### C. `E-LOOP-007` is silent on §49.4.4's own worked example [landed, but narrower than SPEC]

`type-system.ts:18672` *additionally* requires the while body to **contain `lift`**. So:

```scrml
${ <n> = 0
   let x = while (@n < 3) { @n = @n + 1 } }   // §49.4.4's OWN parenthetical example
```
→ emits **`["W-PROGRAM-001"]`** only. **`E-LOOP-007`: SILENT** — despite §49.4.4 + §34 + §49.9 mandating
it. The impl's own comment concedes the narrowing works around an **upstream ast-builder misparse** that
absorbs an unrelated while-statement into a preceding let-decl's init.

**There is no input where the SPEC unambiguously mandates an E-LOOP-007 fire AND impl#1 fires.** The
landed pos is grounded in the `lift`-bearing form the impl does catch.

## Additional findings — a bidirectional sweep the list's scope did not cover

Ran impl-live→SPEC **and** SPEC-registry→impl over all three families. **The list's implicit "these 14 are
the tier-1 set" claim fails in both directions.**

| | live in `compiler/src` | in SPEC §34 registry |
|---|---|---|
| `E-CTRL-*` | 001,002,003,004,005,**011** | 001,002,003,004,005,**010**,011 |
| `E-LIN-*` | 001,002,003,**005**,006 | 001,002,003,**004**,005,006 |

1. **`E-LIN-005` is excluded on a false premise — a real coverage hole.** The list says "RESERVED". It is
   **SHALL-mandated** (§34 row `18319`; full §35.5 prose + worked example `18911-18953`) **and
   implemented** (`type-system.ts:7737`, honoring the spec's same-scope carve-out). The "reserved" idea
   traces to a **stale §6.7.12 note** (`SPEC:4868`) that the registry explicitly supersedes at `18319`.
   **Recommend a follow-on item.** *(Also: `18319` cites the emit site as `:3355`; it is `:7737`.)*
2. **`E-CTRL-010` — SHALL NOT accept (§17.2, `SPEC:10599`), Error. Zero emit sites.** Inside §17 — a hole
   in this list's own named section. sPA-verified: bare `for` + `else` emits only `W-PROGRAM-001`.
   Reproducer in the progress file.
3. **`E-LIN-004` — SHALL, Error (§34 row `18423`). Zero emit sites.** The recurring/deferred-ctx form of
   E-LIN-002 ("a callback that fires N times consumes the binding N times"). **Overlaps the live
   E-LIN-006** — the impl may have covered part of E-LIN-004's mandate under a different number.
4. **`E-DG-002` false-fires on the SPEC §17.1.1 sugar.** `if=`/`else` fires "no readers", while §17.1.1's
   **own given desugaring** is clean — yet §17.1.1 declares `if=` **is** sugar over that form. Boundary is
   the if-chain collapse hiding the `@var` read from DG reader-accounting. Sibling of the acknowledged SB1
   class (`dependency-graph.ts:364`). **Your `fefbdeaa` correction sharpens this**: the row now states the
   trigger as *"declared but never consumed — no reader edge (`readers.size === 0`)"*, which is exactly
   what the collapse defeats. Your new `conformance/cases/reactive/dg-002-no-readers-pos/` covers the
   **no-readers** path, not this sugar false-fire.
   > **⚠ WITHDRAWN sub-claim.** My agent also reported *"§34:18285 registers E-DG-002 as Error; it emits
   > warning."* True at base `752574d9` — **but `fefbdeaa` already corrected that row to Warning** (along
   > with its trigger and drifted self-cite). **Do not re-file it.** Flagging explicitly because it would
   > otherwise read as a live finding you'd already closed hours earlier.
5. **`E-TILDE-001`'s message prescribes a fix the SPEC forbids** — *"Add `~ = <value>`"*, but §32.2 lists
   only two initializers and §35.2 makes `lin` bindings immutable (`~` is a `lin`, §32.3).
6. **SPEC §35.4 editorial defect** — child headers mis-numbered `34.4.x`; cross-refs in §35.3/§35.5 point
   at "§34.3"/"§34.4.3". Cases cite the logically-correct §35.4.x.
7. **§34's E-CTRL-011 row cites stale emit lines** (`4087-4093, 6517-6519`); live sites are `8084`+`12313`.
8. **`E-TILDE-001/002` are §32-governed, not §35** — the live messages cite §32 themselves. The list files
   them under §35; dispatch B was corrected to cite §32.

## Rulings needed (PA/user — the sPA did not decide any of these)

1. **`E-CTRL-004`**: hoist the test above the `:17566` guard (source fix), or amend the SPEC? Pos is ready.
2. **`E-TILDE-001/002`**: wire `tilde-init`/`tilde-ref` (or lower `~` into the tracker), then items 13-14
   become authorable. Also: fix the §32.2-contradicting message text.
3. **`E-LOOP-007`**: fix the upstream ast-builder misparse so the TS check can un-narrow? And tighten the
   §34:18062 / §49.9:25343 rows, which read literally as the *inverse* of §49.4.4's prose.
4. **`E-LIN-005`**: add as a follow-on item (recommended) — it is a live SHALL-mandated tier-1 code.
5. **`E-CTRL-010` / `E-LIN-004`**: implement, or retire the registry rows. Both are **impl-missing-a-SHALL**
   (an *absence*, not a divergence) → **not authorable as conformance cases**; a pos would assert a code
   that can never fire. **Compiler-source work — deliberately out of scope for a conformance-data list.**
6. **`E-DG-002`** (#4 above): separate dispatch — the sugar/desugaring asymmetry + the Error-vs-warning
   partition mismatch.

## Coverage caveats — no silent truncation

- **`E-CTRL-011`**: two fire sites (`8084`, `12313`); the pos exercises **`8084` only**. `12313` uncovered.
- **`E-LOOP-007`**: pinned in the `lift`-bearing form only (blocker C).
- **`E-LIN-002`**: both triggers now pinned — loop (`§35.4.4`) by the agent, **primary double-use
  (`§35.5`) by the sPA** (`7610107f`). The registry states double-use as the code's *whole* condition
  (`SPEC:17968`), so the agent's brief-faithful loop-only coverage left the more important half open.
  **My brief named the loop emit site — the brief was the defect, not the agent's work.** (The list's own
  pointer for item 10, `:17457`, is not an emit site at all.)
- **`severity`** is assertable on **pos twins only** — `run.ts:221` records a mismatch when a `severity`
  entry names a code that did not fire. The list's "severity per code" is satisfiable on the pos half only.

## ENV-GAP for re-integration (will bite you)

A **fresh worktree has no `node_modules`** (gitignored). `bun conformance/run.ts` resolves anyway, but the
**gated bridge fails at import** — `Cannot find module '@happy-dom/global-registrator'` — which surfaces
as a **red pre-commit hook that looks exactly like a broken test**. It is neither a regression nor a case
defect. Fix: `ln -s <main>/node_modules node_modules` in the worktree (gitignored, never committed). After
that: bridge 673→688 pass, 0 fail. **Same class as the known "sPA worktree lacks gitignored `dist`" gap —
worth folding into the sPA boot procedure so it is not re-diagnosed every list.**

## Heads-up — resolved, recorded for the record

Mid-run I observed **another session's staged work in main's shared index** (`ast-builder.js`,
`type-system.ts`, `conformance/cases/{loop,reactive}/`, plus `docs/known-gaps.md` + `master-list.md`).
**Zero ss75-scope paths — never an ss75 leak** (verified both directions; both agents confirmed
containment). I left it strictly alone and never touched main's index. It has since resolved: that was
**your own S260 wrap mid-flight**, now committed as `fefbdeaa`/`0887e18f`/`8d537c3f`.

**Note for the concurrent-work protocol:** an sPA cannot distinguish "PA mid-wrap" from "a leak" by
inspecting main's index — I could only rule out a leak *for my own scope*. The signal that resolved it was
main's HEAD advancing. Worth a `commit-lock`/status convention so a satellite can tell in one read.

## Suggested re-integration

`conformance/cases/{control-flow,linear}/` is **pure-additive new data** — no shared manifest (`run.ts`
auto-discovers via `readdirSync`), no compiler-source touched. **`spa/ss75` already has `8d537c3f` merged
in cleanly**, so you can file-delta the two case dirs, or fast-forward/merge the branch outright — the
merge is already proven conflict-free. Confirm `bun conformance/run.ts` → **691/691** independently (mind
the ENV-GAP above if you use a fresh worktree).

**`known-gaps.md` is exactly where findings 1-8 want to land** — and you just regenerated it in `8d537c3f`,
so reconcile rather than clobber (per the PA-owned-shared-docs rule).

**Then: findings 1-8 are the durable value of this list — please route them before the freeze bar is
read as met. Three tier-1 §17/§35 diagnostics currently cannot fire, and the corpus alone will not say so.**
