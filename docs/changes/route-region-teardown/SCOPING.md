# Route-region teardown — the unblocked half of `g-route-timer-poll-not-stopped-on-soft-nav`

**Status:** `scoping` · **Authorized S313** (bryan: *"ratify C. build the unblocked half"*)
**provenance:** `dd:soft-nav-outlet-lifecycle-model-2026-08-02` · `ruling:` user-voice S313 (Pole C ratified)
**Gap:** `g-route-timer-poll-not-stopped-on-soft-nav` (HIGH, PA-verified by source trace)

## Why this is banked rather than landed

The PA verified the defect by source trace and designed the fix, then stopped at the build. Two
reasons, both contract-mandated rather than discretionary:

1. **It is compiler source (codegen), not a runtime patch** — see "Why runtime-only fails" below. The
   S239 adversarial pass is MANDATORY before any compiler-source landing, and the finder fan-out was
   not available in the authoring session. That gate exists because a green 20k-test suite has
   repeatedly shipped a real regression — twice on this PA's own work in this same session.
2. The **second half** of the fix (firing author `cleanup()` LIFO on route-leave) is a lifecycle
   commitment that rides the Pole-C ratification. Landing half a teardown and leaving `cleanup()`
   silent would be a worse state than today, because it would LOOK closed.

## The defect (verified, not reported)

- `_scrml_destroy_scope` (`compiler/src/runtime-template.js:1339`) performs the §6.7.2 four-step
  teardown: cleanup callbacks LIFO → `_scrml_stop_scope_timers` (:1776) → `_scrml_cancel_animation_frames`.
- It is reachable **ONLY** via `_scrml_unmount_scope` (:1469) — the `if=` path.
- `_scrml_nav_apply_html` (:2996) calls **`_scrml_teardown_region(liveOutlet)`** (:3026), never `_scrml_destroy_scope`.
- `_scrml_teardown_region` (:3122) drains **only** `_scrml_region_cleanups` (display-effect disposers).

⚠️ **`_scrml_teardown_region`'s own doc-comment claims it tears down "reactive display effects /
subscriptions / **timers**".** ~~The timer clause is FALSE.~~ **S314 correction: over-corrected — the
clause is SCOPE-accurate (an `_outletResident` timer really is drained here) and COVERAGE-overclaiming.
See "Two comments that are SCOPE-ACCURATE…" below; do not delete the comment, scope it.**

**Consequence:** a route-content `<timer>`/`<poll>` starts at chunk module-init and is never stopped by
a soft nav — it fires against detached DOM for the rest of the session, compounding per route visited,
holding the departed route's closures. Author `cleanup()` in route content never fires.

## Why a runtime-only fix does NOT work (the trap to avoid)

`_scrml_timer_start(scopeId, timerId, intervalMs, bodyFn)` takes **no element**, and `<timer>` emits
**no DOM node**. So `_scrml_teardown_region`, which holds only the outlet element, cannot discover which
`_scrml_scope_N` ids belong to the outgoing route:

- **DOM query is impossible** — nothing to query; the association is not in the DOM.
- **The `_scrml_region_track` pattern does not transfer** — it keys on `el.closest("[data-scrml-outlet]")`
  and there is no `el`.
- **A boot-time snapshot ("scopes present after shell wiring are shell scopes") is REJECTED as fragile** —
  an `if=` inside the shell can register a timer later and would be misclassified as route content, i.e.
  a shell timer silently killed by a navigation. That is a worse failure than the leak.

**Therefore the region↔scope association must be established at EMIT time.**

## ⛔ TRACED S313 — the design below was a HYPOTHESIS and it is WRONG. Read this first.

> **⚠️ PARTIALLY SUPERSEDED S314 — read "VERIFIED S314" below BEFORE scoping from this section.** Its
> trace is exact and every line number re-verified. But its premise *"the region↔scope association must
> be established at EMIT time"* is written as if from scratch, and that machinery **already exists**.
> The S314 section corrects the premise and re-splits the sizing. Bullets 1 and 2 below stand; bullet 3
> (leave-edge and enter-edge are the SAME arc) rests on the superseded premise and is re-argued there.

