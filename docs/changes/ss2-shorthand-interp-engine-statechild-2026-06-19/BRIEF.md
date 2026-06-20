# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is the CWD that `pwd` reports at startup.

## Startup verification (do this BEFORE any other tool call)

1. Run `pwd` via Bash. Output MUST start with
   `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If under any other
   repo (`scrml-support/...` or a `scrml-spa-*` sibling), STOP and report (S90 routing
   failure). Save the output as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` MUST equal WORKTREE_ROOT.
3. `git rev-parse --abbrev-ref HEAD` + `git rev-parse --short HEAD` (base `c734ec35` or
   descendant). `git status --short` clean.
4. `bun install` (worktrees do NOT inherit node_modules; the hook's `bun test` needs it).
5. `bun run pretest` (populates `samples/compilation-tests/dist/`). Baseline via
   `bun run test`, NOT `bun test` directly.

If ANY check fails: DO NOT proceed. Report and exit.

## Path discipline (enforce on EVERY edit)

- **Apply ALL file edits via Bash** (`perl -0pi`/`python3`/heredoc/`cp`) on ABSOLUTE
  paths under WORKTREE_ROOT that include the `.claude/worktrees/agent-<id>/` segment —
  NOT Edit/Write (S126). Echo the path before each write; re-verify with `git diff`/grep.
- NEVER use main-rooted paths (`/home/bryan-maclee/scrmlMaster/scrml/compiler/...`
  without the worktrees segment) — that leaks into main.
- NEVER `cd` into main. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`,
  worktree-absolute paths — for compile/run too.

## Commit discipline

- Commit after each meaningful unit; WIP commits expected. Create + update
  `docs/changes/ss2-shorthand-interp-engine-statechild-2026-06-19/progress.md` per step.
- Coupled code+test = ONE commit. `git status` clean before DONE.
- NEVER `--no-verify`. The pre-commit hook gates each commit.

---

# TASK — ss2 item 4: engine state-child `:`-shorthand body is dropped (§51.0.I)

## The bug (R26-reproduced by the sPA at c734ec35)

A `:`-shorthand display-text body on an ENGINE state-child (§51.0.I — the `<Variant ...> :
"text">` form, `:` AFTER the opener attrs) is **silently dropped** from rendered output —
both pure literals AND `${...}` interpolations. Compiles with 0 errors; the arm renders
empty.

Reproduce (write under WORKTREE_ROOT, do NOT commit):
```
<program title="i4">
${ type Phase:enum = { Loading, Empty, Editing } }
<engine for=Phase initial=.Loading>
  <Loading rule=(.Empty | .Editing) : "Loading…">
  <Empty rule=.Editing : "No tasks yet.">
  <Editing rule=.Empty : "${@count} items">
</>
</program>
```
Compile (`compileScrml({inputFiles, write:false})`), inspect the engine's client render
fns: NONE of `Loading…` / `No tasks yet.` / the `${@count}` interp appear. All three
shorthand bodies are gone.

## Root cause (sPA-traced — trust this)

The engine state-child parser (`engine-statechild-parser.ts`) parses the shorthand
**correctly**: each `EngineStateChildEntry` (`sc`) carries
- `sc.bodyRaw` = the raw display-text literal WITH quotes (e.g. `' "${@count} items"'`), and
- `sc.isColonShorthand = true`.
(Confirmed via runSYM AST dump: `sc.rule` is also parsed correctly — the rule is NOT the
problem.)

But the codegen arm-builder **`buildEngineArms`** in `compiler/src/codegen/emit-engine.ts`
(~line 2148-2360) builds each arm's render body from the **ast-builder's `match.children`**
(the structural parse), and for a `:`-shorthand state-child those `children` are **EMPTY**
(the ast-builder does not lower the `:`-shorthand into child nodes). So the arm body is
`[]` → nothing renders. `sc.bodyRaw` + `sc.isColonShorthand` are never consulted for the
render body.

## The fix — mirror the RESOLVED match-arm pattern (codegen-side, emit-engine.ts)

This is the EXACT analog of `g-shorthand-interp-match-arm-codegen` (S196 Bucket 4), already
resolved in `compiler/src/codegen/emit-match.ts`:
- `displayTextLiteralInner(raw)` (emit-match.ts **:545**, module-local) — returns the inner
  content of a single `"..."` display-text literal (honoring §4.18.3 escapes incl. `\${`),
  or `null` if not that shape.
- Consumer at emit-match.ts **:817-834**: when an arm body `trimmed` is a display-text
  literal, take `displayTextLiteralInner(trimmed)` and route the INNER through
  `nativeParseFile(label, inner)` (`require("../../native-parser/parse-file.js")`,
  emit-match.ts:625) → use `synthResult.ast.nodes` as the body. This makes literal
  segments HTML-escape (§4.18.6) and `${...}` interpolations wire (§4.18.4) —
  byte-equivalent to the bare-body `<Variant ...>...</>` form.

In **`buildEngineArms`** (emit-engine.ts), at the point where the arm body is derived from
`match` (around the `match.children` / `rawChildren` handling, ~2326), add a branch:

- **When `sc.isColonShorthand === true`** (the state-child's OWN `:`-shorthand body, §51.0.I):
  derive the render body from `sc.bodyRaw` instead of `match.children`:
  1. `const trimmed = (sc.bodyRaw || "").trim();`
  2. If `displayTextLiteralInner(trimmed) !== null` → route the inner through
     `nativeParseFile` EXACTLY as emit-match.ts:825-831 does → use the resulting nodes as
     the arm body.
  3. Defensive fallback: if not a clean display-text literal (e.g. a bare-expr shorthand
     `<Editing> : @label`), mirror emit-match.ts's other branches (the `looksLikeMarkupStart`
     branch :805 and the `parseExprToNode` bare-expr branch :835-851) so non-literal
     shorthand bodies also lower correctly. Cover at least: a `"literal"`, a
     `"...${interp}..."`, and a bare `@expr` shorthand.

`displayTextLiteralInner` is module-local in emit-match.ts. Cleanest: **export it** from
emit-match.ts (`export function displayTextLiteralInner`) and `import`/`require` it in
emit-engine.ts. (Or hoist it + the nativeParseFile lowering into a tiny shared helper both
emit-match.ts and emit-engine.ts call — your judgment; do NOT duplicate the body.)

### Do NOT
- Do NOT touch the PARSER (`ast-builder.js` / `engine-statechild-parser.ts`) — the parser
  already captures `sc.bodyRaw` + `sc.isColonShorthand` correctly; the fix is purely the
  codegen render-body derivation. (Touching ast-builder.js would also collide with a
  sibling ss2 dispatch.) If you believe a parser change is unavoidable, STOP and report
  back — do not proceed into the parser.
- Do NOT regress the bare-body form (`<Variant ...>...</>`), payload bindings, nested
  engines, `<onTransition>`/`<onTimeout>`, or `effect=`.

## §4.14 ELEMENT-locus second face (emit-html.ts — verify, fix only if broken)

The footprint also flags a §4.14 `:`-shorthand at a **plain element** locus
(`<span : "${@x}">` as a nested child, NOT the engine state-child's own body) potentially
dropping its body in `emit-html.ts`. REPRODUCE it (a `:`-shorthand plain element with a
`${...}` interp inside an engine arm body or a normal markup context). If its body/interp
is dropped, apply the SAME displayTextLiteralInner→nativeParseFile lowering at the
emit-html.ts render site. If it already renders correctly, state that in your deliverable
and make NO emit-html.ts change. (The S153 `colon-shorthand-in-engine-arm` landing fixed
the PARSER closer-finder for nested shorthand elements; this is the separate RENDER face.)

## Tests (coupled — one commit with the code)

Add `compiler/tests/unit/engine-shorthand-body-render.test.js` (or extend an existing
engine codegen test):
- engine with `:`-shorthand pure-literal arm (`<Empty : "No tasks yet.">`) → client render
  fn contains the escaped literal.
- `:`-shorthand interp arm (`<Editing : "${@count} items">`) → render fn wires the
  `@count` read + the literal segments (byte-equivalent to the bare-body form — assert the
  same lowered shape the `>...</>` form produces).
- bare-expr shorthand (`<Editing> : @label` form, if the parser admits it) → renders the
  expr.
- `node --check`-clean emitted client.js.
- a multi-arm engine where SOME arms are shorthand and some are bare-body → all render.
Un-skip any existing skipped engine-shorthand-render test you find.

## VERIFICATION (R26 — required before DONE)

1. Re-run the repro above → all three bodies now present in the client render fns.
2. `bun test` on your new/edited engine test file → green.
3. **Full `bun run test`** (incl. browser) → 0 regressions. Re-baseline any fixture whose
   engine render output legitimately changes (the shorthand arms now emit content where
   they emitted nothing); note each old→new in progress.md.

## DELIVERABLE

Files changed (line ranges), repro before/after (verbatim), the §4.14 emit-html.ts
finding (broken+fixed, or already-correct), full `bun run test` summary, every re-baseline
old→new, HEAD SHA + branch. Commit to your branch; `git status` clean. The sPA file-deltas
your changed files onto `spa/ss2`.

Do NOT push. Do NOT touch main. Do NOT touch ast-builder.js / engine-statechild-parser.ts.
