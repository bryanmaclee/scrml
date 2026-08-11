# BRIEF — g-263 fix round 5 (S338-bryan)

**Dispatched:** 2026-08-11 · **Base:** `fix/g263-seed-convergence-land` @ `1cf602c1`
**Frozen review ref:** tag `review/g263-r2` == `1cf602c1` · **main:** `c5499773`
**Prior rounds:** 4. Each one shipped a new defect. A green suite has never once caught one.

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

Your FIRST action, before reading anything else:

1. `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED CHECKOUT: **STOP and report.**
2. `git rev-parse --show-toplevel` MUST equal that same worktree path.
3. `git status --short` MUST be clean.
4. `bun install` — a fresh worktree does NOT inherit `node_modules` (the pre-commit hook fails
   with "cannot find package 'acorn'" otherwise).
5. `bun run pretest` — populates the gitignored `samples/compilation-tests/dist/` fixtures.
   Use `bun run test` (which chains pretest), NEVER bare `bun test`, for any baseline.

**Per-edit path discipline.** Every Read/Write/Edit targets a WORKTREE-ABSOLUTE path. NEVER `cd`
into the main checkout. Use `--cwd "$WORKTREE_ROOT"` for `bun` and `git -C "$WORKTREE_ROOT"`.
A relative path resolves against the shared checkout via the additional-working-directories list;
a main-rooted absolute path leaks directly. If you are about to write to
`/home/bryan-maclee/scrmlMaster/scrml/...` — STOP and re-derive.
Echo your startup `pwd` in your first commit message (`WIP(g263-r5): start at <pwd>`).

**Crash recovery.** Commit after EACH meaningful change — do not batch. WIP commits are expected;
your branch is the checkpoint. Maintain an append-only timestamped `progress.md` in
`docs/changes/g263-seed-convergence-2026-08-10/` recording what you just did, what is next, and
blockers. If you die, that file plus your commits are the entire recovery surface.

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first and follow its **Task-Shape Routing** section to pick the
2–4 additional maps for this task shape (codegen + dependency-graph + type/AST).
Map stamp: commit `616688ea`, 2026-08-09. **HEAD is past that stamp** — landings since include
#495 #496 #497 #498 #499 #500 #502 #504 #505 plus this branch's own three rounds. Treat every map
claim as a **hypothesis to verify against source**, not as fact. Report which map content was
load-bearing, including "none was" — that is a real answer and we track it.

---

## WHY YOU ARE HERE

This branch converges two drifting walkers onto one shared expression-position table. **The
convergence core is verified GOOD and is NOT up for re-litigation** — four independent adversarial
reviews established, by execution:

- the hand-rolled seed deletion is CLEAN (no fallback, no preserved-for-compat export, no
  dead-but-live parallel walker; two real importers)
- the new scope stack is 0-regression across 14 shadow shapes
- `EXPR_NODE_FIELDS` 11→7 correctly dropped 4 phantoms (`testExpr`/`subjectExpr`/`targetExpr`/
  `returnExpr` have zero AST declarations and zero construction sites)
- the WeakMap memo is inert (0 of 38 reproducers memo-sensitive)
- `dependency-graph.ts` −500 lines produces 0 diagnostic-code and 0 diagnostic-text changes over
  1904 corpus sources
- suite failure NAME SETS identical to main

**Do not undo any of that.** What follows are defects in things bolted onto that core.

**The one-sentence diagnosis, and it is your north star:** *every finding below is a text-level
shortcut standing in for a structural one.* The branch's own docblocks state the rule three times
(`client-read-seed.ts:38`, `:144`, `:305` — "PARSE, NEVER REGEX … a bare-identifier regex over
source text reads inside string literals and comments") and the implementation breaks it in three
places. Fix the shortcuts structurally; do not add a better heuristic.

---

## PART A — CORRECTNESS (all seven are PA-verified by execution)

### A1 — `wired` leaks server-only consts. NEW on this branch; main is clean.

`compiler/src/expr-positions.ts:230` `bareAttrValueIsWired` returns true for `if` and `/^on[a-z]/`,
and `:335` hardcodes `ifCond` to `"client"`. Consumed at `compiler/src/codegen/client-read-seed.ts:353`.

PA-verified reproducer (compile, then grep the emitted client bundle):

```
// models.scrml
export const ARGON2_PEPPER = ["p3pper", "argon2id", "s3cr3t"].join("-")
// index.scrml
<p if=ARGON2_PEPPER>gated</p>
```

Branch emits `models.client.js: const ARGON2_PEPPER = [...].join("-")` — the secret is in the
browser. Main does not. **The use site is byte-identical on both refs**:
`_scrml_cs_reactive_get("ARGON2_PEPPER")` — a STRING lookup into the reactive store, not a binding
read. So the const is dead in the client and buys nothing; it is pure leak.

Same family, all verified: `if=X.field`, `if=X[0]`, and `if=` on `<each>` / `<match>` / `<engine>`.
`if=(X)` and `if=X()` ARE genuine binding reads and are correctly classified — so **the answer
differs by VALUE SHAPE within one attribute name.**

Second vector: `onclick=X.go` lowers to a static HTML attribute (`onclick="X.go"` in the emitted
HTML); zero client JS references the binding, and the const ships anyway.

### A2 — `wired` is FALSE for the three canonical reactive attribute forms

`show=@x`, `bind:value=@x`, `class:on=@x` are declared `wired: "static"` and all three emit
client-executed code that reads the position (`el.style.display = _scrml_cs_reactive_get(...)`,
`addEventListener("input", ...)`, `classList.toggle(...)`, each inside a `_scrml_effect`).

This is inert TODAY only because `client-read-seed.ts`'s `addName` independently drops `@`-prefixed
names. That is luck, not design — and `WiredClass`'s own docblock calls this "the field a
confidentiality consumer gates on." A third consumer is already queued (the sibling arc converging
`symbol-table.ts`'s `walkValidateResetTargets`) and would inherit it.

### A3 — `"unknown"` is a dead value, so the default is fail-OPEN

`grep '"unknown"' expr-positions.ts` → four hits: three comments and the type alias. **Zero emit
sites.** The docblock (`:121`, `:129`) argues at length that an undetermined position fails CLOSED.
It never can: every unmeasured position is forced to `"client"` — the LEAK direction. `/^on[a-z]/`
alone force-classifies an unbounded unmeasured set (`only=`, `once=`, `onus=`, `onward=`).

### A4 — the predicate drifts from codegen's

`expr-positions.ts` uses `/^on[a-z]/`; codegen uses `name.startsWith("on")`
(`emit-html.ts:675`, `:3153`, `:3223`). They disagree on `on=`, `on-tap=`, `on_tap=`, `on<digit>`.
Measured under-emits (`ReferenceError` class) on all four. **The arc replaced two drifting walkers
and introduced a new drifting predicate.**

### A5 — `import.meta` fenced by a regex over SOURCE TEXT. NEW; silent cross-file.

`compiler/src/codegen/emit-client.ts:425`:

```ts
if (valid && /\bimport\s*\.\s*meta\b/.test(initTrim)) valid = false;
```

Two lines before `parseExprToNode(init, …)` builds the very node it could have tested.
PA-verified: `export const HINT2 = "read import.meta later"`, read in `on mount` —

```
MAIN    const HINT2 = "read import.meta later";   _scrml_cs_reactive_set("a", HINT2);   renders
BRANCH  (no declaration)                          _scrml_cs_reactive_set("a", HINT2);   ReferenceError
```

Exit 0, zero diagnostics, whole client bundle dies. Six non-`import.meta` shapes flip
declared→undeclared (plain string, URL string, template string, `[...].join()`, the spaced literal
`"import . meta"`, and the type-annotated form). **Cross-file it fails SILENTLY** —
`_scrml_modules["models.client.js"] = { };` while the importer still destructures — which falsifies
the design's own "under-emitting throws a loud ReferenceError the adopter can see" argument.
The in-code justification ("`import.meta` makes the WHOLE FILE fail to load") is false for a string.

**Fix:** test the parsed `initExpr` for a real `import.meta` meta-property. Not the text.

### A6 — missing `variable-ref` guard on the expr group's `raw` alternate

The expr group's `exprNode` alternate carries `v.kind !== "variable-ref"`; its `raw` alternate does
not, so one value object can match two alternate groups with CONTRADICTING `wired`. **Latent, not
live** — no current producer sets `raw` on a `variable-ref` (checked `ast-builder.js:2919/3372/5720`,
`native-parser/tag-frame.js:1445`) — but `native-walker/attrvalue-exprnode-walker.ts:5-7` asserts in
its own docblock that the shape exists.

### A7 — `emitGroup` prefers the first SUPPORTED alternate, not the first NON-EMPTY one

`refs: []` beats a real `exprNode`; four lift-path producers hardcode `refs: []`
(`ast-builder.js:5642/5728/5781/5821`). Traced live: the DG credits zero readers there.
Pre-existing on main, but the convergence promoted an accident into a documented "PREFERENCE order"
contract. Skip empty alternates.

---

## PART B — BY CONSTRUCTION (this is the half that decides whether round 6 exists)

Rounds 1–4 each shipped a new defect and the suite caught none of them. Patching A1–A7 without this
part buys one round.

### B1 — `EXPR_NODE_FIELDS` gets a DUAL-DIRECTION gate. Highest leverage item in the brief.

`resultExpr` is a REAL AST field — declared `compiler/src/types/ast.ts:1150`, 6 construction sites
in `ast-builder.js` — and it is MISSING from `EXPR_NODE_FIELDS`. `route-inference.ts:1931` carries
its own copy of the same list and **already includes it** (`"resultExpr", // match-arm-inline`).
So the table built to end list-drift disagrees with a fourth copy still in the tree.

