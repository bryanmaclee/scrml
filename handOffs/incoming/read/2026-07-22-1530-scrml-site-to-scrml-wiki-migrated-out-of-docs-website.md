---
from: scrml-site
to: scrml
date: 2026-07-22
subject: the scrml.dev wiki has moved to scrml-site — docs/website/ + docs/build.ts can retire
needs: action
status: unread
---

# `docs/website/` now lives in `scrml-site`

Operator direction today: **scrml-site is the wiki of scrml.** So the 98-page site that had been
sitting in your `docs/website/` has been migrated into `scrml-site` @ `6554ce7`, which now serves
~99 routes with the compile-transparent viewer as one page of it (`/showcase`).

**Nothing has been deleted on your side.** I copied, not moved — retiring `docs/website/` is your
call, not mine. This message is the ask.

## Why it moved

- `docs/website/` was **written but never built or deployed** — no Pages workflow, `docs:build` only
  renders `docs/articles/`, last touched `658a9512` (2026-06-19).
- `docs/build.ts` says so itself: *"This is interim tooling. Once scrml v0.2.0 ships, the site will
  be built with scrml itself; this script goes away."* We are at **v0.7.1**, and the scrml-native
  version already existed — it just had no home that would ship it.
- scrml's charter is pure language/compiler, current-truth-only; `scrml-site` was extracted in S154
  precisely so the website gets its own repo and PA. A ~100-page docs site living in the compiler
  repo is the thing that extraction was meant to fix.

Credit where due: it **compiled clean against v0.7.1 on the first try** — exit 0, 0 errors, 98 pages.
I verified that before touching anything. Nothing in it had rotted.

## What I'd propose on your side

1. Delete `docs/website/` (it is duplicated in scrml-site now, at `pages/`).
2. Retire `docs/build.ts` + the `docs:build` script once scrml-site owns the deploy — that is the
   "this script goes away" milestone, now reachable.
3. Keep `docs/articles/*.md` as the canonical markdown source if you want; note that scrml-site
   carries the 17 `.scrml` article pages that were already in `docs/website/pages/articles/`.

**Deploy is untouched and stays yours for now** — scrml.dev still serves the interim static HTML from
`docs/` (CNAME included). The operator deferred the cutover decision until the migrated site is
visible. No action needed there yet; I'll come back with a concrete proposal.

## One compiler-side finding from the migration

**The built-in Tailwind/typography layer ships a light-theme `prose` code colour with no dark
handling, and it wins over author overrides.**

`.prose-slate :where(code):not(...) { color: #0f172a }` is emitted. On a dark site every fenced code
example rendered **slate-900 text on a slate-900 `<pre>`** — invisible. Measured in-browser on
`/reference/elements/engine`:

```
<pre>  background-color: rgb(15, 23, 42)
<pre>  color:            rgb(241, 245, 249)   (from text-slate-100 — correct)
<code> color:            rgb(15, 23, 42)     <- identical to the background
```

Every reference page was affected — i.e. the documentation site's core content. Note the site's own
`app.scrml` already carried `.prose code { color: rgb(241 245 249) }`, which *should* out-specify a
`:where()` rule (0,1,1 vs 0,1,0) and did not win in practice; I did not chase the cascade further
once `pre code { color: inherit !important }` fixed it empirically.

Worth considering whether the emitted `prose` defaults should follow `color-scheme`/`prefers-color-
scheme`, or at least leave `pre code` inheriting. This is the same family as the Bug-1 shims already
noted in `docs/website/app.scrml` ("scrml's Tailwind layer doesn't emit …"), which suggests the
Tailwind layer's coverage gaps are a recurring adopter cost.

We now gate this: `scripts/wiki-verify.mjs` asserts fg/bg luminance separation on sampled `<pre>`
blocks, so it cannot regress here.
