# BRIEF — `int`/`number` assignability: the corpus census, as a re-runnable instrument

**Dispatched:** S404-bryan, 2026-09-06. Base: `origin/main` @ `069e86fd`.
**change-id:** `int-number-assignability-census-2026-09-06`
**Agent:** scrml-js-codegen-engineer · `isolation: "worktree"` · model opus · background.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST and follow its "Task-Shape Routing" section to the
additional maps for a type-system / census-probe task shape. The map watermark is `499eecce`;
HEAD is `069e86fd` — factor in the four landings between them (`bd82ccaa`, `94572819`, `82ef4363`,
`499eecce`, `069e86fd`), which include the S402 §7.5.1 positions-1-and-2 widening in
`compiler/src/type-system.ts`. Treat map content as a **verify-against-source hypothesis**.
Report whether the maps were load-bearing — "not load-bearing" is a valid and useful answer.

## WHY (the decision this feeds)

SPEC §7.5.1 says, verbatim: *"Position 3 cannot be turned on before an `int` / `number`
assignability ruling exists."* The operator rules that pair next session. The ruling needs a
MEASURED blast radius, and the number currently in circulation — *"37 of 40 new rejections are
false positives, all the same shape"* — is **relayed, not reproduced**. Reproduce it or replace it.

⚑ **PA-VERIFIED FACTS you may rely on (I ran these; do not re-derive, but DO flag if you find them
wrong):**
- `compiler/src/type-system.ts:1431` — `["int", tPrimitive("integer")]`, i.e. **`int` is an ALIAS of
  `integer`**, not a separate primitive. The `int`-vs-`integer` spelling is NOT the question.
- `fieldTypeEquals` (`type-system.ts:~1220`) compares primitives **by NAME**, with no
  number/integer normalization.
- `hostReceiverKind` (`type-system.ts:~3967`) DOES normalize: `if (name === "number" || name ===
  "integer") return "number";` — comment: *"§53 — `integer` is a number refinement (maps to number
  at runtime)"*. `HOST_METHOD_RETURNS`'s header comment says the same. So the normalization exists
  in the method-resolution path and is absent in the assignability path.
- `type-system.ts:3887` comment: *"GCP3 classifies every numeric literal as 'number' (§45)"* — so a
  literal `1` types as `number`, never `integer`.
- SPEC §53.2.1 grammar lists `integer` as a `base-type` alongside `number`/`string`/`boolean`.
- Corpus (PA-measured, plain grep, 2555 `.scrml` files): **74** `fn`/`function` declarations carry
  at least one `int`/`integer`-annotated parameter, across **26** files.

## WHAT TO BUILD — `scripts/int-number-census.ts`

A re-runnable probe, in the house style of `scripts/source-text-regex-census.ts` and
`scripts/review-debt.ts`: `--summary` (human) and `--json` (machine), and **it SHALL report its own
totals (`N of M`) so a truncation is visible in the output rather than inferable from it**
(pa-base §8, the truncated probe).

It answers FOUR questions over the real corpus (`**/*.scrml`, excluding `node_modules/` and
`.claude/worktrees/`):

1. **Every `int`/`integer` ANNOTATION POSITION**, bucketed by position kind: function/`fn`
   parameter · function/`fn` return type · struct field · state-cell declaration · schema column ·
   map key/value · array element · other. Report counts and the file:line of each.

2. **Every CALL SITE that reaches an `int`/`integer`-annotated parameter**, and what is passed,
   classified as:
   - `integral-literal` — a numeric literal with no fractional part (`1`, `-7`, `0`)
   - `fractional-literal` — a numeric literal with a fractional part (`1.5`)
   - `number-annotated` — an identifier whose declared annotation is `number`
   - `int-annotated` — an identifier whose declared annotation is `int`/`integer` (the diagonal;
     these already pass)
   - `unannotated` / `inferred` — no resolvable annotation
   - `other` — anything else (call result, arithmetic, member access, …); sub-bucket it
