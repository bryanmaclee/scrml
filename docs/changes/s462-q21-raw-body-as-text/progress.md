# S462 Q21 — raw body as text — progress

- [x] Brief archived; merged origin/main (a9aa81eff, up to date).
- [x] Corpus measured (before coding): 4,513 raw bodies / 179 files / 12 repos (scrml, scrml-support,
      scrml-site, flogence, giti, 6nz, 6NZ, scrmlDev, flint, if-you-give-a-dev-an-enum, scrml-native,
      flo-practice). 326 hold a nested tag — all bare `<code>…</code>`; 0 nested pre/code carry an
      attribute; 0 hold any other tag; 1 holds a bare `>` outside the wrapper
      (scrml/docs/changes/s441-audit-gap-filing/repro/site-pre-body-line-starting-match-parsed-as-code.scrml:10,
      `.Idle :> "idle"` — displays identically).
- [x] Encoding implemented (bf67f3044): compiler/src/raw-content-encode.ts + emit-html, emit-ssr-render,
      emit-each, emit-lift. emit-each / emit-lift also ask refuseRawContentLowering.
- [x] Decisions: nested `<code>`/`<pre>` WITH attributes → text (corpus 0). `<script>`/`<style>`
      refusal in raw content → KEPT (defence in depth), reported for PA/bryan.
- [x] Tests: unit raw-content-as-text-s462-q21 (20), integration ssr-raw-content-as-text-s462-q21 (2,
      bites on base), conformance/cases/raw-content (8 runtime cases, impl#1 8/8).
- [x] Chromium: every gap repro + each/match/if/engine/meta/component/lift-component positions —
      base a9aa81eff runs 7 of 8 + CSS injection; head runs nothing, all display as typed.
- [x] SPEC §4.17 rewritten (ba5175cb5); §4.18.6 / §24.3.1 cross-refs; SPEC-INDEX + FACTS regenerated.
- [x] known-gaps: active-html gap RESOLVED; match-arm-each silent accept RESOLVED; 4 new gaps filed
      (lift pre not raw; control-flow keyword in raw body; DOM text entities literal; runtime
      meta.emit pre); bootstrap gap widened with the Q21 obligation + measured bootstrap results.
- [x] Bootstrap: NOT implemented — recorded precisely in g-bootstrap-raw-content-not-fail-closed-s462
      (needs a raw-HTML node through ANodeK/View/HNode, ~35 exhaustive match sites).
      bootstrap-conformance.md regenerated.
- [x] Corpus emit differential (base a9aa81eff git-archive vs head, in-process compile, 12 repos):
      4,841 .scrml scanned, 271 hold `<pre`/`<code`; outcome (error codes) identical 271/271;
      artifacts identical 270/271; the 1 difference is the expected `.Idle :> "idle"` ->
      `:&gt;` (displayed text identical, happy-dom). A first run showed 4 giti files differing by
      local-id renumbering only; fixed (1f96570ba). Chromium innerText of every pre/code on 6
      corpus pages (5 scrml-site pages, giti history; 301 elements): identical base vs head.
- [x] Gates: pre-commit 34844/0; integration+lsp+commands 5657/0/10 skip; browser-baseline PASS;
      root-level 2239/0; e2e-render-map 259/0; s34-census --check-new PASS; host-global-scan
      --check 0 violations; facts / spec-index / state / bootstrap-conformance /
      gen-bootstrap-severity --check current; snippet-gate 128/0; corpus-compile-floor PASS;
      types-gate unchanged; conflict-marker PASS. self-host-v2 not touched (slices not run).
