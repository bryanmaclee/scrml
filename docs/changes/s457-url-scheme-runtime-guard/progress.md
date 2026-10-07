# progress — s457-url-scheme-runtime-guard (append-only)

## 2026-10-07 — start
- Worktree verified (agent- prefix), base = origin/main 0d8e9d8ce, bun install + pretest OK.
- Read SPEC §5.2 (1789-1804) and §19.6.8 (19373-19405) in full.
- Logging surface = `_scrml_error_boundary_log(id, err)` (always-included 'errors' chunk; precedent ids
  'session.destroy', "on mount").

## Emitter enumeration (grep `setAttribute(` / `.href =` / `.src =` over compiler/src, plus a probe
## compiling 10 markup positions x 11 URL shapes — .tmp/probe.mjs, output .tmp/probe-before.txt)

| # | site | what it writes | verdict |
|---|------|----------------|---------|
| 1 | emit-bindings.ts:1013/1016 top-level quoted template attr (`href="${@u}"`), mount + reactive effect | data | GUARD when quotedUrlAttrNeedsRuntimeGuard |
| 2 | emit-event-wiring.ts `emitValueAttrApply` (`href=${expr}`, component-substituted `href=@c`), shared by the global value-attr block (:2286) and engine/match arms (emit-variant-guard.ts:973) | data | GUARD every URL attr |
| 3 | emit-variant-guard.ts:918/920 arm attr-template (`href="${@u}"` inside engine state-child / match arm) | data | GUARD via a binding flag set at emit-html.ts:3344 registration |
| 4 | emit-each.ts:2703/2710/2722 row expr / variable-ref / call-ref | data | GUARD every URL attr |
| 5 | emit-each.ts:2756 row quoted template | data | GUARD when prefix commits to nothing |
| 6 | emit-each.ts:2760/2765, 793, 1013, 1193, 1847, 1939, 3981 | static literal / compiler data-* attrs | no guard |
| 7 | emit-lift.js:1382 emitSetAttrs template (string-attr path) | data | GUARD when prefix commits to nothing |
| 8 | emit-lift.js:1647 AST string-literal template | data | GUARD when needed |
| 9 | emit-lift.js:1670 variable-ref, :1703 call-ref, :1809 expr, :3257 BLOCK_REF-split attr | data | GUARD every URL attr |
| 10 | emit-lift.js:1203/1384/1499/1621/1654/1707 | static / bind:* name | no guard |
| 11 | emit-ssr-render.ts attrValueParts (server first-paint `<each>` rows, `href="${@.url}"`) | data, server-side HTML | GUARD (server copy of the same helper) |
| 12 | emit-event-wiring.ts:2228 bool attr toggle | "" | no |
| 13 | emit-client.ts:1958 theme `data-scrml-theme-*` | not URL | no |
| 14 | emit-client.ts:2544/2651 csrf meta content; :2556 location.href = compile-time constant | not data URL attr | no |
| 15 | emit-html.ts static attrs (:3354, :3433 bare `href=@u` -> static NAME text, known gap g-unquoted-href-cell-ref-renders-cell-name-s456) | author text | no |
| 16 | runtime-template.js 2217/2932/2935/3026/3147/3356/3432/3581 | data-scrml-key, canonical-link copy from a fetched same-origin page, chunk URLs, tabindex | no (inert: compiler/server-composed) |
| 17 | runtime-template.js:2666 `_scrml_navigate` -> `window.location.href = path` | navigation, not an attribute | OUT OF SCOPE — report as deferred |

## 2026-10-07 — step 1
- NEW compiler/src/runtime-url-guard.js: the ONE scheme reader + sets + `_scrml_safe_url`; attr-injection-sink.ts
  now imports the sets/reader from it. `readLiteralUrlScheme` gains a `relative` kind (was folded into `none`);
  s456 test expectations for "/x:y" and "1abc:" updated accordingly.

