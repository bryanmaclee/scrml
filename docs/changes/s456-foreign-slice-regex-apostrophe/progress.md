# progress — s456-foreign-slice-regex-apostrophe (append-only)

## U0 — startup (base 0aef3270d = origin/main)

Worktree verified, bun install + pretest OK. BRIEF archived (7dd81c1fe).

## U1 — governing text (quoted verbatim)

SPEC §2.2.1 (S451 paragraph):

> **No runnable artifact from a compile that reports an error (S451).** A compile that reports one or
> more diagnostics of **Error** severity (§34) SHALL NOT produce a runnable artifact. [...]

SPEC §2.2.1 (first paragraph):

> A codegen path that cannot lower a construct SHALL emit a hard diagnostic (e.g. `E-CG-003`) rather
> than a silent stub that yields malformed output.

SPEC §23.2.4a, Unbuildable slice:

> **Unbuildable slice (E-FOREIGN-007).** A slice that is not valid JavaScript as the body of a
> strict-mode async function whose parameters are its crossings SHALL be a compile error
> (E-FOREIGN-007) that names the slice's source location and the parser's complaint. [...] It is an
> AUTHOR error at the slice, never reported as a compiler defect.

SPEC §23.2.4a, Crossing-shadow:

> This SHALL be a compile error (E-FOREIGN-006) that NAMES the shadowed binding. The check is a
> pre-emit SYNTACTIC scan (brace/string/comment/template-aware; it inspects only top-level binding
> keywords and never type-checks or rewrites the interior [...])

SPEC §23.2 stage table (CG row): "a slice that cannot be built as such a function is E-FOREIGN-007"
— the check is a CG-stage check, so the fix stays in codegen (not moved to TS).

## U2 — reproduction at 0aef3270d

| repro | exit | diagnostic | emitted |
|---|---|---|---|
| GAP 1 large (flogence graph-ingest-tool.scrml@90671f6 + `const q1 = /[']/g` at :541) | 0 | none | `const plan = null /* E-FOREIGN-007 ... :136 does not parse */` |
| GAP 1 small (unparseable slice inside an `if` in tool `main`) | 0 | none | `null /* E-FOREIGN-007 */` |
| GAP 2 (`/['x]/g` regex in slice, directly in `main`) | 1 | E-FOREIGN-007 "no top-level ; and no top-level return" (wrong cause) | `null /* E-FOREIGN-007 */` |

Root 1 (lost diagnostic): `case "foreign"` pushes E-FOREIGN-006/007 only into the narrow
`opts.foreignCrossingErrors` sink. The sink is threaded by the function-level emitters
(emit-tool/emit-server/emit-library) but NOT carried into the opts that the control-flow emitters build
for an `if` / loop body, so a slice inside `if (…) { … }` reaches the arm with no sink: the arm returns
the `null /* … */` placeholder and pushes nothing. The large flogence slice sits inside
`if (args.includes("--ingest")) {` — that is the whole difference from the small GAP 2 file.

Root 2 (misattributed): `scanForeignSliceShape` / `scanForeignSliceTopLevelBindings` are hand
character scanners with no regex-literal state: the `'` in `/['x]/` opens a string that swallows the
rest of the slice, hiding the top-level `return`.

## U3 — audit of the "comment / placeholder instead of diagnostic" class (codegen)

Grep: emitted `/* E-` placeholders + narrow-sink pushes guarded by `if (sink)` / `if (opts.errors)`.
Measured at 0aef3270d with .tmp repros:

| site | mechanism | fail-open? (measured) |
|---|---|---|
| emit-logic `case "foreign"` E-FOREIGN-006/007 | narrow `foreignCrossingErrors` | YES — exit 0 inside `if` |
| emit-logic `case "sql"` `.prepare()` E-SQL-006 | narrow `preparedStmtErrors` | YES — exit 0 inside `if` in a tool (runtime-throw IIFE only) |
| emit-logic if-as-expression E-LIFT-002 (x3) | comment ONLY, no push anywhere | YES — exit 0 for SPEC §16144 Example 6 |
| emit-expr E-SESSION-VALUE / E-SESSION-RESERVED-KEY | `_sessionValueUseErrors`, drained only by generateServerJs | YES — exit 0 in a `kind="tool"` main |
| emit-control-flow match no-lowerable-arms E-CG-003 | `opts.errors` if present | path with no channel is silent by its own comment |
| emit-logic Tier-3 positional E-TYPE-001 | `opts.errors` if present | silent without a channel (retired construct) |
| emit-expr E-CG-TILDE-UNRESOLVED / E-VARIANT-AMBIGUOUS | module sink drained by runCG | NO (already the robust shape) |
| emit-logic expression `!{}` E-CG-003 | module sink drained by runCG | NO |
| emit-control-flow `/* §1a: cannot positionally bind */` | comment only | open gap g-tool-context-match-loses-enum-field-order (fix = resolve field order, not refuse) |
