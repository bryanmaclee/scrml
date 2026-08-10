# BRIEF — §6.6.19 E-DERIVED-SERVER-ONLY-REACH misses every NON-TOP-LEVEL derived cell

**Dispatched:** 2026-08-10 (S337-bryan). **Agent:** scrml-js-codegen-engineer, `isolation: "worktree"`, model opus.
**Base:** `origin/main` @ `191b4a36`. **Gap:** `g-derived-server-only-reach-misses-for-loop-lift-body` (HIGH).
**Origin:** routed by Peter (S335) after his review of my #486; PA re-verified independently this session.

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST, then follow its "Task-Shape Routing" for this task shape
(compiler-source / route-inference). Relevant maps: `primary.map.md`, `structure.map.md`, `error.map.md`.

⚠ **MAP CURRENCY:** maps are stamped `commit: 616688ea`; HEAD is `191b4a36` — **7 commits ahead**.
Post-map landings to factor in: #487 (S334 wrap), #489/#490/#491 (S335 review-floor + ledger),
#492/#493/#494 (S336 `scripts/boot.ts` + wrap). **None of them touch `compiler/src/route-inference.ts`**
(verified by the PA: `git diff --name-only 616688ea..191b4a36 -- compiler/` shows no route-inference change).
Treat map content as a verify-against-source hypothesis. Report whether the maps were load-bearing —
"not load-bearing" is a valid and useful answer.

---

## THE DEFECT — verified by the PA this session, not inherited

