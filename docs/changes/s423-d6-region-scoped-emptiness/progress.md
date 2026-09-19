# progress — s423-d6-region-scoped-emptiness (LIMB 2)

Append-only. Base `origin/main` @ `3b66030a`. Worktree
`.claude/worktrees/agent-a3571211340b70c27`.

---

## 0 — startup gate (F4)

- `pwd` = `/c/Users/poliv/Documents/GitHub/scrml/.claude/worktrees/agent-a3571211340b70c27` ✓
  starts with `.../scrml/.claude/worktrees/agent-`.
- `git rev-parse --show-toplevel` = same path ✓. Tree clean at entry ✓.
- `bun install` → 218 packages installed ✓ (worktrees do not inherit `node_modules`).
- `bun run pretest` run FROM the worktree CWD (NOT `--cwd`) → "Compiled 13 test samples ->
  samples/compilation-tests/dist/"; `samples/compilation-tests/dist/` contains **34** artifacts ✓.
- `git merge-base HEAD origin/main` = `3b66030a20326e1326b4246fc4d35ece0a5d6ce0` =
  `git rev-parse origin/main` = `HEAD` ✓.
- Brief fetched from `origin/fix/s423-d6-region-scoped` into `docs/changes/s423-d6-region-scoped-emptiness/`.

## 0b — maps read (required first read)

`.claude/maps/primary.map.md` + `.claude/maps/test.map.md`, both stamped `787d4cb4` against HEAD
`3b66030a`.

**Verdict: NOT load-bearing for this task.** What they contributed was two orientation facts, both
already implied by the brief: (a) `e2e-render-map` is 2 `.test.js` and runs in `tracking` only
(non-blocking) — so nothing I do here can move a required gate; (b) `test.map.md:73` carries a real
warning — "THE `e2e-render-map` HARNESS WAS SUBSTANTIALLY REWORKED WITHOUT ITS FILE COUNT MOVING
… Read the harness, do not infer it from the tally." That warning is correct and is the single
genuinely useful line; it is also advice to ignore the map and read the source, which is what the
work actually required. Neither map describes the detector set, the region emission shapes, or the
seed bridge — the three things this arc turns on. No map citation was used as evidence anywhere
below; every claim here is from executed measurement or from reading `compiler/src`.

---

## 1 — reproducing the brief's measurement (PA-located-verify)

`bun compiler/tests/e2e-render-map/observe-one.js examples/25-triage-board.scrml populated`

```
{"cellKey":"examples/25-triage-board.scrml#populated","state":"renders-clean","smells":[],
 "detail":{"seed":{"chunks":1,"writes":[{"name":"tasks","reason":"written","namespaced":true,
 "wrote":true}],"domChanged":true,"observable":true,"errors":[]}},"seeded":true}
```

Reproduced exactly. A DOM dump through the real harness (temporary probe, not committed):

- **`examples/25-triage-board.scrml#populated`** — `<div class="columns">` holds
  `<!--scrml-each:00hqpedw_126-->` … 3 × `<section class="column">` … `<!--/scrml-each:00hqpedw_126-->`,
  and each `<ul class="task-list">` contains exactly `<div data-scrml-each-mount="each_00hqpedw_120"></div>`
  with **0 childNodes**. Surviving mount slots: **3, all empty**. Comment ranges: **1, non-empty**
  (446 chars of column chrome — "InboxDoingDone").
- **`examples/03-contact-book.scrml#populated`** — surviving mount slots **0**; one comment range
  `<!--scrml-each:011gr8d2_99-->` holding **2 `<li class="contact-row">`** with real text.

Both match the brief's table.

---

## 2 — THE HYPOTHESIS: verified, and **REFINED — the stated mechanism is WRONG**

Brief's wording: *"a `[data-scrml-each-mount]` element survives in the DOM only when that `<each>`
rendered nothing; when items render, the runtime consumes the slot."*

**The consumption half is wrong.** Read from source, not inferred:

- `compiler/src/runtime-template.js:2266-2272` — "Approach A-unified
  (g-each-mount-div-foster-parented-in-table): the top-level `<each>` mounts as a parse-safe
  two-comment fence `<!--scrml-each:N-->…<!--/scrml-each:N-->` … rows are inserted as SIBLINGS
  between the anchors in the each's real parent. **A NESTED each still mounts as a runtime `<div>`**."
