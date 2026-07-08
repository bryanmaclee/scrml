# CSS Wave-1 §65.11 CALIBRATION dry-run — REPORT

**Status:** ANALYSIS-ONLY. No hard error shipped, no emission changed, no pipeline wired.
**Analyzer:** `compiler/scripts/css-conflict-dryrun.ts` (self-contained, report-only).
**Corpus:** the 83 `#{}`-bearing `.scrml` files (`grep -rlF '#{'`, verified 2026-07-07).
**Spec basis:** SPEC §65.2 / §65.2.1–65.2.4 (decidable core + fail-closed residue) / §65.11 (this gate).

---

## Executive summary

| Metric | Count | Notes |
|---|---:|---|
| Corpus files | 83 | 187 *textual* `#{` — but that count is inflated by `//` comments + `<code>#{}</code>` prose. |
| **Real analyzable CSS surface** | **625 grouped rules** | across **62 program scopes** + **3 component scopes** |
| **HARD `E-STYLE-CONFLICT` (fires today)** | **0** | ZERO. Every corpus conflict lives in a *program-level* `#{}`, which §65.2.4 makes soft. The 3 component-scoped `#{}` have no same-property overlap. |
| WHAT-IF hard (program provable overlap) | **20** | what *would* fire if the same CSS were written inside a bounded component `#{}`. Split: **13 universal-`*`-reset**, **7 BEM base+modifier**. |
| Same-axis (§65.2.3, BEM on `:hover`) | **7** | same BEM shape, on the `:hover` layer. |
| Soft — structural fail-closed (intended) | **5** | functional / sibling / dynamic-`<each>`-match. Correct. |
| Soft — program-unbounded **firehose** | **2941** | across **49 files** (worst file: 381). The literal "program-level = unbounded → soft" reading fires on *every* same-property program pair (`body`+`.form-card` background). **Unusable as shipped.** |
| Shorthand/longhand overlap (spec-gap probe) | **14** | `* {margin}` vs `.x {margin-bottom}`, `.btn {border}` vs `.btn-op {border-color}`. §65.2.4 "same property" is silent on shorthand/longhand. |

**False-positive verdict:** Of the 20 would-be-hard overlaps, **13 (65%) are clear false positives** (the
universal-`*` reset idiom), and **7 (35%) are the BEM base+modifier judgment call** — literally a §65.2.1
conflict (pure source-order tiebreak, which §65 deletes) but also the single most common CSS methodology.
**Zero of the 20 are "clean, no-argument today-bugs."**

**Boundary recommendation (one line):** The §65.2.4 decidable/fail-closed *axis* is right, but two
carve-outs are missing before the hard error can ship — **(1) universal `*` (and `body`/`html`) rules must
be a lower layer, not a same-level conflict** (removes 65% of the false positives outright), and **(2) BEM
base+modifier same-property overlap should start SOFT** until Wave-2 `style=[a,b]` (§65.4.4) gives adopters
a clean migration target. With those two carve-outs, the residual hard-error rate on this corpus is **0
false positives** — safe to ship. Without them, Wave-1 hard would flag the two most common real-world CSS
idioms (reset + BEM) and adopters would disable it (the guarantee dies as convention — the exact §65.11 risk).

---

## 1. Hard-error rate (each `E-STYLE-CONFLICT` that WOULD fire)

**Hard errors that fire on the corpus AS-IS: 0.**

Reason: the checker's hard path is reserved for **component-scoped** `#{}` (the `@scope`-donut-bounded,
decidable case — §65.2.4). The corpus contains only **3 component-scoped `#{}` blocks** (all in
`samples/compilation-tests/`), and none of them has a same-property overlap:

| File | Component | Rules | Overlap? |
|---|---|---|---|
| `samples/compilation-tests/css-scope-01.scrml` | `Badge` | `.badge` (1 rule) | none possible |
| `samples/compilation-tests/css-scope-01.scrml` | `Card` | `.card-wrapper`, `.card-title` | disjoint (different elements) |
| `samples/compilation-tests/gauntlet-s20-styles/css-flat-and-scoped-001.scrml` | `Card` | `.card` (1 rule) | none possible |