The banked design proposed "a route chunk registers its own region teardown, mirroring how it already
registers a rehydrator." **Tracing the rehydrator invalidates it.**

`emit-event-wiring.ts:2162-2170` emits `_scrml_nav_rewire(root)` and registers it via
`_scrml_register_rehydrator`. Its body is **non-delegable handlers + reactive display binding only**
(`nonDelegatedRewire` + `reactiveRewire`). **`<timer>` / `<poll>` are NOT in it** — they are emitted by
`emit-reactive-wiring.ts:~1250` as `_scrml_timer_start(...)` at **chunk module-init**, outside any
rehydrator.

**Consequences, and they change the fix:**

1. **An "active-region flag wrapped around the rehydrator loop" would capture NOTHING.** That is the
   obvious runtime-only design and it is a dead end — the timer has already started, at module-init,
   before any rehydrator runs.
2. **The defect is bigger than "teardown forgot to call `_scrml_destroy_scope`."** A route's `<timer>`
   starts exactly ONCE, when its chunk first loads, and is thereafter never started, stopped, or
   restarted by the navigation path at all. So beyond the leak, a route timer does **not** restart on
   re-entry — which §20.8.8 step 3 now requires (route-enter re-runs region-associated bodies).
3. **Therefore the leave-edge fix and the enter-edge re-association are the SAME arc, not two.** The
   region↔resource association has to be established at emit time for both; splitting them would land a
   teardown for resources whose creation is still bound to the wrong owner.

**What must be re-derived before building (do NOT scope from the section below):**
- Where `emit-reactive-wiring` can learn a node is route content. `fileHasOutlet(fileAST)`
  (`emit-reactive-wiring.ts:1042`) discriminates SHELL files, but the **single-file `<page>` form** puts
  shell and routes in ONE file, so file-level granularity is insufficient there — a `<page>`-ancestry
  test is likely required.
- Whether route-content lifecycle bodies should move INTO a registered region-wiring function (making
  creation and teardown symmetric) rather than staying at module-init. That is the shape §20.8.8 step 3
  implies, and it is a larger codegen change than the banked design assumed.

**Estimate impact:** this is no longer a contained runtime patch plus a small emit marker. Treat prior
sizing as void. The **verification list below stands unchanged and is still correct** — in particular the
shell-timer non-regression test, which is now MORE important, because the fix necessarily touches where
timers are created and not only where they are destroyed.

## ✅ VERIFIED S314 — the emit-time association EXISTS; its DISCRIMINATOR is the defect

**provenance:** `spec:` §6.7.2 + §20.8.8 (the governing sentences the fix restores) · empirical, by
compilation + emitted-bundle differential on `e80b692e`. Not a re-read of S313 — an execution.

### What is already built

`classifyMarkupNodes` (`emit-reactive-wiring.ts:1091`) threads an `insideOutlet` flag through the markup
walk, stamps `node._outletResident = true` on a `<timer>`/`<poll>` (`:1105`) and on
`<keyboard>`/`<mouse>`/`<gamepad>` (`:1114`), and at `:1273` / `:1310` routes that resource's stop into
`_scrml_region_cleanups` instead of the boot-once `_scrml_register_cleanup` (beforeunload) path.
Landed as **navigate-wave1b M1 Phase 4**. `_scrml_region_cleanups` is declared in the runtime
(`runtime-template.js:4282`), which the HTML loads BEFORE any chunk — so the emitted
`typeof … !== "undefined"` guard is not a live load-order risk on the classic path.

### The differential (three files compiled; branch read off the emitted bundle)

| # | shape | emitted cleanup branch | verdict |
|---|---|---|---|
| **A** | `<timer>` at shell top level | `_scrml_register_cleanup` (beforeunload) | **correct** — a shell timer must survive nav |
| **B** | `<timer>` in a route file (`pages/reports.scrml`) | `_scrml_register_cleanup` (beforeunload) | **THE DEFECT, reproduced by execution** |
| **C** | `<timer>` lexically inside `<outlet>…</outlet>` | `_scrml_region_cleanups` | **mechanism works** |

