# progress — s462 impl#1 script/style refusal everywhere

- [x] brief archived; base d6820a607 (origin/main)
- [x] base reproduced (Chromium, `chromium-check.mjs` against a `git archive` of d6820a607):
      lift-script-body `window.pwned=7`; lift-script-src `/evil.js` requested + ran; lift-style-body
      `body` background `rgb(1, 2, 3)` from cell data. Fix: all three refused at compile time, no artifact.
- [x] code + tests (d9fe8eb01): element-refusal.ts (rule, structural check, raw-content scan);
      ast-builder end-of-build check + html-fragment / string-path token check + markup-value
      refusalSpan; block-splitter marker + raw-content scan; component-expander (used + unused);
      codegen backstop refuseElementLowering (emit-lift / emit-each / emit-html / emit-ssr-render);
      api.js CG-duplicate drop; emit-lift hyphenated-name split fix. Unit + 20 conformance cases.
- [x] SPEC §4.17 amended (S462 amendment + raw-content paragraph, prov=pa-ruled) + §34 rows; SPEC-INDEX regen.
- [x] known-gaps: NEW resolved g-impl1-script-style-admitted-outside-the-markup-opener-s462;
      NEW open g-toplevel-decl-string-rhs-scanned-as-markup-s462 (pre-existing false refusal);
      g-bootstrap-admits-script-style-elements-s462 corrected ("impl#1 refuses both" was opener-only).

- [x] merged origin/main 8b9cd9919 (#1398 bootstrap refusal); generated docs regenerated; known-gaps by hunk
      (the two impl#1 gaps #1398 filed are RESOLVED here; this branch's duplicate entry dropped).
- [x] adversarial round: attribute-held markup — snippet lambda attribute (rendered / unrendered /
      zero-arg) refused in component-expander at the call site; `<tableFor>` column `:let` slot body
      refused in type-system; markup value inside a text `${}` now reports at its file position;
      SVG-namespace lift and logic nested in lifted markup confirmed. +5 conformance cases (25 total).

- [x] S239 review of b125d2786 → FIX, addressed:
      HIGH 1 raw scan bypass via RCDATA/RAWTEXT → fail-closed text rule (any `<script`/`<style` start-tag
      text anywhere in the body); HIGH 2/3 raw body in component / match arm / each never scanned →
      `collectRefusedElements` scans the text child of every pre/code node it reaches (structural, any
      parser) + meta-eval `checkEmittedNodes` scans emit() raw bodies + codegen backstop
      `refuseRawContentLowering` (emit-html, emit-ssr-render); MED 4 static `on…=` in raw content →
      NOT refused (§5.2 sanctions static handler text; corpus 0 of 4519 raw bodies) — filed HIGH
      g-raw-content-static-handler-attribute-executes-s462 for a ruling; LOW 5 handler-arrow markup →
      TAB escape-hatch token check (E-SCRIPT-001 instead of E-CODEGEN-INVALID-LOGIC). Addendum: `^{}`
      emit raw bodies refused (ME stage). All reviewer repros (r, r2..r5, n, a) re-run in Chromium via
      the reviewer's x.mjs: every script/style repro refused; only the two `onerror` repros (item 4) run.
      Bootstrap: 4 raw-content cases FAIL there → filed g-bootstrap-raw-content-not-fail-closed-s462.
      +9 conformance cases (34), raw-content-display-neg narrowed to what stays silent.

- [x] review-round gates: emit differential vs origin/main f2284b72e (git-archive base): 2765 common
      sources, 0 newly failing/passing, 0 code changes, 0 text changes, 165 artifacts differ = all
      `_scrml_project_root` path-only (normalized 165/165), 34 added sources (the new cases). Targeted
      refusal differential: 4981 files / 172 candidates, 30 changed = exactly the 30 positive
      element-refusal cases. host-global-scan: the new handler-arrow expect-reject case throws in esm
      mode like the other expect-reject cases → pinned in known-throws.txt.

## (c) measurement

`<pre>`/`<code>` bodies holding a literal `<script`/`<style` start tag, every `.scrml` file:
scrml (worktree) + scrml-support = 162 files carrying `<pre>`/`<code>`, 0 sites; scrml-site, flogence,
giti, 6nz, scrmlDev, flint, if-you-give-a-dev-an-enum, scrml-native = 109 more, 0 sites. ZERO →
refused (PA-ruled by the governing sentence). The only prior assertion of the opposite: two
must-not-fire unit cases in script-element-rejected.test.js, flipped.

## corpus differential (E-SCRIPT-001 / E-STYLE-001)

4961 `.scrml` files across the same 10 roots; 150 contain `<script`/`<style` text (the superset
that can hold a refused element); each compiled with base d6820a607 and head. Outcome changed in
16 files — exactly the 16 new positive conformance cases (conformance/cases/element-refusal/*-pos).
Newly refused corpus sites outside the new cases: NONE. 78 files refused identically on both.
Re-run after the adversarial round + merge: 4972 files, 163 candidates, 21 changed = exactly the 21
positive element-refusal cases; 83 refused identically (78 + the 5 positive block-grammar cases #1398 added).

## emit differential (scripts/corpus-emit-differential.ts, base d6820a607 vs head 65700ddb)

2759 common sources: 0 newly failing, 0 newly passing, 0 diagnostic-code changes, 0 text-only changes;
165 differing artifacts, ALL `case.server.js` differing only in the embedded `_scrml_project_root`
path (base compiled from a scratch `git archive`; verified by normalizing the root: 165/165 path-only,
0 real). The tool's own exit 2 is its INCOMPARABLE "revision <unknown>" finding — the base side is
an archive, not a git checkout.
