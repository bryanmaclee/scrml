# SCOPING — `if=` mount/unmount, Phase 2 finish (the dirty path)

**Status:** `current`
**Last-reviewed:** 2026-07-28
**Session:** S297 (bryan · ASUS-Vivobook)
**Ruling:** bryan, S297 — option **(i) finish Phase 2**. Options (ii) *amend SPEC to sanction a
display lowering* and (iii) *lint the split now, fix later* were both put and both declined; (iii) is
**dropped outright**, not folded in as a phase.
**Baseline:** `main` @ `115e8b1b`. Every number and quote below was produced by compiling on that
commit and reading the emitted artifact — none is inherited from a prior doc.

---

## 1. The defect

`if=` compiles to **two different lowerings with different DOM semantics**, chosen silently at
compile time. One is conformant; the other is not.

**Governing sentences (Rule 4 gate — outcome (1), sentences FOUND):**

- **§17.1** (`SPEC.md:10908`) — *"The `if=` attribute is a structural boolean conditional."*
- **§17.1** (`:10914`) — *"When `expr` evaluates to false, the element is NOT rendered. **It does not
  exist in the DOM.**"*
- **§17.2** (`:11195`) — *"`show=` is distinct from `if=`: **`show=` hides, `if=` removes**."*

Reverse direction searched — §17.1, §17.1.1, §17.2, §17.4, §17.4a, §17.4b, §17.6, §17.7, §10 (lift).
**No sentence anywhere sanctions a display lowering for `if=`.** The only `display:none` sanction in
SPEC is §17.2's, explicitly scoped to `show=`.

Direction-of-change (pa-base §8): the fix is **semantics-changed, toward the contract** — a
conformance restoration, not a widening. It makes the compiler do what §17.1 already says.

## 2. The discriminator, and how narrow "clean" actually is

`isCleanIfNode()` (`emit-html.ts:678`) — a subtree is **clean** only if, recursively:

- every node is `markup`, `text` or `comment` — **any `logic` / `expr` / `state` / `if-chain` / `meta`
  child makes it dirty**;
- no tag starts with a capital (components are dirty);
- every attribute passes `attrIsWiringFree` (events, `bind:`, transitions → dirty).

Callers: `isCleanIfSubtree()` (`:645`, standalone `if=`) and `isCleanChainBranch()` (`:735`, chain
branches, via `stripChainBranchAttrs`).

**Consequence, verified by compiling three `if=` on one page against the same cell:**

| shape | lowering | conformant |
|---|---|---|
| `<div if=@v>plain static text</div>` | `<template>` + `<!--scrml-if-marker-->` | ✅ |
| `<div if=@v><span>still static</span></div>` | `<template>` + marker | ✅ |
| `<div if=@v>${@label}</div>` | `data-scrml-bind-if` → `style.display` | ❌ |

**A single `${…}` interpolation flips `if=` from *removes* to *hides*.** "Clean" is not "has no event
handler" — it is "contains nothing dynamic at all", which for a conditionally-rendered element is
close to a degenerate case.

## 3. Measured incidence

Compiled `examples/23-trucking-dispatch` (36 files — the canonical multi-file example app) and
counted emitted markers:

| lowering | sites | share |
|---|---|---|
| **dirty** (`data-scrml-bind-if`, display-toggle) | **101** | **68%** |
| clean (`scrml-if-marker`, mount/unmount) | 48 | 32% |

Cross-check on `samples/` — 28 dirty / 15 clean, same ~65% ratio. *(Caveat: that compile exits with
683 errors because `samples/` holds deliberately-negative fixtures; the ratio is from the files that
did emit, so treat it as corroboration, not a second independent measurement.)*

**So roughly two-thirds of `if=` in our own flagship app is non-conformant today.**

## 4. A second, adopter-visible consequence — pre-hydration visibility

The dirty path emits the element into the initial HTML **with no `style="display:none"`** and hides it
only once client JS boots. Verified with the predicate FALSE at compile time:

```html
<!-- source: <div id="panel" if=@isAdmin onclick=noop()>ADMIN ONLY — static text…</div>, @isAdmin = false -->
<div id="panel" data-scrml-bind-if="_scrml_attr_if_1" data-scrml-bind-onclick="_scrml_attr_onclick_2">ADMIN ONLY — static text inside a dirty if=</div>
```

`grep -c 'display:none'` on the emitted HTML → **0**. The clean path in the same file correctly emits
its subtree inside `<template>` and it never renders.

So content behind a false `if=` **ships in the HTML and is visible until hydration** — and stays
visible with JS disabled or if the bundle fails to load.

⚠️ **Scope this claim precisely.** `if=` is NOT and never was a confidentiality boundary — that is
`protect=` / §14.8.9 / `<auth>`. Interpolated *values* are filled client-side and are absent from the
initial HTML. What ships is the subtree's **static skeleton and static text**. It is a correctness +
FOUC defect, not a §14.8.9 breach. But adopters will reasonably read §17.1's "does not exist in the
DOM" as a guarantee they can gate markup on, and today it is not one. **OQ-4 asks whether this
deserves its own gap id.**

## 5. Why Phase 2 stopped — and what already exists to finish it

The split is a **self-documented unfinished migration**, not an accident:

- `emit-event-wiring.ts:1568` — *"Phase 1 (2026-04-29): both flags route to display-toggle. Phase 2
  will split `isConditionalDisplay` (`if=`) off to mount/unmount codegen."*
- `emit-html.ts:2930` — *"`if=` → mount/unmount semantics (Phase 2 work; today: display-toggle)"*

Phase 2 landed the **clean** half and stopped ~3 months ago. Prior deep-dives
(`scrml-support/docs/deep-dives/if-mount-unmount-implementation-strategy-2026-04-29.md`,
`phase-2g-chain-mount-strategy-2026-04-29.md`) are both `status: historical`, `last-reviewed:
2026-05-26` — read them for archaeology, **not** as current truth (Rule 4).

**The de-risking finding: the machinery the dirty path needs already exists and is already used by
the clean path's own controller.**

| need | existing mechanism | where |
|---|---|---|
| mount a subtree from a template | `_scrml_mount_template` | clean `if=` controller |
| scoped teardown on unmount | `_scrml_create_scope` / `_scrml_unmount_scope` | clean `if=` controller |
| locate the insertion point | `_scrml_find_if_marker` | `emit-event-wiring.ts:1453` |
| **re-run wiring against a swapped root** | `pushRebindableSel(sel, body)` → emits into `reactiveRewire`, wrapped as `(root \|\| document).querySelector(...)` | `emit-event-wiring.ts:987` |
| **track effects for teardown** | `regionEffectLines()` → `_scrml_effect` + `_scrml_region_track(el, …)` | `emit-event-wiring.ts:1005` |

The last two are the ones that make this tractable: soft-nav already needed "re-bind this wiring
against a region that got swapped in, and tear it down on the way out", and that is *exactly* what a
dirty `if=` mount/unmount needs. The clean controller already emits through `reactiveRewire`, so both
halves live in the same emitted function and are already parameterized on `root`.

**This is why (i) is smaller than "rewrite the if= codegen".** The plausible shape is: route dirty
branches through the same `<template>` + marker emission, and on mount invoke the subtree's existing
rebindable wiring with `root` = the mounted node; on unmount, `_scrml_unmount_scope`.

**All loci in this section are PA-located and marked verify** (pa-base v2.7). I traced the
clean/dirty *decision* by compiling and matching emitted output back to `isCleanIfNode`; I have **not**
traced the rebind path end-to-end at runtime. Treat §5's proposed shape as a hypothesis for the
implementing agent to confirm or refute, and report which.

## 6. RULINGS — all five answered (bryan, S297, "your recs")

**OQ-1 → SSR is IN, as unit 2 with its own acceptance gate.** Not a follow-on that can slip.
`emit-ssr-render.ts` is a separate renderer; if the client path changes what ships in the initial HTML
and SSR does not mirror it, the two disagree and produce a hydration mismatch — worse than either
state alone. They cannot safely diverge.

