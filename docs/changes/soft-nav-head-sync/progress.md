# progress — soft-nav-head-sync

Append-only. Newest entry at the bottom. Written for a successor who boots cold with
nothing but this file and the branch.

---

## 2026-08-19 — entry 1 — startup + premise verification (no code written yet)

**Worktree** `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0ee37b7ee9d9c856`
**Branch** `soft-nav-head-sync`, cut from `origin/fix/soft-nav-head-sync` @ `dda661b2`.

### Startup gates — all green
- `pwd` / `git rev-parse --show-toplevel` agree; tree clean at start.
- `git fetch origin fix/soft-nav-head-sync && git checkout -B soft-nav-head-sync FETCH_HEAD` → HEAD `dda661b2` as briefed.
- `bun install` OK (217 packages).
- `bun run pretest` OK (13 samples compiled into `samples/compilation-tests/dist/`).
- ⚠ `git` printed `fatal: bad tree object fb316444…` / `failed to run repack` during the
  background auto-gc kicked off by the initial `fetch`. `fb316444` is NOT reachable from my
  history (`git cat-file -t` says missing); it is a pre-existing dangling object in the shared
  object store. My branch, index and commits are intact. Non-blocking, but the PA should know
  the main repo's object store has at least one missing object.

### Both PA loci HELD — verified by reading source at HEAD
- **D1** `compiler/src/runtime-template.js` `_scrml_nav_sync_head(doc)` (≈ line 2841) syncs exactly
  `<title>`, `meta[name=description]`, `link[rel=canonical]` via `_scrml_nav_sync_head_el`.
  `link[rel=stylesheet]` is never touched. Confirmed.
- **D2** `_scrml_navigate_soft` pushes at ≈ 2713 / 2724 **before** the fetch;
  `_scrml_nav_fetch_and_swap` at ≈ 2752 does
  `if (!res.ok || res.redirected) { _scrml_navigate(res.url || path); return null; }`. Confirmed —
  the pushed entry is orphaned.
- Relative-depth premise **CONFIRMED in the emitter**: `compiler/src/codegen/index.ts:3054` emits
  `<link rel="stylesheet" href="${upToRoot}${entryBase}.css">` and `:2305` emits
  `href="${base}.css"`. So hrefs really are relative at varying depth, exactly as the brief and
  the reporter said.

### ⛔ ONE BRIEF PREMISE IS WRONG — there IS an automated gzip gate
The brief says *"The PA grepped and found NO automated gate enforcing the budget"*. **False.**
`compiler/tests/integration/v0-3-x-spa-tree-shake-phase-b.test.js:145` asserts
`expect(gzip.length).toBeLessThan(16 * 1024)` on the assembled shared runtime for an SPA-counter
fixture. It is in the **pre-commit gate** (integration tier). It WILL go red if the delta lands in
a chunk that fixture assembles.

Measured baseline at `dda661b2` (harness: gzip of the artifact `compileScrml` writes):

| artifact | raw B | gzip B |
|---|---|---|
| `SCRML_RUNTIME` whole template | 342,667 | 102,631 |
| chunk `utilities` isolated | 40,433 | 14,185 |
| chunk `core` isolated | 25,692 | 8,186 |
| assembled runtime, SPA counter (the gated artifact) | 54,773 | **15,600** |

Headroom against 16,384 B = **784 B**, not the ~185 B the gap entry remembers. Note the gated
fixture does **not** include the `utilities` chunk, so a soft-nav-only delta may not move it at
all — which is itself worth reporting, because it means the gate does not actually watch this
code.

### ⚠ SEPARATE LIVE DEFECT FOUND, OUT OF SCOPE, NOT BEING FIXED HERE
`navigate()` in an **attribute** position (`<button onclick={ navigate("/x") }>`) lowers to
`_scrml_navigate_soft("/x")` in `app.client.js`, but `detectRuntimeChunks`
(`compiler/src/codegen/emit-client.ts:1785/1790`) only lights the `utilities` chunk for a
**bare-expr** node or for `fileHasOutlet(fileAST)`. On a page with no `<outlet>`, the emitted
bundle therefore references `_scrml_navigate_soft` while the assembled runtime does not define it
→ **`ReferenceError` on click**. Reproduced by compiling and grepping both artifacts. This is the
S265 class again. Surfacing, not fixing — outside this brief.

### Test-feasibility probe — SETTLED, and it is good news
An outcome-shaped assertion ("the destination's stylesheet is *applied*") is achievable in the
existing happy-dom tier:
- happy-dom **does** fetch `<link rel=stylesheet>`, fire `load`/`error`, populate `link.sheet`, and
  feed `getComputedStyle`. Verified end-to-end.
