# s451-boot-diag-severity — progress

- start: worktree /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a667109ca5e9c2eca, base origin/main 25677da72.
- baseline counter (before): PASS 95 · FAIL 65 · NOT-TWINNED 511 · UNSUPPORTED 629 (graded 160); 25 "severity unobservable" failure lines (not ~38).
- finding: the lower.scrml gate (`hasError`) already keyed on the `E-` prefix, so W-/I- codes did NOT block the artifact before this change (probed: W-ATTR-001 / W-STORY-ON-TOP-LEVEL / W-LIFECYCLE-010 alone → Core produced). The brief's (b) was stale on that point. The prefix is still wrong as a severity source: §34 makes E-DG-002 / E-TYPE-051 / E-CONTRACT-004-WARN Warning and 30+ W- codes Info.

## Done

1. `scripts/s34-catalog.ts` — the one §34 row parser; `scripts/s34-census.ts` now uses it (census output byte-identical before/after, `--full` and `--full --json`). Severity = last non-empty cell (some rows omit the trailing `|`).
2. `scripts/gen-bootstrap-severity.ts` GENERATES `compiler/self-host-v2/severity.scrml` (`Severity` enum + `severityOf(code)` match) for every `"E-/W-/I-…"` literal in the bootstrap's `*.scrml`. Two live rows that disagree → generator throws. `--check` mode. `slice-m4/severity.test.js` fails if the file is stale, executes the COMPILED table against §34 for every code, and forbids a `message:`/`severity:` struct field outside ast.scrml.
3. `ast.scrml`: `Diag.severity: Severity`; `newDiag(code, message, file, span)` is the one constructor. All 13 literal constructions (parse 2, analyze 11) go through it.
4. `lower.scrml hasError`: severity == Error (both `diags` and `infos`), not the prefix. `parse.scrml`: `errs` holds Error-severity spans only.
5. Counter grades the Diag's severity per occurrence; twin-extra-error + no-artifact message key on severity Error.

## Gate direction

For every code the bootstrap names, (prefix `E-`) ⇔ (severity Error) — checked mechanically over severity.scrml. So the gate change is behaviour-neutral today: no warning lets an artifact through that the prefix gate refused, and no case changed runtime execution.

## Catalog gaps — codes the bootstrap names with no usable §34 row (fail-closed Error)

70 codes (the generated header in severity.scrml is the live list). 69 have no §34 row; E-ENGINE-INVALID-TRANSITION's row says Severity "Runtime". Families: the bootstrap-private E-PARSE-* (31), E-BOOTSTRAP-UNSUPPORTED / -REDECLARE, the §66.20 codes (E-DECL-*, E-GRANT-*, E-FIELD-PRIVATE-WRITE, E-WRITE-*, …; §66.20 says "the §34 catalog rows land WITH the implementation" and lists them Error — the bootstrap IS that implementation, so the rows are owed), and the S449-flagged unnamed E-DECL-STATE-CHILD / E-TYPE-VARIANT. All are `E-` and §66.20 states Error where it names one, so fail-closed agrees with the SPEC everywhere it speaks.

## Counter after

PASS 119 · FAIL 41 · NOT-TWINNED 511 · UNSUPPORTED 629 (graded 160). 24 FAIL→PASS (all were "severity unobservable" and now hold), 1 FAIL→FAIL (`error/handler-non-exhaustive` twin: severity holds, which exposes twin-extra-error `E-SCOPE-001` — previously masked by the codes failure; pre-existing bootstrap defect, not fixed here), 0 PASS→FAIL. docs/bootstrap-conformance.md NOT regenerated (counter test does not require it; brief forbids otherwise).
