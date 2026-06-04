# DISPATCH BRIEF — R28-8: bare-variant inference into VALIDATED struct fields

**change-id:** `r28-8-validated-struct-field-inference-2026-06-04`
**agent:** scrml-js-codegen-engineer · isolation: worktree
**ratified:** S151 (extend §14.10 bare-variant inference; user verified "only drawback is extra work, no new semantic-ambiguity class")

---

# MAPS — REQUIRED FIRST READ

Before consuming any other context, read `.claude/maps/primary.map.md` in full (~170 lines).

The §"Task-Shape Routing" section names which additional maps to consult. Your task shape is
**"bare-variant inference fix (R28-8)"** — there is a dedicated route + a "Bare-variant inference
helpers" table in `structure.map.md` (the three walkers + their call sites, line-confirmed against
HEAD ef5713df).

Map currency: the refreshed maps live at main commit `ef5713df` (2026-06-04). **Your worktree
branches from the SESSION-START commit `9f01f6cd` (S112 — NOT live HEAD), so until you run the
merge-startup step (Startup Verification 4b below) your worktree has the OLDER maps.** After the
ff-merge, `.claude/maps/` is current — `structure.map.md` will contain the "Bare-variant inference
helpers" table. Read the maps AFTER the merge.

Feedback: in your final report include either:
- "Maps consulted: [list]; load-bearing finding: <one sentence>"
- "Maps consulted but not load-bearing — [which map you expected to help but didn't]"

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is whatever the harness assigned. S99/S126 has had path-discipline leaks; treat
this as incident-prevention.

## Startup verification (do this BEFORE any other tool call)

1. `pwd` via Bash. Output MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`.
   If it is under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that is
   the S90 CWD-routing failure. Save the output as `$WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` MUST equal `$WORKTREE_ROOT`.
3. `git status --short` — confirm clean.
4. `git rev-parse HEAD` — note it; your base. **The harness branches worktrees from the
   SESSION-START commit `9f01f6cd`, NOT live HEAD (S112), so your base is STALE.**
4b. **S112 FIX — pick up this session's commits BEFORE doing anything else:** run
   `git -C "$WORKTREE_ROOT" merge --ff-only main`. This fast-forwards your worktree branch to the
   live main tip (linear history), pulling in the refreshed `.claude/maps/` + this BRIEF's change-id
   dir. It MUST fast-forward cleanly. If it does NOT (non-ff / divergence reported), STOP and report.
   Confirm after: `git -C "$WORKTREE_ROOT" log --oneline -1` shows a `docs(s161)` commit, and
   `grep -c "Bare-variant inference helpers" "$WORKTREE_ROOT/.claude/maps/structure.map.md"` is ≥1.
5. `bun install` (worktrees don't inherit node_modules).
6. `bun run pretest` (populates `samples/compilation-tests/dist/` for browser tests).
7. Baseline: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`
   should be GREEN before you change anything. (Full `bun run test` is the pre-push gate; the subset is
   the pre-commit gate.)

If ANY check fails: DO NOT proceed. Report and exit.

## Path discipline (enforce on EVERY edit)

- **Apply ALL file edits via Bash** (`perl`/`python3`/`cp`/heredoc on `$WORKTREE_ROOT`-absolute paths
  that include the `.claude/worktrees/agent-<id>/` segment), NOT the Edit/Write tools. Echo the target
  path before each write; re-verify via `git diff`/`grep` after. (S126 interim mitigation — Edit/Write
  have leaked to MAIN twice while git/pwd saw the worktree.)
- **NEVER `cd` into the main repo or anywhere else.** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd
  "$WORKTREE_ROOT"`, and worktree-absolute paths exclusively. (S126 — `cd` leaks `bun add` / compile
  commands into MAIN.)
- First commit message MUST embed your `pwd`: `WIP(r28-8): start at $(pwd)`.

## Commit discipline (S83 — both sides necessary)

- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` to verify; `git -C "$WORKTREE_ROOT" add
  <file>`; commit IMMEDIATELY. Don't batch — commit per sub-step.
- Before reporting DONE: `git -C "$WORKTREE_ROOT" status` MUST be clean. "work in worktree, no commits"
  is NOT an acceptable terminal report.
- Update `docs/changes/r28-8-validated-struct-field-inference-2026-06-04/progress.md` after each step
  (append-only, timestamped). WIP commits expected. If you crash, your commits + progress.md are how
  the next agent resumes.
- Report: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, deferred items, and the maps feedback line.

---

# THE BUG (R28-8) — confirmed live, root-caused