- ⚠ It must be served by **`node:http`**, NOT `Bun.serve` — happy-dom's internal fetch uses
  node's http client and gets `NetworkError: … Parse Error` against `Bun.serve`. Probe proved
  `node:http` works and `Bun.serve` does not. Anyone reproducing must use `node:http`.

### NEXT
1. Build a realistic multi-page fixture (shell `<program>` + `<outlet/>`, pages at depth 0/1/2,
   per-page CSS) and **reproduce D1 empirically** before writing the fix.
2. Then implement D1 (resolve against target URL, await load, prune after swap) and D2.

### Blockers
None.

---

## 2026-08-19 — entry 2 — D1 + D2 implemented, verified by execution

### What landed (commit `4b0fbbeb`, then refined)

`compiler/src/runtime-template.js` — all inside the `utilities` chunk, beside the
existing head-sync helpers:

| symbol | role |
|---|---|
| `_scrml_nav_sheet_base` | module-init pin of the base the LIVE head's RELATIVE hrefs belong to |
| `_scrml_nav_is_sheet` | `rel` token-list test; excludes `alternate stylesheet` |
| `_scrml_nav_sheet_urls(doc, path)` | the fetched doc's sheets, ABSOLUTE against the TARGET url |
| `_scrml_nav_live_sheets(ownedOnly)` | live head sheets + absolute url; narrow view for pruning |
| `_scrml_nav_has_sheet(href)` | already-attached test (WIDE view — never double-fetch) |
| `_scrml_nav_attach_sheets(wanted)` | append missing, start fetches immediately, return `subscribe(cb)` |
| `_scrml_nav_prune_sheets(wanted)` | retire unreferenced CLAIMED sheets, after the swap |
| `_scrml_nav_claim_boot_sheets()` | one-shot: claim the initial SSR document's sheets |
| `_scrml_nav_commit_entry(path)` | the §20.8.8(1) commit gate — save scroll + pushState |

Wiring: `_scrml_navigate_soft` no longer pushes; `_scrml_nav_fetch_and_swap(path, restore, push)`
and `_scrml_nav_apply_html(html, path, restore, token, push)` thread the flag; popstate passes
`false`; `runSwap` is gated on `sheetsReady`; `swap()` commits the entry first and prunes last.

### THE THING MOST LIKELY TO BE GOT WRONG — and a second trap under it

The brief flagged target-url resolution. Confirmed and handled. **But there is a second trap the
brief did not name and it would have produced a subtle, intermittent wrong-file bug:**

> `history.pushState` MOVES THE DOCUMENT BASE URL. `HTMLLinkElement.href` (and anything resolved
> against `window.location`) therefore RE-RESOLVES the live head's *relative* attributes mid-flight.
> Live on `/` with `<link href="app.css">`, push `/reference/auth`, and that same element now
> reports `…/reference/app.css`.

Observed directly in the harness. If the have/want comparison had used `link.href`, the shell sheet
would have looked "missing" after the first nav and been re-appended on every subsequent one.
`_scrml_nav_sheet_base` exists solely to close this: pinned once at module init, deliberately never
updated, correct forever because every sheet the engine appends carries an ABSOLUTE href.

### D2 — chose push-after-commit, not replaceState-on-redirect

The brief allowed either. Push-after-commit, because:
1. It closes the **whole class**, not the redirect case. Today FIVE paths hard-navigate on top of
   an already-pushed entry: non-OK response, redirected response, transport failure, unparseable
   document, target with no outlet, chunk load failure. `replaceState` fixes one.
2. SPEC **§20.8.8 item 1** is directly on point: *"A navigation that fails, is aborted, or is
   superseded before commit SHALL emit no lifecycle edge whatsoever."* A history entry for an
   uncommitted navigation is exactly that residue.
3. `replaceState`-then-`location.href = sameUrl` relies on browsers treating a same-URL assignment
   as a replace rather than a push. Push-after-commit needs no such assumption.
4. Bonus: two rapid clicks now push ONE entry (the loser bails on the token check before committing)
   instead of two.

Cost, stated plainly: the address bar no longer updates until the fetch resolves.

### Pruning is CONSERVATIVE — a regression I nearly shipped

A naive prune removes **every** unreferenced head stylesheet, including one an author injected at
runtime. SPEC §20.8.6 (`<program>` is the persistent shell) and §20.8.8 item 5 (shell state survives
"with author mutations intact") say that is shell state, not route state. So the engine claims
sheets (`data-scrml-sheet`) and prunes only claimed ones. Verified non-vacuous: flipping the prune
back to unconditional turns the author-sheet test red.

