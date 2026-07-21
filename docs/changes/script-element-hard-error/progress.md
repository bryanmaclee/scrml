# progress — `<script>` in scrml source is a HARD ERROR (`E-SCRIPT-001`)

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a4c40a7f83b768871`
Base: `origin/main` @ `499dd740`

## Unit 0 — startup verification

- `pwd` == `git rev-parse --show-toplevel` == worktree root. Tree clean at `499dd740`.
- `bun install` OK (218 packages). `bun run pretest` OK (13 test samples -> `samples/compilation-tests/dist/`).
- Maps read: `primary.map.md` (+ routing to `error.map.md` / `structure.map.md`).

## Reconnaissance (pre-edit)

- Fire site confirmed: `compiler/src/block-splitter.js:3478` — the `<style>` /
  `E-STYLE-001` rejection, immediately after `flushText()` / `step()` / `readIdent()`
  in the markup-opener path.
- `readIdent()` (`block-splitter.js:1088`) accumulates `[A-Za-z0-9_\-]+`, so `<noscript>`
  yields the FULL ident `"noscript"`. An exact `=== "script"` compare cannot prefix-match it.
- `RAW_CONTENT_ELEMENTS` (`pre`, `code`) is handled at line ~3700 — AFTER the rejection
  site — but the raw-content branch consumes the whole body as one text run, so a
  `<script>` inside `<pre>` never re-enters the markup-opener path. To be VERIFIED, not assumed.

### Premise re-verification (not taken on faith)

- `E-SCRIPT-001`: 0 references across `compiler/src/`, `compiler/SPEC.md`, `compiler/tests/` — free to claim.
- `<script` in `.scrml` under the worktree (excl. `dist/`): **0 files**. Migration cost zero, confirmed.
- `<script` in `.scrml` under `scrml-support/`: **7 lines across 7 files**, every one inside a `//`
  comment (Svelte/Vue comparison prose). NOTE: the BRIEF says "6 files"; the actual count is 7.
  Immaterial to the ruling (all comment-only), but the number in the BRIEF is off by one.
- Baseline behavior reproduced: `<script>` body / `<script src>` -> **0 diagnostics** before the change;
  `<style>` -> `E-STYLE-001`. The SPEC's closed door was indeed wide open.

## Unit 1 — impl + tests (commit `2dea3ca1`)

`compiler/src/block-splitter.js` — `E-SCRIPT-001` beside `E-STYLE-001`, same fire site, same
scan-to-close recovery (`</script>`, case-insensitive, 9 chars) or EOF.
`compiler/tests/unit/script-element-rejected.test.js` — 21 tests. Code+test one commit
(they are one logical unit; splitting creates a transiently-red window).

### The 5 must-not-fire cases, each with its verifying fixture

| # | Case | Fixture | Result |
|---|---|---|---|
| 1 | `<script>` in a `//` comment | verbatim text from `gauntlet-teams/team-4/app.scrml:852`, `round3/twitter/vue/app.scrml:158`, `round10/bun/response-graph.scrml:140` (+ an HTML-comment case) | no fire |
| 2 | `<script>` in a string literal | double- and single-quoted, inside `${...}` | no fire |
| 3 | `<script>` inside `<pre>` / `<code>` | §4.17 raw-content bodies | no fire |
| 4 | `<noscript>` | plus `<scriptish>` / `<script-host>` prefix-adjacent idents | no fire |
| 5 | the compiler's OWN emitted output | full `compileScrml` of a canonical program; asserts `<script src="scrml-runtime.*.js">` + `app.client.js` SURVIVE, exactly 2 tags in emit order | tags intact |

### Adversarial verification (mutation testing — green ≠ complete)

The must-not-fire tests were mutation-tested to prove they are not vacuous:

- Mutation 1 — `=== "script"` -> `.includes("script")`: **2 tests fail** (`<noscript>`,
  script-prefixed idents). The exactness guard is load-bearing.
- Mutation 2 — delete the scan-to-`</script>` recovery: **2 tests fail**, and the cascade test
  shows +2 spurious errors. The recovery is load-bearing.
- Both mutations reverted; `git diff --stat` back to the exact 34-line addition; 21/21 green.

## Unit 2 — SPEC + §34 catalog (commit `aaa1618b`)