**Symptom.** Bare-variant inference into a typed object-literal field FAILS with `E-VARIANT-AMBIGUOUS`
when the struct field carries a trailing validator (`req`, `length(...)`, etc.). Plain enum fields work.

**Minimal reproducer (FAILS today — `E-VARIANT-AMBIGUOUS` on `.News`):**
```scrml
type Category:enum = { News, Opinion, Tech, Culture }
type Article:struct = { id: int, category: Category req }   // ← `req` validator
<x> = 0
function build() {
    const draft: Article = { id: 0, category: .News }       // ← E-VARIANT-AMBIGUOUS today
    @x = draft.id
}
<page><button onclick=build()>Build</button></page>
```

**Control (PASSES today — drop the `req`):** `category: Category` (no validator) → `.News` resolves clean.

**Root cause (line-confirmed, type-system.ts @ HEAD ef5713df):** the struct-body resolver at
**`type-system.ts:1838-1844`**:
```js
const fieldTypeExpr = part.slice(colonIdx + 1).trim();   // = "Category req"  (INCLUDES the validator)
...
fields.set(fieldName, resolveTypeExpr(fieldTypeExpr, typeRegistry));   // resolveTypeExpr("Category req") → asIs
```
`resolveTypeExpr("Category req", ...)` doesn't match the registry's `Category` (the trailing `req`
defeats the lookup) → the field type drops to **`asIs`**. The bare-variant inference walker
`inferBareVariantsWithStructNav` (type-system.ts:8199; the `fieldType = structType.fields.get(fieldName)`
read at **:8237**) then recurses with that asIs/null context → the flat walker `inferBareVariantsInExpr`
hits the no-context branch (~:7958) → `E-VARIANT-AMBIGUOUS`.