- `compiler/src/codegen/emit-each.ts:1666-1671` and `:3527-3532` (the Tier-1 nested-each branch and
  the Tier-0 `${for…lift}` branch) both emit, verbatim: *"The item-local mount is created + appended
  ONCE (**stable DOM node identity across inner re-renders**); the inner reconcile **writes into it
  in place**."*

So the mount `<div>` is the nested each's **container**, not a placeholder that gets consumed. It is
present whether or not rows rendered. `03-contact-book` shows **0** surviving slots because its
`<each>` is **top-level** (→ comment fence, no mount div is ever emitted), **not** because a slot was
consumed.

**The discriminator the brief actually needs is therefore STRONGER than it claimed, once restated:**
an **empty** `[data-scrml-each-mount]` div is an exact structural witness that *that nested each
rendered zero rows* — because the div always exists and the reconcile writes into it in place.
The brief's predicate reached the right cells for a wrong reason; the corrected reading is what the
implementation is built on.

⚠ One stale comment found in passing, **not touched** (compiler/src is out of scope):
`compiler/src/codegen/emit-ssr-render.ts:411` still says *"Only a TOP-LEVEL each mounts to a static
`data-scrml-each-mount` div"* — the exact inverse of today's emission (top-level = comment fence,
nested = mount div). Measured DOM is authoritative. Worth a separate gap; not filed by me (the PA
files gaps).

**Both emission shapes are handled** by the implementation, as the brief requires: comment fence
(range between paired anchors) and mount div (element children).

---

## 3 — THE PREDICATE: the coordinator's mid-flight correction, measured, and **one disagreement**

The coordinator corrected the brief mid-arc: the brief's lean ("fire only when EVERY identifiable
each-region is empty") leaves D6 dark on 25-triage, because the outer range is non-empty. **That is
correct and I reproduced it** — `P-ALL-REGIONS-EMPTY` = `false` on 25-triage.

The coordinator's replacement was: **"fire on ANY surviving empty mount slot"**. I measured that
rule and **it false-fires**, so I did not build it.

**The decisive experiment.** The brief states that `seed-fixtures.js` is wrong (it seeds
`column:"todo"` into an app whose columns are `["Inbox","Doing","Done"]`) and that a separate arc
will correct it. So I mounted 25-triage through the real harness with the **corrected** seed the next
arc will land — `column:"Inbox"` / `column:"Doing"` — without touching `seed-fixtures.js`:

| 25-triage-board#populated, seed | regions | leaf regions | `ANY-empty-mount` | `ALL-REGIONS-empty` | `ALL-LEAVES-empty` |
|---|---|---|---|---|---|
| **today's (wrong) fixture** `column:"todo"` — renders nothing | 3 empty mounts + 1 non-empty range | 3, all empty | **fires** ✓ | quiet ✗ | **fires** ✓ |
| **corrected fixture** `Inbox`/`Doing` — renders 2 tasks correctly | mounts: "Triage A", "Triage B", **empty**; range non-empty | 3, 2 non-empty | **FIRES — FALSE POSITIVE** ✗ | quiet ✓ | quiet ✓ |

The corrected render is a **correct** board: two columns show their task, the "Done" column is
legitimately empty. `ANY-empty-mount` scores it `renders-empty-with-data` (RED). That is precisely
the cry-wolf outcome the brief forbids ("a detector that cries wolf gets ignored and then deleted"),
and it lands the moment the fixture-correction arc ships — i.e. the rule is safe today only by
accident of a fixture everyone agrees is broken.

**What I built instead — `ALL-LEAF-REGIONS-EMPTY`:**

> Fire when **every identifiable LEAF each-region rendered nothing** (leaf = an each-region that
> contains no other each-region).

This keeps the coordinator's load-bearing insight intact — *the non-empty outer range must not veto
the empty inner mounts* — but achieves it structurally rather than by ignoring ranges: the outer
range is **excluded from the conjunction because it is a container**, not because of its shape. A
top-level each with no nested each inside it is a leaf and still counts (03-contact-book, 06-kanban).
And it is the only one of the three candidates that is correct on **both** rows of the table above.

Rationale for the conjunction rather than a disjunction, stated as the brief asks: an outer each
rendering column chrome answers "did the page show something", not "did the DATA appear"; the
innermost regions are where item data lands. Requiring *all* of them to be empty is the fail-quiet
choice the brief asks for on ambiguity — a two-list app with one legitimately-empty list stays green.