> **⚠️ S301 — THE PREMISE ABOVE IS FALSIFIED. Re-derived from the code on `db159a51`, not inherited.**
> SSR does not render `if=` at all today, so there is **no divergence for the client change to
> create**:
> - `emit-ssr-render.ts:213-221` — `attrsToParts()` **throws `SsrUnsupported`** on `if`, `show`,
>   `else`, `else-if` (also `bind`, any `:`-directive, any `@`-prefixed attr).
> - `emit-ssr-render.ts:370-373` — the caller **catches `SsrUnsupported` and returns `null`**, so the
>   affected block is simply **excluded from prerender per-block** and the rest of the page proceeds.
>
> So a subtree carrying `if=` is absent from the SSR seed regardless of which lowering the client uses.
> The "they cannot safely diverge / hydration mismatch" reasoning does not apply, because SSR emits
> nothing for these subtrees to mismatch against.
>
> **This does not delete unit 2 — it changes its content**, and the choice was a ruling:
> - **(a) verify-only** — assert the per-block exclusion still holds after unit 1 (a regression guard).
> - **(b) take the opportunity** — SSR gains `if=` support, so `if=false` SSRs as *absent* per §17.1.
>
> ### ✅ RULED (bryan, S301): **(a) now, and file the arc.**
>
> **The measurement is what decided it.** Flagship app, 36 files, 23 `<each>` blocks:
>
> | | count |
> |---|---|
> | iterate `@cell` (candidates by the `in=` gate) | 19 / 23 |
> | carry a **non-literal attribute value** | 20 |
> | carry **non-field-read interpolation** (call / ternary / method) | 16 |
> | carry `if=` | 16 |
> | **blocked by `if=` ALONE — i.e. what (b) would unlock** | **0** |
> | SSR each-renderers actually emitted (`_scrml_ssr_render_each_*`) | **0** |
>
> `if=` is **never the binding constraint** — every block carrying it also carries an attribute or
> interpolation blocker. (b) would have shipped a capability with **no consumer**, and `if=` is the
> smallest and least valuable piece of a multi-part widening. *(Classification is regex-based over
> crudely-extracted blocks — counts ±; the direction is not sensitive to that.)*
>
> **Consequences of the ruling:**
> 1. **Unit 2 collapses to a regression assertion** — no separate build. Folded into unit 1's
>    acceptance gate as item **7** (`BRIEF-unit1-client.md`): the per-block SSR exclusion must still
>    hold after unit 1, and the emitted-renderer count must stay at 0. This is the one thing unit 1
>    could plausibly break, and it is a `semantics-changed` class no diagnostic catches.
> 2. **The real arc is filed separately** — an SSR row-template subset widening, ordered by measured
>    blocking power (non-literal attrs 20 → non-field-read interpolation 16 → `if=` 0 marginal):
>    [[g-ssr-each-row-template-subset-blocks-all-prerender]].
>
> Unit 1 (client) is unaffected and still forbids touching `emit-ssr-render.ts`.

**OQ-2 → PREREQUISITE, and the probe sharpened what the prerequisite is.** I compiled an `<each>`
inside an `if=` on `0d78278c` and read the artifact. My stated hypothesis ("orphan or double-register")
was **partly wrong** and is corrected here:

- The `if=` around an `<each>` **is dirty** (`data-scrml-bind-if` present) — so today the each is
  permanently in the DOM and the hazard is entirely latent. Nothing is broken now.
- Renderer registration is **fine**: `_scrml_each_renderers["each_…"] = …` at module top level,
  column 0, once. It does not orphan.
- The anchor lookup is **fine per-render**: `_scrml_find_each_anchor(document, "…")` sits *inside*
  `_scrml_each_render_…()`, so it re-resolves on every render rather than capturing a node at init.

