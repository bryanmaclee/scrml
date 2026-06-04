# BRIEF — S154 ruling (a) codegen: HTML-element `:`-shorthand content-model rule (Phase-0 survey-STOP)

> Archived verbatim per S136. Dispatched S159 (2026-06-03) to `scrml-js-codegen-engineer`, model opus,
> isolation:worktree, background. agentId ab11b676c6d632cef. change-id:
> `s154a-colon-shorthand-html-2026-06-03`. SPEC half landed this arc at `1fb9823f` (§4.14 + §34
> E-COLON-SHORTHAND-ON-VOID). This is the PHASE-0 (survey+STOP) brief; the Phase-1 implementation brief
> will be archived separately when greenlit.

---

You are implementing the CODEGEN half of **S154 design ruling (a)** in the scrml compiler: a `:`-shorthand body on a lowercase HTML element follows the element's content model. The SPEC half landed this arc at `1fb9823f` (§4.14 + §34 `E-COLON-SHORTHAND-ON-VOID`). change-id: `s154a-colon-shorthand-html-2026-06-03`.

This dispatch has a **PHASE-0 SURVEY + STOP gate**. The key unknown: is the `:`-shorthand body even CAPTURED at parse for a plain HTML element, or dropped? (`<span : @label>` compiles to an empty `<span></span>` — body captured-but-not-emitted, or dropped at parse. That determines emit-html-only vs parser+emit.)

THE RULE (landed SPEC §4.14 @ 1fb9823f, lines ~969-1028):
- Non-void (`isVoid:false` in compiler/src/html-elements.js — span/div/p/li/label/button/...): the `:`-shorthand body IS the single-expression body, byte-identical to `<tag>${expr}</tag>`. `<span : @label>` → `<span>${@label}</span>`. §4.18 code-default grammar (bare run is code; display text is `"..."`). Resolves the empty-emit + E-DG-002 false-fire (rendered ⇒ consumed).
- Void (`isVoid:true` — input/img/br/hr + SVG geometry rect/circle/line/path/polyline/polygon): REJECT with E-COLON-SHORTHAND-ON-VOID (§34). Void = no content model; binds via attribute (`<input bind:value=@x/>`), not a body.

DISCIPLINE BLOCKS (standard isolation:worktree set per pa.md, identical structure to prior S159 briefs):
- MAPS-required-first-read (primary.map.md; currency 97fe2199 — emit-html/ast-builder/html-elements covered; verify line numbers via grep).
- F4 startup-verification (pwd prefix / show-toplevel / **S112 merge main → 1fb9823f** / bun install / bun run pretest).
- Path discipline: Bash-edit only on worktree-absolute paths; NEVER cd into main (S99/S126).
- Crash-recovery: per-unit commits; first commit includes verbatim pwd; progress.md append-only; NEVER --no-verify; code+coupled-test = one commit.

PHASE 0 (survey + STOP — do NOT edit yet) covers: (1) parse-capture of the `:`-shorthand body for plain HTML (the gating Q — compile /tmp/s154a/nonvoid.scrml, inspect AST); (2) the emit-html site + how bare-body `<span>${@label}</span>` emits today (the byte-identical target); (3) the proven `<each>` per-item `:`-shorthand render (emit-each.ts) — mirror or distinct?; (4) void-guard fire site + html-elements.js isVoid lookup + E-* fatal partition; (5) §4.18 code-default-body interaction (display-text-literal `<li : "x">` vs expression `<span : @label>`); (6) scope — lowercase-HTML-only, PascalCase components + engine/match `:`-shorthand OUT OF SCOPE/untouched; (7) test plan + baseline. STOP, commit survey + progress.md, report "PHASE 0 COMPLETE — awaiting greenlight" (self-contained — fresh implementer; SendMessage resume unavailable).

PHASE 1-3 (after greenlight): implement per survey + rulings; tests; Phase-3 R26 (non-void renders body + 0 E-DG-002 false-fire + node --check; void fires E-COLON-SHORTHAND-ON-VOID; DO NOT mark DONE without R26).

(Full verbatim dispatch prompt: see the S159 conversation transcript / the Agent call for agentId ab11b676c6d632cef.)
