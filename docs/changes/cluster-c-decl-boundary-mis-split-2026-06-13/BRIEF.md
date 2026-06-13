# Cluster C — `${}`-decl-boundary mis-split (two coupled parser/diagnostic fixes)

change-id: `cluster-c-decl-boundary-mis-split-2026-06-13`
Dispatched S190 (2026-06-13). Agent: `scrml-js-codegen-engineer`, isolation:worktree, model opus.

You are fixing TWO related compiler bugs in the block-splitter / ast-builder decl-boundary handling
inside `${...}` logic blocks. They are the same FAMILY (decl-boundary mis-handling at `${`) but are
distinct mechanisms with distinct fix loci. Both are CONFIRMED reproducing at HEAD `ea7eea43`
(PA-verified this session). The full PA diagnosis is below — but you MUST survey + re-confirm the
exact fire loci yourself before changing code (depth-of-survey discount: the named loci are
HYPOTHESES; correct the touchpoint if your survey shows it's elsewhere).

---

# MAPS — REQUIRED FIRST READ

Before consuming any other context (SPEC sections / source files), read `.claude/maps/primary.map.md`
in full (~100 lines). The §"Task-Shape Routing" section tells you which additional maps to consult —
this is a **compiler-source bug fix** (parser/ast-builder + diagnostic + new §34 code). Follow that
routing (error map + structure/primary map at minimum).

Map currency: maps reflect HEAD `a00624f5` as of 2026-06-12 (S189). Current HEAD is `ea7eea43` — that
one commit ahead is the S189 wrap commit (hand-off/changelog/maps/state DOCS only; ZERO source
change). So the maps are effectively current for all source. If your work touches files modified after
`a00624f5`, treat map content as a starting hypothesis to verify via grep/Read.

Feedback in your final report: either "Maps consulted: [list]; load-bearing finding: <one sentence>"
or "Maps consulted but not load-bearing".

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

**S99 leak history: this class of dispatch has had path-discipline leaks before. Do NOT become the next incident.**

Your worktree path is whatever the harness assigned. Before ANY other tool call:

1. `pwd` via Bash. Output MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`.
   If it's under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report — that's the
   S90 CWD-routing failure. Save the output as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git status --short` — confirm clean.
4. `bun install` (worktrees do NOT inherit node_modules; the pre-commit `bun test` fails without it).
5. `bun run pretest` (populates `samples/compilation-tests/dist/`; full `bun test` produces ~130
   ECONNREFUSED failures without it). Use `bun run test` (chains pretest) for baseline, NOT bare `bun test`.

## Path discipline (S99/S126 — IN FORCE)
- **Apply ALL file edits via Bash** (`perl`/`python3`/`cp`/heredoc) on **worktree-absolute paths that
  include the `.claude/worktrees/agent-<id>/` segment** — NOT the Edit/Write tools (Edit/Write have
  leaked into MAIN twice; Bash writes go where `pwd`/`git` resolve). Echo the target path before each
  write; re-verify via `git diff`/`grep` after.
- **NEVER `cd` into the main repo** (or anywhere outside WORKTREE_ROOT). Use `git -C "$WORKTREE_ROOT"`,
  `bun --cwd "$WORKTREE_ROOT"` (or run bun from WORKTREE_ROOT), and worktree-absolute paths exclusively.
  A `cd` into main leaks installs/edits/compiles into MAIN (S126 incidents #14/#15).
- Your FIRST commit message MUST include the verbatim `pwd` output: `WIP(cluster-c): start at <pwd>`.

## Commit discipline (S83 — two-sided rule)
- After EVERY edit: `git -C "$WORKTREE_ROOT" diff <file>` to verify; `git add`; commit IMMEDIATELY.
  Don't batch — commit per sub-fix.
- Before reporting DONE: `git status` MUST be clean. "HEAD unchanged — work in worktree, no commits"
  is NOT an acceptable terminal report. Commit everything.
- Update `docs/changes/cluster-c-decl-boundary-mis-split-2026-06-13/progress.md` after each step
  (append-only, timestamped: what was just done / what's next / blockers). If you crash, your commits
  + progress.md are how the next agent picks up.
- **Re-dispatch note (the FIRST attempt died here):** the prior agent stalled when a COMPOUND Bash
  command — `printf "..." >> progress.md && git add ...` — was denied by the permission classifier, and
  the watchdog never recovered. **De-risk:** keep file writes and git operations as SEPARATE Bash
  calls. Write progress.md via a heredoc (`cat >> "$WORKTREE_ROOT/docs/changes/.../progress.md"
  <<'EOF' ... EOF`) in its own call; run `git -C "$WORKTREE_ROOT" add` / `commit` in separate calls.
  Don't chain a redirect-write with `git add`/`commit` in one `&&` command. The prior attempt got
  through repro-confirmation only (no fix work) before stalling — you start fresh from HEAD `ea7eea43`.

---

# THE TWO BUGS (both CONFIRMED at HEAD `ea7eea43`)

## Bug 1 — g-derived-rhs-interp-wrapped (LOW) — RULING: reject + clean diagnostic

A derived/state-cell decl whose RHS is wrapped in a `${...}` logic block drops the RHS:

```scrml
<page>
${
  <names> = ["a", "bb", "ccc"]
  const <bad> = ${ @names.filter(n => n.length > 1) }
}
<p>${@bad.length}</p>
</page>
```

At HEAD this FAILS: the `${` after `=` is treated as a block boundary, so `const <bad> =` gets an
empty RHS and the `${...}` leaks out as a separate logic block → `E-SCOPE-001: Undeclared identifier
\`$\`` (the orphaned `$`). (The gap's older recorded symptom was `E-CODEGEN-INVALID-JS \`const bad =
;\``; the live symptom is the `$`-orphan — same root.) The plain form `const <bad> = @names.filter(...)`
(no `${}` wrapper) compiles CLEAN.

**RULING (user, S190): REJECT with a clean diagnostic.** Do NOT unwrap-and-accept. The canonical
derived/state RHS is a bare expression (`const <x> = expr` / `<x> = expr`); a `${...}` wrapper at
decl-RHS position is non-canonical and must be rejected with a clear message steering to the bare
form. Consistent with the S182/S183/S188 ERROR rulings on this silent/defect-accept class +
`feedback_limit_primitives_not_godify` (one canonical form, don't widen the primitive to accept a
redundant wrapper).

- Add a NEW §34 Error code. Propose a name (e.g. `E-DERIVED-RHS-INTERP-WRAPPED` or
  `E-DECL-RHS-INTERP-WRAPPED`) — confirm against §34 naming conventions; land the §34 row in the
  SAME change (pa.md Rule 4 — SPEC normative; a routed code must have a §34 row).
- The diagnostic message must name the cause and the fix: e.g. *"A derived/state-cell RHS is a bare
  expression; remove the `${ }` wrapper — write `const <bad> = @names.filter(...)`."*
- Fire it cleanly INSTEAD of the misleading `E-SCOPE-001 $` cascade (suppress the orphan-`$`
  follow-on, mirroring how the S189 E-SYNTAX-045 fix recovers without a spurious E-SCOPE-001 cascade).
- This applies to BOTH `const <x> = ${...}` (derived) AND a plain `<x> = ${...}` (state) decl RHS, in
  both logic-block and (if reachable) other decl loci — verify the position set in your survey.

## Bug 2 — g-markup-const-consumes-cell-decl (RE-TAGGED MED this session) — RULING: fix the parse

Inside a `${}` block, a markup-typed `const X = <markup>...</markup>` followed by a structural cell
decl `<cell> = init` causes the markup-const body to OVER-CONSUME the following sibling decl:

```scrml
<page>
${
  const G = <div class="x">hi</div>
  <name> = "Ada"
}
<p>${@name}</p>
</page>
```

**At HEAD this compiles exit-0 but is SILENTLY WRONG: `@name` renders EMPTY, not "Ada".** The string
`"Ada"` appears NOWHERE in the emitted output. Compare the clean orderings, which BOTH wire
`_scrml_reactive_set("name", "Ada")` + `_scrml_init_set("name", () => "Ada")`:
- cell-FIRST: `${ <name> = "Ada"; const G = <div...>... }` → CLEAN, "Ada" present.
- bare top-level (no `${}`): `<name> = "Ada"` then `const G = ...` → CLEAN, "Ada" present.

**Why it's now SILENT (severity re-tag to MED, ruled S190).** Pre-S189 this fired a LOUD
`E-SCOPE-001` on `@name` (cell never registered). S189's §6.9 `preBindReactiveStateCells` hoist
(`type-system.ts:10589`) pre-binds file-scope reactive cells from existing `state-decl` nodes — it
MASKED the loud E-SCOPE-001 but did NOT fix the parse: the `<name> = "Ada"` decl's INITIALIZER is
still swallowed, so the cell defaults to canonical-empty (`""`) instead of `"Ada"`. The bug went from
loud-diagnostic to silent-data-loss — that's WHY it's re-tagged MED.

**The fix must restore the FULL decl** — `name` must parse as a sibling `state-decl` with its
`= "Ada"` initializer intact, so it inits to `"Ada"`. Do NOT lean on the §6.9 hoist (it only binds
NAMES; it cannot recover a lost initializer). Verify your fix produces
`_scrml_reactive_set("name", "Ada")` in the emitted JS for the const-then-cell ordering.

### Bug 2 is BROADER + the root is DIFFERENT than first scoped (PA dog-food, S190 — re-dispatch addendum)

PA dog-fooded the adjacent surface on the current compiler. The swallow is NOT "the markup body
over-runs past its close tag" — it is **the Form-2 markup-const raw-capture grabbing the ENTIRE rest
of the `${}` block** (from the markup opener to the block's closing `}`). Evidence:

- A markup const FIRST in a `${}` block swallows **every following sibling** in that block — `<a>=1 <b>=2 <c>=3` (p7) → none get `_scrml_reactive_set`; a following derived `const <doubled> = @count*2` (p1) → both `count` and `doubled` lost; a following Shape-2 bindable `<userName req> = <input/>` (p4) → silently renders the LITERAL `<userName />` tag (render-by-tag never expands); a following `fn label()` (p2) → LOUD `E-SCOPE-001: Undeclared identifier \`label\``.
- It happens **even when the markup const SELF-CLOSES** — `const G = <br/>` then `<name> = "Ada"` (p6) → name still lost. A self-closed tag has NO body to over-run, so the root is the raw-capture extent, not body termination.
- Ordering matters: cell-FIRST (`${ <name>="Ada"; const G=<div>... }`) and bare-top-level are CLEAN — only `[Form-2 markup const, THEN anything]` in the same `${}` block triggers it.

So the real fix locus is the **Form-2 auto-lift raw-capture body-extent** (where `const Name = <markup>`
captures its RHS): it must stop at the markup value's end (self-close `/>` OR the matching close tag),
and everything after it in the `${}` block must parse as ordinary sibling statements/decls. Symptom
matrix: cells/deriveds → SILENT (lost init / canonical-empty); Shape-2 bindable → SILENT (literal
unexpanded tag); functions → LOUD (E-SCOPE-001). Your fix must close ALL of these.

**RULING: fix the parse** (no design fork). A `<cell> = init` / derived / fn / bindable decl after a
markup const inside a `${}` block is VALID scrml that SHALL register/parse (SPEC §6; §38.1 literally
shows `${ <username> = "" }`). (`${}`-wrapping is redundant — it warns `W-PROGRAM-REDUNDANT-LOGIC` —
but redundant ≠ broken; it must still parse correctly.)

---

# FIX LOCI (HYPOTHESES — survey + confirm before editing)

- **Bug 1** (`${`-RHS split): `compiler/src/ast-builder.js` — `parseLogicBody` (~:2673) + `collectExpr`
  (~:2842) and/or `tryParseStructuralDecl` (the `const <NAME> = expr` derived/state path, ~:4462).
  Also check the block-splitter (`compiler/src/block-splitter.js`) — the gap notes the `${` may be
  split at the BS layer before the RHS is collected. Find where the RHS collection stops at `${` and
  emit the new diagnostic at the decl-parse site.
- **Bug 2** (markup-const body over-consumption): `compiler/src/ast-builder.js` — the `const Name =
  <markup>` Form-2 auto-lift detection + body-extent machinery (~:509–1006, see "Bug-batch S93 — Bug 2"
  at ~:1185 and the BS-layer split at ~:1187). And/or `compiler/src/block-splitter.js` body-extent /
  close-tag matching. The body-extent must end at the markup's matching close tag, not run into the
  following sibling decl.

These are DISTINCT mechanisms — expect two distinct edits. Survey BOTH before touching either. If your
survey shows the fix is materially broader than this scope (e.g. it requires a structural change to how
BS tokenizes `${}` blocks), STOP and report a Phase-0 finding before proceeding — this region is
"block-splitter blast-radius" (deferred S181/S188 for exactly that reason).

---

# RULE 4 — VERIFY AGAINST SPEC (read these sections IN FULL before encoding behavior)

- §6.2 (three RHS shapes — Shape 3 derived `const <x> = expr`; the RHS is a bare expression).
- §6.4 / §7 (logic contexts; `${...}` is a logic/interpolation block — its valid positions).
- §40.8 (default-logic mode — `<program>`/`<page>` bodies; bare top-level decls auto-lift;
  W-PROGRAM-REDUNDANT-LOGIC). This is why the `${}` wrapper is redundant-but-legal.
- §6 / §38.1 (a `<cell> = init` inside a `${}` logic block SHALL register — §38.1 shows
  `${ <username> = "" }`).
- §6.9 + `type-system.ts:10556-10609` (the `preBindReactiveStateCells` hoist — understand it masks
  Bug 2's loud symptom but cannot recover the lost init).
- §34 (error-code catalog conventions — for the new Bug 1 code).

If the SPEC is silent/ambiguous on anything load-bearing, surface it in your report — do NOT paper
over it.

---

# PHASE 3 — MANDATORY R26 EMPIRICAL VERIFICATION (this is BS-region — do NOT skip)

Regression tests are necessary but NOT sufficient here. Before reporting DONE, empirically re-compile
real source on YOUR post-fix baseline and confirm the exact symptom shapes:

1. **The repros** (recreate them; exact bodies in this brief). Bug 1: t3 (`${}`-wrapped const-derived
   RHS), p5a (`${}`-wrapped PLAIN state `<bad> = ${...}`), p5b (`${}`-wrapped TYPED `const <bad>: number
   = ${...}`) → all now fire the NEW clean diagnostic (NOT `E-SCOPE-001 $`); t4 (plain RHS) → CLEAN.
   Bug 2: c5/c5b/c5c (const-then-cell, incl. multi-cell + nested-interp) → CLEAN **and
   `_scrml_reactive_set("name", "Ada")` present**; **p1** (const-then-cell-then-derived) → `count`=5 +
   `doubled` both wired; **p2** (const-then-FN) → `fn label` resolves (no E-SCOPE-001); **p3** (TWO
   markup consts then cell) → name + A + B all wired; **p4** (const-then-Shape-2-bindable) →
   `<userName/>` EXPANDS (not literal); **p6** (SELF-CLOSING `const G=<br/>` then cell) → name=Ada
   wired; **p7** (const then a/b/c) → all three `_scrml_reactive_set`. Plus the always-clean controls
   c6 (cell-then-const) + c4 (bare top-level) → still "Ada". (PA's /tmp/cc-s190 + /tmp/cc-probe repro
   files are gone with the session; recreate from the bodies in this brief.)
2. **`node --check`** on the emitted client JS for every repro that compiles — exit 0.
3. **The flagship** `examples/23-trucking-dispatch/` — re-compile the whole app; confirm ZERO new
   errors/regressions (it has derived cells + markup consts; this region is high-blast-radius).
4. **Full test suite** (`bun run test`, NOT just the pre-commit subset) — this touches BS/parser, so
   the browser + self-host + commands suites matter. 0 fail is the contract. Report the counts.

Report the R26 table (each repro: symptom before → after) in your final report. **Do NOT mark DONE
without R26 passing.**

---

# TESTS

- Add regression tests covering: Bug 1 (the new diagnostic fires on `${}`-wrapped RHS for const-derived
  AND plain-state, in logic-block position; the plain bare-expr RHS stays clean — no false fire). Bug 2
  (const-then-cell in `${}` registers the cell WITH its init value; multi-cell; nested-interp markup
  const; the cell-first + bare-top-level orderings stay clean). Put them where the BS/ast-builder
  parser tests live (grep for similar `*.test.js` — e.g. the g-division `division-in-ternary-arm.test.js`
  pattern, or a new `cluster-c-decl-boundary.test.js`).
- A coupled code+test commit is ONE logical unit (don't split into a transiently-red window).

---

# SPEC + DOCS

- §34: new Bug-1 code row (in the SAME change). For Bug 2: no new code (it's making valid scrml parse).
- If the §34 `E-SCOPE-001`/related rows or any prose claim the wrong behavior for these forms, fix it
  (Rule 4). Keep changes minimal + spec-faithful.
- Do NOT touch the native-parser `.scrml` mirrors unless your survey shows the live-pipeline fix has a
  native-parser sibling that's reachable — the native parser is feature-stale and DEFERRED to the ~v0.8
  cutover (note it in your report instead).

---

# REPORT SHAPE (final message = raw data for the PA)

- WORKTREE_PATH, FINAL_SHA, BRANCH.
- FILES_TOUCHED (full list).
- Per-bug: root cause (precise — file:line), the fix, the new §34 code name (Bug 1).
- R26 table (5 repros + flagship + full-suite counts: pass/skip/fail).
- Maps-consulted line.
- Any Phase-0 STOP findings / deferrals / SPEC ambiguities surfaced.
- Confirm `git status` clean + the first-commit `pwd` echo.
