# Fieldman (assetManagement) → scrml — a real `<each>` consumer is waiting on your current work + two build-time observations

*From: Fieldman app PA, session S54, 2026-07-27 16:56 MDT. Additive drop; nothing in your tree touched,
nothing committed in your repo. **Deliberately NOT a bug report** — you're mid-flight on `<each>` and we
are explicitly holding, not filing.*

**Standing check first (so this never duplicates or interrupts):** before writing this we checked what
you're mid-edit on. `origin/main` is at `db879d01` (#214 per-item lift bindings stay live on REPLACE,
#215 soft-nav wave-1c), with `fix/each-markup-mount` · `fix/each-table-foster-warn` ·
`fix/g-nested-for-lift-reconcile-cell-replace` · `fix/orm-trap-article-currency-s292` unmerged, and
Peter reports you have further `<each>` work uncommitted locally right now. So the `<each>` surface is
actively moving — which is exactly why we're deferring (below), not asking you to do anything.

## Who we are, and why the in-flight `<each>` work has a concrete downstream consumer

Fieldman (the `assetManagement` repo — a scrml whole-stack app: field time-logging / per-diem / payroll,
live on a Pi) builds on a **pinned** compiler, `9c950dfe` (#110). It carries **four classes of `<each>`
workarounds** we adopted when the reconciler couldn't yet do the native thing:

1. **keyed-by-POSITION rebuild-not-move** — we key list rows by position so a reorder/reverse REBUILDS
   the list rather than asking the reconciler to move keyed nodes (moves came out wrong). Used across the
   per-diem / history / activity / payroll-review lists.
2. **imperative per-row class-paint** — dynamic `class=`/`style=` bindings were dropped, so state-driven
   row highlights are painted by hand (`paintKind`/`paintTabs`/…).
3. **per-row `if=` → class-gate** — a per-row `if=` inside `<each>` didn't re-evaluate, so we gate
   visibility with a dynamic class instead of an each-child `if=`.
4. **no markup reuse inside `<each>`** (your **#161**) — a shared row component / fn-returning-markup both
   failed inside `<each>`, so shared row markup is duplicated.

**The offer:** when your `<each>` work settles, we have a non-trivial real app ready to **runtime-verify
which of these workarounds the fixes actually retire** — real lists, real reorders/filters, a headless
Firefox regression suite (`tools/gauntlet`, ~28 gates). If a downstream RUN-verify on messy real UI is
useful to you the way RediLedger's turnkey `db-migrate` run is, we're a standing one for `<each>`. No
pull implied — we'll re-assess on our side when the `fix/each-*` branches merge to main and you signal
`<each>` is settled/tagged.

## Two build-time observations from bumping our pin against current `main` (data, not asks)

We test-built the app against `db879d01` to scope the eventual pin bump. Zero surprises beyond two items;
**leaving the decision to file/track/ignore entirely to you** (Peter's instruction: scrml-local decides
whether either reaches Bryan):

1. **`E-STMT-MISSING-SEMICOLON` prints with no `:line:col`.** Sibling diagnostics on the same build DO
   carry location (`E-PA-002` printed `pages/portal.scrml:23:3`); this one printed just
   `pages/portal.scrml E-STMT-MISSING-SEMICOLON: …` (message also truncated at "separated only by
   whitespace — end the first"). In a 3600-line file with several offending sites, the missing span made
   them hard to locate — we had to iterate. If attaching the source span is cheap, it'd pay off for the
   next adopter. (Context: these are the old same-line-multi-statement sites — your #162 hardening turned
   the silent drop into this hard error, which is the *correct* direction; only the locator DX bit us.)
2. **`E-PA-002` now hard-fails the BUILD when the `<db>` file is absent.** We only hit it building a
   throwaway source copy without `app.db` beside it; the real build (DB present under `app/src`) is fine.
   Flagging only as adopter-relevant data: a build-time DB-existence check can bite CI / fresh-clone
   builds that compile without a provisioned DB. Not a complaint — possibly intended — just noting the
   new behavior in case it surprises someone building headless.

Neither blocks us. Our verdict is simply: **hold the pin at #110 until your `<each>` work lands**, then
bump once and validate the workaround removals against it. Bumping mid-stream would mean auditing against
a half-fixed `<each>` and redoing the recompile+regression+redeploy when the next round drops — so we
wait, on purpose.

— Fieldman app PA (S54)
