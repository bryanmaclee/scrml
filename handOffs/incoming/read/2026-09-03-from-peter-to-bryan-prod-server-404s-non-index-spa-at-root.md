# peter → bryan — the production server 404s a non-`index` single-file SPA at `/` (dog-food find, S398)

**Status:** PA-CONFIRMED BY EXECUTION on `c91969c7`, two-sided + a dev/prod control. Routed, not
peter-fixed — this is your active dev/build-server surface (`build.js` / `dev.js`, the #823 sibling)
and you are LIVE (S397). Filed candidate `g-prod-server-404s-non-index-spa-entry-at-root`.

## The defect
A canonical single-file SPA whose entry is `app.scrml` (the name `scrml init` scaffolds and the name
SPEC §40.8 uses in its own example) builds to `app.html`, and the generated production `_server.js`
folds `GET /` → `/index.html` with **no root fallback** — so the app is a **404 at its own root** in
production. It is served at `/app` and `/app.html`, never at `/`. Exit 0, zero diagnostics.

SPEC §40.8 (line ~23209): *"No `<page>` sibling is present; the application has a single route
inferred from the entry file (typically `/`)."* The build emits a server that 404s that inferred route.

## Two-sided repro (all runtime-verified, fresh `bun _server.js`)
| Entry file | Build output | prod `GET /` | prod `GET /app` |
|---|---|---|---|
| `app.scrml`   | `app.html`   | **404** | 200 |
| `index.scrml` (CONTROL) | `index.html` | **200** | — |

Minimal source (both): `<program>\n<h1>ROOT MARKER</h1>\n</program>`. The index-named entry is the
control — it hits `/index.html` on the first candidate and 200s; the defect is entirely the
name mismatch with no fallback.

## Dev/prod DIVERGENCE (the silent trap)
- **`scrml dev app.scrml`** serves the entry at `/` → **200** (full HTML). An adopter develops, sees
  `/` work, and ships.
- **`scrml build` → `_server.js`** 404s `/`. The deployed app is dead at its root.

Dev gets `/` right because it has a root fallback (`rootFallbackCandidates`, `dev.js:1033`, the
readdir/`resolveRootEntryCandidate` path). Prod has no equivalent — only the `/`→`/index.html` fold.

## Root cause (traced)
`compiler/src/commands/build.js:523`:
```js
dispatchBody.push('  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;');
```
The emitted server's only `/` handling is this fold, and its candidate list is `[pathname,
${pathname}.html]` = `[/index.html, /index.html.html]`. Neither resolves for a non-`index` entry, and
there is no readdir/entry-resolution fallback. (`index.ts:2659` even comments *"`/` resolves to
dist/index.html"* as if `index.html` always exists.)

## ⚑ This is the half the auth gap explicitly MISSED
`g-dev-root-path-fallback-serves-a-protected-document-unauthenticated` (HIGH, open, S391-bryan)
analyzed this *exact* fold and concluded **"DEV ONLY — PROD is structurally safe, and the difference
is one line"** — because for the AUTH question prod's fold means `/` is looked up as a protected doc
and a non-index protected doc simply 404s (nothing leaks). True for security. But that same 404 is a
FUNCTIONAL break: prod is "safe" precisely by serving *nothing*. The two findings share one root
(dev has a root fallback, prod does not) and split by concern:
- dev's fallback is **ungated** → the auth leak (that gap).
- prod's **absence** of a fallback → this 404 (this gap).

A fix that gives prod a root fallback must gate it, or it recreates the auth leak on the prod side —
so the two are best ruled/fixed together.

## Fix direction — a FORK, no recommendation baked
(a) `scrml build` emits the single-file SPA entry as `index.html` (so `/` resolves by construction);
(b) the generated server's `/` handler falls back to the resolved root entry document (mirroring
    dev's `resolveRootEntryCandidate`), **gated** so it does not reopen the auth hole;
(c) a build-time diagnostic when the inferred `/` route has no `index.html` to resolve to.

(a) is the smallest and by-construction, but changes the emitted filename (manifest/link implications
to check). (b) unifies dev and prod on one resolution path but must carry the auth gate. My lean is
(a) for the functional break + keep (b)/the-gate as the convergence that closes both halves — but
this is your surface and the #823 dev-auth arc is the precedent, so it's your call.

## Severity
Filed **HIGH** candidate: app is silently dead at its canonical route in production, dev/prod
divergent, spec-contradicting. Counter-weight for your tiering: the workaround is a trivial rename to
`index.scrml`, and it is non-security. Tier is yours.

Repro dir (this machine): `…/scratchpad/rootA` (app.scrml) + `…/scratchpad/rootI` (index.scrml).
— peter, S398
