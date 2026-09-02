# progress — s395-dev-root-auth-gate (rulings 2b + 2c step 1) — SECURITY

`prov=ruling:user-voice-scrml.md S395 — "your recs" adopting limb (b) + folding §52.13 into one arc`

Closes `g-dev-root-path-fallback-serves-a-protected-document-unauthenticated` (HIGH) and the
§52.13 case-variant divergence. **Dev-only.** `compiler/src/commands/build.js` untouched.

## READ THIS FIRST — state AS SHIPPED

This file is a running log across four review rounds. Sections below describe the state at the time
they were written and some were later superseded; superseded claims are marked in place. The
authoritative summary is here.

- The ungated root branch is **deleted**. `/`'s candidates go through the one gated loop.
- Protection is decided at **exactly one site**, on a candidate already resolved to a real file.
- There is **no** request-path pre-gate. An earlier revision had one; it was removed by ruling
  (see ARC SPLIT).
- `/SECURE.html` is **404 on a case-sensitive filesystem** — ruled, expected, fail-closed, nothing
  leaks. It is carried as **`test.failing`**, so the suite exits zero and it flips loudly if the
  behaviour ever changes. The **leak** half is a SEPARATE hard test that is never `.failing`.
- Only the `statSync` existence probe and the read/serve tail are inside catches; **`gateProtectedDoc`
  is outside both**, so a gate that throws is loud rather than a silent 404.
- `compiler/tests/commands/`: **256 pass / 0 fail**.
- Full suite: **30945 pass / 54 fail**; failure-set delta vs `origin/main` is **one removed, zero
  added** — the removed one being the §52.13 parity test that was silently red on `main`.
- Prod is **byte-identical**; `compiler/src/` diff vs `origin/main` is `dev.js` alone.

## What shipped

`compiler/src/commands/dev.js`

1. **The ungated root branch is deleted.** The `pathname === "/"` block that sat *after* the gated
   candidate loop and returned HTML from two paths (`resolveRootEntryCandidate`, sorted-`readdirSync`
   first-`.html`) is gone. Root resolution now contributes **candidates** to the one gated loop
   (`rootFallbackCandidates`), so there is exactly one place in dev that returns a document and it is
   gated. Ruling 2b.
2. `registeredProtectedDocs` is read in **exactly one function**, `gateProtectedDoc`, and protection
   is decided at **exactly one site** — on a candidate the loop has already resolved to a real file.
   Previously the read sites were `:1046`/`:1048` inline in the loop; a second serving path that did
   not know about them is what produced the leak.
3. Only the `statSync` existence probe is inside a swallowing `catch`. A wide `try` hid exceptions
   from `gateProtectedDoc`, turning a throwing auth guard into a silent 404.

   ⚑ An earlier revision of this branch ALSO gated the raw REQUESTED path before resolution
   (ruling 2c step 1). **That was removed** — see the ARC SPLIT section. Ruling 2c is its own arc now.

## ⚑ THE MEASUREMENT THE RULING OWED — and why literal deletion was NOT shipped

Measured with `devDispatch` driven exactly as the §52.13 test drives it. `GET /`, unauthenticated:

| scenario | dist `.html` | base | after |
|---|---|---|---|
| single-input `secure.scrml` (AUTH) | `secure.html` | **200, SECRET DASHBOARD in body** | **302 → /login** |
| single-input `secure.scrml`, `opts={}` | `secure.html` | **200, SECRET DASHBOARD in body** | **302 → /login** |
| single-input `index.scrml` (AUTH) — CONTROL | `index.html` | 302 → /login | 302 → /login |
| single-input `app.scrml` (public) | `app.html` | 200 "PUBLIC APP" | 200 "PUBLIC APP" |
| multi-input `alpha`+`beta` (public), no index | `alpha,beta` | 200 "ALPHA" | 200 "ALPHA" |
| multi-input `index`+`zeta` (public) | `index,zeta` | 200 "INDEX" | 200 "INDEX" |
| multi-input `alpha`(public)+`secure`(AUTH) | `alpha,secure` | 200 "ALPHA" | 200 "ALPHA" |
| multi-input `aaa`(AUTH)+`zzz`(public) | `aaa,zzz` | **200, SECRET DASHBOARD in body** | **302 → /login** |

