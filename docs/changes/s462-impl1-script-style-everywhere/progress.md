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
