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
- [ ] Corpus emit differential (12 repos) + innerText comparison
- [ ] Gates