---

## 4 — the seed-write gate (coordinator point 2) — ADOPTED

`obs.seeded` is `seed != null`, which is true even when the seed bridge wrote **nothing**. Measured
across the 4 populated cells:

| cell | seed reason | `writes[].wrote` | `domChanged` |
|---|---|---|---|
| `examples/03-contact-book.scrml#populated` | `written` | true | true |
| `examples/25-triage-board.scrml#populated` | `written` | true | true |
| `examples/06-kanban-board.scrml#populated` | `derived-cell` | false | false |
| `examples/16-remote-data.scrml#populated` | `no-such-cell` | false | false |

D6 now gates on a real write when the observation carries a seed report. **Back-compatible by
construction:** when `obs.seedReport` is absent (every direct `runDetectors` call — all of
`detector-validation.test.js`), the gate is `obs.seeded` exactly as before, so no existing assertion
changes meaning.

**Population count on the narrowed surface** (the coverage-removal blind spot the brief names):
**2 of 4** populated cells (`06-kanban-board`, `16-remote-data`) stop being inspected by D6's
body-global emptiness question; **434** unseeded cells were never inspected by it and are unchanged;
**2** cells (`03-contact-book`, `25-triage-board`) remain inspected. Neither of the 2 dropped cells
can change state as a result: both render a non-empty body today, so the body-global check answered
"not empty" for both before the narrowing and D6 fired on neither. The narrowing removes a *latent*
false-positive, not a live signal.


---

## 5 — what was built

`compiler/tests/e2e-render-map/render-detectors.js`

- `collectEachRegions(body)` (exported) — every identifiable `<each>` render region, in **both**
  emission shapes: `{shape:"mount", host, nodes}` for a nested each's container div, and
  `{shape:"range", start, end, nodes}` for a top-level each's comment fence. An **unterminated
  fence is skipped**, not guessed at — the runtime's own `_scrml_each_end` gives up the same way.
- `nodesHaveRenderedContent(nodes)` — `hasRenderedContent`'s question asked of an arbitrary sibling
  list, because a fence region is a RANGE with no element wrapping it. Reuses
  `isUnrenderedByOwnMarkup` / `elementCarriesContent` / `CONTENT_CANDIDATE_SELECTOR`, so the S419
  "one definition of not-rendered" invariant still holds across all three call sites.
  ⚠ Deliberately **not** implemented by cloning the range into a detached wrapper: `cloneNode`
  does not copy an input's live `.value` PROPERTY, which is exactly S419's "value set by binding
  (property only)" case — a clone would score a filled input empty.
- `regionScopedEmptiness(body)` (exported) — returns `{allLeavesEmpty, summary}`, or **null** when
  the question is not identifiable (no region, or no leaf), in which case the caller keeps today's
  body-global answer. Fail-quiet, per brief item 3.
- `seedWasDelivered(obs)` — the seed-write gate of §4.
- D6 now asks its question at two scopes, recorded as `detail.emptyWithDataScope` = `"body"` (the
  original question) or `"each-regions"` (the new one).

`compiler/tests/e2e-render-map/render-harness.js` — passes the already-computed `seedReport` through
to `runDetectors`. One added field on an existing call; no behaviour of its own.

### ⚑ A TRAP FOUND WHILE BUILDING, AND IT WOULD HAVE LANDED SILENTLY

The obvious `detail` payload is the region ids — `each_00hqpedw_120`, `scrml-each:00hqpedw_126`.
**Those embed the chunk token, which is minted from the compile's `mkdtemp` staging dir and differs
on every run and every machine.** `generate-baseline.js` persists `detail` for every NON-green cell
into the tracked baseline JSON — and reddening a seeded cell is this detector's entire purpose, so
**the first cell this change reddens is the first to commit its `detail`.** Every regeneration would
then churn a tracked artifact. This is the S420 hazard (`e2e-render-map.test.js:325`) arriving by a
new door: that test's own guard regex is `/[0-9a-z]{6,}\$/` and needs a `$`, so `each_00hqpedw_120`
would have slipped straight past it. The report is **counts and shapes only**, and a test pins that
(mutation D below reds it).

---

## 6 — THE BITE PROOF (brief item 5)

⛔ No `git stash` anywhere — every flip is a FILE COPY from `_probe/render-detectors.{BASE,FIXED}.js`.

