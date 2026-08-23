BUILD ROUND on a **ratified, one-way, authoring-surface ruling**. This is the flagship arc of the session. Two calls of a five-call deliberation (`dpa-036`, type-system assignability) are yours; the other three are explicitly out.

## WORKSPACE — fresh isolated worktree
**STARTUP GATE, first action; STOP and report if any fails:**
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`
2. `git rev-parse --show-toplevel` equals it · `git status --short` clean
3. `git fetch origin && git checkout -b feat/s365-asis-split-rung0 origin/main` — confirm `git merge-base HEAD origin/main` == `origin/main` (currently `b74f7363`)
4. `bun install` (a fresh worktree does NOT inherit `node_modules`; the pre-commit hook fails "cannot find package 'acorn'" otherwise)
5. `bun run pretest` (populates the gitignored `samples/compilation-tests/dist/` fixtures)

**PATH DISCIPLINE.** Absolute paths under YOUR worktree root only. **NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`** (live). Use `git -C "$WORKTREE"` / `bun --cwd="$WORKTREE"`. **Never `git stash`.** Never touch a sibling worktree.

⚑ **NEVER disable the commit gate.** Not `--no-verify`, and **not by pointing `core.hooksPath` anywhere** — this repo sets no `core.hooksPath`, so `git -c core.hooksPath=…` silently skips the gate. A dispatch did exactly that earlier today and its tree was RED under the real gate. If a hook blocks you, report it; do not route around it.

## MAPS
`.claude/maps/primary.map.md` — read it first and follow its Task-Shape Routing. ⚠️ **It is stamped at `c93a692c` and HEAD is `b74f7363`**, so treat map content as a **verify-against-source hypothesis**, not fact. Report which map content was load-bearing, "not load-bearing" included.

---

## THE RULING (bryan, S365: *"ratify 1, take 3 and 4, hold 5"*)

### Call 1 — the `asIs` split. RATIFIED. ⚑ ONE-WAY, authoring surface.

**`asIs` means the developer signed for it. It must never mean the compiler did not look.** Today those are one value, and that is the whole defect.

**Mechanically:** inference failure must be **structurally incapable** of producing `asIs`. It produces `unknown` carrying the AST node kind that defeated it. That value **still passes** — no build error, so the adopter is billed nothing — but it is **loud and counted**.

**Fail-LOUD, not fail-closed.** The property today's behaviour cannot have: *absence of a diagnostic* and *success* are currently the same observation.

```
the value's type is asIs, because a human wrote it   -> silent, passes
the value's type is unknown, because inference gave
   up at AST node kind k                             -> PASSES, but emits a warning naming k, and is counted
the value's type fits the declared type              -> silent, passes
it does not fit                                      -> E-TYPE-031 (unchanged)
```

### Call 1's ratified MECHANISM — the decay-stopper

Change inference's return type from `ResolvedType` to **`Result<ResolvedType, InferenceGap>`**, where **constructing an `InferenceGap` REQUIRES naming the AST node kind**. Pair it with an **exhaustive switch over node kinds with a `never` fallthrough**, so that adding a node kind to scrml without handling it becomes a **TypeScript compile error in scrml's own compiler**.

This is the point of the whole design: the coverage invariant is enforced by a type checker, not by a reviewer's attention. **Do not substitute a runtime assertion, a lint, or a doc comment for the `never` fallthrough** — the by-construction property IS the ruling.

### Call 4 — amend §7.5 to its provable domain. TAKEN.

§7.5 promises assignability checking at four positions and delivers one. **PA-measured on `main`, reproduce this yourself before amending:**

| position | result |
|---|---|
| `let n: number = "nope"` (also `string`, `boolean`) | **fires `E-TYPE-031`** |
| `<n>: number = "nope"` (typed cell) | SILENT |
| `fn f(x: number)` called `f("nope")` | SILENT |
| `fn f() -> number { return "nope" }` | SILENT |
| `let z = "x" * 2` (operand typing) | SILENT — does not exist |

Independent of the algorithm: **§34's registry books `E-TYPE-031` as a *prop* error (§15.3/§15.10) while §7.5 uses it for general assignment**, across nine normative sites. **Amend §7.5 to describe what is provable now, and let the algorithm catch up to it** — rather than leave a normative sentence no implementation has ever satisfied. Reconcile the §34 registry with it in the same landing.

---

## FACTS ALREADY VERIFIED BY THE PA — build on these, do not re-derive

- **scrml already declares both kinds.** `AsIsType` at `compiler/src/type-system.ts:340`, `UnknownType` at `:364`, both in the `ResolvedType` union at `:489-490`, constructors `tAsIs()` at `:950` and `tUnknown()` at `:966`.
- **The distinction is discarded in TWO LINES**, `:853-854`, bidirectionally:
  ```
  if (src.kind === "asIs" || src.kind === "unknown") return true;
  if (target.kind === "asIs" || target.kind === "unknown") return true;
  ```
