# BRIEF — Close the E-CG-001 protected-field egress evasion via an acorn-exact scan (HIGH, S245)

CHANGE-ID: `ecg001-acorn-egress-scan-2026-07-07`
BASELINE: `5b5ca405` (current main). GAP: `g-ecg001-protected-field-regex-division-evasion` (HIGH, filed S244).
DISPATCHED-BY: scrml PA (S245). AGENT: scrml-js-codegen-engineer · isolation:worktree · background.

## The bug (CONFIRMED empirically + in-source)
`E-CG-001` is the §14.8.9 server→client confidentiality BACKSTOP: it fires if a protected DB field reaches the
emitted client JS bundle. It builds its scanned view (`emit-client.ts:2746-2748`) by collecting the CODE segments
from `rewriteCodeSegments` (`code-segments.ts`) — string/regex/comment content is excluded — then tests
`/\.<field>\b/` against that view (`:2749-2751`).

`code-segments.ts` `regexAllowedAfter` (`:26-51`) treats `/` after `of`/`in`/`await`/`yield`/… as a REGEX opener.
Those are usable as VARIABLE NAMES, so `const of = 2; const r = of / user.ssn / 2;` is DIVISION — but is
mis-scanned as a regex literal, `/ user.ssn /` is swallowed, `.ssn` drops out of the view, the field test returns
false, **E-CG-001 does not fire, and the protected field ships to the client with no error.** A SILENT bypass of a
load-bearing V1-security invariant.

**Reproduced (scanner level) — your test seed** (`/tmp/rt-review/ecg001-repro.mjs`, re-create in your worktree):
```
rewriteCodeSegments code-view of `const of = 2; const r = of / user.ssn / 2;`
  → "const of = 2; const r = of \n 2;"   (.ssn GONE → /\.ssn\b/ = false → LEAK)
vs `const r = user.ssn / 2;` → ".ssn seen = true" (fires normally)
```

**Root:** `code-segments.ts` deliberately "errs toward masking" — CORRECT for its original job (fn-name mangling:
never rewrite inside a string/regex) but EXACTLY WRONG for a security egress guard, where masking = not-seeing =
leaking. One scanner, two uses, opposite required safety biases. **Regex-vs-division is undecidable from raw
pre-tokenized text — S244 proved this (two reverted heuristic rounds, each caught leaking by the S239 gate). Do NOT
attempt another raw-text heuristic. TOKENIZE.**

## The fix — give E-CG-001 its OWN acorn-exact scan (fail-closed)
The emitted client JS is VALID JavaScript by construction (it runs in the browser). acorn knows `of` is an
identifier value → `/` after it is division. Use it.

1. **New helper** (a NEW file, e.g. `compiler/src/codegen/egress-field-scan.ts`, or a local fn in emit-client.ts):
   acorn-parse (or acorn-tokenize) the emitted `clientCode` and detect whether any `protectedFields` name appears
   in **code position**. Mirror how `compiler/src/codegen/validate-emit.ts` already acorn-parses emitted JS (same
   input shape — reuse its acorn import/version/options). Two acceptable strategies (pick one; AST is recommended):
   - **(a) AST walk (recommended, exact):** `acorn.parse(clientCode, {...})` → walk for `MemberExpression` with a
     non-computed Identifier `.property` whose `name ∈ protectedFields` → leak. (Optionally also `MemberExpression`
     computed with a string-literal property `obj["ssn"]`, and object-destructuring `const {ssn} = ...` — see
     "class check" below.)
   - **(b) Token-span masking (minimal drop-in, exact):** tokenize with acorn; blank (replace with whitespace) the
     SOURCE spans of `string`/`template`/`regexp` tokens + comment spans; keep all other source; run the EXISTING
     `/\.<field>\b/` test on the masked source. Preserves current dot-access detection semantics exactly, just fixes
     the scanning.
