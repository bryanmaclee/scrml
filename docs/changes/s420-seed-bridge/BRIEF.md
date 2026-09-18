# Dispatch brief — `g-e2e-render-map-populated-seed-is-inert-so-d6-has-no-live-subject` (HIGH)

The brief as dispatched, kept beside `progress.md` so the work can be judged against what was
actually asked for. Two of its claims turned out to be wrong; both are recorded in `progress.md`
(§S2 and §S10) rather than quietly corrected here.

## The bug

`compiler/tests/e2e-render-map/` scores every corpus app in two cells: `#empty` and `#populated`.
The `#populated` cell seeds reactive state from `seed-fixtures.js` and then asks detector **D6**
("data was seeded but nothing rendered") whether the app rendered its data. **The seed is inert, so
D6 has never had a live subject on the corpus.**

PA-reproduced at `a5c3810a` — running `observeApp(app, seed, "populated")` against
`observeApp(app, null, "empty")` for each of the four seeded apps gives:

```
examples/03-contact-book.scrml :: empty=renders-clean populated=renders-clean IDENTICAL=true
examples/06-kanban-board.scrml :: empty=renders-clean populated=renders-clean IDENTICAL=true
examples/16-remote-data.scrml  :: empty=renders-clean populated=renders-clean IDENTICAL=true
examples/25-triage-board.scrml :: empty=renders-clean populated=renders-clean IDENTICAL=true
```

Same `state`, same `detail`. Seeding changes nothing observable.

## Root cause as dispatched (PA-traced — verify it, then fix it)

Emitted chunks do NOT call the bare runtime accessors.
`compiler/src/codegen/cell-accessor-rename.ts` renames every cell-accessor call in a chunk body to
a chunk-local `_scrml_cs_` wrapper, and the chunk prologue defines:

```js
_scrml_cs_reactive_get = (n, ...r) => _scrml_reactive_get(_scrml_cs_key(n), ...r)
```

so the app's real store key is `_scrml_cs_key("contacts")` — e.g. `001a4t7q$contacts`.

`render-harness.js` (~:385-406) bridges the **bare** accessors:

```js
globalThis.__scrml_set__ = (typeof _scrml_reactive_set !== "undefined") ? _scrml_reactive_set : null;
```

So `obs.set("contacts", [...])` writes the **un-namespaced** key. Nothing subscribes to it; no
effect fires; the DOM never changes.

## The fix as dispatched — limb 1 only

Make the harness seed through the accessor the app actually uses: prefer `_scrml_cs_reactive_set` /
`_scrml_cs_reactive_get` (or apply `_scrml_cs_key` to the name) when the chunk defines them, falling
back to the bare accessors when it does not. Keep the fallback — not every emit shape is
chunk-namespaced, and a harness that only works for one shape is the same class of bug.

**Do NOT attempt limb 2** (D6's `hasRenderedContent` is body-global, so page chrome satisfies it
before data arrives). That is a separate, filed design question. The job is to make the seed LIVE
and then REPORT what D6 says — that measurement is what decides limb 2.

## Required evidence

1. Prove the fix bites, before/after, value readable AND DOM changed. A seed that reads back but
   renders nothing is still inert.
2. Check what turned green AND what turned red. This tier has a documented history of a "fix"
   converting a loud failure into a silent green. Report the `#populated` cell state BEFORE and
   AFTER for all four seeded apps and explain every change. A cell moving to
   `renders-empty-with-data` (D6 firing) is very likely CORRECT. Do not weaken the detector. A red
   that reveals a real app bug is a WIN and must be reported, not suppressed.
3. Do NOT regenerate `e2e-render-map-baseline.json`. A regeneration is owed on a POSIX host and is
   out of scope. Report the delta; do not bake it in.
4. Run the whole tier: `bun test compiler/tests/e2e-render-map/`. Report pass/fail and the expect()
   count.
5. Add a test that would have caught this: assert the seed is OBSERVABLE, not merely that a seed key
   exists on both sides. The existing both-directions seed test asserts only the bookkeeping — that
   is exactly how this shipped.
6. Prove the new test bites: break the fix, confirm red, restore, confirm green. State the mutation.

## Constraints

- Nav maps `.claude/maps/` are STALE (watermark `e74f5423`). Treat any map claim as a hypothesis.
- Windows clone, Git Bash. POSIX-vs-win32 separator leakage is a live hazard class in this tier.
- Only `compiler/tests/e2e-render-map/**` should need to change. Editing `compiler/src/` requires
  different authorization — stop and report instead.
- Never `git stash` (shared across worktrees on this clone); do base-vs-build flips by FILE COPY.
