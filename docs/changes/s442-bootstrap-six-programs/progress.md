# s442-bootstrap-six-programs — progress

Worktree: /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a337dc820eb4a91db (branch worktree-agent-a337dc820eb4a91db)
Base: origin/main cf62b415 (asserted == merge-base).

## Log
- 2026-09-29 — startup verified; BRIEF committed (d904acbd). Bun 1.4.2 (the pre-commit hook takes ~4 min per commit on this machine).
- 2026-09-29 — BASELINE (before any edit):
  - slice-m1 73/73 · SLICE_CORE=lowered slice-m1 73/73 · slice-m2 325/325 · slice-m3 24/24 · lint-no-default-arm 28 files / 0 violations
  - `bun conformance/run.ts` (impl#1): 1047/1054 pass + 7 xfail
  - footprint (`scripts/hybrid.ts --swap CG=…/slice-m3/substitute.js --footprint`): 18/18 runtime passes, 10 codes-only, 579 not-yet, 447 front-end
- 2026-09-29 — the four remaining §66.19 programs extracted VERBATIM from SPEC into `compiler/self-host-v2/slice-m4/src/`
  (form/signup.scrml = §66.19.2; theme/lib/brand-theme.scrml + theme/app.scrml = §66.19.4; audit/audit.scrml = §66.19.5;
  engine/after.scrml + engine/before.scrml = §66.19.6). **slice-m4, not slice-m2:** slice-m2 is the M2 proof (the lowered Core
  EQUALS M1's hand-built oracle, drift-guarded); these four programs have no hand-built oracle and are graded by RUNNING them,
  so they get their own slice with its own harness/tests, and slice-m2's oracle suite stays untouched.

## SURVEY — where each §66.19 program fails through the bootstrap today (base cf62b415)

Instrument: `frontEnd` (slice-m2/lowered.js — parse → analyze → lower over the verbatim SPEC sources); first diagnostic and
every construct the program needs that the front end does not have (read from the diagnostics + the source).

| § | program | first failing stage | constructs missing (source order) | Core-blocked / OPEN |
|---|---|---|---|---|
| 66.19.1 | counter | — (passes; M2) | — | — |
| 66.19.3 | dropdown ×3 | — (passes; M2) | — | — |
| 66.19.5 | audit log | PARSE | (a) array spread `[...@audit, x]` (E-PARSE-EXPR — `...` handled only in struct literals); (b) `Date.now()` host call (analyze E-BOOTSTRAP-UNSUPPORTED "only calls of a named function"); (c) a struct literal as a `.push` argument (E-TYPE-STRUCT-CONTEXT — no expected type from the element type); (d) spread-append `@audit = [...@audit, e]` classified as an end-append (today E-WRITE-NOT-GRANTED, a replace); (e) `bind:value=@actor` (E-BOOTSTRAP-UNSUPPORTED); (f) negative lines: `.shift()`, `.filter(...)` (method calls other than push/unshift/length unsupported), `@audit[0].action = …` (index place), `@audit = appended(…)` (O37 (c) certified call) | (b) and (e) need Core: Core has no host-call Expr and no event-value/bind form — core.scrml is off-limits (brief §4) |
| 66.19.6 | engine as `single` | PARSE | (a) `:`-shorthand state-child bodies `<Idle rule=.Loading : "Ready">` (E-PARSE-TAG / E-PARSE-STATE-CHILD cascade); (b) `single` modifier; (c) a declaration with attributes + child graph field + `renders` nested in `<program>` (`<card>`); (d) `@phase = .X` — a transition write to a `single` declaration's OWN value; (e) `<*phase/>` rendering the state-child bodies (O5 (1i)); (f) `${status}` — an enum value rendered; negative lines E-COMPONENT-ENGINE-SCOPE (`single` on `status`) and E-DECL-SINGLE-INSTANTIATED (`<phase/>`) | E-DECL-SINGLE-INSTANTIATED is conditional on **O55** (OPEN) — not decided |
| 66.19.2 | validated form | PARSE | (a) `:`-shorthand state-child bodies (as 66.19.6); (b) validator attributes `req length(>=5)` in an opener (E-PARSE-TAG); (c) a `renders` clause after a CHILD declaration inside a declaration body (E-PARSE-DECL-BODY); (d) `bind:value` / `bind:checked` (analyze E-BOOTSTRAP-UNSUPPORTED); (e) `<*email/>` / `<*password/>` / `<*signup/>` / `<*saveState/>` (Core has no View.Star); (f) `single`; (g) bare `return` in a function; (h) a declaration with attrs + renders nested in `<program>` | (d) needs Core (bind); validators' runtime reach is **O25** (OPEN) |
| 66.19.4 | theme library | PARSE | (a) a `match` expression inside an opener value `(match @mode {…})` (E-PARSE-EXPECTED); (b) `<theme>` marker — tokens → CSS custom properties (not recognized: its declarations are not exported → E-IMPORT-NOT-EXPORTED `brand`/`danger`); (c) named shared instances `<accent:swatch …/>` (§66.8.2; E-SCOPE-001 "no field label"); (d) `<*accent/>`; (e) `@mode = …` whole write of a library top-level `let` (E-BOOTSTRAP-UNSUPPORTED) | (b) is CSS — brief §4: stop (slice-m3 CSS files held by another session); ⚑ O17(d), O39 marked in the source |

`§66.19.6 before` (the retired `<engine>` form) is not a target: it is §51.0 legacy (§66.21, Stage 1 "parses identically" —
the ingest shim's / impl#1's form, not the §66 front end's).

PLAN (least missing surface first): 66.19.5 audit → 66.19.6 engine → 66.19.2 form → 66.19.4 theme (non-CSS parts only,
if reached). Core-blocked constructs are implemented up to the Core boundary and reported.