PA-verified live defect, on BOTH refs (pre-existing, NOT a regression — but it is exactly the class
this arc exists to close):

```
on mount { @a = match @phase { .Idle :> NEEDED, .Ready :> "ready" } }
→ index.client.js:  if (_scrml_match_2 === "Idle") return NEEDED;
→ NEEDED is never declared anywhere.  exit 0, no diagnostic.
```

The existing test is ONE-DIRECTIONAL: it asserts the presence of 7 names and the absence of 4
hardcoded historical phantoms. **Three brand-new phantoms added to the list pass it.**

Build the gate: enumerate every `ExprNode`-typed field declared in `compiler/src/types/ast.ts` and
assert each is either IN `EXPR_NODE_FIELDS` or on an explicit exclusion list carrying a one-line
reason. Then add `resultExpr` (and anything else the gate surfaces) and MEASURE the migration —
report which corpus files change emit, do not assume zero.

Prove the bite BOTH ways: add a phantom → RED; remove a real field → RED.

### B2 — `bareAttrValueIsWired` CALLS codegen's predicate

Import and call the same function/regex codegen uses, or extract it to one shared helper both
import. Restating it is what produced A4. If codegen's predicate is not currently exported as a
callable, extract it — that extraction IS the fix.

### B3 — make `"unknown"` real, or delete it from the type

