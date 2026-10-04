# s451-boot-diag-severity — progress

- start: worktree /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a667109ca5e9c2eca, base origin/main 25677da72.
- baseline counter (before): PASS 95 · FAIL 65 · NOT-TWINNED 511 · UNSUPPORTED 629 (graded 160); 25 "severity unobservable" failure lines (not ~38).
- finding: the lower.scrml gate (`hasError`) already keyed on the `E-` prefix, so W-/I- codes did NOT block the artifact before this change (probed: W-ATTR-001 / W-STORY-ON-TOP-LEVEL / W-LIFECYCLE-010 alone → Core produced). The brief's (b) was stale on that point. The prefix is still wrong as a severity source: §34 makes E-DG-002 / E-TYPE-051 / E-CONTRACT-004-WARN Warning and 30+ W- codes Info.

## Done

1. `scripts/s34-catalog.ts` — the one §34 row parser; `scripts/s34-census.ts` now uses it (census output byte-identical before/after, `--full` and `--full --json`). Severity = last non-empty cell (some rows omit the trailing `|`).
2. `scripts/gen-bootstrap-severity.ts` GENERATES `compiler/self-host-v2/severity.scrml` (`Severity` enum + `severityOf(code)` match) for every `"E-/W-/I-…"` literal in the bootstrap's `*.scrml`. Two live rows that disagree → generator throws. `--check` mode (exit 1 when the file is stale; run by CI's NON-blocking tracking job). `slice-m4/severity.test.js` does NOT check staleness (605e006d9 removed that byte-equality check: a docs-only §34 row that changes no answer would have gone red); it executes the COMPILED table against §34 for every code, and forbids a `message:`/`severity:` struct field outside ast.scrml.
3. `ast.scrml`: `Diag.severity: Severity`; `newDiag(code, message, file, span)` is the one constructor. All 13 literal constructions (parse 2, analyze 11) go through it.
4. `lower.scrml hasError`: keyed on severity, not the prefix (both `diags` and `infos`). Review r2: FAIL CLOSED — a diagnostic is an error unless its severity is Warning or Info, so a missing/unknown severity closes the gate (diag-gate.test.js pins it). `parse.scrml`: `errs` holds Error-severity spans only.
5. Counter grades the Diag's severity per occurrence; twin-extra-error + no-artifact message key on severity Error.

## Gate direction

For every code the bootstrap names, (prefix `E-`) ⇔ (severity Error) — checked mechanically over severity.scrml. So the gate change is behaviour-neutral today: no warning lets an artifact through that the prefix gate refused, and no case changed runtime execution.

## Catalog gaps — codes the bootstrap names with no usable §34 row (fail-closed Error)

69 codes after merging origin/main dbb671c2d (which added the E-ERROR-011 row; the generated header in severity.scrml is the live list). 68 have no §34 row; E-ENGINE-INVALID-TRANSITION's row says Severity "Runtime". Families: the bootstrap-private E-PARSE-* (31), E-BOOTSTRAP-UNSUPPORTED / -REDECLARE, the §66.20 codes (E-DECL-*, E-GRANT-*, E-FIELD-PRIVATE-WRITE, E-WRITE-*, …; §66.20 says "the §34 catalog rows land WITH the implementation" and lists them Error — the bootstrap IS that implementation, so the rows are owed), and the S449-flagged unnamed E-DECL-STATE-CHILD / E-TYPE-VARIANT. All are `E-` and §66.20 states Error where it names one, so fail-closed agrees with the SPEC everywhere it speaks.

## Counter after

PASS 119 · FAIL 41 · NOT-TWINNED 511 · UNSUPPORTED 629 (graded 160). 24 FAIL→PASS (all were "severity unobservable" and now hold), 1 FAIL→FAIL (`error/handler-non-exhaustive` twin: severity holds, which exposes twin-extra-error `E-SCOPE-001` — previously masked by the codes failure; pre-existing bootstrap defect, not fixed here), 0 PASS→FAIL. docs/bootstrap-conformance.md NOT regenerated (counter test does not require it; brief forbids otherwise).

## Staleness coupling (cost, by design)

severity.scrml goes stale — reported by `gen-bootstrap-severity.ts --check` in CI's tracking job, not a blocking gate — when a §34 row for a code the bootstrap names is added, struck or re-severitied, or a new code literal enters a bootstrap source. `slice-m4/severity.test.js` goes red only when staleness changes an ANSWER (a re-severitied row, or a new code whose §34 row is not Error). Fix: `bun scripts/gen-bootstrap-severity.ts`. The merge of dbb671c2d (new E-ERROR-011 row) exercised exactly this. The first cut wrote SPEC line numbers into the header and so went stale on ANY SPEC edit above a gap row; removed.

## Review r2 (fix round, frozen review at 63b217e7 — LAND-WITH-NITS)

1. FIXED — `hasError` fails closed (see Done item 4); bite proven (old predicate → 2 of the 3 new diag-gate tests fail).
2. FIXED — the gate's header comment states the §34-Severity-column rule via the generated table + fail-closed default; the retired `E-`-prefix wording is gone.
3. SKIPPED — the proposed guard ("every quoted `"[EWI]-…"` literal in the bootstrap sources is in the table") is the generator's own collector (`bootstrapCodes`, same regex, same files) restated, and severity.test.js already executes the compiled table for exactly that set. It is tautological, and it cannot see the case the finding names (a code built some way other than a quoted literal) — by construction no text scan of quoted literals can. Today every code reaching `newDiag` originates as a full quoted literal (grep: no `'E-…'`, no backtick, no `"E-" +` construction). The real-coverage guard is DYNAMIC — every code a compile actually emits ⊆ the table — and belongs in the bootstrap-conformance run (which already compiles every case); deferred, not built here (scope).
4. FIXED — Done item 2 and the staleness note no longer claim severity.test.js checks staleness (605e006d9 removed it); staleness is `--check` in CI tracking.
