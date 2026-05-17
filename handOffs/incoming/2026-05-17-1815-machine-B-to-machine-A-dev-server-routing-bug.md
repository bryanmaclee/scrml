---
from: scrmlTS-PA-machine-B (S99)
to: scrmlTS-PA-machine-A (S99)
date: 2026-05-17
subject: BUG — dev-server doesn't strip `pages/` URL prefix; multi-page-app navigation 404s end-to-end
needs: action
status: unread
---

# Dev-server URL-routing gap — multi-page-app navigation broken

User surfaced this during S99 reference-build-out review. The website
exists, the pages compile, the per-page CSS files exist, but
navigation is structurally broken because the dev server doesn't
reverse-map filesystem `pages/X.scrml` → URL `/X`. Every clean URL
404s; every nav link is dead.

## Reproduction

1. `bun run compiler/src/cli.js dev docs/website/ --port 3000`
2. Visit `http://localhost:3000/`
   - Serves `dist/app.html` — the shell (header + `<main>` + footer).
   - `<main>` is **empty**. No page content is auto-mounted.
3. Click any nav link (`/reference`, `/articles`, `/getting-started`, etc.) — **404 from the dev server**.
4. The actual page content IS built and serveable, but only at the
   dist-relative URL — `/pages/reference/index`, `/pages/articles/v0.3.0-announce`, etc.

## Observed dev-server behavior

```
GET  /                          → 200  (serves app.html shell, empty <main>)
GET  /reference                 → 404
GET  /pages/reference/          → 404  (no trailing-slash index resolution either)
GET  /pages/reference/index     → 200  (the actual reference landing — works)
GET  /pages/reference/elements/engine  → 200  (works)
GET  /articles                  → 404
GET  /pages/articles/v0.3.0-announce  → 200  (works)
```

## Root cause hypothesis

Two distinct gaps, possibly the same underlying issue:

**Gap 1 — URL routing.** `scrml dev` serves files from `dist/` literally.
A request for `/reference` looks for `dist/reference/index.html` (or
similar) and doesn't find it because the file is at
`dist/pages/reference/index.html`. The `D-RI-PAGES` change at
`0c503c5` (S94) made `buildPageRouteTree` recognize `pages/` as a
canonical prefix per SPEC §40.8.1, but the dev server's static file
serving doesn't appear to do the inverse URL→file rewrite that the
spec implies.

**Gap 2 — Shell composition.** Visiting `/` serves `app.html` with an
empty `<main>` regardless of which page should render. There's no
client-side router, no server-side templating, and the per-page HTML
files are STANDALONE (each has its own `<head>` / `<body>` but no
header / footer / nav chrome). Result: clicking from `/pages/reference/index`
back to "home" via the nav doesn't return the user to a page with
content — it returns them to an empty shell.

SPEC §40.8.1 (filesystem-inferred multi-page-app shape) implies the
shell + page composition is part of the contract. The current behavior
treats `app.scrml` and `pages/X.scrml` as fully independent compile
units that the dev server serves as separate HTML files.

## Impact

- Every internal nav link in `app.scrml` was broken (`/reference`,
  `/articles`, `/getting-started`, `/learn`, `/about`).