Either emit it at every genuinely undetermined position AND make every consumer treat it as
not-wired (the fail-closed story the docblock already tells), or remove the third value so the type
stops making a safety claim the code does not honor. **Do not leave a dead third value.**

### B4 — re-base the confidentiality tests on COMPILED SOURCES

`expr-positions-shared-table.test.js` asserts against hand-built synthetic AST objects. That is why
none of A1–A5 was caught. Five mechanisms survive deliberate deletion with the suite fully green:
`collectFromMarkupSource` (0 failures / 96), `collectFromCalleeName`, the entire local-decl binding
branch, phantom-field detection, and three whole positions (`initialCell`, `serverSource`,
`inlineMatchBody` — deletable against all 30,283 repo tests with zero new failures).

For every position that carries a confidentiality decision, the test must **compile a real `.scrml`
source and assert on the emitted bundle**, in BOTH directions:
- the server-only const's VALUE does not appear in any `.client.js` (leak check), and
- a genuinely-client-read const IS declared (under-emit check).

Cover **both paths** for each: same-file AND cross-file. The recorded reason this bug survived three
rounds is that all six leak vectors used a separate file, so every one travelled the cross-file path
and the same-file caller was untested. The current suite has the mirror gap — the leak vectors are
all cross-file, the wired vectors are all same-file.

