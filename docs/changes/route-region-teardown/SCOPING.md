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
subscriptions / **timers**".** The timer clause is FALSE. Fix the comment in the same landing — a false
comment on the exact function that should have done the job is how this survived.

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

## Recommended design (verify before building — this is a PA hypothesis, not a trace)

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
  `4e7e5439` before the fix.
- **EXECUTE the bundle** — do not grep the emitted text. The "emitted ≠ runs" trap has three recorded
  occurrences (S265 theme-switch, S268 component-root, S307 audit).
- **Shell-timer non-regression** — a `<timer>` in the SHELL must SURVIVE navigation. This is the
  misclassification risk above and is the single most important negative test.
- **`if=` non-regression** — `_scrml_unmount_scope`'s path must be untouched.
- Conformance both halves; the DD's CN-1..CN-10 cover the lifecycle contract separately.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` — **watermark `fe14c9b2`, STALE** by S305/S307/S310/S313 landings. Treat map
content as a verify-against-source hypothesis and factor in the post-map landings.