Nothing in-tree was at risk — the runtime's only other `createElement("link")` sites are
`rel="prefetch"` (`_scrml_prefetch_tier1` / `_scrml_prefetch_tier2`) and `_scrml_nav_is_sheet`
excludes them. The exposure was adopter code.

### Tests — `compiler/tests/browser/g-soft-nav-stylesheet-swap.browser.test.js`, 10 tests

Every assertion is `getComputedStyle` on something the reader is looking at. Real compiled fixture,
real HTTP server, real click, real stylesheet fetch.

**RED-BEFORE-GREEN, measured:** against the unfixed runtime **7 of 9 failed** (the author-sheet test
was added afterwards). The two that passed are the designed controls (hard-load control; commit-takes-
one-entry). Failure values are the defect verbatim: destination colour `""` — no styling at all — and
`history.length` `Expected: 1, Received: 2`.

### Host facts anyone reproducing this needs (all verified by probe, none guessed)

1. happy-dom's resource fetch uses node's http client and dies `NetworkError … Parse Error` against
   `Bun.serve`. **Use `node:http`.**
2. happy-dom enforces the same-origin policy against the document's own url. `setURL` BEFORE the
   first `fetch`, or everything is blocked from `about:blank`.
3. **happy-dom 20.8.9 does not implement CSS cascade layers** — rules inside `@layer { … }` parse
   but never match in `getComputedStyle`. The compiler emits every authored rule inside
   `@layer global`, so the test host unwraps layers IN THE TRANSPORT. Urls/filenames/depths (the
   thing under test) untouched; the asserted rules are the compiler's own.
4. **happy-dom 20.8.9's MutationObserver fires its callback exactly ONCE per `observe()`** — a
   second mutation is silently dropped (probe: 3 mutations, 1 delivery). The no-flash test therefore
   uses a 150 ms transport delay on stylesheet responses plus a 5 ms sampling poll, which is a
   better instrument anyway.
5. happy-dom's DOMParser documents DO attempt to load their `<link>` resources (real browsers make
   an inert document). Harmless 404 noise in the log; the engine reads `getAttribute("href")` and
   resolves itself, so nothing depends on it.

### Suite

| tier | BEFORE (base runtime, test file removed) | AFTER |
|---|---|---|
| unit+integration+conformance | 22382 pass · 70 skip · 1 todo · **0 fail** · 22453 tests / 1229 files | **identical** |
| browser (`browser-baseline.ts --check`) | — | **PASS**, name set matches baseline (48 asserted, 0 of 2 env-excluded) |

`expect()` call count moves 113,881 -> 113,892 (+11) with test count, pass, fail and skip all flat.
**Attributed, not hand-waved:** `compiler/tests/unit/esm-runtime-module-format.test.js:138` runs
`for (const n of names) expect(topLevel.has(n)).toBe(true)` over
`deriveTopLevelExportNames(assembleRuntime(...))` — **one assertion per TOP-LEVEL DECLARATION in the
runtime.** This change adds exactly 11 (9 function declarations + `_scrml_nav_sheet_base` +
`_SCRML_NAV_SHEET_TIMEOUT_MS`). Arithmetic confirmed across two revisions: the 9-declaration version
measured +9, the 11-declaration version +11. The sibling loop at :149 reads the tree-shaken
`core/scope/errors/transitions` slice, which excludes `utilities`, so it does not move — which is why
the delta is +11 and not +22. All 11 new assertions pass.

### NEXT
- Nothing blocking. Awaiting the S239 adversarial pass. DO NOT LAND.

---

## 2026-08-19 — entry 3 — the gzip accounting the brief demanded

Same measurement both sides: `gzipSync` over the exact bytes `compileScrml` writes.
BEFORE = `dda661b2`'s `runtime-template.js` in this worktree; AFTER = final HEAD.

### ⛔ FIRST, THE BRIEF'S PREMISE IS WRONG IN BOTH DIRECTIONS

The brief: *"The PA grepped and found NO automated gate enforcing the budget — so nothing will go
red if you spend the headroom."*

**A gate exists**, and it is in the pre-commit tier:
`compiler/tests/integration/v0-3-x-spa-tree-shake-phase-b.test.js:145`,
`expect(gzip.length).toBeLessThan(16 * 1024)`.

**And it does not watch this code.** Its fixture is `SPA_COUNTER` — a single file, no `<program>`,
no `<outlet>`, no `navigate()`. It therefore assembles **without the `utilities` chunk**, which is
where the entire soft-nav engine lives. `_scrml_navigate_soft` is not in the artifact it measures.