2. **FAIL-CLOSED (critical):** if acorn throws (unparseable emitted JS), E-CG-001 MUST treat it as unverifiable →
   fire a diagnostic (E-CG-001 or a dedicated "could not verify client egress" error), NEVER silently pass. A silent
   pass on parse-failure would be a NEW bypass (emit unparseable JS → skip the guard). Security-conservative: when
   in doubt, error.
3. **Leave `code-segments.ts` UNTOUCHED** — its mask-bias stays correct for the fn-name mangle. This DECOUPLES the
   two opposite-bias uses (the actual root fix). E-CG-001 no longer borrows the mangle scanner.
4. **Preserve the legitimate exclusion:** a protected field name inside a genuine STRING or COMMENT (e.g. a label
   `"SSN"` or `// ssn note`) must still NOT fire (that was the original reason for the code-only view). acorn gives
   this for free (string/comment content is not code position).

## Class check (do NOT expand scope silently)
The current `/\.field\b/` catches only DOT access. Computed `user["ssn"]` and destructuring `const {ssn}=user` are
ALSO uncaught today (a sibling evasion S244 didn't file). If your acorn approach closes them for FREE (the AST walk
naturally can), do so + note it. If closing them adds real scope/risk, do NOT expand this dispatch — instead file a
one-line sibling-gap note in a `NOTES.md` in your change dir for the PA to triage. This dispatch's deliverable is
the FILED HIGH (the regex-division evasion) closed exactly + fail-closed.

## ACCEPTANCE (all must hold)
- The reported evasion NOW FIRES: `const of = 2; const r = of / user.ssn / 2;` (with `ssn` protected, reaching
  client code) → E-CG-001 fires.
- Controls: normal `user.ssn / 2` STILL fires; a clean app with NO protected field in client code does NOT fire; a
  protected field name inside a string/comment does NOT fire (legitimate exclusion preserved).
- Fail-closed: unparseable emitted client JS → E-CG-001/verification error, not a silent pass. Add a test.
- **Regression tests** covering: the evasion (`of`/`in`/`await`/`yield` variants) now caught · the string/comment
  exclusion preserved · fail-closed on parse error · the normal member-access case.
- Full suite `bun run test` → 0 fail (document any pre-existing browser/env-floor fails; do NOT fix unrelated).

## SCOPE FENCE (shared checkout — coordinate)
Touch ONLY `compiler/src/codegen/emit-client.ts` (the E-CG-001 region ~2746-2758) + your NEW acorn-egress-scan
helper file + tests. Do NOT touch (other sessions/threads own these): `code-segments.ts`, `expression-parser.ts`,
`route-inference.ts`, `literal-scan.ts`, `codegen/emit-each.ts`, `protect-analyzer.ts`, `codegen/emit-channel.ts`,
`codegen/emit-server.ts`, `match-statechild-parser.ts`, `runtime-template.js`. Do NOT edit `docs/known-gaps.md`
(the PA marks the gap resolved at landing). Do NOT touch the adjacent SQL-leak scan (`:2762+`) — it scans raw
(over-fire = safe), it is NOT evadable, leave it.

## STARTUP + PATH DISCIPLINE (worktree)
`pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-` (else STOP — S90). `git
rev-parse --show-toplevel`==WORKTREE_ROOT; `git status --short` clean; `bun install`; `bun run pretest`. Apply ALL
edits via Bash on worktree-absolute paths (NOT Edit/Write). Never `cd` into main; `git -C "$WORKTREE_ROOT"`. First
commit message includes your verbatim `pwd`. Commit incrementally; keep progress.md.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` (Task-Shape Routing for a compiler-source codegen/security fix). Currency HEAD
`66a3afb1`/2026-07-04 — verify against current source. Report the Maps-consulted line.

## REPORT
`WORKTREE_PATH` · `FINAL_SHA` · `FILES_TOUCHED` (emit-client.ts + the new helper + tests ONLY) · which strategy
(AST vs token-mask) + why · the R26 evidence (evasion now fires; controls; fail-closed) · the class-check verdict
(computed/destructuring closed-for-free or filed as a sibling note) · how you mirrored validate-emit.ts's acorn
setup · the Maps line.
