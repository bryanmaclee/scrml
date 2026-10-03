# s451-boot-program-shape — progress

## 2026-10-03 start
- WORKTREE_ROOT /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-abc5c7e218ae5b05b, base b490f3b75 (== origin/main).
- Baseline counter (`bun scripts/bootstrap-conformance.ts`, 1288 cases): PASS 42 (15 vacuous) · CODES-ONLY 0 · FAIL 18 · LEGACY 951 · UNSUPPORTED 277 · CRASH 0.
- Probe (bootstrap front end, one-line sources) confirmed every silent shape in both gaps:
  `<program auth="bogus">`, `<program frobnicate="1">`, `capabilities=[teleport]`, bare `auth`, `auth=@m`,
  a nested `<program auth="Bogus">` in a program body, two top-level programs, `<p>` before/after the program,
  `<engine>` before the program, `<foreign lang>` + `<program lang>`, `ratelimit="100/fortnight"` → all `[]`.
- Loci held: `AProgram.attrs` has no reader in analyze.scrml; `declStubs` mints a stub per ProgramItem; phaseA's loop keeps the LAST
  (`program = d.sym`); a file-top `MarkupItem` is `noStubs` / `[]` in every pass (dropped). Also found: a NESTED `<program>` in a
  program body (`ProgramItem` inside `p.items`) is ignored by every pass except `typeItems` / `fnItems` (which pull its types and
  functions into the parent namespace) — the same fail-open, in scope as (A)'s nested-attribute rule.

## Governing sentences
- §4.12 "two such outermost `<program>`s in one file are two top-level programs (`E-PROGRAM-002`, §40.8)".
- §40.8 "A second (or later) top-level `<program>` in the SAME file — wrapped in markup or not — SHALL be `E-PROGRAM-002` (compile error)".
- §52.13.2 "An `auth=` attribute on a `<program>` or a `<page>` whose value is not exactly one of the three literals `"required"`, `"optional"`, `"none"` SHALL be a compile error, `E-AUTH-ATTR-INVALID` (§34). … and every non-literal value: a bare `auth` with no value, an interpolation (`auth=${mode}`) and a cell (`auth=@mode`). … The message SHALL name the value written and list the three legal values."
- §4.12.2 "An `auth=` attribute on a nested `<program>` … SHALL be a compile error (`E-PROGRAM-NESTED-AUTH`), whatever its value"; §52.13.2 "`E-AUTH-ATTR-INVALID` SHALL NOT also fire for it."
- §4.12.2 "A session attribute on a nested `<program>` SHALL be a compile error (`E-PROGRAM-NESTED-SESSION`)".
- §4.12.2 "Every other `<program>` attribute is application-level and SHALL be a compile error on a nested `<program>` (`E-PROGRAM-NESTED-ATTR`), once per offending attribute … the five documentary attributes … keep the WARNING `W-PROGRAM-TITLE-NESTED` … a name the `<program>` attribute set does not know keeps `W-ATTR-001` (§52.13.3)."
- §52.13.3 "`<page>`, `<channel>`, `<program>`, … have closed attribute sets — unknown attribute names emit `W-ATTR-001`".
- §23.5.3 "The vocabulary is CLOSED in v1 (these six). … an unrecognized capability token SHALL be a compile error (`E-FOREIGN-CAPABILITY-UNKNOWN`, §23.5.7)."
- §39.2.4 (the §40.2 `ratelimit=` row) "A `ratelimit=` value that does not match the `N/unit` form SHALL be a compile error (E-MW-002)"; "`unit` is one of `sec`, `min`, `hour`".
- §4.12.2 table, `story=` row: "On the top-level `<program>` it emits `W-STORY-ON-TOP-LEVEL` and is ignored."
- §23.6 "`<foreign lang>` in a file with a `<program>` is `E-FOREIGN-LANG-IN-PROGRAM`."
- §38 "A `<channel>` positioned outside `<program>` in a file that ALSO contains a `<program>` sibling … SHALL emit `E-CHANNEL-OUTSIDE-PROGRAM`".
- §20.8.1 "an `<outlet>` outside a `<program>` shell SHALL be **E-OUTLET-OUTSIDE-SHELL**".
- Other markup at a file's top level, outside any `<program>`: searched §40.8, §4.12, §38.1, §21.8 — §40.8 says only "The file top level outside any `<program>` / `<page>` / `<channel>` is NOT this locus"; no rule says what it renders as → E-BOOTSTRAP-UNSUPPORTED.
- `name=` on the top-level `<program>`: §4.12.2 "The top-level `<program>` MUST NOT have a `name=` attribute" — no code named → E-BOOTSTRAP-UNSUPPORTED.