**Anchor your assertions.** Existing ones are defeatable: `toMatch(/const SHOWN = "shown-client-value";/)`
(unanchored — a comment satisfies it), `toContain(pos.clientRef)` (any occurrence anywhere in the
bundle), `/_scrml_modules\[...\] = \{[^}]*NEEDED: NEEDED[^}]*\}/` (satisfied by `NEEDEDNEEDED:
NEEDEDNEEDED`), `/\bconst SECRET\b/` (misses an `export let` leak, which emits `let SECRET`).
Use `^\s*`-anchored, line-scoped matches. Add an `export let` vector.

---

## OUT OF SCOPE — do NOT do these

- **Node-traversal unification.** The seed descends only array-valued fields; the DG has explicit
  object-descent for `lift-expr`. Three live cross-file `ReferenceError`s inside `lift` bodies are
  invisible to the shared table by construction. **File this as a gap** in `docs/known-gaps.md` with
  a `locus=` and a `prov=` attribute, and **correct the docblock** so it stops reading as though the
  drift is fully closed — the table shares WHICH FIELDS, not WHICH NODES. Do not attempt the fix.
- Re-opening the deletion, the scope stack, the memo, or the 11→7 field reduction.
- Any change to `dependency-graph.ts`'s `p.origin.startsWith("attr.")` gate beyond documenting that
  the DG reads `.wired` ZERO times. (Verified: `grep -c '\.wired' dependency-graph.ts` → 0.)

---

## VERIFICATION — DO NOT REPORT DONE WITHOUT THIS

1. **Every reproducer above, compiled on your branch AND on `origin/main`**, with the grep that
   proves the symptom is gone. Not "tests pass."
2. **R26 empirical:** recompile real adopter sources
   (`../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`, `examples/`, `samples/`) via
   `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>` on your post-fix baseline.
3. **`bun scripts/corpus-emit-differential.ts`** against `origin/main`. Report N-of-M changed,
   named, each classified: fixed-leak / under-emit-regression / cosmetic. **Do not assume "fixed
   leak."** Note honestly that this instrument has low power here — the collector executes on only
   162 of 1904 sources — so it is a floor, not a proof.
4. **Migration measurement for B1**: how many corpus files change emit when `resultExpr` enters the
   list. Report the count and the files. Assumed-zero is not measured-zero.
5. **Bite proofs** for B1 (both directions) and for at least three of the B4 tests: corrupt the
   implementation, confirm RED, restore, confirm GREEN. **Report any test that stays green under a
   corruption it claims to catch.**
6. `bun run test` — report pass/fail. Compare the failure **NAME SET** against `origin/main`, not
   the counts. A count cannot distinguish a fix from a swap.

**Report:** files touched, final SHA, which of A1–A7 / B1–B4 landed vs deferred and why, every
locus in this brief that turned out WRONG (the loci here are PA-located-verify, not traced — say so
plainly if one is off), and anything you think we got wrong. **You are explicitly authorized to
argue against this brief.** A prior agent on this repo recommended reverting its own completed work
because the measurement said the repair was near-vacuous; that was the right call and it was taken.
If a fix here is wrong, say so with evidence rather than building it.