> The corpus cannot *exercise* the hard path — the component-scoped `#{}` surface is 3 blocks, all trivial.
> The hard-error signal therefore comes entirely from the **WHAT-IF projection** (§2), which measures what
> *would* fire once the same CSS moves into a bounded scope (the expected Wave-2 direction: `const chrome = #{}`,
> component-scoped styling). **This is the load-bearing calibration data.**

### WHAT-IF hard (program-scope overlaps that would fire hard if the `#{}` were component-scoped) — 20

All 20 are `provably-shared` same-property overlaps on a **static** element, no distinguisher. They fall in
two disjoint classes:

**1a. Universal `*` reset vs specific class — 13** (across 3 files):

```
gauntlet-s79-calculator.scrml      * (L7)  vs .calc/.screen/.btn        prop=padding   shared=<div.calc> etc
gauntlet-s79-counter-todo.scrml    * (L6)  vs .section/.count-display/.btn/.todo-input  prop=padding
gauntlet-s79-theme-settings.scrml  * (L6)  vs .app/.section/.btn/.username-input/...    prop=padding
```
The source is the universal reset idiom `* { margin: 0; padding: 0; box-sizing: border-box; }` colliding with
every element that also sets `padding`/`margin`.

**1b. BEM base + modifier (class vs class, same element) — 7** (across 2 files):

```
gauntlet-s20-styles/css-custom-props-001.scrml  .btn (L11) vs .btn-secondary (L17)  prop=background  shared=<button.btn.btn-secondary>
gauntlet-s79-calculator.scrml                   .btn (L53) vs .btn-op (L75)          prop=background,color  shared=<button.btn.btn-op>
gauntlet-s79-calculator.scrml                   .btn (L53) vs .btn-clear (L86)       prop=background,color  shared=<button.btn.btn-clear>
gauntlet-s79-calculator.scrml                   .btn (L53) vs .btn-equals (L98)      prop=background,color  shared=<button.btn.btn-equals>
```
Verified against source: `<button class="btn btn-op">` — the element **statically** carries both classes;
`.btn { background:#3a3a3a }` and `.btn-op { background:#1e3a1e }` both set `background`; `.btn-op` wins
**only by source order** (both flat-specificity `(0,1,0)`). This is exactly the tiebreak §65 deletes.

### Same-axis (§65.2.3) — 7

The identical BEM shape on the `:hover` state layer:
```
gauntlet-s79-calculator.scrml    .btn:hover (L65) vs .btn-op:hover/.btn-clear:hover/.btn-equals:hover   prop=background,color
gauntlet-s79-counter-todo.scrml  .btn:hover (L61) vs .btn-danger:hover (L70)                             prop=background
```
Both rules carry `:hover` on a provably-shared element and set the same property — a same-axis overlap
(§65.2.3), which the spec folds into the `E-STYLE-CONFLICT` family. Same judgment as BEM (§3).

---

## 2. Soft rate (`W-STYLE-CONFLICT-POSSIBLE`) + loci

There are **two very different soft populations**, and conflating them is itself a calibration hazard:

### 2a. Structural fail-closed soft (the intended §65.2.4 residue) — 5

These are the cases §65.2.4 *designed* the soft diagnostic for — matches over dynamic markup:

```
dashboard/app.scrml                 button (L193) vs button.small (L203)   prop=padding,font-size  — match via dynamic <each> <button class="small">
gauntlet-s79-counter-todo.scrml     * (L6) vs .todo-item/.empty-state       prop=padding            — match via dynamic <li> inside <each>
debate-async-dashboard-...react.scrml  .order-item (L486) vs .order-item.optimistic (L496)  prop=padding — .optimistic is a reactive class-toggle inside <each>
```
This population is small (5) and correct. `.order-item.optimistic` is the ideal case: `.optimistic` is a
`class:optimistic=@cond` reactive toggle, so the modifier is **conditionally** present — the checker correctly
declines to fire hard and surfaces a non-blocking soft.

