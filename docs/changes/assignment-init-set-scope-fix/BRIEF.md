> # ✅ DONE — S321-peter, PR #417 (`260a8455`)
>
> Fixed `g-assignment-emits-init-set-inverting-reset` (HIGH). NOT via the proposed
> `resolveBareAtWriteTargets` flat-name-set (never landed on this clone). Simpler
> route: `_emitInitThunkSidecar` (emit-logic.ts) skips the reset init-thunk for a
> `structuralForm:false` plain reassignment whose cell has a `<name>` structural
> decl (`collectStructuralDeclNames`) — safe-by-construction (implicit `@`-decls
> like SSE binds keep their thunk), per-node so the compound collision this brief
> feared cannot occur. S239 caught + fixed F1 (control-flow-body under-skip, module
> fallback); F2 (implicit double-write) filed as a pre-existing MED sibling.
> Pinned: 2 RT conformance cases (proven fail-pre / pass-post) + unit
> `assignment-init-set-reset-inversion.test.js`.

# BRIEF — fix round: `resolveBareAtWriteTargets` uses a FLAT, UNSCOPED name set

change-id: `assignment-init-set-scope-fix`
authored: 2026-08-03 (S316-bryan) · agent: `scrml-js-codegen-engineer` (iso worktree, opus, bg)
gap: `g-assignment-emits-init-set-inverting-reset` (HIGH, `docs/known-gaps.md:125`)
DONE-PROBE: bun test compiler/tests/unit/assignment-init-set-reset-inversion.test.js
probe-intent: green, WITH a new case pinning the compound-child name-collision shape below. The
existing 19 tests already pass on the broken build — they are blind to this defect, which is the
whole reason the probe needs the new case.

---

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full. The
§"Task-Shape Routing" names which additional maps apply to a compiler-source codegen task. Follow it.

**Map currency:** maps reflect HEAD `e80b692e` (2026-08-02, refreshed at S314). HEAD is now
`09d17541` — **14 intervening commits, and 4 of them ARE codegen**, so factor them in rather than
trusting the map blindly on emit paths:

