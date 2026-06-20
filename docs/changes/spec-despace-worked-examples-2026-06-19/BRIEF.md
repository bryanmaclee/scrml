# BRIEF — SPEC.md worked-example despace (despace arc, Part B1)

**Dispatched:** 2026-06-19 (S209). **Agent:** general-purpose, isolation:worktree, opus.
**Base:** branch from `c734ec35` (current main HEAD — already carries despace Part A).

## CONTEXT

scrml's canonical opener form is **no-space `<identifier>`**. Name Resolution (NR, §15.15.6)
classifies an opener by the identifier (registry + naming convention: lowercase → HTML / built-in
lifecycle; PascalCase → component or registered state type) — **NEVER by whitespace**. A leading
whitespace after `<` (`< db>`) is the **deprecated v0 opener form** that emits `W-WHITESPACE-001`
(→ `E-WHITESPACE-001` in P3). This was empirically confirmed against the live compiler
(`< div` → W-WHITESPACE-001, resolves HTML; `< Foo` → component; newline → deprecated form).

Part A (already landed, `bf390560`) reconciled the SPEC **rules + EBNF + §4 prose** to this model.
**This task (Part B1) is the worked-example consistency pass:** despace the worked-example openers
that teach CANONICAL usage so they model `<db>` not `< db>` — while PRESERVING the deliberate
deprecation-form illustrations.

## TASK

In `compiler/SPEC.md` ONLY, despace genuine block/state/structural/substate **worked-example
openers** that teach canonical usage:
- `< db ...>` → `<db ...>`, `< schema>` → `<schema>`, `< state>` → `<state>`
- `< machine>` → `<machine>`, `< engine>` → `<engine>`, `< page>` → `<page>`, `< channel>` → `<channel>`
- `< Submission>` / `< Draft>` / any `< PascalCaseSubstate>` → `<PascalCaseSubstate>`
- prose/heading token references like `< machine>` / `< engine>` used as a name → `<machine>` / `<engine>`

## KEEP — do NOT despace (deliberate deprecation-form illustrations)

A spaced `< X>` MUST STAY SPACED when it illustrates or discusses the DEPRECATED form. KEEP every
spaced opener in these zones/contexts:

1. **§4.2 deprecated-form example** — the worked example block labeled **"Worked example — valid
   (deprecated whitespace form)"** (the `< db src="db.sql" tables="users">` there). KEEP.
2. **§4.3 The Disambiguation Rule** (the whole section, ~"Status (Phase P1...)" through the
   migration-path bullets) — all `< state-type>` / `< identifier>` mentions are PROSE about the
   deprecated form. KEEP.
3. **§4.9 (preprocessor)** — the macro examples `< ${name}>` and `< db>` and the
   `< db src="db.sql">` warning-case. These DEMONSTRATE the deprecated form. KEEP.
4. **§4.10 (newline)** — all `< ...>` mentions (prose about the deprecated newline/whitespace form). KEEP.
5. **§13 P1-amendment prose** (~"the block splitter accepts both `<identifier>` and `< identifier>`"). KEEP.
6. **§15.15.5 / §15.15.6** (W-WHITESPACE-001 definition + NR authority) — all `< identifier>`
   mentions are the deprecated-form illustration. KEEP.
7. **§34 catalog rows** — `W-WHITESPACE-001`, `E-WHITESPACE-001`, the retired `~~W-MACRO-001~~`,
   and `W-STATE-BLOCK-BARE-WRITE-DECL` rows all reference `< db>` / `< identifier>` as the deprecated
   form. KEEP.

**Heuristic for any other ambiguous case:** if the spaced opener is within ~5 lines of text
containing "deprecated", "W-WHITESPACE-001", "E-WHITESPACE-001", "whitespace form", "whitespace
after `<`", or is explicitly contrasting deprecated-vs-canonical → **KEEP** and list it in your
report. Otherwise → despace.

## DO NOT TOUCH (not openers)

- Comparison operators: `a < b`, `x < 10`, `< 0.5`, etc.
- Generics / type args: `Array< T>`, `Map< K, V>`, `Promise< X>` (despace ONLY if it's truly an
  opener; a type-arg `< T>` is NOT an opener — leave it, but note it if unsure).
- The EBNF productions already reconciled in Part A (they already read `'<' identifier` — no `'< '`).
- Anything outside `compiler/SPEC.md`.

## METHOD

- This is **per-occurrence judgment, NOT a blind sed.** For each `< X>` candidate, classify:
  worked-example-opener-teaching-canonical (DESPACE) · deprecation-illustration (KEEP) ·
  comparison/generic/noise (SKIP).
- SPEC.md is prose — there is **no compile step** and **no test impact**. Do NOT run the test suite.
- Despacing removes one character on a line; it does NOT change line COUNT, so SPEC-INDEX line
  ranges stay valid — do NOT regenerate the index.
- **Startup:** `cd` your worktree, `git merge main` (or confirm base == `c734ec35`+). VERIFY base
  carries Part A: grep `compiler/SPEC.md` for **"deprecated whitespace form"** at §4.2 — it MUST be
  present (proves you're on the post-Part-A SPEC). If absent, STOP and report.

## COMMIT DISCIPLINE (background-agent crash recovery)

- Commit after each meaningful chunk (e.g., per major section group) — don't batch. WIP commits fine.
- Write/update `docs/changes/spec-despace-worked-examples-2026-06-19/progress.md` after each chunk
  (timestamped: what despaced, count, any kept/ambiguous). Append-only.
- If you crash, your commits + progress file are how the next agent picks up.

## REPORT (final message — this is the return value, raw data not prose-for-humans)

- Total openers despaced (count) + a per-section breakdown.
- The list of KEPT spaced openers (section + reason) — confirm the keep-zones were honored.
- Any AMBIGUOUS sites you skipped for PA review (line + the candidate + why ambiguous).
- The branch + final SHA (PA will S67 file-delta `compiler/SPEC.md` to main + verify).
- Maps: not load-bearing (SPEC-text task) — note "maps not consulted (SPEC-text-only)".
