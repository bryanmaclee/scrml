# S426 — D6 region emptiness ignores the parent that CONFERS content

**Change-id:** `s426-d6-parent-content`
**Dispatched by:** PA (S426-peter) · **base:** `origin/main` @ `f8317399`
**Gap:** `g-d6-region-content-ignores-the-parent-that-confers-content-so-an-each-inside-a-select-or-picture-reds-a-correct-render` (HIGH, open)
**Scope signal:** Peter, verbatim post-S424-wrap — *"take the new HIGH next session"*.

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its §"Task-Shape Routing" to any additional map
it names for a test-tier/detector task. Treat map content as a **verify-against-source hypothesis**,
not fact.

⚑ **The map is STALE: stamp `787d4cb4`, HEAD `f8317399` — 17 commits behind, and THREE of them land
in the very directory you are changing.** Factor these in directly; the map does not know them:

- `bb9101ea` (#993) — D6 region-scoped emptiness first shipped (`collectEachRegions`, `leafRegions`,
  `regionScopedEmptiness`, `nodesHaveRenderedContent`).
- `1f6a8d1a` (#1001) — the `gainedContent` veto predicate at `render-detectors.js:692`.
- `7ac7cef3` (#1002) — `seedThrewNotice` + the `hasSeedBridgeFailure` disqualifier at `:887`.

Report the load-bearing map finding at the end, **"not load-bearing" included**.

---

## THE DEFECT, and it is PA-REPRODUCED on `f8317399` (not inherited)

`regionScopedEmptiness` asks `nodesHaveRenderedContent(region.nodes)` — a predicate that decides
content from the region's **own** nodes and their descendants. But three definitions inside
`elementCarriesContent` make an element content-bearing **because of the children it contains**:

| parent | `elementCarriesContent` definition | locus |
|---|---|---|
| `select` | has an `<option>` | `render-detectors.js:199` |
| `picture` / `video` / `audio` | a `<source>`/`<img>` child with `src`/`srcset` | `:205` |
| **`svg`** | **any element child (`el.children.length > 0`)** | **`:216`** |

`emitEachMountHtml` places the fence at the each's **SOURCE** position, so the rows land INSIDE that
parent and the element that counts them sits OUTSIDE the region. Neither `option` nor `source` is in
`CONTENT_CANDIDATE_SELECTOR` (`:97`), and a `<circle>` is not either — so the region measures EMPTY
while the page renders correctly, and D6 scores `renders-empty-with-data`: **RED, against the
compiler, on a correct render.**

⚑ **`svg` is a THIRD instance the gap entry does not name.** I found it by sweeping
`elementCarriesContent` for other delegating definitions after reproducing the first two; the gap text
names only `select` / `picture` / `video` / `audio`. **Do not treat the gap's list as the population** —
it was incomplete, which is exactly why the sweep is owed.

### Reproduce it yourself before changing anything (PA-verified output below)

Run from the repo root. `nodesHaveRenderedContent` is not exported; drive it through the exported
`regionScopedEmptiness`, which is what D6 actually consumes.

```js
// scratch.mjs
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const { regionScopedEmptiness, hasRenderedContent } =
  await import("./compiler/tests/e2e-render-map/render-detectors.js");
function show(label, html) {
  document.body.innerHTML = html;
  const rse = regionScopedEmptiness(document.body);
  console.log(label, "| page correct:", hasRenderedContent(document.body),
              "| allLeavesEmpty:", rse && rse.allLeavesEmpty);
}
show("select/value-only", `<main id="root"><select><option value="">Choose…</option>` +
  `<!--scrml-each:a--><option value="1"></option><option value="2"></option><!--/scrml-each:a--></select></main>`);
show("picture/source   ", `<main id="root"><picture>` +
  `<!--scrml-each:b--><source srcset="a-480.webp"><source srcset="a-960.webp"><!--/scrml-each:b-->` +
  `<img src="a.jpg" alt="a"></picture></main>`);
show("svg/shape        ", `<main id="root"><svg viewBox="0 0 10 10">` +
  `<!--scrml-each:e--><circle cx="1" cy="1" r="1"></circle><!--/scrml-each:e--></svg></main>`);
```

PA-measured on `f8317399` — all three print `page correct: true | allLeavesEmpty: true`.

Two controls that behave CORRECTLY today and must still do so afterwards:

- options **with text** (`<option value="1">One</option>`) → `allLeavesEmpty: false` (the text half
  already saves them).
- a genuinely empty fence in a plain `<ul>` → `allLeavesEmpty: true`, page `false`. True positive.

---

## ⛔ THE NAMED TRAP — do NOT close it this way

**Do NOT add `option` / `source` to `CONTENT_CANDIDATE_SELECTOR`.** That list is consumed by
`hasRenderedContent` at **BODY scope** too, so adding them makes a bare `<option value="1"></option>`
count as rendered content for a whole page — re-opening the S419 class
(`g-e2e-render-map-hidden-text-counts-as-content-while-hidden-elements-do-not`) from the other side.
S419's ruling is that there is **ONE definition of "not rendered"**, and this widening would break it
while appearing to honour it.

## THE INVARIANT TO IMPLEMENT (the fix direction, open to your correction)

> **A region's content test SHALL agree with the definition that makes the region's PARENT
> content-bearing — and SHALL NOT ask whether the parent is content-bearing overall.**

Two halves, and the second is the fail-closed half:

1. **Agree with the parent's definition.** When a region node's parent is one of the conferring
   parents above, a region node that satisfies that parent's own conferring test counts as content.
   This mirrors `elementCarriesContent` rather than widening a global list, so BODY scope is
   untouched — a bare `<option>` alone in a body still renders nothing.
2. ⚑ **Never ask `elementCarriesContent(parent)`.** The placeholder `<option value="">Choose…</option>`
   in the corpus sits OUTSIDE the region and already makes the `<select>` content-bearing BEFORE any
   seed — so "is the parent content-bearing?" is **fail-OPEN**: it would score a genuinely empty fence
   inside a placeholder-bearing `<select>` as GREEN. The question is whether **the region's own nodes**
   confer, never whether the parent happens to be conferring.

The region's parent is derivable without a signature change (`node.parentNode`; a range region's
siblings share one parent, and a mount region's nodes are the host's children) — but if a signature
change reads better, take it and say why.

## OWED MEASUREMENTS — and one of them already came back ZERO

pa-base §8: *before narrowing any check, count what it will stop looking at* — and the corollary,
*a fix built before the problem is measured is a fix whose value is unmeasured.* I ran the count; carry
it, and **correct it if I am wrong**:

- **Corpus `<each>` sites inside a conferring parent: `select` only — `picture`/`video`/`audio`/`svg`
  are ZERO.** (Text-level scan over 2,609 `.scrml` files.)
- ⚑ **Every real corpus site emits options WITH TEXT, so NONE of them trips this defect** —
  `assignment-picker.scrml` (3 sites, `${d.name} (${d.current_status})`),
  `pages/dispatch/load-new.scrml` (1 site, `${c.name}`), and
  `conformance/cases/each/shorthand-option-label-preserved/case.scrml` (2 sites, labels via
  `:`-shorthand and `${}`). **The real-world trigger population is ZERO, not "three files waiting".**
- ⚑ **The gap entry's citation of `status-picker.scrml` is WRONG** — that file has no `<select>`
  element at all; its single `<select` occurrence is inside a `//` comment on line 3, and its `<each>`
  emits `<button>` rows. A text-level grep produced that citation (overlay Rule 7's own class). I will
  correct the entry; do not spend time on that file.

**So this fix is PREVENTATIVE, and say so in the commit message.** It is still worth landing: a
detector that reds correct renders is the cry-wolf shape pa-base §8 names (a gate that cries wolf gets
bypassed, then deleted), value-only `<option>` rows and `<source>` rows are legitimate scrml, and
corpus-zero is **not** evidence of design intent (the corpus-is-artifact kernel — the corpus lacks the
shape because nobody wrote it yet). Do **not** re-argue the fix's existence on corpus-zero grounds.

## GATE — what must be true before you report DONE

1. **Bite proof by mutation, both directions.** Your new test must RED when the fix is reverted, and
   the fix must not make any existing case flip. Gut the new predicate to a constant and show which
   tests red — a source-text/shape assertion is NOT a behavioural gate (S424 proved there is no anchor
   that makes one detect behaviour; 13 behavioural tests were the real gate there).
2. **All three shapes** (select / picture-or-video-or-audio / **svg**) covered by tests, plus **both
   controls above** (text-bearing rows stay green; genuinely-empty fence stays RED).
3. ⚑ **The fail-open control is mandatory:** a genuinely empty fence inside a `<select>` that has a
   placeholder option OUTSIDE the region must STILL score `allLeavesEmpty: true`. If your fix greens
   that, it is the fail-open form and it is wrong.
4. **BODY scope unchanged:** `hasRenderedContent` on a body holding only `<option value="1"></option>`
   must still be `false`. Pin it.
5. `bun test compiler/tests/e2e-render-map/` — full tier green (the S424 baseline is
   **164 pass / 0 fail** for the tier and **148 / 0** for `detector-validation.test.js`).
6. Report **which cells of the committed baseline move.** Expected: none. If any moves, STOP and
   report rather than regenerating a baseline.

## PROCESS (binding)

- **Startup verification + path discipline (F4).** First action: confirm `pwd` is your assigned
  worktree under `.../scrml/.claude/worktrees/agent-`, confirm the git toplevel equals it, confirm a
  clean tree. Then `bun install` (a fresh worktree does NOT inherit `node_modules`) and run `pretest`
  **from the worktree CWD** — `bun --cwd <path> run pretest` SILENTLY NO-OPS and exits 0 (S376); check
  the artifact exists, never the exit code. If any check fails, STOP and report.
- Every write uses a **worktree-absolute path**. Never `cd` into the main checkout; use
  `git -C "$WORKTREE_ROOT"`. Echo the startup `pwd` in your first commit message.
- ⚑ **NEVER `git stash`** — `refs/stash` lives in the COMMON `.git` dir and is shared across every
  worktree, so a stash here can be popped into another tree (S385, witnessed in both directions). Do
  base-vs-fix flips by **file copy**.
- ⚑ **Never a bare `pkill -f` / `killall`** on a command string every checkout shares (S376) — kill by
  PID captured at launch, or filter on cwd.
- **Commit after each meaningful unit** (WIP commits expected) and keep an append-only
  `docs/changes/s426-d6-parent-content/progress.md` (timestamped: what was just done, what is next,
  blockers). A clean tree before you report DONE is mandatory; "work in the worktree, no commits" is
  not an acceptable terminal report.
- **Step 1, because the worktree is cut from `origin/main` and this brief is NOT there yet** (S346):
  `git fetch origin brief/s426-d6-parent-content && git checkout FETCH_HEAD -- docs/changes/s426-d6-parent-content/`
- Read any `"rebase onto $(git rev-parse HEAD)"` instruction as resolving to **`origin/main`**.

## ⚑ YOU ARE LICENSED TO OVERTURN ME

The locus, the invariant, and the `node.parentNode` mechanism above are **PA-located, verify-first** —
not findings. Every locus I hand you was produced by reading and by the repro, not by tracing every
consumer. If the invariant is wrong, if there is a fourth conferring definition I missed, if the region
parent is not reachable the way I claim, or if the whole framing should be inverted — **say so with the
measurement and do that instead.** In the last three sessions this licence caught three wrong PA
corrections and produced a better argument than the PA's own on a question the PA had already decided.
A brief that demanded compliance would have shipped every one of those errors.

Report: what held, what was refined, what was wrong.
