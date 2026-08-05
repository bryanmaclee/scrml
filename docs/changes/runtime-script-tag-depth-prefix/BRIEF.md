# BRIEF — runtime `<script>` tag depth prefix (g-runtime-script-tag-not-depth-prefixed, HIGH)

**Thread-id:** `runtime-script-tag-depth-prefix`
**Gap:** `g-runtime-script-tag-not-depth-prefixed` (HIGH, open). PA-reproduced live on `b929b9c9` (S320).
**Lane:** codegen (Peter). Disjoint from the held auto-await choke-point (#405) and bryan's lanes.
**DONE-PROBE:** a shell-less nested `pages/a/b/deep.scrml` compiles with the runtime `<script src>` prefixed `../../`; a composed nested page stays prefixed exactly once (no `../../../`); conformance case pins both.

## The bug (PA-verified by compilation, S320)
The own-document (non-composed) HTML emit path emits the runtime `<script src>` at **depth 0** with no `upToRoot` prefix, so any nested route 404s it and the page is **100% DOA — silently, zero diagnostics.**

Verified emit on `b929b9c9`:
- **(A) shell-less nested** (`pages/top.scrml` + `pages/a/b/deep.scrml`, no shell): `dist/a/b/deep.html` → `<script src="scrml-runtime.<hash>.js">` (BARE) while the runtime is written only at `dist/scrml-runtime.<hash>.js`. `top.html` (depth 0) bare is correct.
- **(B) composed** (shell + nested page): `dist/a/b/deep.html` → `<script src="../../scrml-runtime.<hash>.js">` — **already correct** via the composition re-add path.

## Loci (S301 re-characterization, current)
- Bare push (own-document path): **`compiler/src/codegen/index.ts:2233`**.
- Placeholder substitution: **`index.ts:3024-3030`** — a plain `split().join()`, cannot add a prefix.
- Composed re-add (already correct): **`index.ts:~2858-2875`** / applies `upToRoot` at **`:2871`**.
- Runtime file written only at dist root: `api.js:2885`.
- **The intended contract is already evidenced:** the ESM chunk path emits `from "../../scrml-runtime.<hash>.js"` — mirror it.

## Fix direction
Give the own-document runtime `<script>` tag the same `upToRoot` depth prefix the ESM chunk path already applies (compute the page's depth-to-dist-root and prefix the hashed runtime filename).

## ⚑ Fix-interaction caveat (the one real risk — the S239 must prove this)
`:2871` already applies `upToRoot` to whatever `src` it finds on the composition re-add path. Prefixing at `:2233` **without coordinating** can double-prefix composed pages (`../../../...`). Composed pages flow: `:2233` push → whole-run strip removes the runtime tag → `:2871` re-adds prefixed. Ensure the composed result stays a SINGLE prefix. The two verification cases below MUST both pass.

## Gate (R26 empirical + S239)
1. **Case (A)** shell-less nested `pages/a/b/deep.scrml` → `deep.html` runtime src === `../../scrml-runtime.<hash>.js` (was bare). Depth-0 `top.html` stays bare.
2. **Case (B)** composed shell + nested page → `deep.html` runtime src === `../../scrml-runtime.<hash>.js` — exactly one prefix, NOT `../../../`.
3. New conformance/unit case pinning the depth-prefixed runtime tag for a nested own-document page (and a composed nested page as the no-double-prefix guard).
4. Corpus/regression: `examples/23-trucking-dispatch` (25 pages) — re-verify every page's runtime `<script src>` resolves against its own dist dir (the gap's own witness); the 4 non-`<page>` `channels/*.html` that fall through to `:2233` should now be prefixed too.
5. Full `bun test compiler/tests/{unit,integration,conformance}` from repo ROOT; baseline-subtract the ~6 Windows-local fails.
6. **STOP-IF-BIGGER:** if a single prefix at `:2233` cannot satisfy BOTH (A) and (B) without a broader refactor of the strip/re-add flow, STOP and report the collision.
