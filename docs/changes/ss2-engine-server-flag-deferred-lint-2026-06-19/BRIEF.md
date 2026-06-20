# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is the CWD that `pwd` reports at startup.

## Startup verification (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Else STOP (S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. `git rev-parse --abbrev-ref HEAD` + `--short HEAD`; `git status --short` clean.
4. `bun install`. 5. `bun run pretest`. Baseline via `bun run test`.

If ANY check fails: STOP and report.

## Path discipline
- ALL edits via Bash (`perl -0pi`/`python3`/heredoc/`cp`) on WORKTREE_ROOT-absolute paths
  WITH the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write (S126). Echo path
  before each write; verify with `git diff` after.
- NEVER main-rooted paths; NEVER `cd` into main. Use `git -C`/`bun --cwd`/absolute paths.

## Commit discipline
- Commit per unit; create+update
  `docs/changes/ss2-engine-server-flag-deferred-lint-2026-06-19/progress.md` per step.
- Coupled code+test = ONE commit. `git status` clean before DONE. NEVER `--no-verify`.

---

# TASK — ss2 item 2: surface the silently-swallowed bare `server` flag on `<engine>`

## The bug (R26-reproduced by the sPA at c734ec35; known-gaps.md:196)

`<engine for=Phase initial=.Loading server>` (a BARE `server` flag, no `=@source`) compiles
with **ZERO diagnostics** and emits JS byte-identical to a plain engine — the flag is
parsed-and-DROPPED. Per `feedback_dont_soft_classify_bugs`, a silent no-op of an
asserted-valid attribute is worse than an error. SPEC §51.0.A asserts "an engine cell MAY
itself be `server`-authoritative (§52 Tier 2)" but the §52 read/load-into-engine-cell path
(the engine-hydration Approach-F **E-leg**) is UNBUILT. The fix is a DEFERRAL WARNING that
tells the adopter the bare flag is recognized-but-not-yet-wired, until the E-leg lands.

Reproduce: compile the source above (`compileScrml({inputFiles, write:false})`) → 0
diagnostics, `engineDecl.serverSource === null`.

## Why the flag is invisible to SYM today (sPA-traced)

`ast-builder.js:14263` captures the engine `server=` attr ONLY via the regex
`\bserver\s*=\s*@(IDENT(\.IDENT)*)\b` → `engineDecl.serverSource` (the `server=@source`
E-leg form, S199). A BARE `server` token in the opener (no `=@…`) matches NOTHING and is
never recorded. So the SYM stage has no signal. You must capture the bare flag at the
parser, THEN warn at SYM.

## The change (4 touch points)

### 1. Parser — capture the bare flag (`compiler/src/ast-builder.js`, ~14263 region)
Where `serverSourceMatch` is computed against the engine opener `header`, ALSO detect a
bare `server` flag: a standalone `server` token in the opener attr region that is NOT the
`server=@…` form and NOT part of another attr name. Record it as a new boolean field on the
engine-decl, e.g. `serverFlagBare` (set it onto the engine-decl node next to `serverSource`
at ~14510/14680). **Be attribute-aware** — do NOT match `server` inside `server=@x` (the
E-leg, already captured), inside an attr VALUE, or inside a `${...}`/string. Mirror the
care the existing opener-attr scanning uses. Default `serverFlagBare = false`.
- The bare flag and `server=@source` are mutually exclusive by shape (one has `=@`, one
  doesn't) — a header with `server=@x` sets `serverSource` and leaves `serverFlagBare`
  false; a header with a lone `server` sets `serverFlagBare` true and leaves
  `serverSource` null.

### 2. SYM — fire the deferral warning (`compiler/src/symbol-table.ts`)
Where engine metadata is built / validated (the engine-decl validation region around
serverSource capture ~5204, or the engine validation walker — pick the locus where other
engine W-/E- diagnostics fire, e.g. near `W-ENGINE-SERVER-SOURCE-NOT-AUTHORITATIVE` at
~7354), when `engineDecl.serverFlagBare === true` (and `serverSource === null`), push a
**`W-ENGINE-SERVER-DEFERRED`** diagnostic with **severity `"warning"`** (NOT error):
- Message names the engine (`for=Type`), states the bare `server` flag is recognized but
  the §52 Tier-2 server-authoritative-engine READ/hydrate path (the engine-hydration E-leg)
  is **not yet wired**, so the flag currently has no effect; and points to the wired
  alternative `server=@source` (§51.0.E, S199) for server-authoritative reactive hydration.
- **Stream partition (CRITICAL — `feedback_diagnostic_stream_partition`):** a `W-` code +
  `severity:"warning"` MUST land in `result.warnings` (non-fatal), NOT `result.errors`.
  Follow the exact pattern the sibling `W-ENGINE-SERVER-SOURCE-NOT-AUTHORITATIVE` uses so it
  routes to the warning stream and does NOT cause CLI exit 1.

### 3. SPEC §34 catalog row (`compiler/SPEC.md`)
Add a `W-ENGINE-SERVER-DEFERRED` row to the §34 diagnostic catalog, sectioned with the
other engine `W-`/`E-` rows (near `E-ENGINE-SERVER-WITH-DERIVED` / the S199 E-leg rows).
Cite §51.0.A + §52 (the asserted-but-deferred feature) and known-gaps.md:196. Mirror the
wording style of the existing `W-ENGINE-SERVER-SOURCE-NOT-AUTHORITATIVE` row.
**NOTE for the sPA:** this is a new diagnostic code = a SPEC §34 addition. The sPA will
FLAG this SPEC-touch to the PA at re-integration (the PA owns SPEC). Author the row
faithfully to the settled known-gaps prescription; do not invent new semantics.

### 4. Codegen — confirm the flag stays inert (`compiler/src/codegen/emit-engine.ts`, ~1791)
Verify the bare flag still produces NO codegen change (the E-leg is unbuilt — the flag must
remain a no-op at emission, only now WITH the warning). If `serverFlagBare` accidentally
alters emission, gate it off. Most likely NO emit-engine.ts change is needed beyond
confirming inertness — state that in your deliverable if so.

## Tests (coupled — one commit)

Add `compiler/tests/unit/engine-server-flag-deferred.test.js`:
- bare `<engine ... server>` → `result.warnings` (use a CROSS-STREAM helper that checks
  BOTH streams, per `feedback_diagnostic_stream_partition`) CONTAINS `W-ENGINE-SERVER-DEFERRED`;
  `result.errors` does NOT; compile still succeeds (no exit-1).
- `server=@source` (the wired E-leg) → does NOT fire `W-ENGINE-SERVER-DEFERRED`.
- a plain engine (no server) → does NOT fire it.
- parser: `engineDecl.serverFlagBare === true` for the bare form, `false` + `serverSource`
  set for the `=@source` form.

## VERIFICATION (R26)
1. Re-run the repro → `W-ENGINE-SERVER-DEFERRED` now fires (warning stream), compile OK.
2. `bun test` your new file → green.
3. **Full `bun run test`** (incl. browser) → 0 regressions. If any existing engine fixture
   uses a bare `server` flag, it now emits this warning — re-baseline its warning count and
   note old→new in progress.md (a bare-server fixture gaining a deferral warning is correct).

## DELIVERABLE
Files changed (line ranges), repro before/after, the §34 row text you added, the
emit-engine.ts inertness finding, full `bun run test` summary, every re-baseline old→new,
HEAD SHA + branch. Commit to your branch; `git status` clean. The sPA lands your changed
files onto `spa/ss2` (cherry-pick for symbol-table.ts/emit-engine.ts which carry sibling
ss2 changes).

Do NOT push. Do NOT touch main.