**Whole-file revert to `origin/main`:** `0 pass / 1 fail / 1 error` — but it fails at IMPORT
(`SyntaxError: Export named 'regionScopedEmptiness' not found`), which is a weak bite: a deleted file
would red identically. So four TARGETED behavioural mutations were run instead, each restoring the
file from `FIXED` first. **All from a 72/72 green baseline.**

| # | mutation | what it removes | result |
|---|---|---|---|
| **A** | `regionVerdict = null` | the region scope entirely — the exact pre-S423 behaviour, exports kept | **7 fail / 65 pass** — incl. the board-bug pin, both lone-shape pins, both-empty, hidden-row, the id pin, **and the compiled end-to-end fixture** |
| **B** | `allLeavesEmpty: emptyLeaves.length > 0` | the conjunction → the coordinator's "ANY empty mount" | **3 fail / 69 pass** — the two anti-cry-wolf pins **and the compiled "matching seed stays green" case** |
| **C** | `seedWasDelivered` → `return true` | the seed-write gate | **1 fail / 71 pass** — "wrote NOTHING, even on an empty body" |
| **D** | add `ids: regions.map(...)` to the summary | the no-per-run-token discipline | **4 fail / 68 pass** — the id pin plus the three count-equality pins |

Restored from `FIXED`; `git status --porcelain -- compiler/` empty; **72 pass / 0 fail**.

Mutations A and B each red a test that **compiles and mounts a real `.scrml`**, not only synthetic
DOM — so the pins are anchored to what the compiler actually emits, not to what the test believes it
emits. If the emitter moves a nested each off `data-scrml-each-mount`, or a top-level each off the
comment fence, the synthetic pins keep passing and the end-to-end ones red.

**`bun test compiler/tests/e2e-render-map/` — 88 pass / 0 fail / 1176 expect() calls**, including
`detector-validation.test.js` and the whole of `e2e-render-map.test.js`.

---

## 7 — FULL-TIER BEFORE/AFTER (brief: the measurement owed)

Both runs are MINE, executed in this worktree via
`bun compiler/tests/e2e-render-map/generate-baseline.js --print`, and compared cell-by-cell across
**all 443 live cells** — not by reading the diff.

⚠ **The comparison is BEFORE-run vs AFTER-run, NOT committed-baseline vs after**, because the
committed baseline is already drifted at base: it holds **438** cells against **443** live ones.
Comparing against it would have attributed five pre-existing drifts to this change.

| state | before | after | delta |
|---|---|---|---|
| `renders-clean` | 277 | 276 | **−1** |
| `renders-empty-with-data` | **0** | **1** | **+1** |
| `renders-empty` | 18 | 18 | 0 |
| `needs-server` | 8 | 8 | 0 |
| `compiles-but-throws` | 21 | 21 | 0 |
| `smell-detected-wrong` | 2 | 2 | 0 |
| `fails-compile` | 117 | 117 | 0 |
| **total** | **443** | **443** | **0** |

**STATE CHANGES: exactly 1 of 443.**

```
examples/25-triage-board.scrml#populated: renders-clean -> renders-empty-with-data
  smells [] -> ["S-EMPTY-WITH-DATA"]
```

**SMELL-SET CHANGES: exactly 1 of 443** — the same cell. Every other cell's smell array is
byte-identical.

**ACCEPTANCE-BAR OFFENCES: 0.** No cell went red → green. No cell changed state for any reason
other than gaining `S-EMPTY-WITH-DATA`. Checked programmatically over every cell, not by eye.

**POPULATED SUBTOTAL (4 cells):**

| cell | before | after |
|---|---|---|
| `examples/03-contact-book.scrml#populated` | renders-clean | renders-clean |
| `examples/06-kanban-board.scrml#populated` | renders-clean | renders-clean |
| `examples/16-remote-data.scrml#populated` | renders-clean | renders-clean |
| **`examples/25-triage-board.scrml#populated`** | renders-clean | **renders-empty-with-data** |

**PER-RUN TOKENS IN COMMITTED `detail`: 0.** The whole regenerated map was scanned for
`each_<tok>_N`, `scrml-each:<tok>_N` and `<tok>$` — zero hits.

### Pre-existing base drift — NOT mine, NOT absorbed

Measured in the BEFORE run, i.e. on clean `origin/main` code with no edit of mine applied:

- **6 cells live but absent from the committed baseline**: `benchmarks/per-route-roles/routes/admin.scrml#empty`,
  `examples/32-external-api.scrml#empty`, `examples/33-endpoint.scrml#empty`,
  `samples/compilation-tests/server-005-mixed.scrml#empty`,
  `samples/compilation-tests/server-008-form-handler.scrml#empty`, `samples/gauntlet-r14/htmx-forms.scrml#empty`.
- **1 orphan** in the committed baseline: `benchmarks/per-route-roles/routes/loads.scrml#empty`.
- **2 unrelated green→red cells**: `benchmarks/todomvc/app.scrml#empty` (`renders-clean` committed,
  **`compiles-but-throws`** at base) and `examples/09-error-handling.scrml#empty` (`renders-clean`
  committed, **`fails-compile`** at base). `generate-baseline.js --check` was therefore ALREADY
  exit-1 at base, before this arc.

**The baseline was updated for ONE cell only, by hand, not regenerated.** A full regeneration would
have swept all five drifts into this PR as silently-accepted state. They stay visible for the PA.
After the update the tier's delta-gate warns on **2** cells, both pre-existing, down from 3.

---

## 8 — the other measurements owed

- **`bun test compiler/tests/e2e-render-map/` — 88 pass / 0 fail**, including
  `detector-validation.test.js` (72 of those) and all of `e2e-render-map.test.js`.
- **Pre-commit subset** (`bun test compiler/tests/{unit,integration,conformance}`) — see §9.
- **Population count on the narrowed surface** — §4: 2 of 4 populated cells stop being inspected by
  D6's body-global question; neither can change state as a result (both render a non-empty body, so
  that question already answered "not empty" for both).

## 9 — base moved under this arc

