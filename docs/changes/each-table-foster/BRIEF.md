# BRIEF — `<each>` mount-model rework (A-unified): anchor-node + sibling insertion

- **Gap:** `g-each-mount-div-foster-parented-in-table` (HIGH, open) — docs/known-gaps.md
- **Decision:** **Approach A-unified RATIFIED (bryan, S279).** Anchor-node model, applied to ALL `<each>` mounts (not context-conditional). B (table-context-aware mount) REJECTED — it does not fix the `<select>` case.
- **Adopter drivers (two manifestations, ONE root cause, ONE fix):**
  - **GH #131** (pjoliver11, 2026-07-22) — `<each>` `<div>`-mount under `<select>` is DROPPED by the "in select" parser insertion mode → every each-driven dropdown renders EMPTY in **Firefox** (works in Blink), silently (no console error). Source: the issue body's minimal repro.
  - **GH aM report S272** — `<each>`→`<tr>` under `<tbody>` `<div>`-mount is FOSTER-PARENTED out of the table → 0 rows, silent. Source: `handOffs/incoming/read/from-aM-pa-2026-07-19-each-tr-in-tbody-renders-empty.md`.
- **Confirmed reproduced on:** current main HEAD `d6cae6c2` (this session). Compile of the `<select>` repro emits `<div data-scrml-each-mount="each_15"></div>` directly inside `<select>`. NOT a stale-pin artifact.
- **Governing-sentence gate (§1) — CLOSED:** searched SPEC §17.7 (`<each>` iteration), §D1 (SSR render), §14.8.9 (confidentiality) — **no normative sentence prescribes the mount element's shape** (the `<div data-scrml-each-mount>` mentions are *descriptive* of the current codegen artifact, D3 implementation freedom). §17.7 governs the each SEMANTICS: it SHALL render its items in place. The current mount silently fails that in `<select>`/`<tbody>` → this fix RESTORES a governed semantic ⟹ **§8 toward-the-contract, conformance-restoring — NOT a language widening.** Land as a bug fix.
- **DONE-PROBE:** `grep emit-each.ts` — the each mount is an anchor-node model (no `<div data-scrml-each-mount>` string emitted anywhere for the mount) AND the `<select>` + `<tbody>` reproes render their rows in-place in a foster-aware/real browser. While `emitEachMountHtml` still returns a `<div ...each-mount...>`, this thread is OPEN.

## Root cause (single emit locus, three downstream consumers)

`emitEachMountHtml` (`compiler/src/codegen/emit-each.ts:362`) emits a static
`<div data-scrml-each-mount="each_<id>"></div>` at the each's source position,
**unconditionally** — zero context awareness. Two browser-visible failures, same root:

- **In `<table>/<thead>/<tbody>/<tfoot>/<tr>`:** the parser FOSTER-PARENTS the `<div>` out of the
  table (relocates it to just before `<table>`), taking every `<tr>` the runtime appends into it →
  `<tbody>` renders empty.
- **In `<select>/<optgroup>`:** the "in select" insertion mode is a parse error for a `<div>` start
  tag → **the token is IGNORED** (the mount node never exists) → the runtime has no container → the
  dropdown renders empty. And even if it survived, `HTMLSelectElement.options` counts only DIRECT
  `<option>` children of the `<select>`/`<optgroup>` → **rows MUST be siblings under the select**, not
  nested in any wrapper. This is why sibling-insertion (A) is mandatory, not optional.