This asIs-drop is **documented** at `type-system.ts:12847` ("the struct-body resolver lowers a field
carrying ANY trailing validator predicate to `asIs`"). The **schemaFor** path works around it with a
SEPARATE raw-clause recovery (`_schemaForRecoverEnumSubset` @ :12865 + the `structFieldRawClauses` map).
The bare-variant inference path has NO such recovery — that is the gap.

**Confirmed not-the-bug (already work — do NOT touch):**
- Plain (non-validated) enum object-literal fields: work since S84 `6af9fbaf`.
- `is some`-narrowed `==` RHS (direct cell + member-access): works (the §14.10 comparison pre-pass
  `inferBareVariantsAtComparisonSites`).
- State-cell decl `<x>: Struct = {...}` (vs the const/let-local form): works.

---

# THE FIX — survey first, STOP-gate on blast radius

## Phase 0 — SURVEY (mandatory) + STOP-gate

The natural fix is at the **root** (`type-system.ts:1844`): strip the trailing validator from
`fieldTypeExpr` before `resolveTypeExpr`, so a validated field resolves to its true base type
(`Category req` → enum `Category`; `Role oneOf([.Admin,.Editor])` → the enum-SUBSET `PredicatedType`
via `parseEnumSubsetRefinement`, NOT the bare base — preserve the subset). This fixes the data at
source — `structType.fields` would carry the correct type for ALL consumers.

**BUT the blast radius is the open question.** Enumerate EVERY consumer of `structType.fields` (grep
`structType.fields` / `.fields.get` / `.fields.values` across `compiler/src/`). For each, decide
whether changing a validated field's resolved type from `asIs` → base-type REGRESSES it:
- schemaFor / formFor / tableFor (the L22 family) — they already have raw-clause recovery
  (`structFieldRawClauses`). Does fixing `structType.fields` double-handle, short-circuit differently,
  or regress their enum-subset / nullable handling? (See `_schemaForRecoverEnumSubset` @ :12865 and the
  `structFieldRawClauses` map population.)
- The field-VALUE type-check (probe showed `const draft: Article = { category: 42 }` compiles CLEAN
  today with `category: Category req` because the field type is asIs — fixing the type may START firing
  a type-mismatch there. That is arguably CORRECT, but it's a NEW diagnostic surface — verify it
  doesn't break the existing corpus/examples/samples).

**STOP-gate (S158 Phase-0-survey-STOP pattern, user-ratified):**
- If the survey shows approach (A) [fix the root at :1844] is **clean** — no consumer regresses, the
  full suite stays green, the corpus (`examples/` + `samples/`) compiles unchanged except the intended
  fix — then PROCEED with (A) and land it. (A) is preferred: it fixes the disease, not just this symptom.
- If the survey shows approach (A) has a **large/uncertain blast radius** (new corpus errors, consumer
  regressions you can't cleanly resolve), DO NOT make the risky root edit. Instead either:
  - fall back to the **localized** fix (B): make `inferBareVariantsWithStructNav` recover the field's
    base type when `structType.fields.get()` yields asIs — by re-parsing the field's raw clause
    (mirror `_schemaForRecoverEnumSubset`'s leading-type-token + validator-strip approach; you'll need
    the raw field clauses threaded to the walker, OR store a validator-stripped base type alongside the
    asIs entry at resolution time and read it only in the inference walker), confined to the inference
    path so no other consumer changes; OR
  - **STOP and report the survey** with your recommendation + the regression list, and let PA decide.
- State in your report WHICH approach you took and WHY, with the consumer-regression evidence.

## The validator-strip detail (whichever approach)

`resolveTypeExpr` must, for a struct field clause, FIRST try the enum-SUBSET recognizer
(`parseEnumSubsetRefinement` — keeps `Role oneOf([.Admin,.Editor])` as a subset `PredicatedType`, whose
bare-variant resolution the flat walker's predicated-branch @ :7976 already handles), and only if that
returns null, strip trailing space-separated validator tokens (`req`, `length(...)`, `pattern(...)`,
`min(...)`, `max(...)`, `gt/lt/gte/lte/eq/neq(...)`, `notIn([...])`, etc. — the §55.1 universal-core +
the `| not` / `?` nullability which composes per the existing `_schemaForFieldTypePortionIsOptional`
path) and resolve the remaining base type. Reuse the existing strip/recovery helpers rather than
re-implementing — the schema path already solved "isolate the type portion from the validators."
Do NOT discard nullability (`Category req | not` etc.) incorrectly.

---

# Phase 3 — EMPIRICAL R26 VERIFICATION (mandatory; S138 doctrine)

This fix relies on the AST/type-resolution being correct end-to-end. Regression tests alone do NOT
close it. After landing, re-compile REAL + synthetic source on your post-fix baseline:

1. **The synthetic reproducer** (above) — must compile CLEAN; and the typo variant
   (`category: .Newz`) must fire **E-TYPE-063 naming enum `Category`** (NOT E-VARIANT-AMBIGUOUS) —
   proving real inference, not a silent skip.
2. **The real gauntlet source** — re-compile
   `/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/gauntlet-r28/dev-3-elixir.scrml`
   with the QUALIFIED workarounds at lines 125-126 (`Category.News` / `ArticleStatus.Draft`) reverted
   to BARE (`.News` / `.Draft`) in a /tmp copy (do NOT edit the gauntlet source in place — it's in a
   sibling repo). The bare form must now compile past the inference check (it will still hit the
   pre-existing `E-PA-002` press.db error — that is UNRELATED; grep that NO `E-VARIANT-AMBIGUOUS` fires
   on `.News`/`.Draft`).
3. `node --check` the emitted JS for the synthetic reproducer → exit 0.
4. **DO NOT mark DONE without empirical R26 verification passing** (synthetic clean + typo→E-TYPE-063 +
   no E-VARIANT-AMBIGUOUS on the reverted-bare gauntlet fields).

# Tests

Add a focused unit test (e.g. `compiler/tests/unit/r28-8-validated-struct-field-inference.test.js`)
covering: validated enum field bare-variant resolves; typo → E-TYPE-063; subset-refined field
(`oneOf([...])`) bare-variant still resolves against the subset (not the base); plain (control) field
still works; nullable validated field (`Category req | not`). Keep the existing bare-variant +
enum-subset + B20 suites green.

# SPEC

SPEC §14.10's catch-all ("or any other position where the type is fixed by the surrounding
declaration") ALREADY authorizes object-literal field positions — this is an IMPL fix, **no SPEC
amendment needed**. (If your survey finds the §14.10 normative-statement list should add an explicit
"object-literal field whose struct type is known" example for clarity, NOTE it as an optional doc-polish
recommendation — do NOT amend SPEC.md in this dispatch.)

# Scope guard

This dispatch is the VALIDATED-struct-field inference fix ONLY. Do NOT:
- "improve" the field-VALUE type-checking beyond what falls out of the fix (if fixing the field type
  starts firing legitimate type-mismatches, that's fine; do not go hunting for more).
- touch the `is some`-narrowed `==` path (already works).
- refactor the L22 (schemaFor/formFor/tableFor) raw-clause recovery (only verify it doesn't regress).
- migrate any corpus/examples.

Report the final test counts (subset + relevant suites) and the R26 verification table.
