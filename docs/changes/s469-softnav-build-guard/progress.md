# s469-softnav-build-guard — progress

Closes `g-soft-nav-cross-build-handler-id-collision-s469` (HIGH, security limb S435). SPEC §20.8.2 step 0.

## Log
- Branch cut from origin/main `0ff6c93aa`; merged origin/s469-browser-suite-health (#1511, queued; fast-forward to `cd040ea25`) early for its harness repairs. Merge origin/main again once #1511 lands.
- Attack reproduced RED on base (`browser-navigate-cross-build.test.js`: `deleted` 1 → 2 on a click on B's "Add row").
- Commits: fix (runtime + codegen + tooling folds) · ratchet raise (isolated, ruling owed) · tests/harnesses · security pack n23 · SPEC · gaps/docs.

## Design
- **Identity source.** No existing per-build token existed (the runtime filename hash covers the runtime only; chunk tokens are per source path and identical across builds). New `compiler/src/codegen/build-identity.ts`: fnv1a (the §47 content-address primitive) over the runtime + every client chunk, sorted, with the placeholder still in place; substituted once in `runCG` after the runtime post-pass and before the per-route splitter. Markup and CSS are NOT hashed (ids resolve through the chunk tables, so byte-identical client code cannot mis-resolve markup; also keeps markup-only changes from re-keying chunks). Deterministic: two builds of the same sources (same project-relative layout) are byte-identical, identity included.
- **Where emitted.** `<html lang="en" data-scrml-build="ID">` on every page (composed route pages inherit it; SSR reads the static file). Classic chunks: `if (typeof _scrml_build_admit === "function" && !_scrml_build_admit("ID")) return;` as the chunk scope's first statement. esm chunks: a plain `_scrml_build_admit("ID");` (no function body to return from).
- **Where checked.** `_scrml_nav_apply_html`, right after DOMParser and before seed / head / chunk load / swap: missing or different identity, or a document that already refused a chunk → `_scrml_navigate(path)` (hard nav, `W-NAV-BUILD-MISMATCH`). `_scrml_nav_load_chunks` onload: a chunk that refused (`_scrml_build_rejected`) → `W-NAV-CHUNK-LOAD-FAILED` reason "build mismatch" → hard nav (the mid-deploy race: page A fetched, chunk URL now serves B). All three nav entry points (navigate(), link-boost, popstate) go through this path.
- **Handler-resolution hardening (defence in depth).** Option chosen: region ownership by build stamp. Each delegated listener starts `if (!_scrml_build_owns(event.target, "ID")) return;`, each `_scrml_nav_rewire` starts `if (!_scrml_build_owns(_scrml_root, "ID")) return;`, `_scrml_rehydrate_region` refuses a foreign region; the swap stamps the outlet with the fetched page's identity. Unstamped trees (host pages embedding a program, test harnesses) belong to whoever booted. **Why not namespacing ids by chunk token:** the token is a hash of the project-relative SOURCE PATH, identical across builds, so `pages/reports.scrml` in build A and build B share it — it would not stop the commonest deploy case (same route, new ids); it would also change every emitted id (160 pinned ids in 20 test files) for less coverage. **Why not scoping by mounted region (shell = outside outlet):** same-chunk routes render into the outlet from the shell chunk, so the region→chunk map is not static. The stamp approach covers both builds' layers independently and costs runtime bytes instead of per-id bytes.
- Retired `_scrml_nav_same_chunk` (never called since Wave-1c; the basename matcher the gap names).
- Fail-open only where nothing can be protected: a runtime with NO `_scrml_build_admit` (a pre-identity tab, a no-runtime lowering harness) runs the chunk — refusing there protects nothing, since a pre-identity shell has no same-build check and its own listeners are what would mis-resolve.

## Tests
- `compiler/tests/browser/browser-navigate-cross-build.test.js` (13): base `cd040ea25` 2 pass / 11 fail; head 13/13.
- security-failable-pack `n23` (SIDE `nav`, 5 shapes, new `runNavShape` in pack.js): base 5 FAIL; head 5 PASS. EXPECTED_SHAPE_COUNT 467 → 472.
- Browser tier: 1805 pass / 8 fail = exactly the 8 names in FAILURE-BASELINE.json.
- Pre-commit gate (unit + integration + conformance + slices): green.

## Corpus emit diff (scripts/corpus-emit-differential.ts, base `cd040ea25` vs head)
2860 sources, same enumeration, same compile-failure set (1708 ok / 1152 fail both sides), 0 diagnostic-code changes. 8609 artifacts compared: 1648 identical, 6961 differing — all 6961 classified, 0 unexplained:
- 1673 runtime files (core admit/owns + nav check).
- 1673 artifacts differing only by the runtime's content-hashed filename.
- 1671 HTML pages: the `data-scrml-build` stamp only.
- 1773 client chunks: gate line (all) + walker check (574) + rewire check (623).
- 171 `*.server.js`: `_scrml_project_root` absolute path only — a capture artifact (the base checkout lives in another directory), not a change.
- 18 diagnostic-TEXT-only changes: client-JS byte/line positions shift by the gate line (+1 line, +89 bytes). Pre-existing oddity surfaced: `W-CG-UNDEFINED-INTERPOLATION` prints a CLIENT-JS line as a `.scrml:LINE` location.
- Aggregate: client chunks +231,946 B raw / +92,169 B gzip over 1773 chunks (~+131 B raw, ~+52 B gzip each); HTML +28 B raw each.

## Size (runtime-size-ratchet pinned compressor, stripped)
| shape | before (`cd040ea25`) | after |
|---|---|---|
| shell | 22,711 raw / 6,087 B | 23,444 raw / 6,301 B (+214 B gzip) |
| counter | 17,681 raw / 3,912 B | 18,157 raw / 4,087 B (+175 B) |

The shell had 8 B of headroom (ceiling 6,095). Minimum correct variant (admit + nav check only) measured 6,196 B, so no fix fits; offset taken (−48 B, `_scrml_nav_same_chunk`). Ceiling raised to 6,489 B in an ISOLATED commit — **operator ruling owed** (`g-shell-runtime-ratchet-raised-s469-ruling-owed`).

## Self-attack
- back/forward: popstate → `_scrml_nav_fetch_and_swap` → same check (test). bfcache restores the whole old document + heap (one build) — nothing crosses.
- prefetch: `<link rel=prefetch>` only warms the cache; `_scrml_fetch_chunk` returns text and never executes; a cached stale chunk is refused by admit.
- a `<script>` left in the old document: already executed under the same build; scripts in the fetched outlet arrive via innerHTML (inert); missing chunks are only loaded after the identity check.
- chunk race (page A fetched, chunk URL serves B): refused before any statement → hard nav (test).
- two tabs: separate realms and documents; nothing shared resolves handlers.
- a second scrml build on the same origin (link-boost to it): different identity → hard nav (test, pack n23).
- esm: registration-only admit; foreign esm chunks are scoped by the listener checks but not refused (deferred).
- pre-identity tab: no check exists in code already running — residual, closes as tabs reload.

## Hermeticity finding (merge commit's hook run)
Order-dependent RED: a test file that evaluates the runtime at GLOBAL scope leaves `_scrml_build_admit` and a fixed `_scrml_build_id` on `globalThis`; a later file in the same `bun test` process that runs another build's chunk with NO runtime (`new Function` loaders) had its chunk refused by the stale admit. Fixed at the three no-runtime loaders (bootstrap `compiler/self-host-v2/slice-m1/harness.js` `evaluateChunks`, `imported-enum-match-binding`, S452 `runGo`): they shadow the name as `undefined` (they ARE the runtime there). Proven against a hostile preload (a global admit that always refuses): unit + integration + conformance 36,904 / 0; slices + `compiler/tests/*.test.js` 5,223 / 0; browser 1,805 / 8 (the baselined names). In a browser this cannot arise — one document runs one runtime.