**Across these eight scenarios, which file dev serves at `/` is unchanged for every unprotected
document; the only change is that a protected document now redirects instead of being served.**

⚑ **CORRECTED after review — I originally stated that as an unqualified claim over ALL unprotected
documents, and it was falsified.** These eight scenarios do not cover a registry key that outlives
its document, and the review found exactly that: with a stale auth-required `index.server.js` in dist
but no `index.html`, and a public `req.html` as the current entry, `GET /` went **302 on the first
fix where `main` serves 200 "PUBLIC APP"**. Fail-closed, never a leak, but a real behaviour
divergence I had reported as absent. Fixed in round 3 (the pre-gate now only answers for a document
still on disk) and covered by a regression test — but the lesson stands: the claim was broader than
the measurement that backed it.

**The fork the measurement exposed.** The ruling reads two ways, and the difference is *not* security
— both close the leak identically. It is only about what `/` does for a **public** document when
there is no `index.html`:

- **Literal deletion** — drop the root candidates entirely. `/` then 404s unless `index.html` exists,
  which is exact `/`-parity with prod (`build.js:523` normalizes `/` → `/index.html`, two candidates,
  else 404).
- **Shipped** — keep the candidates, move them inside the gated loop.

Literal deletion measured as breaking **more than multi-input**: `scrml dev app.scrml` → `GET /`
goes 200 → **404**, and `dev.js:1629` prints `http://localhost:<port>` and nothing else, so `/` is
the only URL dev hands the adopter. It would also strand `resolveRootEntryCandidate` as dead code
still covered by its own BUG-2 unit tests (`dev-hot-reload.test.js:421-457`), effectively reverting
`scrml-dev-watcher-and-stale-entry-2026-06-01`.

Per the brief's STOP clause that breakage was **not shipped**. The shipped shape still satisfies the
ruling's stated grounds: fork-rule **row 4** — the second *serving* path is removed, not taught the
gate a second time (net code paths 2 → 1); **row 2** — every path that RESOLVES a
serve-dir document passes `gateProtectedDoc` before returning it.

