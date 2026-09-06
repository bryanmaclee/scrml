# peter (S400) → bryan — prod-404 fork made TURNKEY: the auth-gate worry is measured away

**Supersedes nothing — augments** `2026-09-03-from-peter-to-bryan-prod-server-404s-non-index-spa-at-root.md`
(S398 filing) and the ledger entry `g-prod-server-404s-non-index-spa-entry-at-root` (HIGH, open).
This note does the pre-work short of your ruling: re-verified on **current HEAD `8f459481`** (the S398
filing was on `c91969c7`), and — the load-bearing part — **resolved the auth-gate interaction by
measurement**, which was the one thing that could have made your ruling costly. It doesn't.

## 1. Re-confirmed on HEAD `8f459481` — three-way runtime proof (fresh `bun _server.js`, real `fetch`)
| Build | `GET /` | `GET /<entry>` | Note |
|---|---|---|---|
| `app.scrml` → `app.html` | **404** `Not found` | `/app` → **200** `[ROOT MARKER]` | app dead at its own root |
| `index.scrml` → `index.html` (CONTROL) | **200** `[ROOT MARKER]` | — | defect is entirely the name mismatch |
| `secure.scrml` (`auth="required"`) | **404** `Not found` | `/secure.html` → **302 →/login** | auth-safe, but *by serving nothing* |

Locus unchanged on HEAD — `compiler/src/commands/build.js:523`:
```js
dispatchBody.push('  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;');
// candidates = [ /index.html , /index.html.html ] — neither exists for a non-index entry, no fallback
```

## 2. ⭐ THE AUTH-GATE INTERACTION IS RESOLVED (this is the new turnkey content)
The S398 filing said fork (b) "**must carry the auth gate** or it reopens the auth hole on the prod
side." **Measured on the emitted auth build — it does not have to. The gate is already there, and it
is upstream of file resolution.** In the auth `_server.js` the protected-doc check sits **inside** the
candidate loop, keyed on the *resolved* path (`app/secure.scrml` auth build, emitted verbatim):
```js
const pathname = url.pathname === "/" ? "/index.html" : url.pathname;   // :523 fold
const candidates = [ join(SERVE_DIR, pathname), join(SERVE_DIR, `${pathname}.html`) ];
for (const candidate of candidates) {
  const st = statSync(candidate); if (!st.isFile()) continue;
  const rel = relative(SERVE_DIR, candidate)…;
  const _scrml_doc_guard = _SCRML_PROTECTED_DOCS.get(rel.toLowerCase());   // ← gate, IN the loop
  if (_scrml_doc_guard) { /* 302 → loginRedirect */ }
  …serve…
}
return new Response("Not found", { status: 404 });
```
**Consequence for your ruling:** whatever candidate the `/` fold resolves to flows through
`_SCRML_PROTECTED_DOCS` in the same loop. So if fork (b) makes `/` resolve to the real entry
(`app.html`) instead of hardcoded `/index.html`, a *protected* root SPA is gated **by construction** —
it would 302, not leak. **Prod has no ungated post-loop branch.** That is the structural difference
from the dev leak (`g-dev-root-path-fallback-serves-a-protected-document-unauthenticated`, HIGH, open):
dev's leak is an **additional ungated branch AFTER the loop** (`dev.js:1091-1122`,
`resolveRootEntryCandidate` + `readdirSync` first-`.html`, neither consulting `registeredProtectedDocs`).
Prod never had that branch — its only `/` handling is the in-loop fold. **So "the two are best ruled
together" (S398) is still true for the DESIGN model, but the prod fix does NOT inherit dev's leak risk.**

## 3. The three forks, each with exact locus + pattern + test-sketch (turnkey for dispatch)
The build already interpolates emit-time values into `dispatchBody` (see the protected-docs map at
`build.js:395`), so it *can* bake the entry name — the emitted server currently carries no entry
constant, which is the only reason the fold is hardcoded.

- **(a) emit the single-file SPA entry as `index.html`.** Locus: the emit naming that derives
  `<base>.html` from the entry (`build.js:246` derives html names from `.server.js`; the single-file
  entry html is named beside it). Pattern: for the single-inferred-route case, write the entry doc as
  `index.html`. *Smallest, by-construction* for `/`. **Cost:** changes the emitted filename → every
  `<link>`/`<script src>` in the doc and any manifest that names `app.html` must be re-pointed
  (manifest/link check owed); narrower — fixes only the single-file case, not non-index roots generally.
  Test-sketch: build `app.scrml`; assert `dist/index.html` exists and `GET /` → 200.
- **(b) resolve `/` to the actual entry through the existing gated loop.** Locus: `build.js:523`.
  Pattern: bake the resolved entry html name (call it `ROOT_ENTRY_HTML`) at emit and fold
  `url.pathname === "/" ? ROOT_ENTRY_HTML : url.pathname`, OR mirror dev's bounded
  `resolveRootEntryCandidate` as an appended candidate. Either way the candidate still passes through
  the `_SCRML_PROTECTED_DOCS` check at the loop (§2) → **auth-safe by construction, no new gate**.
  *Unifies dev+prod on one resolution model; closes the functional break for all non-index roots.*
  Test-sketch: the §2 three-way table as an integration test — `app.scrml` `/`→200; `secure.scrml`
  `/`→302 (NOT 200 — the leak-guard limb); `index.scrml` `/`→200 unchanged.
- **(c) build-time diagnostic** when the inferred `/` route has no document that `/` will resolve to.
  Locus: the single-route inference path in `build.js` (post-emit, where the html set is known).
  Cheap, **complementary not exclusive** — ships alongside (a) or (b) as a guard. Test-sketch: build
  `app.scrml` with no fix; assert a `W-…`/`E-…` names the unreachable `/`.

## 4. PA-lean (yours to rule — this is a recommendation, not a decision)
The S398 lean was "(a) for the functional break, keep (b)/the-gate as the convergence." **With the
auth cost now measured away, the lean shifts to (b) as the convergence answer** — it closes the
functional break for *all* non-index roots, unifies dev and prod on one resolution model, and (§2) is
auth-safe without a new gate, at the cost of baking the entry name — with **(c) as a cheap
complementary guard**. **(a)** remains the minimal-but-narrower option if you want the smallest possible
diff and accept the filename-rename + manifest check. **I did not build any of it — normative fork on
your dev/build-server surface, the #823 sibling.** Ping if you want the §2/§3 repros as conformance
cases.

Repro (this machine): `…/scratchpad/p404/{appspa,idxspa,authspa}` + `probe.mjs`/`probe2.mjs`
(three-way runtime, re-runnable). — peter, S400