### 2b. Program-unbounded "firehose" (the literal §65.2.4 reading) — 2941 across 49 files

§65.2.4 says program-level global `#{}` has an *unbounded* element set (a global `.btn {}` can match `.btn`
in another file), so the checker "can neither prove-disjoint nor prove-shared" → soft. Taken literally, this
fires for **every same-property pair of program rules**, including rules that target obviously-different
elements:

```
benchmarks/fullstack-scrml/app.scrml   body (L4) vs .form-card (L7)   prop=background,padding   shared=-  (no local overlap; different elements)
```
Worst offenders: `docs/website/app.scrml` (381), `gauntlet-r10-elixir-chat.scrml` (374),
`benchmarks/fullstack-scrml/app.scrml` (292), `benchmarks/todomvc/app.scrml` (269).

**2941 warnings across 49 of 83 files is a firehose no adopter would tolerate.** This is not a bug in the
prototype — it is the honest consequence of the literal "program-level = unbounded → soft" rule. It is a
**boundary finding** (§4): the soft diagnostic for program scope must be *file-bounded* (fire only on a
provable *local* overlap), not *unbounded-global* (fire on every same-property pair). See §4/§5.

---

## 3. FALSE-POSITIVE AUDIT (the crux)

Each would-be-hard overlap classified REAL (today-bug worth surfacing) vs FALSE POSITIVE (legit code
mis-flagged). The hard path itself fired 0 today, so this audits the **20 WHAT-IF hard + 7 same-axis**
(what fires once styling moves component-scoped).

### 3a. Universal `*` reset vs class — 13 → **FALSE POSITIVE**

`* { padding: 0 }` (or `margin: 0`) is the near-universal CSS reset. Its *intent* is to be a **floor** that
every specific rule overrides — the author is not "ambiguous" about whether `.btn { padding: 16px }` beats
`* { padding: 0 }`; they obviously expect the specific rule to win. Flagging this is a false positive on the
most common opening lines of a stylesheet.

Decisive corroboration from the spec itself: §65.3.4 ships a **built-in reset as its own bottom `@layer`**,
and §65.3.3 `<defaults>` are "app-wide element defaults, *locally overridable*." A user-authored `* {}` /
`body {}` reset is the same *kind* of thing — a low-intent default layer — yet §65.2.4's decidable core has
no carve-out for it and treats it as a same-precedence conflict. **This is a spec gap** (§5): the universal
selector (and arguably bare-element `body`/`html`/`*`) belongs in a **lower layer**, not the author-rule
conflict set.

### 3b. BEM base + modifier — 7 (+7 same-axis) → **REAL by the letter of §65.2.1, but the make-or-break idiom**

`<button class="btn btn-op">` with `.btn { background:X }` + `.btn-op { background:Y }` is, by the literal
text of §65.2.1, a genuine `E-STYLE-CONFLICT`: two unconditional same-property rules that provably both
match, at the same precedence level, disambiguated *only* by source order — which §65 deletes. §65.14
explicitly calls these "today-bugs; surfacing them is the point."

**But** this is BEM — the single most widely used CSS methodology (`.card`/`.card--featured`,
`.btn`/`.btn-primary`). Every design system trips it. Two problems make it unsafe to ship *hard* in Wave 1:

1. **No migration target exists yet.** The §65-blessed answer to "modifier overrides base" is ordered
   composition — `style=[base, opTreatment]` (§65.4.4, last-in-list wins) or a reactive variant selector
   (§65.6). **Both are Wave 2.** Shipping the hard error in Wave 1 flags the pattern with no clean fix to
   route the author to — the diagnostic can only say "don't do this," not "do this instead."
2. **Volume.** In this small corpus it is already 14 findings (7 base + 7 hover) concentrated in 2 files; it
   scales linearly with component-scoped adoption. Combined with 3a it is the bulk of the flag surface.

