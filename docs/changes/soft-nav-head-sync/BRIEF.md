# BRIEF — soft-nav-head-sync (S350-bryan, 2026-08-19)

Base `origin/main` `e305216d`. **Client-runtime change. DO NOT LAND** — the PA runs a mandatory
S239 adversarial pass first.

## Why — PA-VERIFIED IN OUR OWN SOURCE AT HEAD, reported by scrml-site

scrml.dev — the language's own documentation site — has been broken on **every in-site click** and
is currently running a workaround. Two defects, both confirmed by the PA reading `main`:

### D1 (HIGH) — soft nav never swaps the page stylesheet

`compiler/src/runtime-template.js` → `_scrml_nav_sync_head(doc)` reconciles exactly three head
nodes: `<title>`, `meta[name="description"]`, `link[rel="canonical"]`. Its own comment admits the
gap (*"Fuller head-diffing (arbitrary meta/link/preload) is a noted follow-on"*).
**`<link rel="stylesheet">` is never touched.** `_scrml_nav_apply_html()` then swaps the outlet and
rehydrates, so the outgoing page's sheet stays attached and the incoming page's is never fetched.

**Why HIGH: the compiler emits ONE STYLESHEET PER PAGE** (that page's Tailwind utility subset,
11-12 KB each on scrml.dev). The destination therefore arrives with none of the utilities its markup
needs — an unstyled document, not a degraded one. Reporter measured **7 of 7 navigations** stale on
the live site. A hard reload always works, which is why users report it as intermittent.

### D2 (MED) — a redirecting soft nav burns two history entries

`_scrml_navigate_soft()` calls `history.pushState` (`:2713`, `:2724`) **before** fetching; `:2752`
then does `if (!res.ok || res.redirected) { _scrml_navigate(res.url || path); return null; }` and
hard-navigates, orphaning the pushed entry — it names a URL whose document was never loaded, so the
first Back appears to do nothing. Measured `history.length` **5 → 7 on one click**. Triggered by any
directory index without a trailing slash on static hosting (`/reference`, `/learn`, `/about`).

## The fix shape — the reporter's, and the PA judges it sound

**D1, and step 1 is the part most likely to be got wrong:**

1. **Resolve the fetched document's stylesheet hrefs against the TARGET url.** They are emitted
   **relative and at differing depth** — `/` ships `app.<hash>.css`, `/reference/` ships
   `../app.<hash>.css`, `/reference/elements/auth` ships `../../app.<hash>.css`. **A naive attribute
   copy resolves against the wrong base and silently 404s.** The reporter said explicitly this is why
   they could not shim it from their side.
2. **Append any sheet not already present, and AWAIT its `load` event BEFORE swapping the outlet** —
   otherwise the swap flashes unstyled content, trading one visible defect for another.
3. **Remove sheets the new document does not reference — AFTER the swap**, not before.

**D2:** push **after** the fetch resolves, or `replaceState` the redirect target onto the entry
already pushed. Either is acceptable; state which you chose and why.

## ⚑ THE CONSTRAINT THE BRIEF EXISTS TO CARRY — the core runtime is on a size knife-edge

`g-spa-runtime-gzip-budget-knife-edge` (**HIGH, open**) records a **16 KB gzip budget** on the SPA
core runtime that has previously been within ~185 bytes of its ceiling, and it carries an
**UNRESOLVED operator fork**: (a) hold 16 KB and require every future core addition to be offset, or
(b) raise the budget. **That fork is not yours to resolve and not the PA's.**

`runtime-template.js` IS that core. **The PA grepped and found NO automated gate enforcing the
budget** — so nothing will go red if you spend the headroom, which is exactly why this is in the
brief instead of in CI.

**You SHALL measure and report the gzip delta your change adds to the core runtime** (before vs
after, same measurement both sides). If it is large enough to matter, say so and propose the shape
that would keep it out of the always-shipped core — a gated chunk is the precedent (`ifmount`, #301).
Do not silently consume the headroom, and do not resolve the fork.

## Verification you owe

1. `bun install` + `bun run pretest` at startup (a fresh worktree inherits neither).
2. **EXECUTE, DO NOT GREP — this is CLIENT RUNTIME and that distinction has burned this project.**
   At S265 a theme-switch feature was verified by finding its marker in the emitted output and was
   **dead on arrival** from a load-time `ReferenceError`. Emitted text proves nothing here. Drive a
   real navigation and assert **what the reader sees**: that the destination page's stylesheet is
   attached AND applied after an in-site click.
3. **Browser-tier discipline** (this project's rules, learned the hard way): recompile the
   `samples/compilation-tests/dist/` fixtures FIRST — they go stale and produce phantom failures —
   and compare the **WHOLE SUITE**, never isolated files, because happy-dom leaks global state
   between files. Use `bun run test` (chains pretest), never bare `bun test`.
4. Full suite + conformance, with before/after counts from the same worktree.

## ⚑ THE REPORTER'S GATE LESSON — do not repeat it in your own tests

Their `wiki-verify` asserted that a `window` stamp **survived** an in-site click — i.e. that soft
navigation *happened* — and never asserted what the reader then saw. **It was validating the exact
mechanism that was breaking the page, and reported 6/6 green while the showcase page collapsed to
unstyled text.** Their conclusion: ***"gate the artifact, not the dev server."***

So: **your tests SHALL be outcome-shaped, not mechanism-shaped.** Assert the stylesheet is applied
after navigation. Do NOT assert that `_scrml_nav_sync_head` was called, that a link node exists in
the head, or that a marker is present — every one of those goes green on a broken page.

## Out of scope — do NOT touch

- The `<outlet/>` behaviour the reporter also mentions (removing `<outlet/>` makes `<main>` the route
  slot and discards `<main>`'s authored children). **PA has NOT reproduced it**; it is a separate
  defect and not part of this arc.
- `docs/known-gaps.md` — PA-owned, already modified on another branch.
- The egress / `protect=` surface — a separate held stack.

## Standing rules

- **NEVER `--no-verify`. NEVER override `core.hooksPath`.** Batch commits to live with the gate. If
  you think a bypass is required: STOP and report.
- Commit after each meaningful unit; append to `docs/changes/soft-nav-head-sync/progress.md`
  (append-only, timestamped). Your branch + that file are your only crash anchors.
- Every locus above is **PA-located-verify**: the PA read these functions and reproduced the symptom
  from the report, but did not trace execution end-to-end. If a locus is wrong or incomplete, say so.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first; follow its Task-Shape Routing. Watermark `c93a692c` vs
HEAD `e305216d` — treat map content as a verify-against-source hypothesis and report whether it was
load-bearing ("not load-bearing" is a valid answer).

## Who is waiting

scrml.dev is live with `hard` (§20.8.3) forced onto **all 551 internal `<a>`**, opting every link out
of soft nav, purely to work around D1. They committed to reverting the sweep the day this lands. So
the fix must work on **their** shape — a multi-page site with per-page stylesheets at varying URL
depth — not only on a synthetic two-page fixture.