Fixtures + commands are reproducible from this section's shapes; A and B are the two cases the build
must flip and hold respectively.

### The actual root cause

`insideOutlet` means **"a lexical descendant of an `<outlet>` node in THIS file's AST."** Real route
content is never that: the `<outlet>` is a slot in the SHELL file, the route lives in its own file, and
the router fills the slot at navigation time. Case C — a `<timer>` written literally inside the outlet
placeholder — is a degenerate authoring shape. **The feature covers the case that does not occur and
misses the one that does.** So the fix is a PREDICATE correction on existing machinery, not new
machinery.

### ⚠️ Two comments that are SCOPE-ACCURATE and COVERAGE-OVERCLAIMING — not "false"

**Correction to this document (S314).** The S313 section above calls `_scrml_teardown_region`'s "timers"
clause **FALSE**. That is over-corrected, and the maps pass caught it: an `_outletResident` timer IS
registered into `_scrml_region_cleanups` and IS torn down there. The clause is accurate about what the
function drains; it is silent about how little reaches it.

`emit-reactive-wiring.ts:1271-1272` has the identical shape, and my first write-up of it repeated the
same error. Its text — *"closing the leak where the old route's timer keeps ticking against detached
cells … the leak is closed"* — sits INSIDE the `if (node._outletResident)` branch and is TRUE of that
branch. What it over-claims is the **class**: it reads as "the route-timer leak is closed" when only the
outlet-resident subset is, and that subset is essentially empty in real apps.

**This is the sharper finding, and it is why the defect survived 28k tests.** Neither comment is a lie a
reviewer could catch by reading it against its own function — both are locally true. The gap is visible
only by asking a question neither comment invites: *what fraction of route timers are outlet-resident?*
Answer: essentially none, because route content lives in a different file from the `<outlet>`.

**For the landing:** correct both to state their SCOPE (outlet-resident only) rather than deleting them,
and do not treat either as describing broken machinery — the machinery works. `_scrml_teardown_region`
also carries a tracked note as **S313-N6**.

### Re-split sizing (supersedes the S313 "treat prior sizing as void")

- **Leave-edge — probably SMALLER than banked.** A discriminator change plus tests, not a codegen
  restructure. The single-file `<page>` form still needs the `<page>`-ancestry test S313 predicted,
  because `fileHasOutlet` is a SHELL discriminator and file-level granularity cannot separate shell
  from route there.
- **Enter-edge (restart-on-return, §20.8.8 step 3) — genuinely UNBUILT.** `:1271-72` explicitly defers
  it: *"Restart-on-return for the region timer rides §20.8.4 fresh-per-visit re-hydrate — a bounded
  follow-on."* No code implements it.
- **On keeping them one arc:** S313's reason (the association must be built at emit time for both) is
  superseded — it already is. The surviving reason is the CN set: **CN-4 is the leave edge, CN-10 the
  enter edge, and landing CN-4 alone makes the ruling LOOK shipped while `keep-alive` re-entry is still
  unpinned** (CN-10 is the only case distinguishing C from Pole A). Keep them together on that ground,
  which is weaker than the one banked — say so rather than inheriting the stronger claim.

### NOT proven — the build's first task

That flipping the discriminator is **sufficient**. Verified: the mechanism exists (C) and its predicate
misses route content (B). NOT verified: that a route-content resource routed into
`_scrml_region_cleanups` is actually drained on the swap for a resource created at **chunk module-init**
rather than inside a rehydrator. Establish that FIRST — it is the same shape as the hypothesis S313
disproved, and it is cheap to check.

### CN-10 is blocked — and NOT on this arc