- `compiler/SPEC.md` §4.17 companion considerations: struck the false `W-LINT-018` claim,
  restated the mechanism as `E-SCRIPT-001` at the block-splitter level, symmetric with `<style>`.
  Added an explicit S277 correction note recording that the old text was false in BOTH halves.
- Added the §34 catalog row for `E-SCRIPT-001` (Error), cross-ref §4.17 / §7 / §23, placed
  alphabetically between `E-PARSE-002` and `E-STATE-004`.
- Checked for a central code registry: `E-STYLE-001` appears ONLY in `block-splitter.js` +
  SPEC + tests, so `E-SCRIPT-001` needs no registration elsewhere. Symmetry confirmed.

## Empirical verification

**Full suite** (`bun test compiler/tests/`):

| | pass | skip | todo | fail | `(fail)` lines |
|---|---|---|---|---|---|
| before | 28521 | 216 | 1 | 38 | 36 |
| after  | 28543 | 216 | 1 | 36 | 36 |

**Failure SET diff: IDENTICAL** (36 entries both sides, `diff` clean). All 36 are the
pre-existing classes the BRIEF named: native within-node parity (`M6.5.b.0`, 17), `migrate --fix`
(§8/§9/§10/§11, 6), dual-pipeline canary (1), browser/happy-dom (`Bug 60`, `g-emit-lift`,
`g-each-peritem`, 12). None `<script>`-related.

Honest note on the count wobble: the FIRST baseline run reported 38 fail, the second reported 36
`(fail)` lines, and the after-run reported 36. The SET is identical, so nothing regressed — but I
did NOT "fix" 2 tests. That is run-to-run flake (the known browser/happy-dom global-state-leak
class). Reporting it rather than banking the favorable-looking delta.

**R26 corpus** — `docs/website` + `examples/23-trucking-dispatch`, WHOLE-DIRECTORY compiles
(the first pass compiled only `app.scrml` — 4 files out of 98 sources — and was widened):

- Non-empty gate asserted BEFORE any comparison: website 295/295 files, trucking 115/115.
  (A bad path silently emits 0 files and reads as a false-green `DIFF: NONE`.)
- Emitted trees: **byte-identical** before vs after (`diff -r`, both targets).
- Diagnostic logs: identical except the output-directory path in the summary line.
  98 + 36 source files compiled, exit 0, **zero** `E-SCRIPT-001` occurrences.
- Emitted `<script>` tags unchanged: website 14 tags (5 per-page client bundles + runtime),
  trucking 4 (incl. the nested `models/auth.client.js`).

**DONE-PROBE (end-to-end through the real CLI, not just `splitBlocks`)**

- A: a source with a `<script>` element -> `error [E-SCRIPT-001] … (line 5, col 1)`, stage BS,
  message names `${...}` and `_{...}` (§23). The `window.__pwned = 1` body reaches
  **0 output files** — the verbatim pass-through is closed.
- B: a source mentioning `<script>` only inside `//` comments -> compiles clean, 0 `E-SCRIPT-001`.

## Findings surfaced, NOT fixed (out of scope)

1. **The `E-STYLE-001` §34 row is wrong** (as the BRIEF predicted): the row reads
   "CSS: syntax error in `#{}` style block" but `block-splitter.js` fires
   "`<style>` blocks are not supported in scrml" — an ELEMENT rejection, not a `#{}` syntax error.
   Left untouched per the BRIEF. Now that `E-SCRIPT-001` sits beside it with an accurate row, the
   asymmetry is more visible. Recommend queueing.
2. **Block-comment cloak at this fire site** (found while verifying case 1, NOT in the BRIEF):
   `/* … <style>x</style> … */` at markup level DOES fire `E-STYLE-001` today, and
   `E-SCRIPT-001` inherits that behavior by construction. It is NOT a new false positive on legal
   code: a `/* */` block comment at markup level ALREADY fires `E-SYNTAX-050` on its own, with no
   tag inside at all (the bare-`/` closer heuristic). That territory is pre-existing-broken and is
   a separate defect. All 7 real ecosystem mentions are `//` line comments, which are clean.
   Deliberately mirrored `<style>` rather than silently diverging. Recommend queueing with (1).

