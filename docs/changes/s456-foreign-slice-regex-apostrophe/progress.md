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

## U4 — fix (9f4c473a0)

- NEW `compiler/src/codegen/refused-lowering-errors.ts` — run-wide refusal sink, reset + drained by
  `runCG` (per-file-loop `finally` + before return), one diagnostic per construct (anchor node, or
  code+file+start+end for a real span). Receives E-FOREIGN-006/007, E-SQL-006, E-LIFT-002,
  E-SESSION-VALUE, E-SESSION-RESERVED-KEY, and the no-channel fallback of match E-CG-003 and Tier-3
  E-TYPE-001. Removed: `foreignCrossingErrors` / `preparedStmtErrors` opts plumbing (emit-server,
  emit-tool x3, emit-library x2, emit-library-shared) and the session sink (emit-expr + emit-server
  reset/drain + index.ts reset).
- `foreign-seal.ts` `scanForeignSliceShape` / `scanForeignSliceTopLevelBindings` read acorn tokens
  (Rule 7: the same lexer the build check and the host use). Unlexable slice → statement body, so the
  build check reports the parser's own message. `.return` / `?.return` is a property name.
- E-FOREIGN-006/007 span line/col resolved from the byte offset (foreign node `line` was 99 for a
  slice at 136 on the flogence repro).
- emit-library: a refusal from a DISCARDED body emit is now kept (it is a source fact; the verbatim
  fallback does not make the construct buildable).

## U5 — evidence

Repro table (base 0aef3270d → head 9f4c473a0):

| repro | base | head |
|---|---|---|
| GAP 1 large: flogence graph-ingest-tool@90671f6 + `const q1 = /[']/g` | exit 0, no diag, `const plan = null /* E-FOREIGN-007 */` | exit 0, artifact == the unmodified file's + the one line (only line-label shifts) |
| GAP 1 large, real syntax error (`const q1 = ;`) | (exit 0 silent class) | exit 1, E-FOREIGN-007 at graph-ingest-broken.scrml:136:18, "line 405 of the slice" |
| GAP 1 small (`x +;` inside `if` in tool main) | exit 0, no diag | exit 1, E-FOREIGN-007 x1 |
| GAP 2 small (`/['x]/g` + `return`) | exit 1, wrong "no top-level ; / return" | exit 0, runs: `out=its` |
| E-FOREIGN-006 in `for` body | exit 0 (fell to silent 007) | exit 1, E-FOREIGN-006 naming `a` |
| `.prepare()` inside `if` in tool main | exit 0 (runtime-throw IIFE only) | exit 1, E-SQL-006 x1 |
| SPEC §17.6 Example 6 (two lifts) | exit 0, comment only | exit 1, E-LIFT-002 |
| `const s = session` in tool main | exit 0 | exit 1, E-SESSION-VALUE |

Corpus differential (`scripts/corpus-emit-differential.ts`, write:true, roots
examples,samples,conformance,stdlib; base worktree @0aef3270d vs head worktree @9f4c473a0):
- enumeration 2388 → 2394 (+6 = the new conformance cases).
- artifacts compared 11708: 11439 byte-identical, 269 differ ONLY by the checkout directory name
  baked into the artifact (`.tmp/basewt` vs `.tmp/headwt`, `_scrml_project_root` / relative host
  import) — verified by substitution, 0 real content changes. Syntax delta: 0 new, 0 fixed.
- compile outcome: 1 newly failing — `samples/compilation-tests/gauntlet-s19-phase2-control-flow/
  phase2-if-as-expr-multi-lift-011.scrml`, whose own header says "two lifts on same path — E-LIFT-002
  (§17.6.9 ex 6)": now reports the E-LIFT-002 it was written to provoke. Correct.
- diagnostic text only: `samples/gauntlet-r13/react-auth-dashboard.scrml` — E-SESSION-VALUE reported
  once instead of twice (route + peer duplicate), location 1:1 → 1:5 (both wrong: the ident's offset
  is fragment-relative upstream; pre-existing). NOTE: that E-SESSION-VALUE fires on a handle-body
  LOCAL `const session = …` on base too — a pre-existing false positive, surfaced, not touched.
- flogence multi-file build (`compile src/` of a read-only copy @1439421 + flogence.db): base exit 0,
  head exit 0, outputs byte-identical (`diff -rq` empty).
- `bun scripts/corpus-compile-floor.ts --check`: PASS.

Tests: pre-commit gate at 9f4c473a0 — 31621 tests / 1469 files, 0 fail. New:
`compiler/tests/integration/foreign-slice-lexing.test.js` (22). Conformance 1316/1366 → 1322/1372
(+6 PASS; each new case verified to fail on 0aef3270d).
