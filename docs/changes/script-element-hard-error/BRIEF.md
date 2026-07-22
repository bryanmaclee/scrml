# BRIEF — `<script>` in scrml source is a HARD ERROR (`E-SCRIPT-001`)

Scoped S277 (2026-07-21) · agent `scrml-js-codegen-engineer` · isolation `worktree` · model opus
**DO NOT DISPATCH until the `outlet-collector-total-walk` PR has MERGED** — both edit `compiler/SPEC.md`,
and two concurrent dispatches on one file violate the ingestion-disjoint invariant.

## THE RULING (bryan, S277)

> **hard error**

`<script>` in scrml SOURCE is rejected outright, mirroring `<style>` → `E-STYLE-001`. JS lives in
logic-context `${...}`; genuine foreign code has `_{...}` (§23). `<script>` is the React/Vue/Svelte
reflex and buys scrml nothing — a second door into the room `_{}` already owns.

## WHY — the gap this closes (PA-verified empirically, do not re-derive)

`compiler/SPEC.md:1147` currently states:

> `<script>` and `<style>` are NOT raw-content in scrml because scrml does not admit those elements at
> all — `<style>` triggers `E-STYLE-001` at the block-splitter level (CSS lives in `#{...}`), and
> `<script>` is a Ghost-Pattern lint surface (W-LINT-018 family) because JS lives in logic-context `${...}`.

**Half of that sentence is false.** Compiled all four shapes through `compileScrml`:

| source | SPEC claims | ACTUAL |
|---|---|---|
| `<style>` block | `E-STYLE-001` | fires correctly |
| `<script>` with a JS body | Ghost-Pattern lint (W-LINT-018) | **NOTHING — silent, and the script passes through VERBATIM into the emitted body** |
| `<script src="…">` | same | **NOTHING** |

A probe body containing `window.__pwned = 1` reached the emitted document untouched. Further,
**`W-LINT-018` is `lint-ghost-patterns.js:1052` "Pattern 19: Svelte store API calls"** — unrelated to
`<script>`. No ghost-pattern rule targets `<script>` at all. The SPEC asserts a closed door that is wide
open and cites a code that is about something else.

## MIGRATION COST — ZERO (measured, ecosystem-wide)

Do not re-survey; this was measured at scope:

- `<script` in `.scrml` source under `scrml/` (excluding `dist/`): **0 files**.
- `<script` in `.scrml` source under `scrml-support/` + `scrml-native/`: **6 files, ALL inside `//`
  comments** — prose comparing scrml to Svelte/Vue (`"Svelte has <script> at the top"`,
  `"Vue's <script setup> = ${} block"`). Zero real `<script>` ELEMENTS anywhere.
- `<script` in `compiler/tests/`: every hit operates on **emitted HTML** (stripping `<script>` from
  output, or hand-building an HTML fixture). No test embeds `<script>` in a scrml SOURCE string.

Those six comment-only files are your **false-positive regression fixtures** — see TESTS.

## THE FIX

Mirror `E-STYLE-001` exactly. Fire site: `compiler/src/block-splitter.js` — the `<style>` rejection sits
at **line ~3478**, immediately after `flushText()` / `step()` / `readIdent()` in the markup-opener path.
Add the `<script>` rejection directly beside it, same shape:

- Fire **`E-SCRIPT-001`** (a NEW code — verified unused across SPEC.md and `compiler/src/`).
- Then recover the same way `<style>` does: scan to the matching `</script>` (case-insensitive) or EOF,
  so the JS body does not cascade into a storm of parse errors.
- Message must name the resolution, the way `E-STYLE-001` names `#{}`. Point at **`${...}`** for scrml
  logic and mention **`_{...}` (§23)** for genuine foreign code. No `--convert-legacy-*` hint exists for
  this; do not invent one.

### MUST NOT fire on (verify each, with a fixture)

