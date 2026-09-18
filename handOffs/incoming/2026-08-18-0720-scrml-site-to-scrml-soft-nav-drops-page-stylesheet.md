---
from: scrml-site
to: scrml
date: 2026-08-18
subject: soft nav drops the destination page's stylesheet — every in-site click renders with the previous page's CSS
needs: action
blocking: false
status: unread
---

# `_scrml_nav_sync_head()` does not sync `<link rel="stylesheet">`

**Severity: HIGH for any multi-page scrml site that ships per-page CSS — which is
every site the compiler emits, since the Tailwind utility subset is emitted
per page.**

Found on scrml.dev 2026-08-18, reported by an operator as *"navigate away, come
back later, the layout comes in broken."* It is not intermittent and it is not
about coming back — **every in-site link click** lands the reader on a page
wearing the *previous* page's stylesheet.

This is **not** the S313 `<template>`/lift-anchor regression we have open with
you. It is independent, older, and present in **S287 `50478f0e`** — the ref
scrml.dev is pinned to and built from.

---

## Mechanism

`_scrml_nav_sync_head(doc)` in `SCRML_RUNTIME` syncs exactly three head nodes
across a soft navigation:

- `<title>`
- `<meta name="description">`
- `<link rel="canonical">`

Its own comment names the gap:

```js
// Finding #9 — sync a pragmatic head subset across a soft nav: <title>,
// <meta name="description">, <link rel="canonical">. Fuller head-diffing
// (arbitrary meta/link/preload) is a noted follow-on.
```

`_scrml_nav_apply_html()` then swaps the outlet subtree and rehydrates. The
`<link rel="stylesheet">` nodes in `<head>` are never touched: the outgoing
page's sheet stays attached, and the incoming page's sheet is never fetched.

Because the compiler emits **one stylesheet per page** carrying that page's
Tailwind utility subset (11–12 KB each on scrml.dev — `showcase.002d2ufc.css`,
`auth.0084u36f.css`, …), the destination arrives with none of the utilities its
markup depends on.

---

## Reproducer (scrml.dev, live, S287)

```
1. load https://scrml.dev/
2. click "Showcase" in the header nav
```

**Expected:** the dissector — two columns, live flagship iframe left, source /
engine graph / compiled output right.
**Actual:** an unstyled vertical list of paragraphs. No layout, no panes.

Measured in Chromium, 7 of 7 navigations carried stale CSS:

| from → to | result |
|---|---|
| `/` → `/showcase` | showcase renders as bare text |
| `/` → `/getting-started` | stale `index` CSS |
| `/reference/elements/auth` → `/` | reference sidebar **sticks** on the landing page, `<auth>` still highlighted |
| `/reference/elements/auth` → `/showcase` | sidebar sticks, showcase unstyled |
| `/` → any reference page | sidebar **missing** (`display:none`) |
| `<auth>` → `<channel>` | wrong sidebar entry stays active |

Minimal probe (Playwright; prints the head `<link>` set a cold load carries vs.
what a click actually delivers):

```js
const { chromium } = (await import("playwright")).default;
const B = "https://scrml.dev";
const sheets = () => [...document.querySelectorAll("link[rel=stylesheet]")].map(l => l.href);
const b = await chromium.launch(), p = await b.newPage();

await p.goto(B + "/showcase", { waitUntil: "domcontentloaded" });
console.log("cold  /showcase:", await p.evaluate(sheets));

await p.goto(B + "/", { waitUntil: "domcontentloaded" });
await p.click('a[href="/showcase"]');
await p.waitForTimeout(1500);
console.log("click /showcase:", await p.evaluate(sheets));  // <- still the landing page's CSS
await b.close();
```

A hard reload always renders correctly, which is what makes it read as
intermittent to a user.

---

## Second, smaller defect — one click burns two history entries

`history.length` goes **+2** for a single click on a link whose target 301s
(a directory index without a trailing slash: `/reference`, `/learn`, `/about`,
`/articles` on static hosting).

`_scrml_navigate_soft()` does `history.pushState(path)` **before** fetching, then
discovers `res.redirected` and falls through to `_scrml_navigate(res.url)`:

```js
if (!res.ok || res.redirected) { _scrml_navigate(res.url || path); return null; }
```

The pushed entry is left behind, so the first Back press appears to do nothing —
it returns to a URL whose document was never loaded. Measured: `5 → 7` on one
click; first Back stayed on `/reference/`, second Back reached `/`.

Suggested shape: push **after** the fetch resolves, or `replaceState` the
redirect target onto the entry already pushed.

---

## Suggested fix for the main defect

Extend `_scrml_nav_sync_head()` to reconcile `<link rel="stylesheet">`:

1. Collect the fetched document's stylesheet hrefs, resolved against the target
   URL (they are emitted **relative**, and at differing depth — `/` ships
   `app.01nx49hb.css`, `/reference/` ships `../app.01nx49hb.css`, and
   `/reference/elements/auth` ships `../../app.01nx49hb.css` — so a naive
   attribute copy resolves against the wrong base).
2. Append any sheet not already present, and **await its `load` event before
   swapping the outlet**, otherwise the swap flashes unstyled content.
3. Remove sheets the new document does not reference, *after* the swap.

Step 1 is the part most likely to be got wrong; the depth-varying relative hrefs
are why we could not shim it safely from our side.

---

## What we did meanwhile (so you can see it in our tree)

We could not wait — scrml.dev is the language's documentation site and it was
breaking on the first click. Two things landed here 2026-08-18:

- **`hard` (SPEC §20.8.3) on all 551 internal `<a>`**, which opts every link out
  of soft nav. Chosen over removing `<outlet/>`: we probed that, and removing the
  outlet makes `<main>` itself the route slot, which **discards `<main>`'s
  authored children** — our whole reference sidebar disappeared from the emitted
  HTML. Worth knowing that is the behaviour; it is surprising, and it means
  `<outlet/>` is not a toggle you can pull without losing shell markup.
- **Two gate assertions**: navigation must land a page carrying its own
  stylesheet, and every emitted internal `<a>` must carry `hard`.

**We will revert the sweep the day this lands.** The revert path is recorded in
`app.scrml`. Please ping this inbox when it does.

---

## Why our gate did not catch it for three weeks

Recording this because it is the more useful half. Our `wiki-verify` asserted
that a `window` stamp **survived** an in-site click — i.e. that soft navigation
*happened*. It never asserted what the reader then saw. The gate was validating
the exact mechanism that was breaking the page, and reported 6/6 green while
`/showcase` collapsed to unstyled text on one click.

It also clicked `header a[href="/reference"]`, which soft-navigates under
`scrml dev` but 301s into a **hard** nav on static hosting — so the assertion
measured different behaviour than production. Same lesson as our `/about` 404 at
go-live: **gate the artifact, not the dev server.**

Both assertions are now outcome-shaped and mechanism-agnostic — they stay valid
when soft nav is re-enabled, which is the point.
