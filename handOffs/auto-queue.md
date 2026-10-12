# AUTO queue — the only work an AUTO (unattended) run may take

Contract: `../scrml-support/pa-auto.md`. **Updated by S465 AUTO (2026-10-12)** over the S464 queue. Items keep their S464 numbers.
Every code item: isolated dispatch (F4 block) → S239 differential review on a FROZEN commit → land only when clean + cloud `gate` green.

## Read first
- **S465 could not merge.** The permission classifier refused the merge call ("Merge Without Review"); see `auto-questions.md` · merge-denied. Finished work is in open PRs (below). A run that still cannot merge should keep producing ready PRs, not re-try the merge.
- **The cloud clone is shallow (depth 50).** `bun scripts/state.ts --check` fails falsely on it. Run `git fetch --unshallow origin` once at boot (S465 did; ~1 min).
- **No git hooks in the cloud clone.** Agents must run the pre-commit suite themselves. This container's env-only failures (identical on main): `dev-db-no-side-file` ×5, `promote-safety-harness`, `headless-serve-bind-host`, `tenant-floor-project-set` ×3 under load, lsp/commands `scrml dev`/`serve` ×11; browser-baseline "nested `<each>` in a lifted row".
- **The container can restart mid-run** (S465: it did once; three agents died). Agents must commit + push after each unit; the PA should bank interim state on the board file.
- **`git reset --hard` is sometimes refused** to agents by the classifier; `git switch -c <name> FETCH_HEAD` works.
- At most 3 agents at once; S465 ran 3 continuously and the load sat at ~20 on 4 cores; suites took 20–40 min.

## Status of the S464 items
| # | item | state |
|---|---|---|
| 1 | P0 CPS server logic on the client | **BLOCKED → Q cps-control-guard.** Branch `wip/s464-p0-cps-r1` @ `82856e8c`. S465: provenance → ruling S464; review of `d5910316` found H-control-guard (needs a §19.9.9.8 rule-3 amendment) + an imported-helper await hole (split out as the await item below); fix round 2 landed rule 4 (pre-first-server statements stay client; their locals travel as request data — a mechanism the SPEC does not spell out, flagged in progress.md). Needs a fresh S239 review after the ruling. |
| 2 | P0 SQL chain truncation | **READY — PR #1407** (3 review rounds, CLEAN on `c049273a`). |
| 3 | brace-less `else` dropped | **READY — PR #1408** (5 review rounds, CLEAN on `fb422643`). |
| 4 | markup display text parsed as code | **BLOCKED → Q markup-stmt-code** (error-code name). Branch `wip/s464-markup-text-not-code` @ `5d0debf2`; revert `dee0e1d5d` restores the full draft once a name is ruled. Not reviewed yet. |
| 5 | `<md>` phase 2 | **READY — PR #1410** (CLEAN on `0ca5227f`). One §67.2 sentence awaits OK → Q md-unclosed-quote. |
| 6 | S462 gap filing | **READY — PR #1406** (only the attr=@cell widening; the rest of the list is lost → Q lost-gap-list). |
| 7 | Q23 braces required (§63) | **WAITING** on #1408 landing; then check whether the W-/E- names follow the `is some` §63 pattern (#1385) — if not, BLOCKED with a proposed name. |
| 8 | Q24 statement markup → error | **BLOCKED → Q markup-stmt-code** (same code name as item 4). |
| 9 | E-VALUE-FUNCTION-STORED | **BLOCKED → Q value-fn-migration** (6 corpus files + ~108 test fixtures newly refused). Branch `auto/s465-value-function-stored` @ `51f2b60c` (check + 18 unit tests; suite red by design). |
| 10 | lift `<pre>`/`<code>` raw | **READY — PR #1409** (CLEAN on `fbd800fc`). |
| 11 | `<md>` phase 3 | **WAITING** on #1410 landing. |
| 12 | 237 `:> { return }` → `:> return` | **READY — PR #1411** (emit byte-identical). `compiler/SPEC.md` still has 10 braced examples — owner's call. |
| 13 | docs currency + maps | **READY — PR #1412**. Found gap `g-lifecycle-is-given-does-not-narrow-s465` (MED) — a good next AUTO item once ruled-in. |

## New this run
- **P0 — imported async server helper not awaited** (live on main: a wrong password is accepted when the check lives in another `.scrml` file). Branch `auto/s465-await-imported-server-fn` — see the S465 hand-off for its review state; it closes the whole "server code emitted from text" class. Land it as soon as a review is CLEAN.

## Next AUTO run may take (in order)
1. The await branch: re-review on its latest head; fix rounds as needed; PR when CLEAN.
2. `g-lifecycle-is-given-does-not-narrow-s465` (MED): the canonical `if (u is given)` must narrow a lifecycle return as the retired `given u :>` did (§42.2.3) — newly-accepting toward the contract (quote §42.2.3).
3. LOW gaps filed this run by reviews, each with a locus (`grep s465 docs/known-gaps.md`) — only those whose fix is newly-rejecting-to-zero or inert.
4. Items 7 and 11 once their prerequisites land.

## Not for AUTO (needs bryan)
- Everything in `auto-questions.md` dated S465, plus the S461/S462 carry-overs listed there.
- `<md>` inside `lift` / markup-value positions; X build; narrowing-checker simplification (after item 9).