Verdict: **not a clean today-bug** (the author's intent is legible and conventional), **not a clean false
positive** (it IS the source-order fragility §65 targets). It is precisely the boundary case §65.11 was
written to find. Recommendation: **SOFT in Wave 1, revisit for HARD in Wave 2** once `style=[a,b]` lands as
the migration target. (See §4.)

### 3c. Structural soft (5) → **correctly NOT hard.** No false positives.

The `.order-item.optimistic` case confirms the reactive-class-toggle carve-out works: a `class:NAME=@cond`
modifier is treated as *conditionally* present, so the checker does not claim a provable unconditional
both-match. This is the carve-out the brief flagged as "what keeps the guarantee affordable" — **verified
correct.**

### False-positive rate summary

| Would-be-hard class | Count | Verdict |
|---|---:|---|
| Universal `*` reset | 13 | **FALSE POSITIVE** (65% of would-be-hard) |
| BEM base+modifier (base + hover) | 14 | judgment call — real-by-letter, ship-soft-in-Wave-1 |
| Clean no-argument today-bug | **0** | — |

**There is not a single "obvious real bug" the hard error would catch on this corpus.** Everything it flags
is either a reset false-positive or a legible BEM idiom. That is the calibration headline.

---

## 4. Boundary recommendation

The §65.2.4 **axis** (decidable → hard; fail-closed → soft) is sound and should stay. But the corpus says the
**line is drawn one notch too eager** in two specific, nameable ways. Move these before shipping the hard error:

**R1 — Universal `*` (and bare `body`/`html`) rules are a LOWER LAYER, not a same-level conflict.**
Treat a user-authored `*`/`html`/`body` selector rule the way §65.3.4 treats the built-in reset and §65.3.3
treats `<defaults>` — a floor that author class/id rules override without ambiguity. Removes 13 of 20
would-be-hard findings (65%) with zero loss of real signal. (Formalize as: universal/bare-element rules
resolve *below* class/id rules in the §65.5 precedence order — a bounded, explicit layer, not a specificity
tiebreak. This is fully in the spirit of "delete specificity, keep explicit layers.")

**R2 — BEM base+modifier same-property overlap starts SOFT (`W-STYLE-CONFLICT-POSSIBLE`), promotes to HARD in Wave 2.**
Two *class* selectors that provably both match one element and set the same property, differing only by a
base/modifier relationship, are real source-order fragility — but Wave 1 has no `style=[a,b]` (§65.4.4)
migration target, so a hard block is premature. Ship it soft now (names both loci, asks for disambiguation,
non-blocking); flip to hard in Wave 2 alongside the ordered-composition primitive that gives the author the
fix. This is the affordability hedge §65.11 demands.

**R3 — The program-scope soft diagnostic must be FILE-BOUNDED, not unbounded-global.**
Do NOT emit `W-STYLE-CONFLICT-POSSIBLE` for every same-property program-rule pair (the 2941 firehose). Fire
the program-scope soft ONLY on a **provable local overlap** (a same-file static/dynamic element that matches
both) — i.e., use the file's own enumerable markup as the bounded set even for program `#{}`, and treat the
"could match cross-file" concern as a documented weaker-guarantee (§65.9 OQ-8), not a per-pair warning.
Without this, program-level soft is 2941 warnings across 49 files and adopters mute the whole category.

**Is the hard false-positive rate low enough to ship the hard error?**
- **As written (§65.2.4 verbatim): NO.** It would flag the universal reset (false positive) and BEM (no
  migration target) — the two commonest CSS idioms — the moment styling moves component-scoped.
- **With R1 + R2: YES.** Residual hard false-positive rate on this corpus = **0**. Hard fires only on
  genuinely-ambiguous non-reset, non-BEM class/id/tag overlaps (of which the corpus has none — a good sign,
  not a gap).

**Should more start soft?** Yes — R2 (BEM) and R3 (program firehose) both move surface from an over-eager
position to soft. Nothing needs to move soft→hard; the corpus shows no under-flagging.

---

## 5. Spec gaps (→ SPEC follow-up)

1. **Universal-`*` / bare-element reset layering (R1).** §65.2.4's decidable list (`tag×tag`, `class×class`,
   `tag×class`, `id×*`) treats `* { padding }` vs `.btn { padding }` as a same-level conflict, but §65.3.3/
   §65.3.4 already model resets/defaults as a *lower layer*. The spec should state where a **user-authored**
   `*`/`html`/`body` rule sits in the §65.5 precedence order. Currently ambiguous → the checker false-positives.

