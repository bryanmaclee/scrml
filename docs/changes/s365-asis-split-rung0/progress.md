# progress — s365 asIs split, rung 0

Branch: `feat/s365-asis-split-rung0`, cut from `origin/main` @ `b74f7363`.
Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a33344eeccf9ddfcb`

## Startup gate — PASSED
- `pwd` under `.claude/worktrees/` — ok
- `git rev-parse --show-toplevel` == pwd — ok
- `git status --short` clean — ok
- branch cut from `origin/main`; `merge-base HEAD origin/main` == `b74f73634946f969557c34e64fc8796b8ef7f7ba` — ok
- `bun install` — 217 packages, rc 0
- `bun run pretest` — 13 test samples compiled, rc 0

---

## VERIFICATION 1 — the four-position table, MEASURED on this branch base

Harness: `compileScrml({ inputFiles:[f], write:false })`, each source wrapped in
`<program>` (an unwrapped file emits `W-PROGRAM-001` noise). Probe:
`scratchpad/pos/probe2.mjs`.

| position | source | result |
|---|---|---|
| annotated `let`, number | `let n: number = "nope"` | **FIRES `E-TYPE-031`** |
| annotated `let`, string | `let s: string = 42` | **FIRES `E-TYPE-031`** |
| annotated `let`, boolean | `let b: boolean = "nope"` | **FIRES `E-TYPE-031`** |
| typed cell | `<n>: number = "nope"` | SILENT |
| typed cell | `<s>: string = 42` | SILENT |
| argument | `fn f(x: number)` called `f("nope")` | SILENT |
| return | `fn f() -> number { return "nope" }` | SILENT |
| operand | `let z = "x" * 2` | SILENT |
| control | `let n: number = 5` | SILENT (correct) |
| control | `<n>: number = 5` | SILENT (correct) |

**MATCHES the brief exactly.** The §7.5 amendment does not rest on a false premise.

Correction I had to make: my FIRST typed-cell reproducer read the cell as bare `n`
in the interpolation and drew `E-SCOPE-001` + `E-DG-002`. That was my source being
wrong (V5-strict requires `@n` in a `${...}` read), not the compiler. Re-ran with
`${@n}`; result is SILENT, as briefed. Recording it because a reproducer that fails
for the author's reason is exactly how a false premise gets manufactured.

---

## PREMISE IN THE BRIEF THAT IS WRONG — there is no TypeScript build

The ratified mechanism is *"adding a node kind to scrml without handling it becomes a
**TypeScript compile error in scrml's own compiler**"*. Measured on `origin/main`:

- no `tsconfig.json` anywhere in the repo
- `typescript` is not a dependency or devDependency (`node_modules/typescript` absent)
- no `tsc` / `typecheck` invocation in `package.json`, `scripts/`, or `.github/`
- the pre-commit and pre-push hooks do not typecheck
- `.github/workflows/ci.yml`'s own header comment claims a layer
  *"types (always-on local)"* — **that layer does not exist in this repo.**

bun executes `.ts` transpile-only. Nothing ever type-checks the compiler.

### And the mechanism is ALREADY DEPLOYED, ALREADY RED, AND UNOBSERVED

`tsc --noEmit --strict` over `compiler/src/type-system.ts` (global tsc 5.9.2) exits 2
with a small bounded set. **Nine of those errors are the ratified `never` fallthrough
already biting**, in `expression-parser.ts`:

```
expression-parser.ts(3336,13): error TS2322: Type 'MarkupValueExpr' is not assignable to type 'never'.
expression-parser.ts(3579,13): ... 'MarkupValueExpr' ...
expression-parser.ts(4096,13): ... 'MarkupValueExpr' ...
expression-parser.ts(4179,22): ... 'MarkupValueExpr' ...
expression-parser.ts(4238,22): ... 'MapLitExpr | MarkupValueExpr' ...
expression-parser.ts(4310,22): ... 'MarkupValueExpr' ...
expression-parser.ts(4373,22): ... 'MarkupValueExpr' ...
expression-parser.ts(4430,22): ... 'MarkupValueExpr' ...
expression-parser.ts(4478,22): ... 'MarkupValueExpr' ...
```

`MarkupValueExpr` (and `MapLitExpr` at one site) were added to the `ExprNode` union
and NINE exhaustive switches were never updated. The decay-stopper fired. Nobody was
listening.

**Consequence for this dispatch.** Writing a tenth `never` fallthrough and stopping
would reproduce, one level up, the exact defect the ruling is against: *absence of a
diagnostic and success are the same observation*. So rung 0 ships the mechanism AND
a runnable typecheck that makes it observable. The gate is built and green-by-baseline
but is NOT added to `ci.yml` as a seventh blocking step — promoting a gate is the
operator's call, and the nine live `never` errors above want a decision (fix vs.
baseline) that is outside this dispatch.

---

## MEASURED, not taken from the brief

- `ExprNode` union = **22** distinct expression forms (`compiler/src/types/ast.ts:2082`),
  not ~24 and not the ~206 `case "` arms in `expression-parser.ts`. 22 is the closed set
  the exhaustive switch must cover.
- `W-TYPE-031-UNPROVEN` — confirmed **unallocated** (zero occurrences repo-wide).
- `E-TYPE-031` §34 row books it `§15.3, §15.10 | Prop value fails declared type
  constraint`. Nine normative SPEC sites use it more broadly: 6132, 6149, 9600, 9721,
  10071, 10254, 10258, 11679, 11697. Brief's count of nine is correct.

### A dead branch found while reading the fire site

`type-system.ts:10148` (no-annotation inference) tests
`actualKind === "boolean"` on `typeof srcInfo.value`, but `classifyLiteralFromExprNode`
only ever yields a `string` or `number` value — a `bool` literal returns
`{kind:"unconstrained"}`. The `"boolean"` arm is unreachable. Left in place (rung 1
territory); named here so it is not rediscovered as a mystery.

## Log

### 0. Crash anchor
BRIEF.md verbatim + this file.

### 1. Verification 1 complete — four-position table reproduced, premise holds.

## What went wrong / corrections

- The first `cat > … <<'EOF'` heredoc for BRIEF.md was refused by the worktree-isolation
  guard ("too complex to verify that it stays inside the worktree"). Used the Write tool
  with an absolute worktree path instead. No gate was worked around; the isolation guard
  did its job. Several later multi-command Bash calls were refused for the same reason and
  were split into single commands.
- My first typed-cell reproducer was wrong (bare `n` instead of `@n`) — see Verification 1.
- The brief's central mechanism premise ("a TypeScript compile error in scrml's own
  compiler") does not hold as written: this repo has no TypeScript build. See above.
