# progress — s461-given-cell-lowering

- 2026-10-09T17:42:41Z WIP(s461-given-cell-lowering): start at /home/user/scrml/.claude/worktrees/agent-a342b0bebb3b69186 (base origin/main 5a895f3)

## Phase 0 — startup (done)
- pwd/toplevel = worktree; remote bryanmaclee/scrml; branch s461-given-cell-lowering from origin/main 5a895f3 (merge-base == origin/main).
- bun install OK; `bun run pretest` OK (samples/compilation-tests/dist populated).

## Rule 4 gate — governing sentences (re-read in compiler/SPEC.md at 5a895f3)
- §42.3.5 worked example (SPEC.md:31426): `${ given @user :> { <p>${@user.name}</p> } } // OK — narrowed to present inside the guard`
- §42.2.3 (SPEC.md:31284): "Multi-narrowing is all-or-nothing. If any listed variable is `not`, the body is skipped entirely. There is no partial execution of the body with a subset of variables present."
- §42.2.3 (SPEC.md:31286): "`given` is the positive counterpart to `x is not`. Inside the body, each named variable is narrowed — the `| not` component is removed from each variable's type. No variable is rebound to a new name; each identifier is narrowed in place."
- §42.5 (SPEC.md:31498-31505): "`given x :> body` → `if (x !== null && x !== undefined) { body }`" · "`given x, y :> body` → `if (x !== null && x !== undefined && y !== null && y !== undefined) { body }`" · "`given x` in a match arm → the arm's generated condition is `x !== null && x !== undefined`".
- §17.6.10 (SPEC.md:16617) — the markup-body limb: "A branch body that is exactly one expression SHALL be equivalent to `{ lift <expression> }`." (a `given` guard lowers to an `if` per §42.5, so its single-markup body is such a branch body.)

## Phase 1 — reproduction (5a895f3, executed)
- repro compiles exit 0; client.js has `if (user !== null && user !== undefined) {` in `_scrml_show_3` AND at top level with an EMPTY body; html has no `<p>`. CONFIRMED.
- AST dump: both `given-guard` nodes carry `variables: ["user"]` — the `@` is stripped at parse (ast-builder.js both given parse sites) and NOTHING records that the head named a cell. The emitter (emit-logic.ts `case "given-guard"`) then interpolates the stripped name.
- Markup body: the guard body parses to `[html-fragment "<p>", logic{@user.name}, html-fragment "< / p >"]` — the exact shape `implied-lift-desugar.ts` converts for an `if-stmt` arm, but that pass only visits `if-stmt` (and pre-filters on `\bif\b`), so the given-guard body reaches emit-logic `case "html-fragment": return ""` = the drop.