`<page keep-alive>` **does not compile** (`E-PAGE-INVALID-ATTR`, probed on `e80b692e`), so CN-10 cannot
be authored in any form, including codes-half-with-`runtime-half-pending`. The blocker is a SPEC-vs-SPEC
conflict (§20.8.4's *"A route MAY opt into `keep-alive` (`<page keep-alive>`)"* vs §4.15's *"the allowed
attribute set on `<page>` is exactly the four"*), which is a **ruling for bryan**, not a dev-agent call —
admitting the attribute is newly-accepting. Full write-up + the third false status claim it exposed:
`CONFORMANCE-CN1-CN10.md`. **CN-1..CN-9 are unaffected; the impl arc proceeds.**

### Direction-of-change — `semantics-changed` (pa-base §8)

Same source, different behaviour, **no diagnostic delta**: an existing app whose route `<timer>` runs
forever will, after the fix, stop it on nav. That is §8's *most dangerous* class — silent, and visible
only in an artifact diff, which is why the real-input recompile is not skippable here. It ships as a
fix rather than an amendment because the governing sentences pre-exist: **§6.7.2** (the four-step
teardown) and **§20.8.8** (the route-leave / route-enter edge contract, ratified S313). Quote both in
the PR body per the Rule 4 governing-sentence gate.

**Consequence for the S239 pass:** the shell-timer non-regression (case A) is now the single most
important negative test, MORE so than S313 stated — the fix edits the very predicate that currently
classifies shell timers correctly, so a sloppy widening kills them silently and fails OPEN.

## Superseded design (retained for provenance — DO NOT BUILD FROM THIS)

Mirror the mechanism the soft-nav engine already uses for rehydration: a route chunk registers its
rehydrator into `_scrml_rehydrators`; it should equally register **its own region teardown**.

1. **Emit side** (`compiler/src/codegen/emit-reactive-wiring.ts:1250` is the `_scrml_timer_start` call
   site) — when the emitting file/route is region-scoped (the same `fileHasOutlet`-class gate that
   already decides `_scrml_link_ensure_click` emission), also emit a registration of that scope id into
   a region-scope list.
2. **Runtime** — `_scrml_teardown_region` additionally calls `_scrml_destroy_scope` for each registered
   region scope, then clears the list. Step 4 (`animationFrame` cancellation) and the in-flight
   `<request>` abort come free, since `_scrml_destroy_scope` already does the first and the abort rides
   the same edge.
3. **Ordering** — teardown MUST run before `liveOutlet.innerHTML = newHtml` (it already does, :3026).

**Scope-of-fix split, per the DD — do NOT collapse them:**
- **(i) SHIP NOW, zero ratification dependency:** stop timers/polls, abort in-flight region `<request>`s,
  cancel pending `animationFrame`. All three poles prescribe it; it restores teardown §6.7.2 already
  describes to a path that never got wired.
- **(ii) Rides the Pole-C ratification:** fire author `cleanup()` LIFO at route-leave.

## Verification the build owes

- **Reproduce first**: a route with a `<timer>`, soft-nav away, assert the interval STOPS. Must fail on
  `4e7e5439` before the fix. **S314 already reproduced the EMIT half by differential (case B above) on
  `e80b692e`** — the route timer takes the beforeunload branch. The RUNTIME half (does the swap actually
  drain it once routed) is still owed and is the "NOT proven" item.
- **Hold case A, flip case B, do not regress case C** — the three-way differential is the emit-side
  oracle. Assert all three branches, not just the one being fixed.
- **EXECUTE the bundle** — do not grep the emitted text. The "emitted ≠ runs" trap has three recorded
  occurrences (S265 theme-switch, S268 component-root, S307 audit).
- **Shell-timer non-regression** — a `<timer>` in the SHELL must SURVIVE navigation. This is the
  misclassification risk above and is the single most important negative test.
- **`if=` non-regression** — `_scrml_unmount_scope`'s path must be untouched.
- Conformance both halves; the DD's CN-1..CN-10 cover the lifecycle contract separately.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` — **watermark `fe14c9b2`, STALE** by S305/S307/S310/S313 landings. Treat map
content as a verify-against-source hypothesis and factor in the post-map landings.
