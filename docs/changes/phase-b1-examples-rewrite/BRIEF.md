# BRIEF — phase-b1-examples-rewrite (sPA ss11, item 7)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Base SHA:** 0a605d3e · **Land target (sPA-owned):** branch `spa/ss11` via file-delta

## Goal
Bring the `examples/` corpus to **canonical scrml**. All 29 top-level examples + the two multifile
dirs (`22-multifile`, `23-trucking-dispatch`) ALREADY COMPILE CLEAN (sPA verified: 29 pass / 0 fail).
This is a CANONICAL-FORM pass, not a fix-failures pass: drive deprecation warnings to zero and modernize
forms WITHOUT changing what each example demonstrates.

## Scope of forms to migrate
1. **Arm separators -> `:>`** (S147). Migrate ONLY ARM-context `=>`/`->` (match arms, `!{}` handler arms)
   that fire `W-MATCH-ARROW-LEGACY`. **DO NOT TOUCH** (all canonical, verified-clean):
   - projection-engine arrows `.Small => .AtRisk` / `.Big | .Fire => .Safe` (§51.9 grammar; e.g.
     `14-mario-state-machine.scrml` compiles clean with these);
   - fn-return `->` (`function persist(...)! -> Err`);
   - JS arrow-function glyph `(e) => fn(e)`.
   The discriminator is the SAME as the tutorial audit's §B5: compile-with-warnings and migrate exactly
   the sites that fire `W-MATCH-ARROW-LEGACY`, nothing else.
2. **null/undefined -> `not`** — ABSOLUTE rule (memory `feedback_null_does_not_exist_in_scrml`). Convert
   GENUINE `null`/`undefined` absence to `not`. PRESERVE `""` / `0` / `false` / `[]` / `{}` — those are
   DEFINED values, NOT absence. Sweep source `.scrml` only — the grep flagged
   `23-trucking-dispatch/{customers,app}.scrml` (plus build artifacts under `dist/` + `FRICTION.md` which
   you IGNORE — `dist/` is gitignored generated output, FRICTION.md is a notes doc). Check each hit in
   context: a `null` inside a string literal / comment / JS-host interop block may be intentional — only
   convert true scrml-source absence values.
3. **Canonical decl form + file-top `${...}` wrapper** — drop redundant file-top `${...}` wrappers that
   fire `W-PROGRAM-REDUNDANT-LOGIC` (bare top-level decls auto-lift under default-logic mode). Canonical
   V5-strict decl shape per the language primer.

## Per-example loop
For each example: compile WITH warnings visible -> identify firing deprecation lints -> rewrite the
firing forms canonically -> recompile -> confirm 0 `E-` and 0 deprecation `W-` (W-MATCH-ARROW-LEGACY,
W-PROGRAM-REDUNDANT-LOGIC, W-DEPRECATED-*). Acceptable residual warnings: `W-PROGRAM-SPA-INFERRED` and
other non-deprecation infos are fine.

## Constraints
- **VERIFIED.md is USER-OWNED.** Do NOT flip any `[x]`/`[ ]` verification checkbox. The user re-verifies
  after rewrite. You MAY append a note that a given example was canonical-rewritten and needs re-verify,
  but never assert verification yourself.
- Preserve each example's teaching intent + structure — minimal-diff canonicalization, not a redesign.
- Multifile dirs: rewrite the `.scrml` sources; ignore `dist/` (gitignored build output).

## Acceptance
- All 29 top-level + both multifile dirs compile: 0 `E-`, 0 deprecation `W-`.
- `git diff` touches only `.scrml` sources (+ optionally a VERIFIED.md needs-reverify note) — no `dist/`,
  no `.db` files.
- Report a per-example table: file · forms migrated · final warning set.

## SHARED DISCIPLINE BLOCK
See the dispatch prompt for the startup-F4 verify, path-discipline (no main-absolute writes; stat+read-back),
incremental commits (commit per-example or per-small-batch, not one giant commit), progress.md, no `--no-verify`.
