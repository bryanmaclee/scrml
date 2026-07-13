# BRIEF — mint E-TYPE-082: enum-variant CONSTRUCTION payload-arity mismatch (fail-arity)

**Change-id:** `mint-e-type-082-variant-construction-arity-2026-07-13`
**Dispatched:** S253, 2026-07-13. **Agent:** scrml-js-codegen-engineer, isolation:"worktree".
**Origin + ruling:** known-gaps `g-fail-variant-payload-arity`. bryan RULED (S253): mint a **GENERAL
construction-arity code, NOT `E-ERROR-010`, NOT fail-only** — the S252 probe found arity is unchecked
**construction-wide** (the non-fail path `let e = MyError.Timeout("oops")` evades too), so the check
belongs at the variant-CONSTRUCTOR site, not the fail handler.

⚠️ **A PARALLEL Class A dispatch is live** (`wire-sql-schema-static-checks-2026-07-13`) — it owns
`gauntlet-phase1-checks.js`, `schema-differ.js`, the SQL/route codegen path (E-SQL-007), and
`conformance/cases/{schema,sql}`. **You own a DISJOINT surface: `type-system.ts` (variant-constructor
region only) + `compiler/SPEC.md` (§34 + the arity prose) + `conformance/cases/error` (or `type`).**
Do NOT touch the SQL/schema/codegen path. Declare your owned `type-system.ts` block (via
`bun scripts/dock.ts --units compiler/src/type-system.ts`) in your report so I can stray-check at land.

---

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full first; follow §"Task-Shape Routing" for a compiler-source
diagnostic task. Currency: HEAD `bc229946`; the map's `fbb4d9fd` (2026-07-09) is current for
compiler-source (intervening commits are PA-docs). Report the load-bearing finding (or "not
load-bearing").

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Echo your real `pwd` = WORKTREE_ROOT.
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` — if under any
   OTHER repo, STOP + report (S90 CWD-routing). 2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
   3. `git status --short` clean. 4. `bun install`. 5. `bun run pretest`. Any fail → STOP + report.
- Write/Edit ALWAYS via ABSOLUTE paths under WORKTREE_ROOT; prefer Bash-edit (echo path, `git diff`
  after); NEVER `cd` into main; use `git -C "$WORKTREE_ROOT"` / `--cwd "$WORKTREE_ROOT"`.
- First commit message includes your startup pwd: `WIP(e-type-082): start at $(pwd)`.
- Commit after every edit (WIP fine; branch = checkpoint); keep `progress.md`; clean `git status`
  before DONE.

---

## THE TASK — mint E-TYPE-082 + wire the construction-arity check

**Rule 4 — read the SPEC before wiring; the rule text is authority:**
- **§14.4** (enum variant definitions — the declared payload field count is the arity contract).
- **§18.7** "Payload Destructuring" (~L11851) — home of **`E-TYPE-021`** "payload arity mismatch in
  positional DESTRUCTURING." **E-TYPE-082 is the CONSTRUCTION-side sibling of E-TYPE-021.** Model the
  new §34 row + prose on E-TYPE-021.
- **§51.0.B.1** — `E-ENGINE-PAYLOAD-ARITY-MISMATCH` (~§34 L18145): a locus-specific arity-code
  precedent (state-child form). Confirms the pattern: arity codes are locus-scoped and distinct from
  E-TYPE-021 by diagnostic surface.
- **§19.3.3** — the `fail` context (E-ERROR-001 non-`!`, E-ERROR-009 variant-validity).

### The gap (verified S253)
Enum-variant CONSTRUCTION arity is UNCHECKED. `fail MyError.Timeout("oops")` where `Timeout` is a
NULLARY (or wrong-arity) variant compiles SILENTLY — the variant IS valid (so E-ERROR-009 correctly
does NOT fire), but the payload count is wrong. Same for the non-fail paths
`let e = MyError.Timeout("oops")` and `return MyError.Timeout("oops")`.

### The seam (verified S253)
- The variant-constructor type-check is in `compiler/src/type-system.ts` — the region around
  `inferBareVariantsAtVariantCtorArgs` / `resolveCtorVariant` (~L14855-14930) handles variant-constructor
  call-arg positions. The arity check belongs where a `.Variant(args)` application is type-checked
  against the resolved `VariantDef`'s payload field count.
- The `fail` handler (~L9600-9660: E-ERROR-001 + E-ERROR-009) **explicitly defers payload-arity**
  ("payload-arity compat is a distinct, deeper" check, ~L9716; "unchecked, surfaced", ~L9619). Because
  the ruling is GENERAL, put the check at the CONSTRUCTOR site so it covers fail AND non-fail AND
  return — do NOT bolt it onto the fail handler only.
- LOCATE the exact arity-check insertion yourself (don't assume a line) — Rule 4 + verify against the
  VariantDef payload shape. If the constructor call isn't type-checked in one place, report the shapes
  you covered.

### The code
- **Mint `E-TYPE-082`** (verified free; highest existing E-TYPE is 081) = "enum-variant construction
  payload arity mismatch" — too many / too few / any-payload-on-nullary. Severity **Error**.
- Per Rule 4 (SPEC normative; named-codes-land-with-impl): add the **§34 catalog row** +
  a **normative statement** (in §14.4 and/or §18.7 as the construction sibling of E-TYPE-021, with a
  cross-ref). This dispatch DOES touch `compiler/SPEC.md` (§34 + the arity prose) — that's expected and
  disjoint from the parallel Class A dispatch (which touches no SPEC).
- **Interaction with E-ERROR-009 (no double-fire):** E-TYPE-082 fires when the variant is VALID but
  the payload arity is wrong; E-ERROR-009 fires when the variant NAME is invalid. A valid-variant/
  wrong-arity `fail` → **E-TYPE-082 only**; an invalid-variant `fail` → **E-ERROR-009 only**. Verify no
  double-fire and no regression on the E-ERROR-009 cases.

### Conformance cases
Add neg cases covering each construction shape — `fail`-path (valid variant, wrong arity), non-fail
`let`/assignment, and `return` — plus a pos clean case. Mirror the landed pattern
(`conformance/cases/<group>/<name>/case.scrml` + the exact expected-metadata shape those dirs use;
pick the `error` or `type` group as fits). Run `bun conformance/run.ts` — all green including yours.

### Gates (NO --no-verify)
- `bun run test` (FULL suite) green. `bun conformance/run.ts` green.
- STOP + report if the SPEC arity basis is ambiguous or the constructor seam doesn't fit — do NOT guess.

### Report
- WORKTREE_ROOT, FINAL_SHA, FILES_TOUCHED, deferred.
- Your owned `type-system.ts` block(s) (dock --units) + the exact arity-check insertion site.
- Confirmation E-ERROR-009 doesn't double-fire / regress.
- NOTE: `/code-review` is not invokable in-agent — the PA runs the mandatory S239 adversarial review
  before landing. Self-review thoroughly but expect the PA pass.