Reactivity / keying / reconciler are all CORRECT — only the mount's **parsed DOM position** is wrong.
Foster-parenting / token-drop are PARSE-TIME → affect only the STATIC top-level mount. A NESTED each
(inside another each's per-item template) builds its mount via `createElement`+`appendChild` at
runtime → immune, and MUST stay unchanged.

## Approach A-unified — the design (anchor-node + sibling insertion)

Replace the wrapper `<div>` mount with a **parse-safe anchor** and insert rows as **siblings** of the
anchor (in the each's real parent), so the rows land as legal children of `<select>`/`<tbody>`/`<ul>`/
`<tr>` and no wrapper `<div>` pollutes flex/grid/`<select>` layout.

**Anchor = HTML comment node** (recommended; a comment is inserted normally in EVERY insertion mode —
never foster-parented, never dropped — and is invisible/zero-layout). A **two-comment fence**
(`<!--scrml-each:N-->` … rows … `<!--/scrml-each:N-->`) is the robust default (bounds the each's node
range for keyed reconcile against arbitrary static siblings before/after the each in the same parent);
a single anchor + reconciler-held node-list is acceptable IF you justify correct handling of static
siblings + keyed reorder/insert/remove. You (the codegen engineer) own the final mechanism — but it
MUST satisfy every acceptance criterion below.

**The four consumers that must move together (this is the shared-runtime blast radius):**

1. **`emit-each.ts:362` `emitEachMountHtml`** — emit the anchor instead of the `<div>`. (The tree-shake
   empty-each `return ""` guard stays.)
2. **`emit-each.ts` per-item reconciler / render fn** — the "writes the rendered iteration into this
   slot" path: change from append-INTO-container to insert-as-SIBLING relative to the anchor; keyed
   reconcile now operates over the anchored sibling range (or fence range), not a container's children.
   Preserve keyed hydration ADOPTION of SSR-rendered rows (match existing `data-scrml-key` rows in
   place rather than re-creating them).
3. **`emit-ssr-render.ts:72` `_scrml_ssr_fill_mount`** — currently a string replace of
   `<div ...>` … `</div>`. With an anchor there is no closing wrapper: inject `rowsHtml` immediately
   after the anchor's opening comment string (before the close fence, if fenced). **Preserve the
   §14.8.9/§14.8.10 auth-omission behavior** (an auth-scoped-unscoped cell is left UNFILLED → the anchor
   with no rows; it hydrates client-side post-mount). The confidentiality floors must still see "empty
   mount".
4. **`runtime-template.js:2021` `_scrml_remount_each`** — `root.querySelectorAll('[data-scrml-each-mount]')`
   will NOT find comment nodes. Replace with a comment-node walk
   (`document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, …)` matching the `scrml-each:` prefix).
   Keep nested-each depth handling. Also update **`emit-variant-guard.ts:1032`**
   `renderFunctionsJs.includes("data-scrml-each-mount")` — the mount-detection gate for engine/match
   arm render output — to test the NEW marker string (else engine-gated eaches silently stop
   re-mounting). This `.includes` self-gates the reconciliation chunk shipping, so it is load-bearing.

## Acceptance criteria

1. **`<select>` (#131):** a top-level `<each>`→`<option>` under `<select>` renders its options as
   direct `<select>` children — `select.options.length === placeholder + item count` after mount, and
   after a reactive `@items` reassignment. **EXECUTE in a foster/select-aware environment** — happy-dom
   does NOT model "in select"/"in table" token handling; use real Chromium AND real Firefox (Peter's
   method), or a spec-accurate HTML tree-construction parser. Grepping the emitted HTML is NOT
   sufficient (the "emitted ≠ runs" trap — S265/U3).
2. **`<tbody>`:** a top-level `<each>`→`<tr>` under `<tbody>` renders rows INSIDE the real `<tbody>` —
   `document.querySelectorAll('tbody tr').length === item count` after a post-mount `@rows` assignment.
3. **`<empty>` fallback** renders in-place (inside the real parent) when the list is empty, for both
   `<select>` and `<tbody>`.
4. **Keyed reconcile** (insert / remove / reorder by key) works over the sibling/fence range — value-
   assert row identity + order after a shuffle, not just count.
5. **Nested each** (inside another each's per-item template) — unchanged behavior (runtime-mounted,
   was never broken; guard against a regression).
6. **Engine-/match-arm-gated each** (S153 path) — an each inside a non-initial arm still re-mounts and
   renders when the arm is entered (this is the `emit-variant-guard.ts:1032` + `_scrml_remount_each`
   path; the comment-walk + updated marker must keep it working). Re-entry idempotence preserved.
7. **SSR:** the server-rendered first paint contains the rows anchored correctly; client hydration
   ADOPTS them (no double-render, no flash); the §14.8.9 auth-scoped-unscoped omission still yields an
   empty mount + post-mount client hydrate.
8. **The div-parent path (existing majority case) still renders identically** — same rows, order,
   reactivity. NB under A-unified the internal wrapper `<div data-scrml-each-mount>` is GONE for these
   too (rows become direct siblings of the real parent). This is an intended artifact change (removes
   the layout pollution). **R26 artifact-diff over the aM corpus + the samples corpus is the regression
   gate** — confirm no corpus program depended on the wrapper `<div>`'s structure/selectors.
9. **`W-EACH-TABLE-FOSTER`** (`lint-w-each-table-foster.js`, api.js Stage 6.4f) — REMOVE or downgrade
   once the mount is foster-safe (its warning no longer applies). Update/retire its test
   `compiler/tests/unit/each-table-foster-warn-s272.test.js`.
10. **Full suite green** (the shared-each-runtime change touches many each tests) + the mandatory
    PA-side adversarial review + R26 (below) before landing.

## Mandatory pre-land (PA runs these; NOT the dev-agent's job)

- **Adversarial review:** `/code-review high` (or finder fan-out) on `git diff origin/main..<agent-branch>`
  — enumerate the mount-model change's blast radius (every each shape: div/ul/table/select/nested/
  engine-arm/match-arm/SSR/empty-fallback) and construct reproducers for the adjacent shapes.
- **R26 empirical:** recompile the assetManagement adopter sources + the samples corpus on the post-fix
  baseline; **diff the emitted artifacts** (the semantics-changed guard — §8) and confirm the `<tbody>`
  + `<select>` reproes now render (real Chromium + Firefox).
- Land via S255 PR-flow → close GH #131 with the merge SHA.

## Repro files

- `docs/changes/each-table-foster/repro-each-tr-tbody.scrml` (table case; existing).
- `docs/changes/each-table-foster/repro-each-option-select.scrml` (NEW — #131; the `<select>` case;
  see the issue body's minimal repro).

## Prior art in-repo (read these first)

- `compiler/src/codegen/emit-each.ts` (the emitter + per-item render/reconcile).
- `compiler/src/runtime-template.js` (~2000–2035 `_scrml_remount_each`; the reconciler; the keyed diff).
- `compiler/src/codegen/emit-ssr-render.ts` (~60–95 `_scrml_ssr_fill_mount` + the SSR row renderer).
- `compiler/src/codegen/emit-variant-guard.ts` (~1015–1035 the `hasEachMount` gate).
- `compiler/src/lint-w-each-table-foster.js` (the interim lint being retired).