1. **`<script>` inside a `//` comment** — the six ecosystem files above. The fire site sits in the
   markup-opener path after comment handling, so this is likely already structurally safe — **verify it,
   do not assume it.** S264's `E-SQL-003` shipped a comment-cloak bypass in this exact area.
2. **`<script>` inside a string literal** in a logic context.
3. **`<script>` text inside `<pre>` / `<code>`** — §4.17 raw-content elements; their bodies are a single
   text run and scrml tokens are not recognized inside.
4. **The compiler's OWN emitted output.** The emitter produces `<script src="scrml-runtime.<hash>.js">`
   and `<script src="<page>.client.js">`. This check is SOURCE-side only and must never see those.
   Confirm by compiling any existing example and checking the emitted `<script>` tags still appear.
5. **`<noscript>`** — a different element; `readIdent()` must not prefix-match it. Fixture required.

## SPEC + CATALOG

- **Correct `compiler/SPEC.md:1147`.** Strike the false W-LINT-018 claim. State that `<script>` triggers
  `E-SCRIPT-001` at the block-splitter level, parallel to `<style>` → `E-STYLE-001`.
- **Add the §34 catalog row** for `E-SCRIPT-001` (Error), cross-referencing §4.17 + §23 + §7. The code
  lands WITH the impl in this same commit per Rule 4 / the named-codes-land-with-impl precedent.

### A SECOND §34 defect found while scoping — report, do not fix here

The existing §34 row reads `| E-STYLE-001 | §9 | CSS: syntax error in `#{}` style block | Error |`, but
the code's ACTUAL fire at `block-splitter.js:3480` is *"`<style>` blocks are not supported in scrml"* —
a different trigger entirely. The row describes a `#{}` syntax error; the code rejects an element. This
is the S260 §34-rot class. **Do NOT fix it in this dispatch** (it is a separate ruling — the row may be
covering two triggers, or one of them may be dead). Report it so the PA can queue it.

## TESTS (required)

New unit file `compiler/tests/unit/script-element-rejected.test.js`:

1. `<script>` with a JS body → `E-SCRIPT-001` fires; message names `${...}`.
2. `<script src="…"></script>` → `E-SCRIPT-001` fires.
3. Recovery: source with a `<script>` containing brace-heavy JS still yields ONE error, not a cascade.
4. `<script>` mentioned inside a `//` comment → **NO** diagnostic (use real text from
   `scrml-support/docs/gauntlets/gauntlet-teams/team-4/app.scrml:852` and
   `.../vue/app.scrml:158`).
5. `<script>` inside a string literal → no diagnostic.
6. `<script>` text inside `<pre>` / `<code>` → no diagnostic.
7. `<noscript>` → no diagnostic.
8. Emitted-output guard: compile a canonical program and assert the emitted HTML STILL contains its
   `<script src="scrml-runtime…">` + client-bundle tags. This is the check that catches a source-side
   rule wrongly applied to emitted output.

## EMPIRICAL VERIFICATION

1. Full suite `bun run test`. A hard error on a previously-silent form is exactly the shape that breaks
   an unrelated fixture — if anything goes red, report it rather than editing the fixture to suit.
2. Recompile `examples/23-trucking-dispatch` and `docs/website`; assert both trees non-empty BEFORE any
   comparison, then confirm **zero** new diagnostics and that emitted `<script>` tags are unchanged.

## REPORT BACK

Worktree path · final SHA · files touched · the 5 must-not-fire cases each with its verifying fixture ·
the E-STYLE-001 §34 row finding · suite numbers · corpus result · maps load-bearing yes/no.

DONE-PROBE: grep -qF E-SCRIPT-001 compiler/src/block-splitter.js
Expected behaviour the probe stands in for: a `<script>` element in scrml source is a hard error
(`E-SCRIPT-001`); a `<script>` mentioned only inside a `//` comment fires nothing (landed #127
`07901878`).