3. **The DIAGONAL question:** how many of the bucket-2 sites would a strict name-equality rule
   REJECT (i.e. everything not `int-annotated`), and of those, how many are `integral-literal`?
   That is the "37 of 40" claim; report the real pair.
4. **The REVERSE direction:** call sites passing an `int`/`integer`-typed value into a
   `number`-annotated parameter. Under a refinement reading this is the SAFE direction and must
   never be rejected; report the count so the operator can see both sides of the door.

⚑ **Prefer the compiler's own machinery over regex.** This is a POST-AST question and Rule 7
(`pa-scrml-overlay.md`) binds new code: reach for the real parse (`compiler/src/api.js`, or the
type-system's own resolution) rather than asking the source text what the tree already knows. Where
you genuinely must scan text, carry a one-line justification in a comment. If a full parse is too
slow over 2555 files, say so with a timing measurement and state exactly what the fallback loses.

## WHAT NOT TO DO

- **Do NOT change any compiler behaviour.** No edit to `fieldTypeEquals`, `fieldTypeAssignable`,
  `BUILTIN_TYPES`, or any diagnostic. This dispatch is a MEASUREMENT and the direction is the
  operator's. A patch here would pre-empt a ruling.
- Do NOT turn on §7.5.1 position 3.
- Do NOT file the finding as a gap or edit `docs/known-gaps.md` — the PA files it (that doc is
  contended with a live sibling session).

## CRASH RECOVERY (mandatory)
Commit after each meaningful unit — WIP commits expected; the branch is the checkpoint. Maintain an
append-only timestamped `docs/changes/int-number-assignability-census-2026-09-06/progress.md`
(what was just done · what is next · blockers). Report your worktree path, the FINAL SHA, and the
files touched.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   `git rev-parse --show-toplevel` MUST equal it. Clean tree. If any check fails: STOP and report.
2. `git merge-base HEAD origin/main` MUST equal `origin/main` — assert your own base, so a wrong
   assumption fails loud instead of silently working from a stale tree.
3. The worktree is cut from `origin/main`, so **this BRIEF is not in it**. Step 1 after the gate:
   `git fetch origin scope/s404-int-number-census && git checkout FETCH_HEAD -- docs/changes/int-number-assignability-census-2026-09-06/`
   (it is committed on the branch `scope/s404-int-number-census`, NOT on `main` — main is branch-protected, so use `git fetch origin scope/s404-int-number-census` and check out FETCH_HEAD for that path).
4. `bun install` (worktrees do NOT inherit `node_modules`; the hook fails "cannot find package
   'acorn'" otherwise). Then `bun run pretest` **plainly, from the worktree CWD** — `bun --cwd <path>
   run <script>` SILENTLY NO-OPS and exits 0. Verify the artifact exists; exit code is no defence.
5. Every Read/Write/Edit uses a worktree-ABSOLUTE path. **NEVER `cd` into the main checkout**; use
   `git -C "$WORKTREE_ROOT"` and `--cwd=<path>` (with the `=`).
6. ⚑ **NEVER `git stash`** — `refs/stash` is SHARED across every worktree, including the PA's main
   checkout and any sibling agent. Do base-vs-build flips by **FILE COPY**.
7. ⚑ **NEVER a bare `pkill -f` / `killall` on a command string** — every checkout shares it, and you
   would silently kill a suite running in main. Kill by PID captured at launch, or filter on cwd.
8. First commit message: `WIP(int-number-census): start at $(pwd)`.
9. NEVER `--no-verify`, and never override `core.hooksPath`. If the gate blocks you, report it.

## DONE-PROBE
`bun scripts/int-number-census.ts --summary` exits 0 and prints, with explicit `N of M` totals: the
per-position annotation counts, the per-classification call-site counts, the strict-rule rejection
count paired with its integral-literal subset, and the reverse-direction count.