`origin/main` advanced from `3b66030a` to **`a1e16a24`** (#991) mid-arc. That commit touches exactly
one file, `docs/pr-reviews.md`, which this branch never touches — **zero overlap, rebases clean**.
Worth naming because `git diff --stat origin/main..HEAD` now shows a spurious `docs/pr-reviews.md |
83 -------`, which is the INVERSE of #991's addition, not a deletion by this branch
(`git log 3b66030a..HEAD -- docs/pr-reviews.md` is empty).

## 10 — deferred / not done

- ⛔ `seed-fixtures.js` NOT touched, per the brief. The three wrong fixtures stand.
- ⛔ `compiler/src/`, `.github/`, `docs/known-gaps.md` NOT touched.
- **The three surviving mount slots in 25-triage share ONE `data-scrml-each-mount` id**
  (`each_<tok>_120`), as the brief flagged. Not chased. What I can add from the emitter: this is
  BY DESIGN and not obviously a defect — `emit-each.ts` derives the attribute from the each-block's
  AST node id (`each_${nsId(innerNode.id)}`), and one AST node is instantiated once per outer row,
  so N outer rows necessarily share it. The emitter's own comment says so and explains the
  consequence it already handles: *"N outer items share the `each_<id>` data-attr, so a single
  global renderer keyed by that id could not address them individually"* — which is exactly why the
  inner reconcile closes over `innerMountVar` per item rather than querying by the attribute. The
  id is a debug/self-describing attribute, not an addressing key. ⚠ But `_scrml_rehydrate_region`
  → `_scrml_remount_each` DOES `querySelector` on `[data-scrml-each-mount]`
  (`runtime-template.js:3172`), so the shared id is a live question on the soft-nav rehydrate path
  specifically. Not investigated; flagged for whoever picks it up.
- **A stale comment in `compiler/src/codegen/emit-ssr-render.ts:411`** claims the inverse of today's
  emission (see §2). Out of scope; not filed (the PA files gaps).
- The detector is **fail-quiet by choice**: an app where ONE of several leaf list regions is
  empty-but-should-not-be still scores green. That is a deliberate residual, not an oversight — see
  §3 and the `REGION_SHAPES` "fail-quiet on ambiguity" test.

### §9a — pre-commit subset (the measurement owed)

`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`

```
23969 pass · 99 skip · 10 todo · 5 fail · 124663 expect() calls
Ran 24083 tests across 1322 files. [228.05s]
```

**Compared as a NAME-SET, not a count**, per the brief. All 5 are the documented pre-existing
cluster; none is in this arc's surface:

1. `self-host smoke: buildImportGraph parity > same import resolution`
2. `self-host smoke: resolveModules full pipeline parity > same result for two-file dependency`
3. `self-host smoke: resolveModules full pipeline parity > both detect self-import cycle`
4. `B5 runtime guard — a dynamic session.set(csrfToken) cannot pin the token > the middleware-minted token survives a session.set("csrfToken", attacker) + still gates`
5. `(unnamed)`

**Zero new failures.** And the no-effect is structural, not just observed: `grep -rln e2e-render-map
compiler/tests/{unit,integration,conformance}` returns **nothing** — no test in the pre-commit subset
imports this tier, so a change confined to `compiler/tests/e2e-render-map/` cannot reach it.
Every file this arc touches is under that directory (plus `docs/changes/`).

---

# FIX ROUND — the adversarial pass's 5 findings

All five verified against the landed predicate before touching anything. **All real.** I also found
**three variants the pass did not list** (`aria-hidden`, inline `display:none`, and a hidden MOUNT
div — F3 was reported only for `hidden` / `<noscript>`), and **one bug of my own** while fixing F5.

Reproduced on `ebf1681b`, via `runDetectors` on synthetic DOM with a delivered seed report:

```
FIRES  F1  rows render, nested tag-lists empty      regions=3 leaves=2 emptyLeaves=2
FIRES  F2  seeded datum outside any each            regions=1 leaves=1 emptyLeaves=1
FIRES  F3  only each inside <div hidden>            regions=1 leaves=1 emptyLeaves=1
FIRES  F3a only each inside aria-hidden             (NOT IN THE REPORT)
FIRES  F3c only each inside display:none            (NOT IN THE REPORT)
FIRES  F3b only each inside <noscript>              regions=1 leaves=1 emptyLeaves=1
FIRES  F3d only each inside a hidden MOUNT div      (NOT IN THE REPORT)
FIRES  CONTROL 25-triage shape                      regions=4 leaves=3 emptyLeaves=3
```

## The hypothesis: RIGHT IN DIRECTION, WRONG IN MEASURE — and the real corpus is what says so

The coordinator proposed: fire only when a seed was delivered AND **the render did not move**.
The direction is right — the discriminator has to be the TRANSITION, because no DOM-shape rule can
separate F1 from the control (see below). But the MEASURE is wrong, and wrong in **both** directions.
Measured by mounting the real apps and comparing rendered text either side of the seed write:

| app | `domChanged` / moved? | gained NEW rendered text? | what the measures imply |
|---|---|---|---|
| `examples/03-contact-book` | true | **true** (`"Ada Lovelace"`, `"ada@x.io"`) | both agree: quiet |
| **`examples/25-triage-board`** | **TRUE** | **FALSE** | ⛔ "did not move" ⇒ **quiet** — kills the control |
| `examples/06-kanban-board` | false | false | no write at all; gated earlier |
| `examples/16-remote-data` | false | false | no write at all; gated earlier |
| D6 fixture, bug seed | **FALSE** | false | ⛔ "did not move" ⇒ fires, but only by luck |
| D6 fixture, ok seed | true | **true** | both agree: quiet |

**Why 25-triage MOVES.** Its `<tasks>` is not empty at boot — the app declares four tasks that render
across Inbox/Doing/Done. The seed REPLACES them with rows whose `column` matches no column, so the
render moves by **shrinking to nothing**. `domChanged:true` is exactly what limb 1 established. A
"did not move" gate would therefore have made D6 dark on the one cell it exists for — the same
failure mode as the brief's original lean, arrived at from the other side. And the fixture shows the
inverse error: `domChanged:false` there even though it IS the bug.

**The measure that works on all six: did the render GAIN anything.** A pure LOSS is not a gain.
`renderedContentSignature` fingerprints what a body renders (per-value counts of non-whitespace
rendered text + a count of content-bearing elements, using the SAME "rendered" definition as
`hasRenderedContent`, so the S419 invariant holds); `signatureGained(before, after)` is true when any
value's count rose or the element count rose. Counts, not a Set — one "Alpha" row becoming two is a
gain and a Set would miss it. `applySeed` already snapshotted the body either side of the write and
threw both away; it now reduces them to the single **boolean** `gainedContent`. The signature holds
raw page text and never leaves the harness — only the boolean reaches `detail`.

## F1 + F2 are one bug, and it is not a DOM-shape bug

F1's markup is **structurally identical to 25-triage** — an outer range holding rows, each row
holding an empty mount. In F1 the outer range rendered the seeded DATA; in 25-triage it rendered
column CHROME. The final DOM cannot tell those apart, which is why the leaf rule could not and no
refinement of it would. What separates them is that the harness writes the seed into a LIVE page, so
it can ask whether anything new appeared. That is also the more faithful reading of D6's own
question: *"data was seeded and the render showed nothing"* — not *"are the lists empty"*.

So the rule is now: **seed delivered AND the render gained nothing AND (body empty OR every leaf each
region empty)**. F1 gains `"Task A"/"Task B"` → quiet. F2 gains `"Welcome, Ada"` → quiet. 25-triage
gains nothing → fires.

## F3 — accepted without argument, and widened

An `<each>` nobody can see is not evidence of anything, and the pass is right that this broke the
S419 one-predicate invariant my own header cites: `collectEachRegions` was a THIRD reader of the DOM
that did not prune unrendered subtrees. `isInUnrenderedSubtree` (walks `parentNode`, because a fence
anchor is a comment node, not an element) now filters both shapes at collection time — so a hidden
each is not merely non-firing, it is **not a region at all**, pinned with `collectEachRegions(body)`
`toEqual([])` so a later change that only tweaks the verdict cannot reopen it. Covered: `hidden`,
`aria-hidden`, `display:none`, `visibility:hidden`, `<noscript>`, `<template>`, and a hidden
GRANDparent × both emission shapes = 14 cases. Plus the opposite guard: a VISIBLE empty each beside a
hidden one still fires, and the hidden one is not counted in the summary.

## F4 — accepted; the fix is narrower than "make it loud"

`render-harness.js`'s no-side-channel branch had a comment reading "Loud, not silent" above code that
was silent. It now pushes to `obs.consoleErrors`, which D2 turns into a red `compiles-but-throws`.
Same for the "every write threw" path — but **only for `set-threw`**. Deliberately NOT for
`derived-cell` / `no-such-cell`: those are the three KNOWN fixture bugs tabled in
`SEED_OBSERVABILITY` and owned by a different arc; reddening them here would break the additive bar
AND pre-empt that arc. Emit regression ⇒ loud. Known fixture bug ⇒ unchanged.

⚠ **Honest limit on the F4 pin.** The behavioural half is not reachable from a fixture — I cannot
make the real compiler emit a client without `_scrml_reactive_set`. So it is pinned two ways instead:
a `runDetectors` contract test (a bridge failure in `consoleErrors` ⇒ `compiles-but-throws`, asserted
explicitly NOT green) and a source-level assertion that the branch pushes and that the fixture-bug
reasons are excluded. Mutation H reds only the source-level one. That is weaker than an executed
pin and I am not going to call it more than it is.

## F5 — taken, and it shipped INVERTED for one round

Replaced the pairwise `regionEncloses` (O(regions² × siblings × depth), linear array scans) with one
node→owner Map plus one ancestor walk per region. `node.contains()` cannot express a range region —
a sibling range has no wrapping element — so the owner map is what handles both shapes uniformly.

⚑ **My first version was an exact inversion**: it kept the regions that nothing encloses (the
OUTERMOST) instead of those that enclose nothing (the innermost). The 25-triage control caught it
immediately — `leaves: 3, emptyLeaves: 3` became `leaves: 1, emptyLeaves: 0` and the control went
quiet. It is now pinned by its own test (`F5: leaf detection keeps the INNERMOST regions`), because
a performance rewrite that silently changes a predicate's meaning is exactly the class that a
green suite would have shipped.

## BITE PROOF — fix round

⛔ No `git stash`; every flip is a FILE COPY. All from a **94 pass / 0 fail** baseline.

| # | mutation | result |
|---|---|---|
| **E** | drop the `gainedContent` conjunct | **2 fail** — F1, F2 |
| **F** | drop the unrendered-ancestor filter | **13 fail** — all 12 hidden-host × shape cases + the visible-beside-hidden guard |
| **G** | invert the leaf direction (outermost) | **6 fail** — board-bug pin, anti-cry-wolf pin, F1, the F5 direction pin, **and both compiled end-to-end cases** |
| **H** | silence the no-side-channel branch | **1 fail** — the F4 source-level pin (see the honest limit above) |

Restored → **94 pass / 0 fail**. Whole tier: **110 pass / 0 fail**.
(`<template>` cases pass even under mutation F, because happy-dom puts template children in
`.content` where `querySelectorAll` cannot reach them — recorded, not "fixed".)

## FIX ROUND — full-tier before/after, re-run from scratch

Both runs mine, executed serially (never two `bun` tiers at once on this box), flipped by FILE COPY
from `_probe/{rd,rh}.{BASE,FIXED}.js` — ⛔ no `git stash`. The BASE run is `origin/main`'s
`render-detectors.js` + `render-harness.js` dropped into this worktree, so it measures the true base
and not the stale committed map (which holds 438 cells against 443 live).

| state | base | after fix round | delta |
|---|---|---|---|
| `renders-clean` | 277 | 276 | **−1** |
| `renders-empty-with-data` | **0** | **1** | **+1** |
| `renders-empty` | 18 | 18 | 0 |
| `needs-server` | 8 | 8 | 0 |
| `compiles-but-throws` | 21 | 21 | 0 |
| `smell-detected-wrong` | 2 | 2 | 0 |
| `fails-compile` | 117 | 117 | 0 |
| **total** | **443** | **443** | **0** |

```
STATE CHANGES (1)
  examples/25-triage-board.scrml#populated: renders-clean -> renders-empty-with-data
                                            [] -> ["S-EMPTY-WITH-DATA"]
SMELL-SET CHANGES (1)   — the same cell
ACCEPTANCE-BAR OFFENCES (0) — none, strictly additive
PER-RUN TOKENS IN COMMITTED detail (0) — none
POPULATED (4): 03-contact-book / 06-kanban / 16-remote-data unchanged; 25-triage red
```

**The control fires, and the new field shows it fires for the right reason:**
`domChanged: true` (the render moved — it SHRANK) with `gainedContent: false` (nothing new
appeared). That pair is the whole argument for the measure, recorded in the committed baseline.

Identical to the pre-fix-round numbers: **the fix round closed four false-positive classes and moved
zero corpus cells.** F1/F2/F3 were all reachable only by DOM shapes no corpus app currently produces
— which is exactly why they needed synthetic pins, and exactly why "the tier is green" was never
evidence they were absent.

Tier suite: **110 pass / 0 fail** (was 88 before the fix round; 94 of them in
`detector-validation.test.js`). The delta-gate warns on **2** cells, both pre-existing base drift.

## RESIDUAL — stated plainly, after the fix round

1. **One-of-several-lists is still invisible, and now doubly so.** An app where one leaf list is
   wrongly empty while another renders stays green (the leaf conjunction), AND an app where the
   seeded data renders *somewhere* while a list that should hold it is empty now also stays green
   (the gain conjunct). The second is a REAL narrowing bought to close F1/F2, and it is the honest
   cost: F1 and the 25-triage control are DOM-identical, so nothing that reads only the final DOM can
   separate them. The gain signal separates them by reading the transition, but it is page-global —
   it cannot say *which* region the new content landed in.
2. **What would close it** is per-region attribution across the seed write (snapshot each region's
   content before and after, and ask whether the region that should have gained did). The machinery
   is within reach — `collectEachRegions` already identifies regions, and `applySeed` already
   straddles the write — but region identity is not stable across a reconcile that replaces the
   nodes, so it is a real piece of work and not a tweak. Not attempted in this arc.
3. **F4's behavioural half is pinned by contract + source assertion, not by execution** — I cannot
   make the real compiler emit a client without `_scrml_reactive_set`. Mutation H reds only the
   source-level pin. Weaker than an executed pin; stated, not dressed up.
4. **`<template>`-hosted regions are excluded for a second reason** (happy-dom puts template children
   in `.content`, unreachable by `querySelectorAll`), so mutation F does not red those two cases.
   Recorded, not "fixed" — the explicit filter covers them anyway.
5. Unchanged from the first round: `seed-fixtures.js` and the three wrong fixtures untouched;
   `compiler/src` untouched (incl. the stale `emit-ssr-render.ts:411` comment and the shared
   mount-id question); the 5 pre-existing base drifts left visible rather than laundered.

### Pre-commit subset, fix round

`23969 pass / 99 skip / 10 todo / 5 fail / 124663 expect()` across 1322 files — the SAME five-name
set as before the fix round (3 self-host smoke, the B5 CSRF guard, 1 unnamed), **zero new**.
Identical totals, so the fix round changed nothing outside this tier.
