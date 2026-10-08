# progress — s457-executable-sinks-srcdoc-svg (append-only)

## 2026-10-07 — start
- Worktree verified (agent- prefix), base = origin/main b6a6b64f0; bun install + pretest OK (dist populated).
- Read SPEC §5.2 rules 1-3 (1789-1812) in full; user-voice §S456 "your recs on 1 and 2", §S457 (a now / drop c).
- Read docs/changes/s457-url-scheme-runtime-guard/progress.md (17-emitter enumeration).

## Probe (before) — .tmp/probe.mjs, 9 markup positions
- srcdoc: quoted `"${x}"` refused everywhere; `srcdoc=${x}`, `SRCDOC=${x}` compile clean at all 9 positions
  and write the data with setAttribute; bare `srcdoc=@u` at top renders the static cell NAME (known gap
  g-unquoted-href-cell-ref-renders-cell-name-s456) but in components/each/lift writes data.
- Event attributes, unquoted: lowercase `onclick=${f}` / `onclick=f()` / `onfoo=${}` / `onbegin=${}` are WIRED as
  listeners everywhere (sanctioned). HANDLER TEXT FROM DATA found at:
  - `ONCLICK=${x}` / `Onclick=${x}` (any name not starting lowercase `on`) — emit-html routes it to the generic
    value-attr path -> `el.setAttribute("ONCLICK", String(x))` at top / component / slot / if / engine / match;
  - lift markup: `onClick=${x}`, `onClick=it.url`, `ONCLICK=go(x)`, `on:click=${x}` -> `setAttribute(...)` with data
    (emit-lift wires only `/^on[a-z]/`).
  - `<each>` rows wire every on-name as a listener (no text write).
- SVG: `<set attributeName="href" to="${@u}">` / `values="${@u}"` -> unguarded setAttribute at every position;
  `to=${@u}` (expression form) is SILENTLY DROPPED at top-level / component / slot / if / engine / match because
  emit-html `valueAttrElementIsLowerable` refuses NR-"unknown" tags not in the standard HTML render set
  (`set` / `animate` are SVG); `<each>` rows write it unguarded.

## Step 1 — runtime + reader + validator
- runtime-url-guard.js: `_SCRML_SVG_ANIMATION_ELEMENTS`, `_SCRML_SVG_ANIMATION_VALUE_ATTRS`,
  `_scrml_safe_url(el, name, value, target)` (4th arg only for an animation value; `values` judged per `;` entry).
- attr-injection-sink.ts: `animationUrlTarget(tag, name, attrs)`, rule 2 for animation values
  (`classifyAnimationValue`, per `;` entry via `jsInterpolationEnd`), `quotedAnimationValueNeedsRuntimeGuard`,
  `executableDataWriteSink(name)` (srcdoc + event names), message form "data".
- validators/attribute-interpolation.ts: element context passed to the classifier; srcdoc with ANY non-literal
  value on a rendered element refused (component call props / declared props skipped; judged where written).

## Step 2 — emitters (all URL-guard sites from the S457 enumeration)
- url-attr-guard.ts: `urlGuardTarget`, attrs-aware `dynamicUrlAttrNeedsGuard` / `quotedUrlAttrNeedsGuard`,
  `wrapUrlGuard(..., target)`, and `refuseExecutableDataWrite` (the emit-time backstop; skips declared
  component props via `_componentPropNames`).
- emit-html: `valueAttrElementIsLowerable` admits the SVG animation elements (the `to=${…}` drop fix);
  value-attr registration refuses srcdoc / unwired on-names; stamps `valueAttrUrlGuardTarget` /
  `directiveUrlGuardTarget` (binding-registry.ts). emit-event-wiring `emitValueAttrApply` + emit-variant-guard
  pass the target. emit-bindings top-level template, emit-each (expr / var / call / template + backstop),
  emit-lift (string path, AST template / var / call / expr, BLOCK_REF-split — element-stack now keeps attrs),
  emit-ssr-render (first-paint rows).
- First commit attempt FAILED the hook: examples/23-trucking-dispatch load-new.scrml — `onAddressInput=setX`
  is a DECLARED component prop merged onto the expanded root inside `lift`; the backstop refused it. Fixed:
  declared props are not element attributes (same reading as emit-html `isDeclaredPropAttr`).
- Duplicate reports (VP-3 + CG backstop on a re-parsed `<match>` arm / CE definition + expanded copy):
  api.js now drops a CG-stage E-ATTR-INTERP-EXECUTABLE when an earlier stage refused the same-named attribute
  in the same file (`attrSinkName`); the CE stage now keeps `attrSinkKey` / `attrSinkName` on its errors.