2. **Shorthand ↔ longhand "same property" (14 findings).** §65.2.4 says "two rules that both set `P`," but
   the corpus has `* { margin: 0 }` vs `.section { margin-bottom: 8px }` and `.btn { border }` vs
   `.btn-op { border-color }` — a shorthand and a longhand that *partially* overlap. Exact-property-name
   matching misses these (the prototype flags them separately as a probe). Ruling needed: does "same property"
   include shorthand/longhand overlap? If yes, the checker needs a shorthand-expansion table (`background` →
   `background-color`, …); if no, `background` and `background-color` can silently co-apply, which is a
   predictability hole. Recommend: **yes, expand** — but note it enlarges the flag surface (mostly onto the
   same reset/BEM classes, so R1+R2 largely cover it).

3. **BEM migration-target sequencing (R2).** §65.2.1 declares the base+modifier overlap a conflict, but the
   fix (`style=[a,b]` ordered composition, §65.4.4) is Wave 2. The spec should acknowledge that the *hard*
   form of the flagship error is gated on the Wave-2 migration primitive — i.e., Wave 1 ships the
   `E-STYLE-CONFLICT` *soft* for the class×class base/modifier case, hard for the unambiguous cases.

4. **Program-scope soft is unbounded-by-definition (R3).** §65.2.4 + §65.14 make program-level `#{}` soft
   because its reach is cross-file/unbounded. But firing a per-pair warning on that basis is 2941 warnings.
   The spec should distinguish "program `#{}` gets the *weaker guarantee*" (OQ-8, a doc-level nudge) from
   "program `#{}` emits a per-pair soft diagnostic" (the firehose). Recommend the former only.

5. **Component-scope surface is too thin to validate the hard path empirically.** Only 3 component-scoped
   `#{}` exist in the corpus — the hard path cannot be exercised by real data yet. The confidence in "hard is
   safe with R1+R2" rests on the WHAT-IF projection of program-scope overlaps, not on live component-scope
   conflicts. Re-run this dry-run after Wave-2 style-as-value adoption grows the component-scoped surface.

---

## Method notes / caveats (for reviewer trust)

- **Analyzer is self-contained** (`compiler/scripts/css-conflict-dryrun.ts`): BS+TAB per file (reliable),
  program-scope rules via the real `collectCssBlocks` infra, component-scope rules via piecewise `#{}`/markup
  extraction from the component-def `raw`. It does **not** run CE — because the live CE currently *fails* to
  re-parse these component-def bodies (`E-COMPONENT-021`) even in the shipping CLI, so CE-tagged
  `_componentScope` is unreliable. (Pre-existing issue, surfaced as NOTES — not in scope here.)
- **"187 blocks"** in the brief/§65.11 is a *textual* `#{` grep; it includes `//` comments and
  `<code>#{}</code>` prose in article/doc files. The real analyzable CSS-block surface is **625 grouped
  rules** across 62 program + 3 component scopes. The `#{}`-*bearing* file count (83) is correct.
- **Element model** distinguishes STATIC classes (`class="a b"`) from CONDITIONAL classes
  (`class:NAME=@cond` reactive toggles) — the latter never count toward a provable *unconditional* both-match
  (verified via the `.order-item.optimistic` case). Combinators are evaluated over the static tree;
  sibling (`+`/`~`), `:not()`/`:has()`/`:is()`/`:where()`, and `<each>`/conditional subtrees route to soft.
- **State pseudos** (`:hover`/`:focus`/`[attr]`) are treated as deterministic layers (§65.2.2) and do not
  conflict with the base — only same-axis (both `:hover`) provable overlaps fire (§65.2.3).
- Line numbers are best-effort (declaration span for program rules; component-def span for component rules).
