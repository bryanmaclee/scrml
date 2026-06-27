# sPA ss40 → PA re-integration — `@apply` utility-composition build (bug-1 W2, §26.8) — ALL LANDED

**List:** `spa-lists/ss40-apply-utility-composition-build.md` · **Branch:** `spa/ss40` · **Build tip:** `913bf8be` (+ 1 sPA bookkeeping commit on top — see final tip below) · **Base:** `7d8b527a` (origin/main; no drift). **No main advance, no push.**

W2 (the build) of the bug-1 `@apply` arc — design was ratified in SPEC §26.8 (W1, S223). All 5 list items done.

## Build commits (FF-merged onto `spa/ss40`, per-item history preserved)
| | SHA | Surface |
|---|---|---|
| resolver | `ad087b62` | `tailwind-classes.js` (`resolveApplyToken` + `applyTokenHasVariant`) |
| parser + expansion + 3 diagnostics | `875874e5` | `ast-builder.js` · `codegen/emit-css.ts` · `codegen/index.ts` |
| SPEC §34 + §26.8 banner + bug-1 + §0 | `e0f41583` | `SPEC.md` · `SPEC-INDEX.md` · `known-gaps.md` |
| tests | `913bf8be` | `tests/integration/apply-utility-composition.test.js` (17 tests) |
| sPA bookkeeping + currency fix | (this commit) | list/progress/this-msg + the SPEC currency fix below |

## Survey correction (Rule 4 — note for the SCOPE record)
`@apply` was NOT at-rule-passthrough as SCOPE §2 hypothesized — it was **silently dropped** (tokenizer captures one `CSS_AT_RULE`; the rule-body parse loop routes non-`CSS_PROP` tokens to `else{i++}`). **Live path is LEGACY `ast-builder.js:parseCSSTokens`**; the native `parse-css-body.js` is opt-in and was NOT updated (S162 feature-stale) — port `parseApplyAtRule` there if `--parser=scrml-native` ever becomes default.

## Verification
- Agent full `bun run test` = **25536 pass / 0 fail / 214 skip** (1110 files, 148s); each of the 4 commits passed the full pre-commit gate incl. browser + TodoMVC. **No `--no-verify`.**
- sPA FF-merged, re-ran the new integration test (17/0), confirmed §34 (+3 rows), the §26.8 banner flip, and the §0 gap-count (MED 14→13) are all real on-branch.
- **Adversarial edges all pass** — composing `@apply ring-2 shadow-lg` → exactly ONE `box-shadow` + BOTH `--tw-ring-shadow`/`--tw-shadow` setters (NOT last-write-wins, byte-matches the §26.8 example); arbitrary `bg-[#1da1f2]` free; `flexx`→`E-APPLY-UNKNOWN-UTILITY`; `hover:`/`md:`→`E-APPLY-VARIANT-UNSUPPORTED`; `prose`/`space-x-4`→`E-APPLY-NON-INLINABLE-UTILITY`; empty `@apply` no-op; multiple lines ordered; `@apply` + hand decls both emit.

## sPA currency fix (made in the bookkeeping commit)
SPEC ~line 16285 carried a stale cross-reference: the `@apply` mechanism described as `§26.8 (S223, Nominal)`. The agent flipped the §26.8 **section** banner to Implemented but left this secondary mention, making the SPEC self-contradictory. Changed to `(S223 spec; Implemented ss40)`. 1-word currency correction, not a design ruling — flagging because the sPA touched SPEC.md.

## ⚠ Design-judgment calls the agent made — PA TO RATIFY (none blocked the build; all defensible + spec-consistent)
1. **Property-level last-wins dedup, scoped to apply-bearing rules ONLY.** §26.8's example shows ONE `box-shadow`, but naive concat of `ring-2`+`shadow-lg` yields two. The agent dedups duplicate properties (last-wins, standard CSS cascade) — but ONLY in rules that contain `@apply`; rules without `@apply` take the byte-identical unchanged fast path (no regression). Matches the §26.8 example + the brief's "ONE box-shadow, not last-write-wins" assertion. Composing still works (the two `--tw-*` setters are distinct properties; only the duplicate `box-shadow` shorthand collapses, and it reads both vars).
2. **Combinator-selector utility (`space-x-4`) → `E-APPLY-NON-INLINABLE-UTILITY`.** §26.8.2 wording is ">1 flat rule"; `space-x-4` is one rule but its selector is `.space-x-4 > :not([hidden]) ~ …` (not a single flat `.<token>{…}`). The agent reads "non-inlinable" to also cover combinator/pseudo selectors (inlining would drop the combinator + apply margins to the wrong element). Defensible "in spirit"; confirm the wording covers it or tighten §26.8.2.
3. **Dogfood lives IN the integration test** (the §26.8 sample + a realistic `.btn`/`.card`/`.btn-ghost` source, compiled + CSS-inspected) rather than a new `examples/35-*.scrml` — to avoid perturbing the PA-owned example count (71) + corpus-audit wiring. A gallery example is a trivial follow-on if you want it.

## Deferred (PA awareness, NOT ss40 items)
- **Pre-existing `//`-in-`#{}`-arbitrary-value limitation** (NOT @apply): an arbitrary value with `//` (e.g. `bg-[url(http://...)]`) can't round-trip a full `#{}` compile — the CSS-block splitter treats `//` as a line comment and eats the closing brace (`E-CTX-003 Unclosed css`). `resolveApplyToken` handles colon-in-brackets correctly (unit-tested); only the URL case can't reach codegen via `#{}`. A separate CSS-block-tokenizer follow-on if adopter friction appears.
- **`master-list.md @generated:recent-sessions` is STALE** (PA-owned, wrap-refreshed). The sPA did NOT run `bun scripts/state.ts --write` (it would rewrite that PA-owned section); only the gap-counts block was hand-edited. `state.ts --check` will FAIL on recent-sessions until the PA refreshes at wrap — this is pre-existing + expected, NOT caused by ss40.

## Disposition
All 5 items `done`/`landed-on-branch`. No parked/dropped. bug-1 RESOLVED (W2 = the last `@apply` remainder). Durable output = branch tip. PA FF-merges `spa/ss40` into main at re-integration. sPA standing down.