**The real exposure is narrower and different:** (a) after a remount, nothing re-triggers the
subtree's each render fns, so a remounted `<each>` renders **empty until the next data change**; and
(b) the lookup is `document`-scoped **first-match**, so a duplicated or lingering fence reconciles into
the wrong one. Note the asymmetry that names the fix: **`_scrml_find_if_marker` already takes a scope
parameter** (`(root || document)`) and `_scrml_find_each_anchor` does not. That parity is exactly what
[[g-each-anchor-lookup-first-match-document-wide]] (LOW) proposes — and under mount/unmount that LOW
becomes load-bearing. Close it first.

> **⚠️ S299 CORRECTION — the sentence above is WRONG on the mechanism, and the prerequisite is bigger
> than it implies.** Re-derived from the code, not from this doc's own premise:
> `_scrml_find_each_anchor(root, id)` **already takes and honours a scope parameter**
> (`createTreeWalker(root || _doc, …)`, `runtime-template.js:2036`). The parity this doc asks for
> already exists. What is actually wrong is (2) the sole caller — `emit-each.ts:3372` — passes
> `document` literally, so the capability is unused; and (3) a module-level `_scrml_each_anchor_cache`
> keyed by **`id` alone** is consulted **before** `root`, which *defeats* a scope parameter outright:
> with the same each id live in two subtrees, the first resolution is returned for every scope until
> that node disconnects.
>
> So the prerequisite is **caller-threading plus a cache-keying change** in the reconcile path
> (`runtime-template.js` / `emit-each.ts`) that S293–S298 worked heavily — not the one-line parity fix
> §6 OQ-2 describes. **Re-estimate this arc's size before dispatching**, and read
> [[g-each-anchor-lookup-first-match-document-wide]] (corrected S299) rather than this paragraph.
> Threading the scope without fixing the cache would pass a single-instance test and still resolve
> cross-scope — a fix that looks right and is not.
>
> **⚠️ S299, SECOND CORRECTION — reproduced, and the root is neither the scope nor the cache.** The each id
> **collides across component expansions**: two different list components, or one instantiated twice, all
> receive the same `node.id`, so the renderer map is second-write-wins and every fence resolves to the first.
> Executed: panel 0 renders panel 1's data, panel 1 renders empty, 0 errors 0 warnings. CE re-parses a
> component body from raw text and numbers nodes from scratch each time. **The prerequisite is therefore a
> component-expansion node-counter fix, in a subsystem this document never named** — scope/cache changes
> cannot fix the renderer-key clobber. Severity raised LOW → HIGH. HELD for a ruling; not started.

**OQ-3 → MEASURED, and the measurement substantially lowers the risk.** 101 sites change *lowering*,
but absent-vs-hidden is only *observable* in three places, and the corpus barely uses them:

| observable surface | corpus hits |
|---|---|
| `:nth-child` / `:nth-of-type` / `:first-child` / `:last-child` | **0** |
| CSS sibling combinators (`+` / `~`) | **1** |
| form control inside an `if=` subtree (same-line heuristic) | **1** |

Zero structural pseudo-classes anywhere in the flagship app. **So the site count overstates the
migration risk by roughly two orders of magnitude.** ⚠️ Two honest limits: this is **our** corpus only —
adopter code (Fieldman/assetManagement, Adopter-A, dc) is **unmeasured** — and the form-control check is
a same-line heuristic, so treat 1 as a floor. Re-run against adopter sources before landing.

**OQ-4 → its own gap id.** Folding it in would reproduce the exact defect filed this same session:
`g-schema-composite-unique-emits-nothing` was described accurately from S288 while living as prose
inside another entry, so it counted nowhere and was never work. Filed as
[[g-if-dirty-path-ships-gated-content-visible-pre-hydration]].