## Step 3 — SPEC + tests + verification
- SPEC §5.2 rule 2: three S457 bullets (SVG animation values; srcdoc in every form; event-handler text from
  data) + provenance; rule 3: SVG animation values bullet; §34 row amended. SPEC-INDEX not touched (PA-owned).
- Tests: unit s457-executable-sinks-srcdoc-svg (19), integration (123), browser (6), conformance cases
  attr-executable-sink/{srcdoc-data-forms-neg, srcdoc-row-data-neg, event-attr-data-text-neg,
  svg-animation-literal-scheme-neg, svg-animation-url-runtime-guard}.
- Bite: base (git archive b6a6b64f0) — integration 105 fail / 18 pass (controls + quoted srcdoc), browser
  6/6 fail, the 5 conformance cases all FAIL on base; head all pass. `bun conformance/run.ts` head:
  1347/1397 + 50 xfail, 0 fail.
- Chromium (playwright headless, file://), base vs head:
  base: srcdoc=${@doc} -> payload ran (__pwned=1); `to="${@u}"` -> ran on click (4); `values="${@u}"` -> ran (5);
        ONCLICK=${@code} -> ran (6); `to=${@u}` -> element value dropped (no write).
  head: srcdoc / ONCLICK -> compile refused (E-ATTR-INTERP-EXECUTABLE); `to=${@u}`, `to="${@u}"`, `values` ->
        DOM `about:blank` before click, click navigates to about:blank, payload never ran; safe control `#ok`
        written unchanged.
- Corpus differential (scripts/corpus-emit-differential.ts; base = git archive of b6a6b64f0 at .tmp/base,
  head = worktree; 2421 sources both sides): compile-failure delta 0/0, diagnostic-CODE changes 0,
  syntax delta 0/0/0. 293 artifact diffs = 275 path-only (base lives under .tmp/base) + 4 runtime files
  renamed (the 'urlguard' chunk changed: `_scrml_safe_url` 4th parameter) + 12 runtime-hash references in
  the 4 already-guarded sources (url-data-scheme-runtime-guard, e-syntax-064, gauntlet-r10-bun-admin,
  lift-008) + 2 host-import relative paths (environmental). Newly-rejecting impact on the corpus: ZERO.

## Step 4 — gates + hardening
- c35f2b9dd pre-commit gate: 32158 tests, 0 fail. browser-baseline --check: PASS (48 baseline names; the
  first run aborted on the harness's own "parser disagrees 48 vs 47" self-check — rerun PASS, no change).
- types-gate: 1 NEW (LogicBinding.valueAttrUrlGuardTarget missing in emit-event-wiring's local type) — fixed
  (a3feba7dc); types-gate OK, unchanged. bootstrap-conformance.md regenerated (5 new cases).
- NOT regenerated (PA-owned): docs/FACTS.md (`facts.ts --check` STALE facts-table), compiler/SPEC-INDEX.md
  (`regen-spec-index.ts --check` wants 47,004 lines).
- Hardening: a duplicate `attributeName` is fail-closed (any URL-naming or computed one decides).
- `^{ emit(…) }` probe: an emitted `srcdoc=${@x}` is refused (post-ME VP-3); an emitted `<set … to=${@x}>`
  is guarded.

## Step 5 — PA review round (Chromium differential of 8be498b14: DO-NOT-LAND)
- Reproduced all 3 findings on 8be498b14 (compile + Chromium, prev = git archive 8be498b14):
  `<each>` / `lift` `<Fr srcdoc=it.d/>` (declared prop) -> setAttribute("srcdoc", data), 1 dialog each;
  `lift <Btn onClick=it.code/>` (declared prop) -> setAttribute("onClick", data), dialog on click;
  two `<button ONCLICK=${…}>` -> 1 error (api.js name-key de-dup).
- ROOT: the `_componentPropNames` skip assumed no emitter writes a declared prop onto the element; true in
  emit-html (i81 `isDeclaredPropAttr`), false in emit-each / emit-lift. SPEC §15 has no sentence on whether
  a declared prop is written onto the root; §15.10 ("available as plain identifiers throughout the
  component body") makes it the component's input, and emit-html's i81 reading is the existing codegen
  contract. FIX: emit-each and emit-lift no longer write a data-valued DECLARED prop onto the expanded root
  (`isDeclaredComponentProp` in url-attr-guard.ts; a comment is left at the site). The skip was removed from
  `refuseExecutableDataWrite` — the backstop now refuses every srcdoc / unwired on-attribute data write it
  reaches. SPEC §5.2 srcdoc bullet gains the normative sentence.
- De-dup: only VP-3 / CE record the name key; codegen refusals are keyed on their own spans, so two distinct
  `<button ONCLICK=${…}>` are two reports; a re-parsed `<match>` arm copy of a VP-3-refused srcdoc stays one.
- Tests: integration §8 (7 shapes + trucking load-new compiles with no `setAttribute("on…")`) + §9 (2-error
  counts); browser test #7; conformance attr-executable-sink/declared-prop-sink-each-lift-pos [runtime].
  Bite on 8be498b14: integration 8 fail (each `onClick` row is a listener on both = control), browser 1 fail,
  conformance case FAIL (4 anchors). Head: all pass; conformance 1348/1398 + 50 xfail, 0 fail.
- Chromium head: the 3 repros -> 0 dialogs, iframe srcdoc null, button onclick null.
- Corpus differential (base b6a6b64f0 vs head): compile-failure delta 0/0, diagnostic-CODE changes 0, syntax
  0/0/0; source set +6 (the new conformance cases). 307 artifact diffs = 275 path-only + 4 runtime renames +
  12 runtime-hash refs + 2 host-import paths + 14 OTHER, all the declared-prop drop: trucking load-new,
  dispatch/load-detail (+ genVar-number shifts in its status-picker.server.js / models/auth.client.js), and
  gauntlet-r10-ts-components — every removed line is a `setAttribute("<declaredProp>", …)` on a lifted
  component root (incl. handler refs `onTransition` / `onAssign` / `onDismiss` / `onAddressInput` written as
  attribute text). Side effect in dispatch/load-detail: the AssignmentPicker lift was wrapped in a
  re-lift `_scrml_effect` ONLY because those junk writes read cells; with them gone the lift is static.
  Nothing else in that lifted body reads a cell (its `<each>` children are already dropped by the lift
  lowering — pre-existing), so no rendered output changes.

## Step 6 — PA review round 2, ruling (a)
- PA rejected the ed1be04ec route (silently dropping declared props in each/lift = semantics change; a §15
  ruling question). First tried the PA's literal spec (restore writes + refuse unwired on-names at the
  write): newly rejected trucking load-new (6) and load-detail (2) — every value a FUNCTION reference
  (`onAddressInput=setOriginAddress`). Stopped and surfaced; PA ruled (a).
- (a): each/lift write declared props again exactly as base; lift now wires every rule-1 `on…` name as a
  listener (`liftEventName`: `isExecutableEventHandlerAttrName` + the `<each>` event name — `on:x` → x,
  else lowercased rest; lowercase names byte-identical); srcdoc with data refused at the write wherever
  emitted (declared props included); URL declared props guarded (existing path). `one` / `online` /
  `onboarding` in lift are now ordinary attributes (rule 1). De-dup fix kept.
- SPEC §5.2: declared-prop SHALL sentence removed; srcdoc + event-text bullets say the refusal / wiring
  applies wherever the write is emitted, an expanded root's props included; §34 row updated.
- Tests: integration §3 (lift-wired cases), §8 rewritten (8 srcdoc refused + 16 on-name listeners +
  href guarded + title written + trucking), browser 3 tests; conformance: declared-prop-srcdoc-each-lift-neg
  + declared-prop-on-attr-lift-listener-pos (old declared-prop-sink-each-lift-pos removed).
  Bite on base b6a6b64f0: both cases FAIL; integration §8 16 fail (each on-names already wired on base).
- Chromium (16 declared each/lift sink variants): base 10 dialogs; head 0 (srcdoc 4/4 refused at compile,
  on-names 12/12 listeners, onclick attr null).
- Corpus differential base b6a6b64f0 vs head: 0 newly failing / 0 newly passing / 0 code changes / syntax
  0/0/0; source set +7 (new cases). 296 diffs = 275 path-only + 4 runtime renames + 12 runtime-hash refs
  (the 4 already-guarded sources) + 2 host-import paths + 3 OTHER: trucking load-new (6 lines),
  load-detail (2 lines), gauntlet-r10-ts-components (1 line) — each `setAttribute("onX", fnRef)` became
  `addEventListener("x", function(event) { fnRef(event); })`. dispatch/board and 22-multifile: byte-identical.