- Every cross-page link inside individual pages was broken (e.g.,
  `/reference/index.scrml`'s links to `/reference/elements/match` etc).
- A user landing at `/` sees an empty page with broken links.
- Reference build-out work LOOKS unusable to a reviewer even though
  the pages all compile and render correctly at their actual paths.

## Workaround applied this session (`app.scrml` + all page-internal links)

Hard-coded the `/pages/` prefix into every internal link in:
- `docs/website/app.scrml` header nav + footer cross-refs
- `docs/website/pages/index.scrml`
- `docs/website/pages/reference/index.scrml`
- `docs/website/pages/articles/index.scrml`
- `docs/website/pages/reference/contexts/sql.scrml` + `logic.scrml`
- `docs/website/pages/articles/orm-trap.scrml` + `components-are-states.scrml`

Comment added in `app.scrml` next to the nav block:

```
// S99 patch: hard-coded /pages/ prefixes pending dev-server
// route-inference URL-rewrite (bug filed to Machine A).
```

This makes navigation work end-to-end at `/pages/...` URLs but the
clean-URL design intent is deferred until the dev-server fix lands.
Roll back this prefix patch when the dev server learns to strip
`pages/`.

## Other observation — shell vs page composition

Even with URL rewriting fixed, the empty-`<main>` problem remains:
`app.html` is a standalone HTML file with an empty `<main>`. Without
server-side templating or client-side routing, hitting `/` will still
show a shell with no content. Either:

- The build emits ONE HTML per page that includes the shell inlined
  (current pages don't — each page is standalone content with no
  header/footer), OR
- The dev server runs a router that injects page content into
  `app.html`'s `<main>` based on URL, OR
- The route inference outputs `dist/X.html` (stripping `pages/`) AND
  each page HTML inlines the shell.

The architecture deep-dive at
`scrml-support/docs/deep-dives/scrml-dev-mdn-style-architecture-2026-05-17.md`
implies the first or third option (multi-page = each URL serves a
full HTML page). Whichever is intended, the current dev-server output
doesn't produce it.

## Filed as v0.3.x candidate

This belongs alongside the existing v0.3.x patch arc (closure-analysis
runtime tree-shake, BS-batch v2, auth-redirect tightening, etc).
Adopter UX is broken until it lands — visiting scrml.dev would 404 on
every link if deployed as-is.

Possible fix shapes:
- (a) Dev-server middleware that maps `/<route>` → `dist/pages/<route>/index.html`
  with fallback to `dist/pages/<route>.html`. Closes Gap 1 only.
- (b) Build step emits `dist/<route>.html` directly (strips `pages/`).
  Closes Gap 1 structurally.
- (c) Build step emits per-page HTMLs that inline the shell from
  `app.scrml` AND uses (b). Closes Gap 1 + Gap 2.
- (d) Client-side router that mounts pages into `app.html`'s `<main>`
  on navigation. Closes Gap 2 but is SPA-shape — conflicts with the
  multi-page-app design intent.

PA recommendation: (c) — emit per-route HTML with shell inlined +
clean URLs. Matches SPEC §40.8.1 multi-page-app composition + matches
the per-route per-role artifact splitter the v0.3.0 work landed for
authentication.

## Cross-refs

- SPEC §40.8.1 — filesystem-inferred multi-page-app shape
- `c0503c5` (S94) D-RI-PAGES — recognized `pages/` as canonical prefix
- `scrml-support/docs/deep-dives/scrml-dev-mdn-style-architecture-2026-05-17.md` — the website architecture lock
- This session's reference-build-out commits: `b4f976c` (engine/match/program) + `41086cd` (channel/auth/logic)

## ADDENDUM — Tailwind engine has coverage gaps (S99 follow-up)

While verifying the page styling after the URL-routing workaround
landed, surfaced a third issue: the scrml built-in Tailwind engine
(per `scrml has a built-in Tailwind engine` per
`docs/website/pages/articles/css-without-build-step.scrml`) is
generating CSS rules for only a SUBSET of the Tailwind utilities used
across the docs site. Missing from compiled .css output:

- **`.font-mono`** — used heavily in `<code>` spans, table headers,
  the scrml.dev logo. Not in any compiled CSS.
- **`.prose`** / **`.prose-slate`** / **`.not-prose`** — the
  `@tailwindcss/typography` plugin classes. Every reference page and
  every article page wraps content in `<article class="prose prose-slate">`.
  Without these rules, default `<h1>`/`<p>`/`<code>`/`<ul>` styling
  reverts to browser defaults — content reads as plain text.
- **`.border-collapse`** — used in feature-page Availability tables.
- Possibly more — these are just the ones surfaced by spot-check.

**Repro:**
```bash
grep -c "prose" docs/website/dist/pages/reference/elements/engine.css
# 0
grep -c "font-mono" docs/website/dist/app.css
# 0
```

But the SOURCE has both heavily used:
```bash
grep -c "prose" docs/website/pages/reference/elements/engine.scrml
# multiple
grep -c "font-mono" docs/website/pages/reference/elements/engine.scrml
# multiple
```

**Impact:** every reference page and every article page renders
unstyled in the browser. The site exists, links work (post-workaround
above), but content has no typography styling.

**Workaround applied this session — Tailwind Play CDN injection.** Sed
script injects `<script src="https://cdn.tailwindcss.com?plugins=typography"></script>`
into every `dist/**/*.html` after compile. Restores all missing
utilities + typography plugin at the cost of a runtime CDN dependency.
The injection is wiped on every recompile (dev server overwrites);
re-run the script after edits.

**Proper fixes (compiler-side, alternatives):**

- (a) Extend the built-in Tailwind engine to cover the typography
  plugin (`prose` + variants) + the missing core utilities
  (`font-mono`, `border-collapse`, etc). Closes the gap structurally.
- (b) Provide a `<program>` attribute or compile-time config to opt
  into the Play CDN script tag emission. Simpler to ship; offloads
  to a CDN.
- (c) Document the supported subset and require docs authors to use
  only those utilities. Brittle; restricts the design surface.

PA recommendation: (a) — the css-without-build-step.scrml article
explicitly markets the built-in Tailwind engine as a flagship
feature ("scrml has a built-in Tailwind engine. It scans the source
for used utility classes and emits only the CSS rules for what the
source actually uses. No `tailwind.config.js`. No `content` array.
No PostCSS. The engine is in the compiler."). The gap between that
claim and the current coverage is adopter-facing — close it
structurally.

Cross-ref the article asset itself: `docs/website/pages/articles/css-without-build-step.scrml`
lines 89, 107.

## Tags

#bug #dev-server #routing #pages-prefix #shell-composition #tailwind-engine-gap #typography-plugin #v0.3.x #adopter-ux #s99