So the brief's *conclusion* ("nothing will go red") is right, but for the opposite reason: not
because no gate exists, but because **the gate measures an artifact that excludes the code the HIGH
gap is about.**

### The numbers

| artifact | BEFORE | AFTER | delta |
|---|---:|---:|---:|
| assembled runtime, `SPA_COUNTER` — **the gated artifact** | **15,600** | **15,600** | **0** |
| assembled runtime, `<program>`+`<outlet/>` MPA shell — **what scrml.dev ships** | **28,190** | **32,295** | **+4,105** |
| `utilities` chunk, isolated | 14,185 | 18,299 | +4,114 |
| whole `SCRML_RUNTIME` template | 102,631 | 106,737 | +4,106 |

(all gzip bytes)

### ⚑ The budget does not bind the artifact an SPA actually ships

The outlet-bearing shell runtime was **28,190 B gzip BEFORE this change — 1.72× the 16,384 B
budget.** It is not near a knife edge; it has been well past the line for as long as the soft-nav
engine has existed. The 784 B of headroom the `SPA_COUNTER` gate reports is real but it is headroom
on a different artifact.

**This does not resolve the operator fork and is not meant to.** It says the fork is currently being
asked about a number that does not measure the thing the gap names. Whichever way (a)/(b) goes, the
gate needs to point at an outlet-bearing fixture or it will keep reporting a budget nobody is
spending.

### My delta, honestly: +4,105 B gzip, and most of it is prose

| slice of the `utilities` chunk (AFTER) | raw | gzip |
|---|---:|---:|
| as shipped | 52,465 | **18,299** |
| line comments stripped | 20,544 | **5,592** |

**Comments are ~70% of that chunk's gzip weight (12,707 B).** The runtime is emitted verbatim — the
`g-emitted-js-never-minified-prize-unmeasured` gap records that no mangle/minify stage exists in the
emit path — so every comment line ships to every visitor. My commenting density matches the
surrounding code; I did not thin it, because a silent correctness trap (the pushState-moves-the-base
one) is exactly the kind of thing the next maintainer needs told. **If the operator wants the bytes
back, comment-stripping the emitted runtime returns ~12.7 KB gzip from this chunk alone — roughly
3× what this fix costs — and changes no behaviour.**

### The gated-chunk proposal (the brief asked for one; `ifmount`/#301 is the precedent)

Splitting *my addition* into its own chunk buys **nothing**: it is needed exactly when soft nav is
live, which is exactly when `utilities` is already pulled in by the `fileHasOutlet` gate.

The real split is one level up, and it is 4× larger than this fix:

> **Move the whole §20.8.2 soft-navigation engine + §20.8.3 link-boost out of `utilities` into a
> `softnav` chunk gated on `fileHasOutlet`.**

Measured at final HEAD: the engine is **45,345 of the chunk's 52,465 raw bytes (86.4%)**, and
`utilities` minus the engine is **2,487 B gzip against 18,299**. A page that pulls `utilities` only
for `_scrml_deep_set` (any `bind:x.y`) or `_scrml_upload` — and has **no `<outlet>`, so it can never
soft-navigate** — currently ships **15,812 B gzip of dead soft-nav engine.**

Cost: one new marker in `CHUNK_MARKERS`, one entry in `RUNTIME_CHUNK_ORDER`, and moving the
`fileHasOutlet` gate in `emit-client.ts:1114` from `utilities` to `softnav` (the two `navigate()`
call-site gates at :1785/:1790 move too). Not done here — out of this brief's scope, and it wants
its own before/after corpus diff.

### ⚠ Related, and it makes the split MORE attractive, not less

`detectRuntimeChunks` lights `utilities` for a `navigate()` in a **bare-expr** node or for
`fileHasOutlet`. A `navigate()` in an **attribute** (`<button onclick={ navigate("/x") }>`) on a page
with no `<outlet>` matches neither: the emitted `app.client.js` calls `_scrml_navigate_soft` and the
assembled runtime does not define it → **`ReferenceError` on click.** Reproduced by compiling and
inspecting both artifacts. Out of scope here; surfaced in entry 1.

---

## 2026-08-19 — entry 4 — fix round: the park-mechanism question, SETTLED BY EXECUTION

**Worktree** `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aad6a8d1780913ffc`
**Base** `f4529dd5` (fetched `origin/soft-nav-head-sync`, `reset --hard FETCH_HEAD`).
Startup gates green: `bun install` 217 pkgs, `bun run pretest` 13 samples.
Existing browser test at base: **10 pass / 0 fail / 34 expect()** — the number to hold.

### The defect being fixed (D3)

