# BRIEF — ss3 item4 `g-render-not-enum-asis-miss`

**Dispatched by:** sPA ss3 · **Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Land target:** agent commits on its own worktree branch; sPA file-deltas onto `spa/ss3`.
**Single file:** `compiler/src/type-system.ts` (the `<render>` `of=` fence, ~:7682-7754).
**Base:** this worktree is branched off `spa/ss3` (which already carries ss3 item3's visitAttr change in the SAME file) — do NOT revert/clobber anything outside the render fence.

## The bug (R26-reproduced on real source)

`<render of=X/>` (SPEC §19.x render-expression primitive) is **error-enum-scoped** (ratified S195 —
"never a default, never a tag-string, never inference"): X MUST be an enum value; a non-enum target
SHALL fire **E-RENDER-NOT-ENUM** (the fence at type-system.ts:7742-7751). But when X resolves to
`asIs` (an erased/inferred type), the fence is DELIBERATELY SILENT (:7717-7721 — "a false fence fire
would be worse than a missed one"). The result: a non-enum cell whose type erased to `asIs` produces
an **inert empty-switch no-op** at codegen (`switch(_rt){}` with no cases → renders NOTHING) instead
of the E-RENDER-NOT-ENUM error.

Reproduced: `<s> = "hello"` + `<render of=@s/>` and `<n> = 42` + `<render of=@n/>` BOTH compile clean
(no fence) and emit an empty-switch render dispatch. The user gets a silent no-op, not the helpful
"render is enum-only" error.

## The fix — concretize the `of=` type, with a STRICT false-positive guard

At the `of=` resolution (:7704-7716), when the scope entry's `resolvedType` is `asIs` (or `unknown`),
try to concretize the target's type from the cell's INITIALIZER expression. Fire E-RENDER-NOT-ENUM
ONLY when the init is an **unambiguous non-enum** shape:
- a string / number / boolean literal (`<s> = "x"`, `<n> = 42`, `<b> = true`)
- an array literal / object(struct) literal / map literal

STAY SILENT (preserve the existing conservative behavior) when the target is anything that COULD be an
enum or genuinely can't be determined:
- an enum-variant init (`.Variant` / a call returning an enum / another enum cell)
- a server-fn / arbitrary call return (`= fetchData()`)
- a derived/computed value whose type the pass can't pin
- a bare ident that doesn't resolve to a concrete literal init

**The guard is the whole point** (R3/R4): the existing `asIs`→silent choice was deliberate to avoid
false fence fires on real-enum-but-erased values. Concretizing must ADD fences ONLY for provably-non-enum
literal inits — never widen to ambiguous shapes. When in doubt, stay silent.

Find the cell's init expr via the scope entry / decl node (the entry that `scopeChain.lookup` returns,
or the state-decl AST node it points at — `initExpr`/`typeAnnotation`). Reuse any existing literal-type
helper rather than re-deriving (grep for how the typer already classifies a literal init elsewhere).

## Verify (R26 — empirical)
- `<s> = "hello"` + `<render of=@s/>` → **E-RENDER-NOT-ENUM** (was silent no-op). Same for `<n>=42`,
  `<b>=true`, an array-literal cell, a struct-literal cell.
- Negative (must STAY clean — no false fence): `<render of=@e/>` where `@e` is a real enum value
  (with all variants `renders`-cl, e.g. a `<match>` arm payload) → no error; a `= fetchData()` async/
  call-init cell → SILENT (unchanged); a derived enum → no false fence.
- The existing enum path (E-RENDER-NO-CLAUSE on a missing-`renders` variant) + E-RENDER-NO-OF
  unchanged.
- Full `bun run test` (incl. browser) GREEN. Report before/after counts; if any existing render-fence
  test changes outcome, report which + why before declaring done.

## Mandatory dispatch blocks

**F4 startup-verification (FIRST):** `pwd` + `git rev-parse --abbrev-ref HEAD` — confirm you are in YOUR
isolated worktree, NOT `/home/bryan-maclee/scrmlMaster/scrml` (main) and NOT `../scrml-spa-ss3`. If
`node_modules` absent: `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules` +
`ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`.

**BASE SETUP (run immediately after F4, BEFORE any edit):** your worktree may be a reused one with stale
state. Put it on a FRESH branch at the current ss3 tip:
`git checkout -B ss3-item4-render-fresh spa/ss3 --force`
then confirm `git log --oneline -3` shows the recent `ss3 item2`/`ss3 item3` commits (this guarantees
your base carries ss3 item3's visitAttr change in the SAME file — leave it intact). If `spa/ss3` is not
a known ref, STOP and report. Do ALL your work on this fresh branch.

**Path discipline (S88/S99/S126):** all writes use YOUR worktree-absolute paths; NEVER a main path;
NEVER `cd` into main. `git status` after each step — only `type-system.ts` (+ a test) should change.
You are based off `spa/ss3` — the file already contains ss3 item3's visitAttr edit; leave it intact.

**Commit discipline (S83/S113/S164):** commit fix + test as ONE commit (coupled). WIP commits expected.
`git status` clean before DONE. NEVER `--no-verify`. Append timestamped lines to
`docs/changes/ss3-g-render-not-enum-asis-miss/progress.md`. Report branch + final SHA + changed files.

**Scope guard:** stay in `type-system.ts` (the `<render>` `of=` fence) + a focused test. If the fix
wants to spill outside type-system.ts, STOP and report.
