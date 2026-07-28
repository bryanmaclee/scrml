# sPA ss20 — each-codegen-followon (post-ss17 each/markup-body cluster)

**Launch:** `read spa.md ss20` · **Branch:** `spa/ss20` · **Worktree:** `../scrml-spa-ss20`

**Fill:** the each/markup-body-codegen cluster that was collision-blocked behind ss17 (now LANDED `72b52b6d`) · NEW S220 · **fireable now**

## Shared ingestion
The "green compile, wrong render" family that lives in the **each / match / markup-value codegen** path — the surface ss17 just finished (emit-each.ts) plus its siblings emit-html / emit-lift / emit-bindings. ss17 closed the 3 per-item-emitter gaps; this list is the **follow-on cluster** it surfaced + the ss19 render-codegen HIGHs that were held for it + the flogence each-body findings. **READ FIRST:** the ss17 landing (`compiler/src/codegen/emit-each.ts` @ `72b52b6d` + `docs/changes/ss17-each-peritem-emitter-2026-06-25/BRIEF.md`) for the per-item emitter shape these build on. the adopter/flogence detail: `(private — scrml-support/handOffs/adopter-confidential/)` + `handOffs/incoming/read/2026-06-25-1107-from-flogence-cockpit-dogfood-3-findings.md`.

## Core files
`compiler/src/codegen/emit-html.ts` · `emit-each.ts` · `emit-lift.js` (`emitCreateElementFromMarkup`) · `emit-bindings.ts` · `tailwind-classes.js` (class-extractor)

## Items (by sub-locus)

### Group 1 — render-codegen HIGHs (held from ss19 Group B)
1. **`g-if-guard-inner-effect-not-gated`** (#11, HIGH) `[status=landed-on-branch SHA=04228356]` — `if=(@x is some)` only toggles `el.style.display`; the inner `${@x.field}` interpolation effect runs on mount with `x===null` → null crash. Locus `emit-html.ts` — gate the subtree's inner interpolation effects on the guard condition. **Highest emit-html/each overlap — this is the core fix.** Repro `/tmp/ryan-verify/07-if-guard-effect.scrml`.
2. **`g-compound-bind-value-not-two-way`** (#10, HIGH) `[status=landed-on-branch SHA=1f03f5fe]` — compound `bind:value=@form.field` writes the DERIVED parent, not the source sub-field → input empty, isValid stuck. Locus `emit-bindings.ts:513-520` — dotted-path bind must target the source sub-field cell, not the root (derived) token. Repro `/tmp/ryan-verify/06-compound-form-bind.scrml`.
3. **`g-each-mount-form-submit-no-preventdefault`** (flogence #1 remaining half, MED) `[status=landed-on-branch SHA=a41d3227]` — a `<form onsubmit=fn()>` inside an `<each>` drops the auto-injected `event.preventDefault()` (present on the top-level registry path) → Enter reloads the page. Locus: the each-mount `addEventListener("submit", …)` emitter (`renderTemplateAttrToJs` event-handler locus) — inject the same `event.preventDefault();` prefix the registry path uses. **Note:** ss17 item-1 (`buildEachExprHandlerBody`) already fixed the OTHER half of flogence #1 (the dead `${(e)=>}` arrow); this is the sibling preventDefault gap.

### Group 2 — emit-lift markup-text interpolation
4. **`g-emit-lift-markup-text-interp-not-lowered`** (MED) `[status=open]` — `emit-lift`'s `emitCreateElementFromMarkup` renders a markup TEXT child's `${...}` LITERALLY for non-each callers (the `<match>`/`<engine>` arm markup-value path — S201 top-level + arm). ss17 worked around it inside the each machinery; the shared emit-lift gap remains. Lower `${...}` inside markup TEXT children to a reactive interpolation. **Closing this also closes #5.**
5. **`g-nested-interp-in-markup-value-literal`** (LOW) `[status=open]` — `${@cell}` inside a markup-value ternary branch renders as literal text on the top-level S201 + arm paths. Same root as #4 — verify it closes when #4 lands (don't double-fix).

### Group 3 — class-extractor (distinct locus, same each-body theme)
6. **`g-each-match-body-class-literal-not-extracted`** (flogence #3, MED) `[status=guard-landed SHA=acc6ef0a · FOOTPRINT-MISS: TS already-correct since S212; real fix = self-host section-assembly.js ~L2113-2118 (B4-deferred → PA)]` — class literals used ONLY inside `<each>`/`<match>` bodies emit no CSS rule → silent unstyled render ("squashed bubbles"). Locus `tailwind-classes.js` (class-extractor, NOT emit-each) — have the extractor also scan the non-interpolated `class="…"` literal tokens inside each/match bodies; interpolated `class="${…}"` keeps the safelist. The single most common "green compile, wrong render" trap (flogence cockpit).

## Progress
`ss20.progress.md`. Land on `spa/ss20`; ping PA inbox when ready. Do not advance main / do not push. PA re-integrates per-group. **Coordinate with ss19** if it's running concurrently — ss19 Group A is server-emit (disjoint from this each/render surface), so ss19A + ss20 are safe in parallel; ss19 Group B (#10/#11) is SUBSUMED here (do not double-dispatch).