- **`SPEC.md:19236`** (`E-TYPE-ANY-FORBIDDEN`, S174) already says: *"Use a concrete type, or `asIs` for a **deliberate, named** untyped escape hatch."* **So this is a conformance defect against an existing ruling, not a new design surface.** Cite it as the provenance.
- **Scale:** authored `asIs` = **29 tokens across 20 of 2,362 tracked `.scrml` files** (16 of them in `examples/23-trucking-dispatch`). Internal `tAsIs()` = **97 sites** in `type-system.ts`. The compiler manufactures the escape hatch >3× as often as anyone writes it.
- `expression-parser.ts` carries ~206 `case "` arms; the DD's bound of ~24 *distinct expression forms* is the closed set that matters — **measure it yourself** before relying on either number.
- `W-TYPE-031-UNPROVEN` is **unallocated** — no occurrence in SPEC or src. Confirm before minting, and mint per §34.0.

## SCOPE — this dispatch is RUNG 0 ONLY

The ratified rung order (from the deliberation's own follow-up poll):
- **rung 0 — THIS DISPATCH:** inference failure becomes structurally incapable of producing `asIs`; it produces the counted, loud gap instead. Plus call 4's SPEC amendment.
- rung 1 (NEXT, ruled, not yours): widen the hardcoded `{number,string,boolean}` literal set — `int`/`integer`/`real` are silent today — and close the PascalCase gate on unknown type names (`strng` is silent; `NotAType` fires).
- rung 2/3 (NEXT, ruled, not yours): argument position, then return, then operand. Call 3 (the builtin-method catalog, `n.toUpperCase()`) rides here.

**Do not build rungs 1-3.** They depend on rung 0's `Result` type and are a separate dispatch. **This is a dependency, not a size deferral** — `[1678]` withdrew size as a reason and that still holds.

## EXPLICITLY OUT
- **Call 5 (warning→error default-on at v1) is HELD by bryan. Ship the new diagnostic as a WARNING. Do not build the flip, do not add a config to enable it.**
- Do not change `E-TYPE-031`'s severity or its existing fire behaviour.
- Do not touch `codegen/`.

## VERIFICATION — do not report DONE without it
1. **Reproduce the four-position table above** on your branch base BEFORE amending §7.5, and paste your own measured version. If it does not match, **STOP and report** — the amendment would rest on a false premise.
2. **Prove the `never` fallthrough bites:** add a node kind (or simulate one) and show the scrml compiler's own TypeScript build fails. That is the ratified property; if it cannot be demonstrated, the mechanism is not built.
3. **Prove the split by execution, both directions:** a source with an authored `asIs` compiles SILENT; a source that defeats inference compiles with the new warning naming the node kind, **and still exits 0**. Paste both.
4. **Corpus impact, measured not assumed:** compile the tracked corpus and report how many files now emit the new warning and how many warnings total. A large number is not automatically wrong — but the number must be known before this lands.
5. **Regression:** `bun --cwd="$WORKTREE" run test` and `bun --cwd="$WORKTREE" conformance/run.ts` (baseline: conformance 883/883; whole tree ~53 failures on `origin/main`). Report branch-only NEW failures. **Separate timeouts from assertions by REASON TEXT** — a bun timeout prints `timed out after Nms`; the four ~10.5 s dev-watcher failures are assertions (`initial bundle never served 200 with marker`) present on main too.
6. **Measure exit codes DIRECTLY (`cmd; echo $?`), never through a pipe** — `cmd | tail` reports tail's status.
7. **Run all six blocking CI gates** at your final SHA and report each exit code. Note `s34-census.ts --check-new` will demand an **emitter provenance note** on any new §34 row — `(… emitted at \`compiler/src/foo.ts:123\`.)`. That gate rejected a PR earlier today for exactly this.

## COMMIT DISCIPLINE
First commit: this brief verbatim to `docs/changes/s365-asis-split-rung0/BRIEF.md` (single-quoted heredoc) + `progress.md`. Crash anchor. Commit after each unit; WIP commits expected. Clean `git status` before DONE.

⚑ **Your `progress.md` must disclose anything that went wrong, not only what worked** — a gate you had to work around, a measurement you got wrong first, a premise in this brief that turned out false. A transcript disclosure evaporates; that file does not.

## REPORT
Final message = deliverable. Include: your own measured four-position table; the `never`-fallthrough bite proof; both-direction split proof; the corpus warning count; gate numbers with the NEW-failure name set; the six gate exit codes; final SHA; **and any premise in this brief you found to be wrong.**
