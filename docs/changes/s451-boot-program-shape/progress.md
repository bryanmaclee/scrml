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
