# sPA ss59 → PA — REINTEGRATE: reactivity §6 wave-2, tier-1 diagnostic codes

**List:** `spa-lists/ss59-conformance-reactivity-6.md` (Wave-2, items 7-19 — the 13 tier-1
reactivity/state diagnostic codes from the S256 tier split)
**Branch:** `spa/ss59` · **tip `3cad84c6`** · based on `origin/main` @ `9c27ce9a` · **not pushed**
**Suite:** 642 baseline → **663/663 green** (+21 cases). Verified by the sPA on the MERGED branch,
not merely per-agent in isolation.
**Brief archived:** `docs/changes/conformance-reactivity-wave2-ss59-2026-07-16/BRIEF.md`

## Outcome
**10 of 13 codes fully covered** (POS reject + clean NEG each) · **1 partial** · **2 parked**.
All landed work is pure-additive `conformance/cases/**` data — **no compiler source touched**.

| Item | Code | Status | SHA |
|---|---|---|---|
| 7  | E-DERIVED-VALUE-MUTATE         | landed | `f66bdc32` |
| 8  | E-DERIVED-ENGINE-CIRCULAR      | landed | `f66bdc32` |
| 9  | E-DERIVED-ENGINE-NO-INITIAL    | landed | `f66bdc32` |
| 10 | E-DERIVED-ENGINE-NO-RULES      | landed | `f66bdc32` |
| 11 | E-DECL-NEEDS-INITIALIZER       | landed | `8e9ce965` |
| 12 | E-DECL-RHS-INTERP-WRAPPED      | landed | `8e9ce965` |
| 13 | E-NAME-COLLIDES-STATE          | landed | `8e9ce965` |
| 14 | E-CELL-AMBIGUOUS-MEMBER-RENDER | landed | `b79765a6` |
| 15 | E-CELL-NO-RENDER-SPEC          | landed | `b79765a6` |
| 16 | E-DG-001                       | landed | `415d79eb` |
| 17 | E-DG-002                       | **PARTIAL** — NEG landed, POS blocked (#5) | `415d79eb` |
| 18 | E-STATE-004                    | **PARKED** (#3) | — |
| 19 | E-STATE-005                    | **PARKED** (#3) | — |

Commits: `b79765a6` (14-15) · `8e9ce965` (11-13) · `f66bdc32` (7-10) · `415d79eb` (16-17) ·
`1f874135` + `3cad84c6` (progress). Every commit verified NON-EMPTY (`git show --stat`) and
hook-gated. Working tree clean.

## Headline for the PA: 4 of 7 escalations are §34 CATALOG defects, not language defects
This list did not stall on scrml semantics. It stalled on the **error-code catalog**. Full detail +
line cites in `spa-lists/ss59.progress.md`; the load-bearing ones:

- **#3 [blocks items 18/19]** — the whole §34 `E-STATE-004/005/006` block cites **§11.1, a FOLDED
  section** (`SPEC.md:7076`: "Subsumed by §6.1-§6.3") and describes legacy V4 state-object semantics.
  The impl repurposed all three codes (verified: single fire site each, impl-wide; no alternate site
  implements the documented behavior). Authoring would enshrine impl#1 against the SPEC → parked.
  **E-STATE-006 is not on the ss59 list but has the same defect** — flagged so you rule on the block,
  not one row at a time. **Ruling needed (direction + target):** amend the rows to match impl + re-cite
  §6, OR treat the impl codes as misnamed (rename + corpus migration).
- **#5 [blocks item 17 POS]** — `E-DG-002`: the §34 row (`:18285`) disagrees with the impl on **both**
  trigger (row: "is read in a context whose wiring can't be established"; impl: `readers.size === 0`,
  "declared but never consumed") **and severity** (row `Error`; impl passes `"warning"` at
  `dependency-graph.ts:3193`). Worse, **§34 contradicts §22.6** (`:15864` normatively presupposes the
  *consumed*-keyed trigger). §22.6 + impl agree; the §34 row is the outlier, and it self-cites a
  no-emit line. **Suggested:** correct row 18285 → never-consumed trigger + severity Warning; the POS
  is then trivially authorable. The landed NEG takes no side (sound under both readings).
- **#4** — `const <x>: T[]` no-RHS: **impl under-fires vs §6.2** (`SPEC.md:2213` states the
  const-derived-requires-an-expression rule unconditionally; impl gates on `isConst && !isArrayType`,
  so `const <items>: string[]` compiles silent). Item 11's POS is pinned on the SCALAR form, so the
  contract is SPEC-true whichever way you rule. **Ruling:** add an array exemption to §6.2, or fix the
  impl.
- **#6** — `E-DECL-NEEDS-INITIALIZER` and `E-CELL-AMBIGUOUS-MEMBER-RENDER` have **no §34 row** at all.
  Neither blocked authoring (behavior is SPEC-ratified elsewhere and the impl agrees), but §34 currency
  owes both a row.

### #7 — SYSTEMIC, and the reason this matters beyond ss59
Root cause of #3/#5/#6 looks structural: `0301a7c4 docs(s78-audit): SPEC §34 +88 legacy prose-only
catalog backfill` bulk-added **88 rows**, **87** of which hard-code an "emitted at `file:line`"
self-cite. Measured this session: of the 64 machine-checkable cites, **59 no longer land within ±8
lines** of their code (5 do).

**Do not over-read the 59.** Line drift is expected as the compiler evolves and is NOT itself proof a
row is wrong. The consequence is narrower and worse: the self-cite is **useless as a verification
anchor**, which is precisely how a row wrong on trigger *and* severity (#5) survived unreviewed.

**Why it's PA-level:** `conformance/README.md` names §34 as THE authority for the `severity` key, and
the entire freeze-gate campaign (ss56-ss77) authors against it. If a chunk of §34 is unreviewed
backfill, sibling sPA lists will keep hitting this — stalling, or silently enshrining impl behavior.
**Recommend a scoped §34-vs-impl audit of the 88 S78 rows as its own work item** — cheap to mechanize
(parse row code + severity, compare against the emit site) and it de-risks every remaining conformance
list. Not an sPA call.

## Corrections to the list itself (PA may want these upstream)
- **List premise stale:** the list says "baseline 72/72"; actual baseline is **642**.
- **Wave-1 markers were stale:** items 1-6 still read `[status=pending]` though they landed and were
  re-integrated. Corrected on-branch from the progress file's SHAs — this is the exact stale-marker
  trap that causes no-op re-dispatch, so worth fixing at the source.
- **Two list fire-site cites were wrong** and were corrected in the briefs from live greps:
  `E-DERIVED-ENGINE-CIRCULAR` fires from Stage 7/DG (`dependency-graph.ts:3569`), not the cited line;
  `E-DECL-NEEDS-INITIALIZER` is **retired except** the const-derived no-RHS sub-case.

## Method notes
- **Pre-dispatch coverage audit paid off.** Parsed `expect.codes` from every `expected.json` (a real
  parse, not a text grep): all 13 were genuinely uncovered — **no no-ops**. But a *grep* audit would
  have wrongly marked 3 of 13 "already covered": `E-DERIVED-VALUE-MUTATE` and `E-DG-002` appear only in
  `notCodes`; `E-DERIVED-ENGINE-NO-RULES` only in rationale prose. (S261 rule, re-confirmed.)
- **A brief error of mine, caught by an agent:** I wrote that `@x = 0` is the declaration form inside
  `${ }`. Per §3.4 (`:289`) and §6.1.2 (`:2037`), declarations are **always** structural (`<x> = 0`) in
  both loci; `@x = expr` is a *write* to a pre-declared cell. The agent followed SPEC + corpus over my
  brief, which is the correct call — flagging so the error doesn't propagate into sibling briefs.
- 4 ingestion-disjoint agents, one per code-family, distinct case dirs → no shared-file race.
- Agent branches retained (not cleaned): `worktree-agent-{aaf6e9bec892580e4, a8561a06ddf24675d,
  a9cf1dd7409d397e6, a3f0ffdf3911db033}`. Work was file-delta'd onto `spa/ss59`, so these are redundant
  once you re-integrate — cleanup is yours, not mine.

## Not done by the sPA (by contract)
No push. No main advance. No design rulings — #3/#4/#5 all need a PA direction call before items 17
POS / 18 / 19 can be authored.
