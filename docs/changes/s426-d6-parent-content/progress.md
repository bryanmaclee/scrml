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

## 2026-09-20 — FIX ROUND (4 review findings)

Both load-bearing findings PA-reproduced on my own tip `f578b15b` before any edit.

### Finding 1 — datalist, and the invariant was WRONG, not merely incomplete

Reproduced: `<h1>Search</h1><input list="cities"><datalist id="cities">{fence of value-only
options}</datalist>` -> `page: true, allLeavesEmpty: true` -> `renders-empty-with-data` on a
correct render. Confirmed both supporting measurements: `elementCarriesContent(<datalist>)`
is **false**, and a datalist-only body is `hasRenderedContent: false` — **and must stay so**.

**I adopt the reframing.** The old wording ("mirror the definition that makes the parent
content-bearing at BODY scope") was read off a sample of five in which two different
questions coincide. The principle is *"is this node the kind of child its ancestor CONSUMES
— did the each produce the rows that parent exists to hold?"* Body scope asks "did the page
show anything?" (a datalist shows nothing); region scope asks "did this each produce its
rows?" (it did). Two questions, two answers, no contradiction — and region scope is only
ever consulted when the body is already non-empty. The table, the predicate name
(`confersContentToConsumingAncestor`) and the comments all say so now.

### The convergent move — the population, enumerated ONCE by execution

Search run: **every HTML parent whose content model is wholly ELEMENT children that carry no
text of their own AND are not in `CONTENT_CANDIDATE_SELECTOR`** — because a text-bearing
child is already saved by the text half and a candidate child by the candidate half. 22
shapes built and measured.

WARNING — **my first pass at this used the wrong discriminator and over-flagged badly**: a
probe asking only "is the region reported empty?" labelled `slot`, `iframe`, `link`/`meta`,
`object>param`, `table>col` and `math>mspace` as instances. They are not: an each of empty
`<span>`s inside a `<slot>` IS an empty render. The reframed question is a semantic judgement
about the parent's content model, which no probe computes. Recorded because it is exactly the
"a measurement you mis-specified is not evidence" trap.

**COVERED (7):** `select>option` · `datalist>option` · `picture`/`video`/`audio`>`source`,`img`
· `video`/`audio`>`track[src]` · `svg`>any element · `map>area` · `colgroup>col`.

**DISPOSED, each with its reason (all pinned by tests that must STILL FIRE):**
- `optgroup` — covered TRANSITIVELY by the ancestor walk inside a `select`/`datalist`
  (measured green); standalone it is invalid HTML no browser renders.
- `table>col` with no `colgroup` — **MEASURED UNREACHABLE**: the parser hoists the `<col>`
  OUT of the table, so the region really is empty and the red is CORRECT. A parser fact,
  not a judgement.
- `object>param` — `<param>` is obsolete, removed from the HTML Living Standard.
- `iframe`/`embed` — element children are FALLBACK content, never rendered.
- `slot` — shadow-DOM only; scrml emits no shadow roots.
- `link`/`meta` in body — not page content, and `regionScopedEmptiness` only walks the BODY.
- `template` — MEASURED: no region collected at all (children live in `.content`).
- `fieldset`/`form`/`ruby`/`dl`/`figure`/`details`/`math>mi,mn` — MEASURED ALREADY GREEN.
- **The one contestable call:** `math` with a text-free `<mspace>` measures as a false red
  and is deliberately NOT covered — MathML that carries meaning carries text, and a
  spacer-only each renders nothing visible. Flagged in source and test as contestable.

### Finding 2 — the crash, and a SECOND instance the review did not name

Reproduced `<constructor>` throwing from `matches()`. **Swept the whole prototype and found
`<__proto__>` throws too, from a DIFFERENT call site** (`querySelectorAll`, `'[object
Object]'`). Exactly those two of eight probed, because the lookup lowercases the tag first,
so only the all-lowercase members of `Object.prototype` survive as keys —
`toString`/`valueOf`/`hasOwnProperty`/`isPrototypeOf`/`propertyIsEnumerable` are all safe by
accident of case. Fixed with a **`Map`**, not `Object.hasOwn`: immune by construction rather
than by enumerating hostile names.

### Finding 3 — taken

`OPTION_SELECTOR` and `MEDIA_SOURCE_SELECTOR` hoisted and read by BOTH `elementCarriesContent`
and the table. Where an entry has no `elementCarriesContent` counterpart (`datalist`, `map`,
`colgroup`, `track`) the comment says so explicitly, because that divergence is the point.

### Finding 4 — SKIPPED, and the measurement says the premise is off

Measured worst case (all-empty region, no early exit, inside a consuming parent):

| rows | depth | time |
|---|---|---|
| 500 | 5 | 18.1ms |
| 500 | **30** | **19.8ms** |
| 2000 | 30 | 56.5ms |
| 5000 | 40 | 149.5ms |

Cost is linear in ROWS and **essentially flat in DEPTH** — 6x the depth costs 1.7ms on 500
rows. So the ancestor walk is not the cost; the per-row `querySelectorAll` is, and hoisting
the ancestor resolution does not remove it (every row must still be tested). The hoist would
buy ~9% on a pathological region and nothing measurable on a realistic one (30 rows, depth 4:
0.074ms per call). Not worth touching the predicate for. Skipped deliberately.

### Gate

- `detector-validation.test.js`: **176 -> 200 pass / 0 fail** (+24)
- Full tier: **192 -> 216 pass / 0 fail**
- Mutation bite, **five** directions:

| mutation | red | note |
|---|---|---|
| predicate -> `return false` | **17** (was 12) | 183 still pass — no pre-existing test flips |
| predicate -> `return true` | **11** (was 4) | every disposal pin + the hostile-tag test bite |
| ancestor walk -> parent-only | **5** (was 4) | now catches the datalist>optgroup transitive case |
| **NEW** Map -> object literal | **1** | the hostile-tag test is the only gate on this class, and it holds |
| **NEW** drop the region-only entries | **5** | the reframing itself is gated, not just documented |

- Baseline: **ZERO cells move**, measured — same 1 ORPHAN, 3 NEW, 2 GREEN->RED as on
  `f8317399`. `e2e-render-map-baseline.json` untouched.