## 2026-10-03 implementation (analyze.scrml, new block after `programStub`; two one-line dispatch edits)
- `declStubs`: a second+ top-level `<program>` gets no stub (`isLaterProgram`) — the FIRST program is the program; the later one's body is not analyzed.
- `phaseA`: `st = programShapeDiags(files, entry, rd.st)` — E-PROGRAM-002 per later program (any file); entry program attrs (`topProgramAttrDiags`); nested programs (`nestedProgramDiags`, recursive); file-top markup (`outsideProgramDiag`).
- Codes: E-AUTH-ATTR-INVALID · E-MW-002 · E-FOREIGN-CAPABILITY-UNKNOWN · W-STORY-ON-TOP-LEVEL · W-ATTR-001 · E-PROGRAM-002 · E-PROGRAM-NESTED-AUTH / -SESSION / -ATTR · W-PROGRAM-TITLE-NESTED · E-CHANNEL-OUTSIDE-PROGRAM · E-OUTLET-OUTSIDE-SHELL · E-FOREIGN-LANG-IN-PROGRAM. Refused (E-BOOTSTRAP-UNSUPPORTED): legal `auth=`, valid `ratelimit=`, every other known program attribute, top-level `name=`, malformed `capabilities=`, nested `<program>` itself, `kind=`/`serve=` on nested, other file-top markup. A file-top `<effect>` stays with s449's `strayEffects`.
- Accepted: a fully valid `capabilities=[…]` — advisory in v1.0 (§23.5.1), governs only foreign code, which the bootstrap refuses.
- impl#1 trap hit: route inference's raw-source `/\bsession\b/` (route-inference.ts SERVER_ONLY_PATTERNS) matches STRING LITERALS — a message containing "session" put the new functions (and their callees) on the server. Worked around (no bare word in strings; `isCookieAttr` assembles the name). impl#1 defect worth a gap.
- Tests: slice-m4/program-shape.test.js (64). self-host-v2 suite 1328 pass / 0 fail.
- Counter after: PASS 34 (7 vacuous) · FAIL 13 · LEGACY 957 · UNSUPPORTED 284 · CRASH 0. Non-vacuous PASS unchanged at 27. Flips: auth/{nested-program-one-code, i-auth-redirect-unresolved, w-auth-login-missing, w-auth-redirect-loop}-pos FAIL→UNSUPPORTED; foreign-lang-in-program-neg FAIL→UNSUPPORTED; auth/w-auth-redirect-loop-neg + middleware/ratelimit-invalid-unit-neg PASS(vacuous)→UNSUPPORTED; 6 engine/*-neg PASS(vacuous)→LEGACY (file-top `<engine>` now refused). Six FAILs now fire the right code and fail only "severity unobservable" (g-bootstrap-diag-has-no-severity): auth-attr-empty-string-pos, auth-attr-unrecognized-literal-no-login-lint-pos, program-two-top-level-same-file-pos, capability/unknown-token, capability/unknown-token-mixed-with-valid, middleware/ratelimit-invalid-unit-pos.

## 2026-10-03 fix round (S239 review of 179e2aa83)
- MED-1: parse.scrml `programOpenerDiags` — a `<program>` opener's typed attributes, validator calls, own type, own value, `:`-shorthand body and `export` were dropped (AProgram keeps `o.attrs` only) → each now E-BOOTSTRAP-UNSUPPORTED at parse. Searched §4.12, §40.8, §66.2 — no SPEC code governs a declaration-shaped `<program>` opener.
- LOW-2: `typeItems` / `fnItems` skip a later top-level program (`isLaterProgram`), so its names cannot mask an unresolved name in the first.
- Tests: +12 in slice-m4/program-shape.test.js; self-host-v2 1340 pass / 0 fail.
