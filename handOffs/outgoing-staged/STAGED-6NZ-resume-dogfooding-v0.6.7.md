---
STAGING-NOTE: DO NOT SEND until v0.6.7 is cut + pushed. At send — (1) fill <V0.6.7-TAG> / <V0.6.7-SHA> / <DATE-HHMM>; (2) update the Bug-61/formFor line to match whether Bug 61 landed in v0.6.7; (3) CONFIRM the live 6NZ inbox path — BOTH `/home/bryan-maclee/scrmlMaster/6NZ/handOffs/incoming/` AND `.../6nz/handOffs/incoming/` exist; verify which is the active repo (git remote / recent commits) before writing; (4) rename to `<DATE>-HHMM-scrmlTS-to-6NZ-resume-dogfooding.md`; (5) log the send in scrmlTS hand-off.
---
from: scrmlTS
to: 6NZ
date: <DATE — set at send>
subject: Resume dogfooding on v0.6.7 — Bug-51-class audit landed; 6nz-V fixed; engines/lifecycle/list-rendering are the high-value targets
needs: action
status: unread
---

# Resume scrml dogfooding — build v0.6.7

The compiler is ready for 6NZ to resume dogfooding + bug-hunting. **Pull `origin/main` and use the `v0.6.7` tag (`<V0.6.7-SHA>`)** — do NOT dogfood on v0.6.6 or earlier; several silent-miscompiles were just fixed.

## The headline lesson from this round (S140 Bug-51-class audit)

We ran an empirical audit and found **5 silent-miscompiles on 8 shipped surfaces**: features that compile to exit-0, pass `node --check`, but are **runtime-broken** — because the test tier was emit-string-only with no happy-dom runtime coverage. (Your own **6nz-V** `class:NAME`-on-for-lift bug was exactly this shape — clean emit, dead reactivity.)

**The single most valuable thing you can report: anything that compiles clean but behaves wrong at runtime.** "Compiled fine but the reactive update never fired / the state machine didn't advance / the bound class never changed" is gold — that's the class our unit tests miss.

## Fixed since you last dogfooded (re-test these)

- **6nz-V** — `class:NAME` / `style:` / attribute-interp / textContent on for-lift **reused** DOM nodes wasn't reactive. **RESOLVED** (class-level runtime fix in `_scrml_effect` tracking-pause-restore; your exact reproducer advances `alpha → bravo → charlie → alpha` post-fix). Covers any nested effect inside a reconciled list item.
- **`<each>` Tier-1 iteration** — was shipping a runtime-dead list (`_scrml_reconcile_list` called but never defined → ReferenceError on first render). Now correct. (Bug 57)
- **`formFor` validation surface** — rendered inputs but validation was dead; now emitted + reactive. (Bug 58<BUG-61-NOTE>)
- **`<tableFor selectable=…>` per-row checkbox** — per-row toggle threw `ReferenceError: evt is not defined`. Fixed. (Bug 59)

## Known-broken — please do NOT re-report (route around these)

- **Bug 54** — `<tableFor>` `<column :let={(row) => <custom/>}>` custom per-cell renderer **silently dropped** at the parse layer. DEFERRED. Avoid `:let` on `<column>`.
- **Bug 60** — render-by-tag on a **nested compound field** (`<form><userName/></form>`) emits literal tags; input never appears. DEFERRED. Top-level Shape-2 render-by-tag works.
- **6nz-U** — still queued (filed S126). **6nz-L / 6nz-T** — M6-deferred (native-parser arc; not in v0.6.x scope).

## Highest-value targets for 6NZ specifically

The S140 audit covered each / formFor / tableFor / schemaFor / engine-`effect=` / `<onTransition>` / lifecycle at the EMIT level + a few at runtime. The editor surfaces you lean on hardest are still thin on runtime coverage — most likely home for the next silent-miscompiles:

- **Engines / state machines** (§51) — especially the S67 hierarchy surface: nested `<engine>` (composite state-children), `history` attribute, `internal:rule=`, `<onTimeout>` / `<onIdle>` temporal arms, derived engines. Drive real transitions and watch whether `effect=` / `<onTransition>` side-effects actually fire and whether in-arm-body `${@cell}` re-renders across variant changes (there's a known v1 limitation here — confirm its exact edge).
- **Lifecycle annotations** (§14.12) — `(A to B)` on struct fields / Shape-1 cells; does `E-TYPE-001` fire on real pre-transition access, and never false-fire post-transition?
- **List rendering under churn** — for-lift + `<each>` with `class:`/`style:`/attribute bindings on reused nodes (the 6nz-V neighborhood). Hammer reconciliation: reorder, insert, remove, re-key.
- **Input state types** (§36) — `<keyboard>` / `<mouse>` / `<gamepad>`. These are spec-real but adoption-thin (≈0 source-level uses today); an editor exercising them end-to-end is uniquely high-signal — expect rough edges and report liberally.

## Reproducer protocol (required — see the cross-repo bug-report rule)

Every bug report MUST include a minimal, self-contained `.scrml` reproducer (inline fenced block for ≤~200 lines, or a sidecar `.scrml`), version-stamped (`compiled against scrmlTS@v0.6.7 / <V0.6.7-SHA>`, exact command), expected-vs-actual stated. Drop reports into `scrmlTS/handOffs/incoming/`. No reproducer → we bounce it back.

Fire away — engines + input-state + list-churn are exactly the runtime paths we haven't swept.
