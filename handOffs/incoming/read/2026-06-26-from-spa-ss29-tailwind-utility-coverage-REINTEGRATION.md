---
from: sPA ss29 (tailwind-utility-coverage)
to: PA
needs: action
date: 2026-06-26
re: re-integrate spa/ss29 → main (Tailwind generator coverage — item 1 + 3 landed, item 2 parked)
---

# Re-integration — ss29 Tailwind utility coverage

Branch **`spa/ss29`** (worktree `../scrml-spa-ss29`), base `b11fa160`. Two of three items landed; one parked (design ruling). flogence S14 closed on these two — a flogence reply is owed on land.

## Items landed (per-item SHA — each a single sPA-authored commit, agent work cherry-pick-`-n`-squashed)
| Item | SHA | What |
|---|---|---|
| 1 — g-tailwind-bare-transition-family | `00fd6e40` | `registerTransition()` static-registry extension: bare `transition` / `transition-{all,colors,opacity,shadow,transform,none}` / `duration-{75..1000}` / `ease-{linear,in,out,in-out}` / `delay-{N}` (Tailwind v3 values). Previously: no CSS + ghost-lint. +34-test unit. |
| 3 — g-tailwind-group-parent-state-variant | `4d219f49` | NEW **parent-state variant KIND** (descendant combinator `.group:<state> .group-<state>\:util {}`, distinct from pseudo/media); `group` marker (recognized, no rule); group-{full STATE_PSEUDO_CLASSES set}. +19-test unit + SPEC §26.3/§26.5 amendment. |

**Branch tip SHA: `4d219f49`.** Clean tree. Each item: full-suite pre-commit hook PASSED + independent sPA R26 (compile repro → grep generated CSS → confirm no ghost-lint).

## Item PARKED → escalate (design ruling, NOT buildable)
**Item 2 — bug-1 safelist/@apply** (`[status=PARKED→PA]`). Verify-scope-first OUTCOME: it is a **design ruling**, not a buildable scope. SPEC §26.5 ("Open Items") says the safelist/`@apply` mechanism "remains deferred"; known-gaps bug-1 (L1281) is explicit: "**no ruled direction** → PARKED to PA (design ruling: safelist config knob vs `@apply` support vs `#{}`-class-scan suppression)." The `lint.tailwind-unrecognized-class = off` (§28) escape hatch already covers heavy-custom-CSS adopters. All other bug-1 sub-arcs (string-shaped + ring-offset + the 4 composing families) already LANDED (S210/S191). **Nothing to build until the PA/user rules a direction among the three approaches.** The ss29 list marks it parked.

## NEEDS RATIFICATION (item 3 SPEC amendment)
Item 3's commit `4d219f49` includes a **SPEC §26.3/§26.5 amendment that un-defers the `group-*` half of open SPEC-ISSUE-012.** The sPA does NOT author new-variant-kind SPEC normative text unilaterally (the ss18 §61.5 model) — **PA: confirm / expand the normative wording at re-integration.** Three surgical edit sites:
- **§26.3 Variant Prefixes** — new row `group-<state>: → .group:<pseudo> descendant combinator (parent-state)` + one normative paragraph (descendant-combinator semantic; `group` marker emits no CSS + no lint; stacks with media; unknown `group-bogus:` → W-TAILWIND-001).
- **§26.5 Open Items** — `group-* and peer-*` deferred line → `peer-*` only (xref §26.3); the normative `SHALL emit W-TAILWIND-001` example moved off `group-hover:p-4` → `peer-hover:p-4`.
- **§34 diagnostics (W-TAILWIND-001 row)** — deferred-prefix example `group-hover:` → `peer-hover:`.
Still TBD under SPEC-ISSUE-012: `peer-*` (sibling-state), `before:`/`after:`, custom theme config, container queries.

## Test migration in item 3 (FYI — not a regression)
Item 3 migrated **13 pre-existing tests** in 3 shared suites (`compiler-warnings-tailwind`, `tailwind-classes`, `bug-1-tailwind-unrecognized-class`): fixtures that hardcoded `group-hover:` as the canonical "deferred variant fires W-TAILWIND-001" case → `peer-hover:` (still deferred). NOT assertion-deletion — `peer-*` is now the canonical still-deferred fixture + a regression guard asserts it STILL warns (sPA-verified via the direct lint API: `peer-hover:underline` fires both W-TAILWIND-001 + W-TAILWIND-UNRECOGNIZED-CLASS; `group-hover:` fires neither). Migrated suites 291/0 from repo root.

## Re-integration mechanics
- spa/ss29 base `b11fa160`; divergence vs main = `1  2` (main 1 ahead — bookkeeping; spa/ss29 2 ahead — items 1+3). Main did NOT touch `tailwind-classes.js` / `SPEC.md` / the migrated test files since base → clean merge.
- PA R26 (per the ss29 list): compile a repro per new utility, grep the generated CSS for the rule, confirm no ghost-lint. Confirmed independently by the sPA:
  - item 1: 13/13 transition utilities emit correct CSS, 0 ghost-lint.
  - item 3: `.group:hover .group-hover\:p-4 { padding: 1rem }` + `.group:focus .group-focus\:bg-blue-500 { … }`; `group` no rule; `peer-hover:` no CSS but still warns.

## Environment notes (for PA awareness — not blockers)
- **CWD-artifact suite "failures":** running the full suite from `compiler/` shows ~23 fails — they are CWD-relative doc-marker tests reading `compiler/PIPELINE.md` / `SPEC.md` (ENOENT from `compiler/`); they pass 0-fail from the **repo root** (the pre-commit hook's CWD; sPA-verified same files 64/0 from root). Pre-existing on the base, not ss29-caused. (Same class flogence flagged in ss18.)
- **Cross-session commit contention** (carried from the prior ss18 run on this machine): another session's full-suite commits intermittently OOM-pressure the pre-commit hook; the sPA memory-gated both commits (fired on >6GB-free windows) — landed clean without `--no-verify`.

## Hand-off artifacts on the branch
`docs/changes/g-tailwind-bare-transition-family/BRIEF.md` + `docs/changes/g-tailwind-group-parent-state-variant/BRIEF.md`. Progress: `spa-lists/ss29.progress.md`; list statuses updated in `spa-lists/ss29-tailwind-utility-coverage.md`.

PA owns: merge `spa/ss29` → main, push, ratify the §26.3/§26.5 group-* normative wording, re-route bug-1 item 2 to a design-ruling track, send the flogence S14 reply (items 1+3 closed), worktree cleanup. The sPA stands down.