⚑ **NARROWED after review — the stronger phrasing I originally used ("fail-open is gone by
construction") is FALSE, and I verified that myself rather than taking it on report.** See the
new HIGH filed below: if a `.server.js` fails to import, its guard is never registered at all,
and the document is then served in full to an unauthenticated request. The arc establishes the
resolution-path invariant; it does not establish that the registry is correctly populated.

**Left open for the owner:** whether dev should additionally match prod at `/` by refusing to guess
an entry (the 404). That is a dev-UX ruling with no security content, and it is now a ~6-line change
(delete the `if (pathname === "/") candidates.push(...)` line and `rootFallbackCandidates`). Not
taken unilaterally.

## Verification

- **Phase 1 — two-sided leak control.** Proven by reverting `dev.js` to `origin/main` and re-running
  the new tests: entry `secure.scrml` `GET /` → `{status: 200, leaked: TRUE}` at base,
  `{status: 302, leaked: false}` fixed. Entry `index.scrml` CONTROL → 302 both.
- **Phase 2 — case variant.** ⚑ **SUPERSEDED — this describes the pre-gate, which was later
  REMOVED by ruling. As shipped, `/SECURE.html` is 404 on a case-sensitive FS and the §52.13
  assertion is RED, exactly as it is on `main`.** The original text follows for history.
  `/SECURE.html` 404 → **302**; `/secure.html` 302 → 302; neither leaks.
  The 404 was filesystem-decided: on a case-INSENSITIVE FS the OS resolves both names to the same
  document, so the same request had two answers depending on the host. Gating on the request path
  makes it FS-independent. This made a previously-RED assertion pass — the existing §52.13 test
  already asserted 302 for `/SECURE.html` and was failing on Linux, unnoticed because
  `compiler/tests/commands/` runs in no blocking job on any platform. **That assertion is RED again
  as shipped**; the discovery that it was silently red on `main` stands, the fix does not.
- **Phase 3 — coverage.** `/` is now probed for both entry-name shapes, both root-resolution paths
  (single-input entry candidate AND sorted readdir scan), plus a public document still 200s at `/`
  so "gate it" and "break it" cannot be confused. Adds a structural guard that
  `registeredProtectedDocs` is read only inside `gateProtectedDoc`.
- **Phase 5 — suite delta.** Full `bun run test` at base and at HEAD, same machine, same session:
  - base: 30934 pass / **55 fail** / 216 skip / 11 todo
  - HEAD: 30940 pass / **54 fail** / 216 skip / 11 todo
  - failure-set diff AT THAT TIME: one removed, zero added. ⚑ **SUPERSEDED — as shipped the delta
    vs base is ZERO in both directions** (the case-variant test is red on base and red here). The
    54 other failures are byte-identical between runs and pre-existing (they include three
    dev-server spawn/timing tests that fail at base too).
- **Prod unchanged.** `git diff origin/main..HEAD -- compiler/src/` touches only `dev.js`. The
  generated production entry for the same auth fixture was emitted at base and at HEAD and is
  **byte-identical**, with `_SCRML_PROTECTED_DOCS.get(rel.toLowerCase())` still present.

## FIX ROUND (S239 adversarial review — 5 findings, all LOW)

**MUST-FIX — the hollow assertion, and it was inside the security regression test.** `devProbe` read
the body only when `status === 200`, so `leaked` was hard-false for every redirect and every
`toEqual({ status: 302, leaked: false })` asserted only the status half. A regression that 302'd
while still carrying the rendered markup would have passed the entire new suite — the docstring
promised the opposite of what the code did. Body is now read unconditionally. The probe was shown to
have teeth (a 302 constructed with markup reports `leaked=true`; a real empty 302 reports false), and
all 12 tests still pass with the assertion made real — so the gate genuinely emits no body.

**MUST-FIX — finding 1, the over-claimed invariant.** Reproduced before touching it: on this
case-sensitive FS `/secure` → 302 but `/SECURE` → **404**, so "one request, one answer, on every
platform" was true only for the explicit `.html` form. **Made true rather than narrowed:** the
pre-gate now probes the same three name forms the static loop resolves (`rel`, `rel.html`,
`rel/index.html`). After: `/secure`, `/SECURE`, `/Secure`, `/secure/`, `//secure.html` all 302, none
leaking. New assertions cover it and were shown failing against the previous `dev.js`.

**Finding 3 — fixed, ordering untouched.** Candidates are now yielded by a `staticCandidates`
generator, so the synchronous `readdirSync` runs only after the first three candidates miss instead
of on every `GET /`. Ordering is byte-preserved: the full 9-scenario measurement is identical to the
table above, including the order-sensitive multi-input rows (`ALPHA`, `INDEX`).

**Suite after the fix round:** 30940 pass / 54 fail — failure set **identical to round 1**, and vs
base one removed / zero added AT THAT TIME (⚑ superseded — zero difference vs base as shipped).
Prod entry re-emitted and still **byte-identical**.

### Filed, not fixed
- **Finding 2** — the pre-gate creates a new divergence in the opposite direction: dev 302s
  `/SECURE.html` where prod 404s on a case-sensitive FS. Security-safe (dev is strictly stricter) but
  the "matches the production `_server.js`" comment is no longer literally true for the request-path
  gate, and parity is §52.13's whole rationale. **Widened by the finding-1 fix** — now also
  `/SECURE`, `/Secure`. The honest resolution is to make PROD filesystem-independent too, which is
  out of scope here.
- **Finding 5** — the loop's `catch { /* not found */ }` also swallows exceptions from
  `gateProtectedDoc`, so a throwing auth guard yields 500 for `/secure.html` (pre-gate, outside the
  try) but skip-and-continue → 404 for a resolution-only path. Consistency, not fail-open.

## FIX ROUND 2 (re-review — 4 findings; three were claims that did not hold)

**Finding 1 (MEDIUM-LOW) — the pre-gate answered for documents that may not exist, and it overrode a
resolution that would have served a different, PUBLIC document.** Reproduced two-sided before
touching it: stale auth-required `index.server.js` in dist, no `index.html`, public `req.html` as
current entry → `GET /` was **302** on the previous HEAD where `main` serves **200 "PUBLIC APP"**.
Contained by storing the real on-disk rel beside each guard and having the pre-gate answer only for a
document still on disk. Both properties now hold together: `/SECURE`, `/Secure`, `/secure/`,
`/SECURE.html` all 302, **and** the stale case serves the public document again. The falsified claim
above is corrected in place.

**Finding 2 (LOW) — my finding-3 fix did not do what its docstring said.** `rootFallbackCandidates`
computed the `readdirSync` scan before returning, so single-input dev still paid the blocking
directory read on every `GET /` — the exact case the docstring cited. It is a generator now and
yields the entry candidate *before* touching the directory. Ordering table re-verified byte-identical
against the reviewer-verified table.

**Finding 3 (LOW) — the structural guard could not fail for its own defect class.** Counting
registry READ sites cannot catch an ungated *serving* path: such a branch adds zero reads. Replaced
with the invariant that actually failed — `devDispatch` must contain exactly ONE document-serving
site (`injectHotReloadScript(`) and the gate must precede it. Verified it bites: against
`origin/main` it fails with **Received: 3** (the loop's site plus the deleted branch's two). The
read-site check is kept as a separate, narrowed test that states only the drift claim it really makes.

### Filed, not fixed
- **Finding 4** — the auth guard is invoked twice per authenticated protected-document request
  (pre-gate, then resolved gate), and under `csrf="auto"` each call does a session-store TTL refresh.
  Idempotent, so cost not corruption; the natural fix is memoising the guard result per request.
- **Finding 2 (round 1)** — dev is now stricter than prod on case variants (`/SECURE.html` 302s in
  dev, 404s in prod on a case-sensitive FS). Security-safe; the honest resolution is making prod
  FS-independent too, which is out of scope here.
- **Finding 5 (round 1)** — the loop's `catch { /* not found */ }` also swallows exceptions from
  `gateProtectedDoc`. Consistency, not fail-open.

**Verification after round 2:** commands suite **254 pass / 0 fail**; 9-scenario ordering table
byte-identical; two-sided leak control re-run fresh (base `{status: 200, leaked: TRUE}` → HEAD all 7
root tests pass); full suite 30942 pass / **54 fail**, failure set identical to rounds 1 and 2 and
one removed / zero added vs base AT THAT TIME (⚑ superseded — zero difference vs base as
shipped); prod entry re-emitted, **byte-identical**.

## ARC SPLIT (ruled by bryan, S395) — the request-path pre-gate is REMOVED

**The ruling.** Strip the pre-gate; keep the core. Ruling 2b took limb (b) on FORK RULE row 4
precisely because *"(b) removes a second code path, (a) would teach the same rule twice"* — and the
pre-gate was itself a second code path deciding protection. Three review rounds each found a new way
it disagreed with the resolution loop: answering for documents that do not exist; overriding a
resolution that would have served a different PUBLIC document; and ignoring candidate resolution
priority (public `foo.html` beside protected `foo/index.html`). Every fix converged the pre-gate
further toward *being* the resolution loop. That convergence is the signal it should not be a
separate decider.

**What changed.** The pre-gate is gone. Protection is decided at exactly ONE site — the resolved
gate inside the candidate loop, against a file already resolved on disk. `mustExistIn` and the
`{guard, rel}` registry value existed only to prop up the pre-gate and went with it, which also
resolves the stale-JSDoc finding: `registeredProtectedDocs` is a `Map<string, guard>` again, exactly
as its annotation says, with no annotation edit needed.

⚑ **`/SECURE.html` is RED again on this case-sensitive filesystem. That is ruled, expected, and
deliberate — it is declining an unruled fix, NOT a regression.** It is the same red the assertion has
on `main`. Protection is decided on the RESOLVED file, so a case variant finds no file here and 404s
(fail-closed — nothing leaks in any variant), while a case-insensitive host resolves it and 302s. The
real design question — gate on the REQUEST PATH (filesystem-independent, two deciders) or the
RESOLVED FILE (one decider, platform-dependent status) — is filed as its own arc. The assertion is
left intact and marked in the test as the split-out item: not re-fixed, not skipped, not weakened.

**The core is untouched and re-verified fresh:** the ungated root branch is still deleted, `/`'s
candidates still go through the gated loop, the lazy generator is intact.

- two-sided leak control, re-run: base `{status: 200, leaked: TRUE}` with `SECRET DASHBOARD` in the
  body → HEAD **302**, all 7 root tests pass
- **all 9 root-path rows byte-identical** to the reviewer-verified table (the only movement anywhere
  in the 9-scenario output is the `/SECURE.html` probe in S1/S2, i.e. the split-out item)
- stale-registry case still serves the public document (200 "PUBLIC APP"), now via the loop alone
- `compiler/tests/commands/`: **253 pass / 1 fail** — the fail being the ruled-red assertion
- prod entry re-emitted: **byte-identical**; `compiler/src/` diff vs `origin/main` is `dev.js` alone
- structural guard rewritten to scan MODULE-WIDE rather than `devDispatch`'s text, so extracting
  serving into a helper cannot make it vacuous; re-verified it still bites against `origin/main`
  (**expected 2, received 4**)

**Failure-set delta, stated explicitly:**
- **vs base: ZERO difference in either direction.** The full-suite failure set is now identical to
  `origin/main` (55 fail) — the §52.13 case-variant test fails on base and fails here, as it always
  did.
- **vs the previous round: exactly one newly failing test**, the §52.13 case-variant assertion.
  Nothing else moved.

## FIX ROUND 4 — the cry-wolf red, my own narrowing, and an unestablished precondition

**1 — the ruled-red test made the security suite unable to exit zero.** Splitting it out of the
parity test fixed the abort-cascade; it did not fix the signal. A real regression would have reported
"1 fail" and been indistinguishable at a glance from the known red — the §8 cry-wolf shape. Now
`test.failing`: green while knowingly red, and it reports *"marked as failing but it passed"* the
moment the behaviour changes, which is the signal the split-out arc will want.

⚑ **A hazard in that instruction, caught before shipping it.** `.failing` passes whenever the body
fails *for any reason*. Marking the whole test would have **masked a leak**: if `/SECURE.html` ever
returned the markup, `leaked` would flip true, the test would fail, and `.failing` would swallow it
as expected. So the file now carries **two** tests — a HARD one asserting the case variant never
leaks whatever status it answers with (never `.failing`), and the `.failing` one carrying only the
unruled STATUS. Verified `.failing` semantics empirically first rather than assuming them.

**2 — restoring IO tolerance after my own narrowing.** Narrowing the `try` to `statSync` also moved
`file.text()`, `devCacheHeaders` and the `Response` construction outside any catch. `scrml dev`
rewrites `dist/` on every recompile while requests are in flight, so a candidate unlinked between the
probe and the read would **reject out of `devDispatch`**, breaking the "always returns a Response"
invariant that an author `handle()` onion calling `resolve(request)` depends on. The read/serve tail
has its own catch again; `gateProtectedDoc` stays outside both, preserving the stated intent that a
failing gate must be loud. Probed deterministically with a chmod-000 candidate (skips as root), and
the probe was verified to FAIL against the previous commit.

**3 — `devProbe` claimed a precondition it did not establish.** Its docstring said it loads the
compiled routes; it only called `devDispatch`. `registeredProtectedDocs` is module-global and reset
only inside `loadServerRoutes`, so **two tests in this file were passing off the previous test's
registry** — the exact "passes for the wrong reason via a stale guard" failure, in a suite whose job
is proving a gate fires. `devProbe` now loads its own dist's routes, so the docstring is true by
construction; six redundant caller-side loads removed.

**Also confirmed this round:** stripping the pre-gate **closed** a dev/prod divergence rather than
opening one — dev and prod now key the gate identically on `relative(<serveDir>, candidate)`
lowercased (`build.js` `_SCRML_PROTECTED_DOCS.get(rel.toLowerCase())`).

## FILED — NEW HIGH (pre-existing, NOT introduced by this arc)

**`loadServerRoutes` drops an auth guard when a module fails to import, and the protected document
is then served in full, unauthenticated.** `compiler/src/commands/dev.js:344` catches an `import()`
failure, logs it, and `continue`s — so a `.server.js` that throws on load never registers its
`_scrml_protected_document`, the registry stays empty for that document, and the one gate has
nothing to match.

**Reproduced independently here, not taken on report** (appended `throw` in the emitted
`secure.server.js`): `GET /secure.html` → **200 with `SECRET DASHBOARD` in the body**, and `GET /`
→ **200, leaked** as well.

**Pre-existing:** the `catch` is byte-identical on `origin/main`, so this arc neither introduced nor
widened it, and it does not block this landing. It does **falsify the arc's original invariant
phrasing**, which is why that phrasing is narrowed above: the arc establishes that every path which
RESOLVES a serve-dir document passes the gate — not that the registry is correctly populated.

**Fix direction for whoever takes it:** a module-load failure must be fail-CLOSED. Serve the
compile-failure channel (dev already has one — the in-memory error page at `dev.js:873`) or a 500,
never the protected markup. A dev server that cannot load a route's module does not know whether that
document is protected, and "unknown" must not resolve to "public".

## Durable lesson from this arc

**A claim written mid-arc needs re-reading at the end.** Three separate artifacts in this branch —
`progress.md`, a `dev.js` comment, and a test's own header comment — ended up asserting behaviour
that had since been removed or coverage that was not running. None were careless at the time; each
was true when written, and the code moved underneath them. Two of the three I found and fixed myself
earlier in this same arc, which is the point: the failure mode is not inattention, it is that
*claims outlive the code they describe*. The mitigation is a final pass that re-reads every claim
against the shipped diff rather than against memory of it.

The specific sharpest instances, both from a knowingly-red assertion:

1. Placed FIRST in a `test()`, it silently killed the four assertions after it, because `bun test`
   aborts a test at the first failed `expect()`. **A knowingly-red assertion must live in its own
   `test()`** — otherwise it converts every assertion after it into dead code that still reads as
   coverage.
2. Marked `.failing` while still carrying a security assertion, it would have **masked a leak** —
   `.failing` swallows a failure whatever caused it. **Split the invariant that must never break
   away from the behaviour that is knowingly unruled**, and mark only the latter.

The general form of both: a mechanism that makes a red acceptable also makes a red *invisible*.
Every time you suppress a signal, check what else was riding on it.

## Not done here

- `docs/known-gaps.md` not edited — PA-owned shared doc. The gap entry and its `@gap` marker still
  say `status=open` and need PA closure.