## 2026-10-07 — step 2 (PA addendum: element scoping)
- PA addendum: `data` (and icon/profile/cite/action/background) double as prop / non-URL names. attr-injection-sink
  scopes element-INSENSITIVELY (fail-closed refusal of literal executable schemes). Decision: the RUNTIME guard
  (rule 3) is element-scoped via `_SCRML_URL_ATTR_ELEMENTS` / `_scrml_is_url_attr(tag, name)` in the same shared
  module (HTML attribute index scopes); rule 2's compile refusal stays element-insensitive (SPEC text unchanged
  there). Unknown tag at an emit site -> name-only (fail closed). Component props never reach the guard: it is
  decided per emitted DOM element, after CE.
- `phase1-use-named-012.scrml` (`<LineChart data=@chartData/>`): compile FAILS (pre-existing, VP-2) and emits a
  static `<LineChart data="chartData">`; no guard, no chunk — pinned in the integration test.

## 2026-10-07 — step 3 (emitters + chunk + SSR + SPEC + tests)
- codegen/url-attr-guard.ts (decisions + wrap). Guarded sites: emit-bindings top-level template; emitValueAttrApply
  (global + arm value attrs); emit-variant-guard arm attr-template (directiveUrlGuard stamped in emit-html);
  emit-each expr/variable-ref/call-ref/template; emit-lift emitSetAttrs template, AST template, variable-ref,
  call-ref, expr, BLOCK_REF-split; emit-ssr-render attrValueParts (server copy SSR_URL_GUARD_HELPER, injected by
  emit-server only when a renderer calls the guard).
- runtime chunk 'urlguard' (runtime-template inlines runtime-url-guard.js verbatim), post-emit gate on
  `_scrml_safe_url(`.
- SPEC §5.2: rule 2 sentence amended; new rule 3 bullet + provenance. SPEC-INDEX now stale (PA-owned; regen needed).
- Tests: unit s457 (49), integration s457 (72), browser s457 (6), conformance case
  attr-executable-sink/url-data-scheme-runtime-guard (bite proven: guard disabled -> 5 anchors fail).
- Updated pins: chunk count 39->40 (2 files), each-block href=@.email expectation now guarded.
- Gate run before this commit: 29665 pass / 3 fail (exactly the 3 pins above, now fixed).

## 2026-10-07 — step 4 (verification)
- Commit a320a02f0 pre-commit gate: 31908 pass / 0 fail (31978 tests, 1477 files).
- bun conformance/run.ts: 1342/1392 pass + 50 xfail, 0 fail; new case PASS; bite proven (guard disabled -> FAIL).
- Browser tier: scripts/browser-baseline.ts --check PASS (48 baseline failures, name set unchanged); new
  s457 browser file 6/6.
- ESM module format: `_scrml_safe_url` exported by the runtime and imported by the chunk.
- Corpus emit differential (scripts/corpus-emit-differential.ts; base = git archive of 0d8e9d8ce + head's new
  conformance case, head = a320a02f0; roots examples,samples,conformance,stdlib,benchmarks; 2421 sources both sides):
  293 artifact diffs = 275 path-only (base lives at .tmp/base: absolute/relative paths) + 2 path-relative
  host-import specifiers (same cause) + 12 guard-only (4 sources x client.js / html runtime-hash ref /
  assets json) + 4 runtime files whose only change is the inserted 'urlguard' chunk (pure 229-line insertion).
  Syntax delta 0/0/0. 14 "newly passing" stdlib/compiler/*.scrml = E-IMPORT-008 in the base snapshot only
  (host-import manifest outside the archived dirs) — environmental. Guarded sources: lift-008-self-closing,
  gauntlet-r10-bun-admin, conformance parse-syntax/e-syntax-064 (href=@.email in a row), and the new case.
  The gap's 3 sources: lift-008 (src, guarded), gauntlet-r10-bun-admin (src, guarded), meta-001-emit-html
  (href in a COMPILE-TIME ^{ emit } of constants -> static HTML, no data write, unchanged).