`_scrml_nav_attach_sheets` appends the destination's `<link rel=stylesheet>` into the LIVE
`document.head` at the top of `_scrml_nav_apply_html`. The swap — which is also what prunes the
outgoing sheets — sits behind BOTH `sheetsReady` AND `_scrml_nav_load_chunks`. On a **cross-chunk**
nav the destination's CSS is therefore live against the SOURCE page's DOM for the whole chunk-load
window (bounded by `_SCRML_NAV_CHUNK_TIMEOUT_MS` = 10 s).

The early attach is load-bearing and must NOT be moved after the chunk load — the parallel fetch is
what buys the no-unstyled-flash property. So: attach so it **FETCHES but does not APPLY**, then
apply at swap time.

### ⛔ THE MECHANISM IS NOT A COIN-FLIP. The brief offered `media="not all"` and `link.disabled = true` as two standard options. Only ONE of them works, and the other fails catastrophically.

**happy-dom cannot adjudicate this at all** — it does not model `media` and does not implement
`disabled`. Probe, happy-dom 20.8.9:

```
A) media='not all': load= true err= false sheet= true color= rgb(9, 9, 9)   <- APPLIED ANYWAY
C0) 'disabled' in link? false                                                <- not even an IDL prop
```

A `media="not all"` sheet still paints in happy-dom, and `link.disabled` is a plain expando there.
So the browser tier is structurally blind to "parked vs applied" via `getComputedStyle`, and the
mechanism had to be settled in **real Chromium** (puppeteer 24.40, headless, 600 ms CSS delay):

```
A_colour_right_after_attach       : "rgb(0, 0, 0)"     <- parked: does NOT apply
A_load_event                      : "load"             <- FIRES
A_load_ms                         : 614                <- == the server's 600 ms delay: really fetched
A_colour_after_load_still_parked  : "rgb(0, 0, 0)"     <- still does not apply after load
A_sheet_object_present            : true
A_colour_after_unpark             : "rgb(9, 9, 9)"     <- applies INSTANTLY on un-park

B_disabled_is_idl_prop            : true
B_colour_right_after_attach       : "rgb(0, 0, 0)"
B_disabled_reads_back_preload     : true
B_load_event                      : "TIMEOUT"          <- *** load NEVER FIRES ***
B_load_ms                         : 5000
B_colour_after_load               : "rgb(0, 0, 0)"
B_disabled_reads_back_postload    : true
B_colour_after_unpark             : "rgb(0, 0, 0)"     <- *** NEVER APPLIES, EVER ***

CSS requests Chromium actually made: [ "a.css", "b.css" ]   <- both DID fetch
```

**Verdict: `media="not all"`. `link.disabled` is disqualified twice over.**

1. **It deadlocks the swap.** `load` never fires on a link disabled before insertion, and
   `_scrml_nav_attach_sheets` settles `sheetsReady` off `load`/`error`. Every cross-chunk nav
   would sit out the full `_SCRML_NAV_SHEET_TIMEOUT_MS` (3 s) before swapping. That trades a
   paint defect for a 3-second stall — strictly worse than the bug.
2. **It never un-parks.** `B_colour_after_unpark` is still `rgb(0,0,0)`. Per HTML §4.2.4 the
   `disabled` setter is a **no-op while the associated CSS style sheet is null**, and Chromium
   never associates a sheet for a link disabled at insertion. So `disabled = false` at swap time
   restores nothing and the destination renders **permanently unstyled** — precisely the defect
   this whole change exists to remove.

`media="not all"` satisfies every constraint: fetch happens (b.css/a.css both in the request log),
`load` fires so `sheetsReady` settles on time, nothing applies while parked, and un-parking is
synchronous and instant.

Chosen spelling is `not all` rather than the more common `print`: `print` MATCHES during print
preview / `window.print()`, which would leak the destination's CSS into the reader's printout
mid-navigation. `not all` matches no media type in any context.

### Consequence for the test tier — recorded here because it shapes item 3

Since happy-dom ignores `media`, the new during-window assertion **cannot** be a
`getComputedStyle` read (the bar the rest of this file holds). It has to be a DOM predicate —
"is any engine-attached sheet in a state where it WOULD paint right now" — with the mechanism
check written mechanism-agnostically (media AND disabled), and the shim boundary stated in the
file the way SHIM 1/2/3 already are. Real-Chromium is where the pixel claim gets made.

### NEXT
item 2 — implement the park/arm pair. item 3 — chunk-delay dimension + red-before-green proof.
item 4 — D4, the silently-swallowed 404 sheet. item 5 — full suite + baseline + gzip delta.