`compiler/src/route-inference.ts` Step 3b (§6.6.19, landed S331 as #486) fires
`E-DERIVED-SERVER-ONLY-REACH` when a `const <name>` derived cell's RHS reaches a binding imported from
an `ESCALATION_SERVER_ONLY_MODULES` module. **It only ever inspects derived cells that the collector
finds — and the collector cannot reach a cell nested in a control-flow body.**

### Reproducer (PA-reproduced on committed HEAD `191b4a36`)

```scrml
<program>
${ import { hashPassword } from 'scrml:auth' }
<pw> = "secret"
<items> = [1, 2]
<div>${ for (let it of @items) { lift <div>${ const <h> = hashPassword(@pw) }<span>${@h}</span></div> } }</div>
</program>
```

**Observed (PA, by compilation + artifact inspection — not by grep of source):**
- exit 0, warnings only, **no `E-DERIVED-SERVER-ONLY-REACH`**
- **zero `.server.js` emitted**
- `hashPassword` present in `dist/case-loop.client.js` AND `dist/_scrml/auth.js`
- `dist/_scrml/auth.js` ships `Bun.password.hash(password, { algorithm: "argon2id" })` **to the browser**
- `dist/case-loop.client.js` inlines the secret: `_scrml_cs_reactive_set("pw", "secret")`

**Control** — the identical cell at top level correctly FAILS with the code. The check works; the
**position** is uncovered.

### Locus — PA-TRACED (not merely searched), verify anyway

`collectDerivedCellDecls`, `compiler/src/route-inference.ts:3650`. Consumed at `:4461` from Step 3b (`:4429`).

```ts
if (Array.isArray(node.body)) visit(node.body);
if (Array.isArray(node.children)) visit(node.children);
```

The walk descends **only** `body` and `children`. A `for`-loop stores its body under an `expr` wrapper,
so the leaking cell's path is `…expr.node.children[0].body[0]` and is never visited.

⚠ **The doc comment directly above this function claims the walk finds derived cells "at any depth —
top-level logic, markup children, component bodies." That claim is FALSE.** Fix the comment with the code.

### PA measurement — the blind spot, and the migration

A probe comparing the shipped walk against a generic structural walk (every array/object-valued
property) over real parsed ASTs:

| corpus | shipped walk | generic walk | never inspected |
|---|---|---|---|
| the reproducer | **0** | **1** | **1** |
| repo `.scrml` (samples/examples/stdlib/conformance, 1896 files) | 106 | 106 | **0** |
| flogence (22) + RediLedger (4) | 3 | 3 | **0** |

**Direction-of-change: NEWLY-REJECTING** (source that compiled now errors) — the reversible direction.
**Migration measured at ZERO** on every corpus reachable from this machine.
⚠ **`../assetManagement` (the adopter shakedown app) is NOT cloned here and is therefore UNMEASURED.**
Do not write "migration is zero" without that qualifier.

### Governing sentence (Rule 4 gate — SATISFIED, quoted)

SPEC §6.6.19, normative statements:

> "A `const <name>` derived cell whose RHS **reaches** a local binding introduced by an `import` from a
> module in the §12.2 Trigger 3 `ESCALATION_SERVER_ONLY_MODULES` set — or from any submodule of one —
> SHALL be a compile error, **`E-DERIVED-SERVER-ONLY-REACH`**."

The sentence binds **every** `const <name>` derived cell. It is **not qualified by position**, and the
only carve-out in the section is `kind="tool"` programs. **So this is CONFORMANCE RESTORATION — the
implementation wrongly ACCEPTS what the spec already says SHALL be refused. It is a bug fix, not a
widening, and it needs NO spec amendment.** Do not open a language question here.

---

## WHAT TO BUILD

**Fix the ROOT, not the position.** Do **NOT** add `expr` to the field list and call it done — that is
position-patching, and the same defect class will recur at the next unenumerated field. This is the
second instance of this exact class in the compiler (see `g-263-direct-cross-file-const-import-not-emitted-client`,
where a hand-rolled seed walker in `emit-client.ts` drifts against `dependency-graph.ts`'s full sweep).
**Two instances of one class is the converge-not-enumerate signal.**

**Required:** make `collectDerivedCellDecls` walk the AST **structurally** — descend every array- and
object-valued property rather than a hardcoded field list — so no future node shape can hide a derived cell.

**Guards you MUST get right (each needs a test):**
1. **No over-collection.** A `kind="tool"` `<program>` (§64) must still be carved out — the check must
   not fire there. Verify the carve-out still holds when the cell is nested.
2. **No double-counting.** Keep the `seen` identity set; a node reachable by two paths fires once.
3. **Do not descend into non-AST baggage** — `spans` (a Map), `parent`/back-references, `loc`. A cycle
   must not hang the walk. Prove termination on the real corpus.
4. **Shadowing still respected.** §6.6.19: a binding declared inside the RHS shadows the import and
   SHALL NOT fire. Nesting must not weaken this.
5. **String literals still inert.** §6.6.19 + §12.4: a name only inside a string literal is not a reach.
6. **Performance.** A generic walk touches more nodes. Measure compile wall-time on the corpus before/after;
   report the delta. If it regresses materially, bound the walk by node kind rather than reverting to a field list.

**Also fix:** the false "at any depth" doc comment above the function.

---

## TEST COVERAGE — the axis the existing suite misses

`compiler/tests/unit/route-inference-derived-server-only-reach.test.js` has 8 sections. **All eight
place the cell at TOP LEVEL.** Its §2 "EVASION" block explores depth *within the RHS* (lambda body,
bare callback ref, match-arm block, unparseable RHS) and **never varies the cell's POSITION.** That is
exactly why a green suite shipped this leak.

Add a **position** axis. At minimum, a derived cell reaching a server-only import from inside:
- a `for`-loop `lift` body (the reported case)
- a `while` loop body
- an `<if>` / `if=`-gated subtree
- an `<each>` row template body
- a `<match>` block-form arm body
- an `<engine>` state-child body
- a component body
- nested two deep (loop inside a conditional)

Each must fire the code. Add the `kind="tool"` nested carve-out as a NEGATIVE case.

### Conformance — assert the LEAK, not just the CODE

Peter's third finding, and it is the reason this slipped: the 3 existing conformance cases + the unit
test assert only diagnostic **codes**; the runtime leak facts (no `.server.js`, no `hashPassword` /
`Bun.password` in the bundle) live only in `rationale` **prose**, which gates nothing.
**Add at least one conformance case that pins the emitted-artifact facts**, so the corpus gates the
leak and not merely its proxy. Follow the existing conformance case structure in `conformance/cases/`.

---

## VERIFICATION — required before you report DONE

1. **Unit + conformance:** `bun test compiler/tests/{unit,integration,conformance} --bail` → 0 failures.
2. **R26 EMPIRICAL (mandatory, not optional):** recompile the reproducer above on YOUR post-fix build and
   assert **all** of: the code FIRES; and for a corrected variant (call moved into a `function`) a
   `.server.js` IS emitted and `Bun.password` does **NOT** appear in any client artifact.
   Symptom-grep, not "tests pass":
   ```sh
   grep -rn "Bun.password\|argon2id" <outdir>/   # must be EMPTY for the client bundle
   find <outdir> -name "*.server.js"             # must be NON-EMPTY for the corrected variant
   ```
3. **Regression sweep:** recompile the full repo corpus and confirm the diagnostic delta vs the pre-fix
   baseline is **exactly** the intended new fires and nothing else. Report the count and the files.
   (PA measured the expected delta as ZERO on this corpus — a non-zero result is a real finding: report
   it, do not silently migrate corpus files.)
4. Report whether the locus hypothesis **held / was refined / was wrong**.

---

## PROCESS

- **Commit after each meaningful unit** (WIP commits expected) + maintain an append-only timestamped
  `progress.md` in this change dir. The branch + progress.md are the crash-recovery anchor.
- **Path discipline:** every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. Never `cd`
  into the main checkout; use `--cwd "$WORKTREE_ROOT"` for `bun` and `git -C "$WORKTREE_ROOT"`.
  First action: `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
  If it does not, STOP and report.
- **Worktree startup:** `bun install` (worktrees do not inherit `node_modules`) then `bun run pretest`
  (populates gitignored browser fixtures). Use `bun run test` for baselines, not bare `bun test`.
- **NEVER `--no-verify`.** Not on any gate, for any reason, without explicit authorization in-brief.
  You do not have it here. Do not override `core.hooksPath` either.
- **Gap ledger:** do NOT edit `docs/known-gaps.md` — it is a PA-owned shared doc and the PA is live in it.
  Report what should be written and the PA will write it.
- If the fix turns out to be wrong, near-vacuous, or to need a design ruling: **say so and argue against
  your own work.** That is an explicitly sanctioned outcome, and it has been the right answer before.

**Report:** worktree path · final commit SHA · files touched · locus held/refined/wrong · the R26
empirical result verbatim · the corpus diagnostic delta · perf delta · anything deferred.

---

## ARCHIVE NOTE (agent, 2026-08-10)

This file was archived into the worktree by the dispatched agent. The dispatch prompt pointed at this
path inside the worktree, but the worktree base (`191b4a36`) predates the BRIEF commit, so the file was
not present. It was read verbatim from the main checkout at
`/home/bryan-maclee/scrmlMaster/scrml/docs/changes/derived-server-only-reach-nested-positions-2026-08-10/BRIEF.md`
and reproduced here byte-for-byte above this note. (The main checkout switched off that commit moments
later and the path disappeared — hence the archive.)