- `a0f2f18b` (#385) directly-imported + client-read `export const` reaches the client bundle
- `7b5c02a2` (#386) type-annotated `export const` emitted to client+server
- `b6c8b97f` (#387) `<engine>` non-initial arm Tailwind class scan
- `09d17541` (#388) `serve=tool` main-only imports + `export let/var`

The other 10 are spec/scoping/docs/CI and do not move `compiler/src`. Treat map content as a
verify-against-source hypothesis if a named file looks moved.

In your final report: `Maps consulted: [list]; load-bearing finding: <one sentence>` OR
`Maps consulted but not load-bearing.`

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: `<ABSOLUTE-WORKTREE-PATH>` (echo your real `pwd` and use THAT).

Path-discipline incidents to date: the class is live and has recurred across sessions. The
`path-discipline.sh` PreToolUse hook guards **Edit/Write** and caught a live mistyped main-rooted
path mid-dispatch at S314. It does NOT see Bash-based writes.

## Startup verification (BEFORE any other tool call)
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is
   under any other repo, STOP and report (the S90 CWD-routing failure). Save as `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git status --short` — clean.
4. `bun install` (worktrees do NOT inherit `node_modules`; the hook fails "cannot find package
   'acorn'" otherwise).
5. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`; ~130 ECONNREFUSED-shaped
   browser failures without it). Use `bun run test` (chains pretest) for any full baseline.

If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- **Edit via Edit/Write on WORKTREE-ABSOLUTE paths.** ⚑ Do NOT follow older briefs in `docs/changes/`
  that mandate "edit via Bash on worktree-absolute paths" — that S126 mitigation is **RETIRED**
  (S314). The isolation guard now refuses Bash heredocs/redirects as too-complex-to-verify, and the
  hook that actually protects you covers Edit/Write. Bash-based writes are now the *discouraged*
  path.
- NEVER a bare relative path (it resolves against the main checkout via the
  additional-working-directories list). NEVER a main-rooted absolute path.
- NEVER `cd` into the main repo. Use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
- Your FIRST commit message includes your verbatim startup `pwd`:
  `WIP(init-set-scope): start at <pwd>`.

# CRASH RECOVERY
Commit after EVERY meaningful edit — WIP commits are expected and fine; the branch is your only
checkpoint. Keep an append-only timestamped `progress.md` under
`docs/changes/assignment-init-set-scope-fix/`. A clean `git status` before you report DONE is
mandatory. "Work is in the worktree, uncommitted" is NOT an acceptable terminal report — the session
that produced the code you are fixing died exactly that way and 571 lines of its tests had to be
salvaged by hand.

---

# BASE — you are NOT branching off main

Branch off **`worktree-agent-a79d3ecafe93fc861` @ `5aeb656a`**, which carries the work being fixed:

- `7305cfdb` — the fix itself (`ast-builder.js`, `codegen/emit-logic.ts`, `types/ast.ts`,
  `parser-conformance-within-node-allowlist.json`)
- `5aeb656a` — its 571 lines of tests (salvaged at S316; 19 tests, all green)

That branch is based on `68039044` and **main has moved 4 codegen commits past it**. Run
`git merge main` FIRST and resolve before you touch anything, then verify the 19 tests still pass on
the merged base. If the merge conflicts in `emit-logic.ts` or `ast-builder.js`, resolve as a real
3-way — never a wholesale `--theirs`/`--ours` (a wholesale `--theirs` rebase silently reverted a
colleague's landed gap work at S307).

---

# CONTEXT — the ruling this fix serves

**RULING (S316, bryan-delegated):** *An assignment never registers a reset initializer. Only a
declaration's init expression does — regardless of position: top-level, function body, `on mount { }`
body, or route-region body.*

`provenance: spec:§6.8.1` — SPEC.md:5483 verbatim: *"If `default=` is absent, `reset(@cell)` SHALL
re-evaluate **the init expression** at reset time and write the result to the cell."* §6.8.2:5500
restates it as *"the **original** init expression."*

`7305cfdb` implements that correctly for the assignment case, and the ruling is not in question. This
brief is **only** about a defect the mandatory adversarial pass found in HOW it identifies "already
declared."

---

# THE DEFECT — confirmed by execution, base-vs-fixed

`resolveBareAtWriteTargets` decides declared-vs-undeclared from a **flat, unscoped `Set` of
`node.name`** gathered over every `state-decl` in the file — **compound children included**. A
compound child and an unrelated top-level phantom-synth cell that share a leaf name therefore
collide, and the top-level write's init thunk is suppressed as though it were a re-assignment.

## Reproducer (executes today; save it as your first regression fixture)

```scrml
<program>
  <form>
    <ticks> = 99
  </>
  ${ @ticks = 7 }
  <button onclick=${ reset(@ticks) }>Reset</button>
</program>
```

`@ticks` at top level is a **phantom-synth** cell — there is no top-level `<ticks>` declaration. The
only `ticks` declaration in the file is the compound CHILD, which registers as `form.ticks`.

Compile and grep the emitted client JS for named initializer registrations:

```
grep -rhoE '_scrml_(cs_)?(init_set|default_set)\("[a-zA-Z0-9_.]+"' <output-dir> | sort | uniq -c
```

| | `form.ticks` | `form.ticks.touched` | `form.submitted` | **`ticks`** |
|---|---|---|---|---|
| main (`09d17541`) | 1 | 1 | 1 | **1** |
| `5aeb656a` (broken) | 1 | 1 | 1 | **0** ← |

With no `init_set("ticks")` and no `default_set("ticks")`, `_scrml_reset("ticks")`
(`runtime-template.js:1146`) misses `_scrml_default_fns`, misses `_scrml_init_fns`, falls through to
the compound-parent branch hunting keys prefixed `ticks.`, finds only `form.ticks`, and **returns
having done nothing**. `reset(@ticks)` is a silent no-op. Compiles clean, zero diagnostics.

Direction-of-change of the DEFECT: **semantics-changed** — pa-base §8's silent class, the one no
diagnostic reveals and only an artifact diff catches.

# ROOT CAUSE — PA-located, VERIFY FIRST

⚠️ **This locus is a HYPOTHESIS (pa-base §5), not a trace.** I read the function and executed the
differential; I did NOT trace how a compound child's `name` field is populated. Confirm or correct it,
and **report which** — held / refined / wrong.

`compiler/src/ast-builder.js:18788` `resolveBareAtWriteTargets`:

```js
if (node.kind === "state-decl" && typeof node.name === "string") {
  if (node._bareAtWrite) bareWrites.push(node);
  else if (isInitializerBearingDecl(node)) declaredCells.add(node.name);
}
```

`declaredCells` is a bare `Set` of unqualified `node.name`, and the walk descends into
`node.children` (compound bodies) like everything else. My hypothesis: a compound child's `.name` is
the **bare leaf** (`"ticks"`), not the qualified path (`"form.ticks"`), so it lands in the same flat
namespace as top-level cells. Verify by dumping the AST for the reproducer before you change
anything.

# THE FIX — scope the resolution; do not widen it

Make declared-vs-undeclared resolution agree with the **key space codegen actually emits**
(`form.ticks` vs `ticks` are different cells, and the runtime maps them as different keys). Whether
you do that by qualifying names on the way into `declaredCells`, by not descending into compound
children when collecting declarations, or by tracking the compound path during the walk is your call
— pick what the AST actually supports and say why in the commit body.

**The invariant to hold:** a bare `@x = expr` write resolves `"declared"` **iff** an
initializer-bearing declaration exists *for the same cell key that write targets* — not merely for
something, somewhere in the file, spelled `x`.

## HARD CONSTRAINTS

- **Do NOT touch `_emitInitThunkSidecar`'s skip order.** `_bareAtWrite === "declared"` sits before
  `node.defaultExpr` deliberately, and the `default=` case is verified correct (see below).
- **Do NOT change `_bareAtWrite`'s three-value contract** (`unresolved` / `declared` / `undeclared`),
  and keep `"unresolved"` treated as `"undeclared"` — that is the conservative pre-S314 fallback for
  hand-built ASTs.
- **Do NOT retire phantom-synth.** It is a separate, named workstream (the V-kill follow-up, 177+
  corpus uses). Its emission must stay byte-for-byte.
- **Do NOT add `_bareAtWrite` to the within-node parity classifier's `STRIP_KEYS`.** The field changes
  emitted JS; stripping it would let a native-pipeline swap silently reintroduce the inversion. The
  RAISE-ONLY allowlist bump on the branch is correct — extend it if your fix moves fixtures, and
  record the reasoning in the allowlist's own `__NOTE__` as the existing entry does.

# MUST NOT REGRESS — exact expected `init_set` counts

I executed all six base-vs-fixed. Five are correct on `5aeb656a` and must STAY correct; re-run every
one after your change:

| shape | source | main | expected AFTER your fix |
|---|---|---|---|
| the bug | `<ticks> = 0` + `${ @ticks = @ticks + 1 }` | 2 | **1** (declaration only) |
| forward-ref | write BEFORE the declaration | 2 | **1** (resolution is order-independent — keep it) |
| §53 declarative | `${ @count: int = 7 }` | 1 | **1** — a declaration, keeps its thunk |
| phantom-synth | `${ @orphan = 42 }`, no declaration | 1 | **1** — byte-preserved |
| `default=` | `<retries default=0> = 5` + `${ @retries = @retries + 1 }` | 1 | **0** — CORRECT, do not "restore" it |
| **collision** | the reproducer above | 1 | **1** ← the fix |

The `default=` row is the trap: `_scrml_reset` checks `_scrml_default_fns` FIRST and returns
(`runtime-template.js:1161-1165`), so the emission that disappears there was dead code the runtime
already ignored. Going from 1 → 0 is the fix working. **Do not treat it as a second regression.**

Also keep the legacy declarative @-forms out of the stamped set entirely: `@x: T = expr` (§53),
`server @x = expr` (§52.4), `@shared x = expr` (§37.4). They are declarations despite
`structuralForm: false`.

# VERIFICATION — all four, in order

1. **The six probes above.** Report the table with your measured numbers, not "as expected."
2. **The 19 existing tests** (`reset-init-set-inversion-s314.test.js` +
   `conf-RESET-INIT-AFTER-ASSIGNMENT.test.js`) stay green, PLUS a new case pinning the collision
   shape. That new case is the DONE-PROBE's whole point — the existing 19 pass on the broken build.
3. **Full gated subset:** `bun test compiler/tests/{unit,integration,conformance}` — 0 failures.
4. **R26 empirical (MANDATORY — this is a HIGH):** recompile real adopter sources on your post-fix
   baseline —
   `bun --cwd "$WORKTREE_ROOT" "$WORKTREE_ROOT/compiler/bin/scrml.js" compile <src> --output-dir <tmp>`
   over `../scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` plus `examples/` — and diff the
   emitted `init_set`/`default_set` key sets against the same sweep on `main`. The symptom check is
   **that key-set diff**, NOT "tests pass". Any cell that loses its last initializer registration is a
   STOP. **Do not mark DONE without the empirical sweep passing**, and paste the counts.

# REPORT BACK

- Whether the root-cause hypothesis **held / was refined / was wrong**, and how you established it.
- The six-probe table with measured numbers.
- The R26 key-set diff (files swept, cells moved, cells that lost their last registration — expect 0).
- Files touched + final SHA + a clean `git status`.
- Anything you found that this brief got wrong. The brief is a hypothesis too.

# DO NOT

- Do not re-litigate the ruling — it is spec-grounded and settled (§6.8.1:5483).
- Do not "fix" the mount-body case here. That is Peter's lane on his own branch; he has the ruling.
- Do not run `git push`, open a PR, or touch `main`. The PA lands this after an independent
  adversarial pass — the same pass that caught the defect you are fixing.