**OQ-5 → HOLD the dispatch until S297-peter's `<each>` queue lands.** The likely surface includes
`emit-ssr-render.ts` and possibly `runtime-template.js`, both in their live write-set (#248 is up).
Not idle time — OQ-2's probe and OQ-3's measurement are read-only and are already done, above.

## 6b. Original open questions (superseded by §6; retained for the record)

- **OQ-1 — SSR / prerender.** Switching dirty → `<template>` changes emitted HTML, which changes what
  SSR ships and what hydration expects. §52.15 SSR interaction is **not** analysed here. Does Phase 2
  cover the SSR path, or is SSR a follow-on with the client path landing first?
- **OQ-2 — nested `<each>` inside a mounted subtree.** Each-renderers register at module top level
  (`_scrml_each_renderers`) and `_scrml_find_each_anchor` is document-wide first-match
  (`g-each-anchor-lookup-first-match-document-wide`). Mount/unmount of a subtree containing an
  `<each>` could orphan or double-register. Does Phase 2 own that, or is the each-anchor gap a
  prerequisite?
- **OQ-3 — migration.** ~101 sites change behavior in the flagship app alone. Absent→hidden is mostly
  invisible, but `:nth-child`, sibling selectors, `.children` counts and form submission of hidden
  controls all move. Measured migration required before landing (pa-base §8), or land-and-observe?
- **OQ-4 — is §4 (pre-hydration visibility) its own gap id**, or a symptom folded into this one?
- **OQ-5 — sequencing vs Peter.** The likely surface includes `emit-ssr-render.ts` and possibly
  `runtime-template.js`, both in S297-peter's declared write-set for their `<each>` queue. Phase 2
  should not dispatch into a live intersecting footprint (pa-base §7 ingestion-disjoint).

## 7. Acceptance gate

1. Every shape in §2's table emits `<template>` + marker; **zero** `data-scrml-bind-if` in the corpus.
2. Re-run §3's measurement: `data-scrml-bind-if` count → **0**; `scrml-if-marker` count → 149 on
   `examples/23-trucking-dispatch`.
   > **S301 — the measurement SCOPE must be pinned or this gate misreads.** §3's counts are
   > **HTML-only**. The attribute name also appears in the emitted `.client.js`, so an unscoped
   > `grep -r` over the dist directory returns **202**, not 101, and reads as a regression that is
   > not there. Re-measured on `db159a51`: **101 dirty / 48 clean, byte-identical to the `115e8b1b`
   > baseline** (no drift). Use exactly:
   > ```sh
   > grep -ro "data-scrml-bind-if" --include="*.html" "$OUT" | wc -l   # 101 → must become 0
   > grep -ro "scrml-if-marker"    --include="*.html" "$OUT" | wc -l   #  48 → must become 149
   > ```
   > This is the `docs/FACTS.md` lesson applied to a gate: a derived number without its command rots
   > silently, and here it rots in the direction of a false alarm.
3. §4 reproducer: predicate false → gated content **absent** from initial HTML.
4. **Conformance case pinning the ABSENCE half.** `conformance/cases/reactive/toggle-show/` is
   misnamed (it pins `if=` mount, cited §17.1) and asserts only `count: 1` after false→true.
   §17.1's "does not exist in the DOM" has **no assertion anywhere** — that hole is precisely why
   three divergent lowerings coexisted green. New cases must assert `count: 0` when false, at
   standalone `if=`, chain-branch, and Tier-1 `<each>` per-row.
5. Full S239 adversarial pass — mandatory, codegen with a runtime surface.
6. R26 empirical: recompile real adopter sources, diff artifacts, confirm no unintended
   `semantics-changed` beyond the intended one.

## 8. Out of scope

- **Tier-1 `<each>` per-row `if=` reactivity** — same ruling, different arc; routed to S297-peter
  (`2026-07-28-1620-from-S297-bryan-to-S297-peter-…`), who is live in `emit-each.ts`.
- **Tier-0 `${for…lift}` per-row `if=`** — separately non-conformant (`emit-lift.js:395/1114/1380`
  emit `style.display`; #222 made that violation *reactive* rather than removing it). Measured floor:
  ~9 item-derived sites in 4 files, all ours. Its own gap entry; sequence after this arc.
- **`show=`** — conformant, untouched.
