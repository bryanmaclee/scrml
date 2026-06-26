# sPA ss30 → scrml PA — W3↔W4 fork, developed for a user ruling

**Context:** Companion to `2026-06-26-from-spa-ss30-w3-codegen-splitter-REINTEGRATION.md` (the ss30 re-integration). That message parked 5 forks; this one fully develops **fork #1 (the load-bearing one)**. The user saw my framing, asked me to develop it, then said: **pass it to the PA — you (PA) bring it to me as a ruling.** I did NOT take the ruling at the sPA layer. Below is ready to bring to the user (or to seed a debate/deep-dive first — the user floated that as an option).

---

## The fork (scope: architecture-wide — decides whether A-4 ever pays off)

**Plain version:** the splitter already *computes* the right answer (per-route, per-role, interaction-tiered reachable set) and *emits* it as a descriptor. **Nothing loads that descriptor.** The page still ships its full `<script src>` fragment list, all eager. **W4 is the wave that makes the browser act on the split. The fork is: what IS the chunk when the runtime acts on it?**

### Grounding facts (empirically verified on trucking, post-W2)
1. **scrml is ALREADY a content-addressed module-registry architecture.** Components are separate self-registering `.client.js` files: each ends `_scrml_modules["components/load-card.client.js"] = { LoadCard, formatRate, ... }`. A route's page-shell pulls deps by file-key: `const { LoadCard } = _scrml_modules["components/load-card.client.js"]`.
2. **The page already loads only its route's import-graph fragments**, not the whole app (board.html loads load-card + load-status-badge + auth + app + board shells — its actual dep set, not all 14 components).
3. **`_SCRML_MOUNTS` (what the chunk writes today via `_scrml_chunk_mount(id,tag)`) is adopter-debug ONLY** — runtime comment "for adopter-debug"; nothing functional reads it. The emitted initial chunk is currently **100% inert**.
4. The splitter computes a set FINER than the static import graph: the N=0 *reactive-reachability* surface, role-keyed. That's the thing a loader could use to ship/defer at sub-route granularity. (Caveat: today serverFnNodeIds=0 + tiers empty, so until Component-3 lands the N=0 set ≈ the whole route — the split buys little yet. Sequencing implication below.)

**Today** — `dispatch/board.html`:
```html
<script src="scrml-runtime.js"></script>
<script src="../../components/load-status-badge.client.js"></script>
<script src="../../components/load-card.client.js"></script>
<script src="../../models/auth.client.js"></script>
<script src="../app.client.js"></script>
<script src="board.client.js"></script>
<!-- window._SCRML_CHUNKS names an initial-chunk file nothing fetches -->
```

---

## The three options (with shapes)

### Option B — manifest-driven fragment loader  *(my recommendation)*
Chunk stays a **load-plan**. Components stay the separate self-registering files they already are. W4 runtime reads the manifest, eager-loads the N=0 fragments, defers tier1/tier2 to idle/hover. The inert `_scrml_chunk_mount` markers become the loader's live "activate now" list.
```html
<script src="scrml-runtime.js"></script>
<script>_scrml_boot("/dispatch/board", _scrml_current_role())</script>
<!-- runtime loads board's N=0 fragments now; load-detail-only fragments wait for interaction -->
```
- **No code duplication** (each fragment one cached file, shared across routes); **lowest codegen lift** (descriptor exists — work is the W4 runtime loader); **cohesive** with `_scrml_modules`. Navigating board→load-detail reuses board's cached fragments. "Limit primitives" answer: the chunk stays a sharp descriptor, not a bundle.
- Cost: more requests (one per deferred fragment) — HTTP/2 multiplex + per-file caching mitigate.

### Option A — inline bundle (chunk replaces the script list)
Initial chunk becomes a self-contained bundle (page-shell + N=0 factories + reactive inits inlined). HTML loads only `<script src=initial-chunk>` + runtime.
```html
<script src="scrml-runtime.js"></script>
<script src="board/initial.<hash>.js"></script>
```
- **Best cold first-paint** (one request, no registry waterfall). BUT **fights the registry**: `load-card` reachable from board *and* load-detail *and* dispatch → its code copied into each bundle (duplication tax), unless a shared-chunk dedup layer is added (re-invents `_scrml_modules`). **High codegen lift.**

### Option C — hybrid (inline N=0, fragment-load the tiers)
Initial chunk = inlined bundle for first-paint; tier1/tier2 = manifest fragment loads.
- Best raw critical-path TTI + no dup on the cold tail. BUT **two delivery mechanisms**, and the N=0 inline path still duplicates shared components across routes.

---

## sPA read (present, don't decide)
**B.** Cohesive with what scrml already is; no refactor/duplication tax; turns the inert descriptor into the live hook; the multi-page / flux-MMORPG navigation pattern (routes sharing components) is exactly where B's cross-route fragment caching wins. Only reason to pick A/C: cold first-paint on a *single* route dominating "feel of performance" over fast *navigation* — and HTTP/2 narrows even that.

**Sequencing consequence:** B is mostly W4 runtime-loader work → a clean standalone W4 wave. A is more codegen → could fold back into W3.

## Clarification axes I offered the user (use these when you bring it to them)
1. **Duplication tax in A, quantified** — which trucking components are reachable from multiple routes → how much code A actually copies.
2. **B's request-count / waterfall cost** — does per-fragment deferral hurt "feel" more than dedup helps.
3. **What N=0 actually contains today vs the full route set** — if N=0 ≈ whole route (pre-Component-3), the split buys little now; does that gate the wave on Component-3 first.
4. **Role dimension** — `_anonymous`-only until role projection lands; any option is single-role until then. Does that reorder the waves.
5. **One ruling or split** — rule the chunk model now, defer the inline-vs-fragment-tier detail (relevant to C).

## Suggested PA next step
Either (a) bring B/A/C to the user as a ruling using the axes above, or (b) seed a debate first — the user named `in-browser-compilation-expert` + `threejs-webgl-integration-expert` + a bundler/code-split voice on *"chunk-as-bundle vs chunk-as-load-plan for scrml's reachability splitter."* It's foundational (the no-batch-ratify-axioms lens applies), so a debate before ruling is defensible.

— sPA ss30 (branch `spa/ss30` tip `2768d1ea`; stood down)
