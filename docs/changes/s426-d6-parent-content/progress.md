# s426-d6-parent-content — progress log (append-only)

## 2026-09-20 — startup + reproduction

- Startup pwd: `C:\Users\pjoli\Documents\GitHub\scrml\.claude\worktrees\agent-ae898a0814b0977e9`.
  `git rev-parse --show-toplevel` equals it; tree clean at `f8317399`.
- `bun install` FAILED on the `puppeteer` postinstall — the cached Chrome folder
  `C:\Users\pjoli\.cache\puppeteer\chrome\win64-146.0.7680.153` exists but its `chrome.exe` is
  missing. Environment breakage, not repo breakage. Re-ran with `PUPPETEER_SKIP_DOWNLOAD=1`:
  "Checked 218 installs across 220 packages". Recorded rather than papered over.
- `bun run pretest` from the worktree CWD → `samples/compilation-tests/dist/` holds 34 files
  (artifact checked, not the exit code — S376).
- Pre-change tier run: `bun test compiler/tests/e2e-render-map/` → **164 pass / 0 fail**, matching
  the brief's S424 baseline. Pre-existing non-gating warnings recorded for later comparison:
  1 ORPHAN cell (`benchmarks/per-route-roles/routes/loads.scrml#empty`), 3 NEW cells
  (`…/admin.scrml#empty`, `examples/32-external-api.scrml#empty`, `examples/33-endpoint.scrml#empty`),
  2 GREEN->RED (`benchmarks/todomvc/app.scrml#empty`, `examples/09-error-handling.scrml#empty`).
  These are baseline drift that predates this change.

### Reproduction — the brief HELD, verbatim

All three shapes print `page correct: true | allLeavesEmpty: true` on `f8317399`, and both named
controls behave (option-with-text → `false`; empty `<ul>` fence → `true`). The mandated fail-open
control (empty fence inside a placeholder-bearing `<select>`) currently reports `true`, i.e. correct
today, so it is a genuine regression guard and not a already-broken cell.

### Two findings BEYOND the brief, both measured

1. ⚑ **The defect is recreated ONE LEVEL DEEPER in all three families**, so the brief's stated
   `node.parentNode` mechanism would UNDER-fix and leave the class one wrapper away:
   - `<select><optgroup><each><option value="1"></option></each></optgroup></select>` → RED
   - `<svg><g><each><circle/></each></g></svg>` → RED
   - `<video><div><each><source src="a.mp4"></each></div></video>` → RED
   `select` and `picture`/`video`/`audio` confer via `querySelector` (a DESCENDANT query), so the
   conferring element is an ANCESTOR, not necessarily the parent. The fix walks ancestors.
2. ⚑ **happy-dom mis-namespaces `<foreignObject>` content** — an `<li>` inside a foreignObject
   reports `http://www.w3.org/2000/svg`. So the svg rule cannot be bounded by `namespaceURI`;
   it is bounded by a `foreignObject` tag check on the ancestor walk instead.

### Sweep of `elementCarriesContent` for conferring definitions — the brief's population HELD

Read every arm. Descendant-conferred: `select` (`:199`), `picture`/`video`/`audio` (`:205-213`),
`svg` (`:214`). NOT conferring: `input`/`progress`/`meter`/`img`/`iframe`/`embed`/`object` (own
attributes), `canvas` (presence). `textarea` reads `el.textContent`, which LOOKS child-conferred —
but a region's text is already caught by the text half of `nodesHaveRenderedContent`, and a probe
confirms the fence-inside-textarea case already scores `emptyLeaves: 0`. **No fourth instance.**

- NEXT: implement the ancestor-scoped conferring predicate in `nodesHaveRenderedContent`.

## 2026-09-20 — implementation + the three-way mutation bite

Landed `confersContentToConferringAncestor` + `CONFERRED_CONTENT_SELECTOR` +
`matchesSelfOrRenderedDescendant` in `render-detectors.js`, called from
`nodesHaveRenderedContent` before the descendant-candidate loop. `CONTENT_CANDIDATE_SELECTOR`
is UNTOUCHED — the named trap is not entered.

Tests: `detector-validation.test.js` **148 -> 176 pass / 0 fail** (+28).
Full tier: **164 -> 192 pass / 0 fail**.

### Mutation bite, THREE directions (by file copy; never `git stash`)

| mutation | red tests | what it proves |
|---|---|---|
| `confersContentToConferringAncestor` -> `return false` (the pre-fix behaviour) | **12** | the fix's own tests are behavioural, and **164 still pass — no pre-existing test flips** |
| -> `return true` (the other constant) | **4** | the CONFERS-NOTHING controls bite: src-less `<source>`, non-option in `<select>`, the `foreignObject` bound, and the plain-`<ul>` true positive |
| ancestor walk -> `parentElement` only (**the brief's stated mechanism**) | **4** | the three depth shapes AND the plain MOUNT-inside-`<select>` case |

⚑ The third row is the load-bearing one. The mount shape is INHERENTLY a depth case — a
nested each's rows are the mount DIV's children, so the conferring `<select>` is their
GRANDparent. A `node.parentNode` fix would have missed the mount shape entirely, not merely
the exotic `<optgroup>` wrapper.

⚑ The FAIL-OPEN controls are immune to every constant by construction: an empty region has
no nodes, so the per-node predicate is never called and no mutation of it can green them.
Stated rather than claimed as a bite.

### Baseline: ZERO cells move

The tier's live-vs-committed comparison is byte-identical before and after — the same 1
ORPHAN, the same 3 NEW cells, the same 2 GREEN->RED. All four warnings predate this change
(measured on `f8317399` before any edit) and `e2e-render-map-baseline.json` is untouched.
Nothing regenerated.

### Corrections to the brief, all measured

1. **The `node.parentNode` mechanism was WRONG** (bite row 3). Ancestor walk instead.
2. **Namespace bounding is not available** — happy-dom reports the SVG namespace for an
   `<li>` inside a `<foreignObject>`. Bounded by TAG.
3. **The svg arm is a deliberate GENERALIZATION** of `children.length > 0` (direct children)
   to any element inside the svg, because the strict mirror leaves `<svg><g>…each…</g>` red
   on a correct render — this same defect one level down.
4. **One of my own test assertions was wrong, not the fix**: the first fail-open controls for
   `<video>`/`<audio>`/`<svg>` had nothing outside the region, so the whole body rendered
   nothing and D6 fired at `body` scope — the control passed while proving nothing about
   region scope. Every `CONFERRING_PARENTS` markup now carries content outside the region.
5. The hidden-`<option>` control does NOT bite the new predicate (guarded upstream by
   `isUnrenderedByOwnMarkup`); recorded in the test itself.

Everything else in the brief HELD: the locus, the reproduction verbatim, the named trap, the
fail-open warning, the conferring population (no fourth instance — `textarea`'s `textContent`
looks child-conferred but is already covered by the text half), and corpus-zero.
