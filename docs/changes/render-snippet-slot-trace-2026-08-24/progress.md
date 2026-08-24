# progress — render-snippet-slot-trace-2026-08-24

- 2026-08-24 startup: worktree /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0dd2d0e2d66cb063
  base origin/main b0abcbc6, tree clean, bun install ok, bun run pretest ok.
- 2026-08-24 fetched brief/s372, checked out docs/changes/render-snippet-slot-trace-2026-08-24/, read BRIEF.md + repro-three-highs.mjs in full.
- 2026-08-24 PROBE 2 REPRODUCES on b0abcbc6. Emitted HTML shows CE *did* expand `<Card>` (`<div data-scrml="Card" class="card">` with card__header/card__body inlined), and unslotted `<em>` DID inline at the `${children}` position. Each `${render X()}` emitted `<span data-scrml-logic="_scrml_logic_N"></span>` and the client lowered it to a BARE `;` (9 of them, 3 cards x 3 slots). `if=(actions is some)` lowered to `(((null !== null && null !== undefined)))` — the prop ref `actions` became the JS literal `null`.
- 2026-08-24 GREP: `render-expansion` / `renderExpansion` / `inlinedChildren` have ZERO hits in the entire repo outside SPEC.md, known-gaps.md, delta-log.md and this BRIEF. The §16.8.1 mechanism was NEVER IMPLEMENTED.
- 2026-08-24 MATRIX PROBE (probe-matrix.mjs) — all shipped-chunk mounts:
  * B1 slot=  -> render site EMPTY placeholder AND `<em slot="body">` appears TWICE (once inside card__body right after the placeholder, once at the Card root end). The duplication is `_injectChildrenWalk`'s trailing `if (!state.slotFound) result.push(...callerChildren)` firing at EVERY recursion level because renderMatch never matched.
  * B2 body={ <em/> } -> render site EMPTY, em nowhere.
  * B3 parametric control={ (n) => ... } -> render site EMPTY, sibling ${label} prop renders "LBL".
  * C1 ${children} control -> WORKS.
  => all three shapes share ONE root: the render-slot logic node is never substituted.
- 2026-08-24 Q2 DISCRIMINATOR SPLIT IN TWO:
  * limb (ii) INDEPENDENT, no snippet in file: `<Box note="present"/>` + `if=(note is some)` lowers to `present !== null && present !== undefined` — the string prop VALUE substituted as a BARE UNQUOTED IDENTIFIER -> `ReferenceError: present is not defined` thrown out of `_scrml_boot`, killing `_scrml_nav_rewire` for the whole page. A2 (prop OMITTED) correctly lowers to `null !== null`.
  * limb (i) flagship `actions is some` -> `null` even though `slot="actions"` IS supplied: slot= children populate `slottedGroups`, never a prop binding, so `is some` sees an unbound prop. Consequence of the same missing snippet machinery.
- 2026-08-24 *** DECISION SITE FOUND AND CONFIRMED BY EXECUTION ***
  compiler/native-parser/translate-expr.js:296-297
      case ExprKind.Render:
          return makeEscapeHatch("Render", "", nativeExpr.span);
  Path: CE parseComponentBody (component-expander.ts:1181) -> reparseSynthesizedFile (:1153)
  -> nativeParseFile (NOT the live BS+TAB path; sourceNeedsLiveFallback :1079 does not trip)
  -> parse-expr.js:2683 parseRenderExpr correctly builds {kind:Render, name, args}
  -> translate-expr.js:296 DISCARDS name+args into escape-hatch raw:"" with ZERO diagnostics
  -> emit-expr.ts:4010 emitEscapeHatch -> rewriteExpr("") -> "" -> bare `;` in client + empty
     <span data-scrml-logic> in HTML.
  Measured: native gives escape-hatch/Render/raw:"" ; LIVE gives call callee=__scrml_render_header__.
  Controls through the SAME native path survive: ${children} -> ident, ${someFn()} -> call, ${label} -> ident.
  That is EXACTLY the reported symptom (unslotted children render, named render sites do not).
- 2026-08-24 Q2 limb (ii) locus: component-expander.ts:2338-2339 substitutePropsInRawExpr on an
  attr `expr` value with no exprNode; the helper (:2452-2464) splices the prop VALUE STRING
  verbatim, so note="present" turns `note is some` into bare `present !== null`.
- 2026-08-24 Q2 limb (ii) SEVERITY (corrected harness — first pass matched the canary INSIDE an
  unmounted <template> and read as a false pass): live-DOM check with template exclusion shows the
  ReferenceError is a WHOLE-PAGE BOOT KILL — a later independent `if=@ok` canary never mounts.
  Control (prop omitted) boots clean.
- 2026-08-24 Q2 limb (i) confirmed: `if=(actions is some)` with `slot="actions"` SUPPLIED lowers to
  `null !== null && null !== undefined` — the section never mounts, and the slotted <button> is
  duplicated (once in the actions template, once at the Card root).
- 2026-08-24 BLAST RADIUS measured by execution: 15 corpus .scrml use `${ render X(`; 15/15 take the
  NATIVE re-parse path (sourceNeedsLiveFallback never trips) and 15/15 lose every Render node.
- 2026-08-24 DIAGNOSTIC NET: ZERO of §16.8.1's SHALL-reject codes fire on their own shapes
  (E-COMPONENT-023, E-TYPE-071 x2 shapes, E-TYPE-072 x2 shapes, E-TYPE-073). `rewriteRenderKeyword`
  (rewrite.ts:2478) text-scans for `render name(`, but expression-parser.ts:1745 has already
  rewritten that text to `__scrml_render_NAME__(` — the gate can never match real pipeline input.
  Its only test (unit/snippet-slot.test.js:453) calls it with a synthetic literal.
- 2026-08-24 THIRD defect: `${render X()}` OUTSIDE a component body emits `__scrml_render_X__()`
  into the client — a call to a function that is never defined — at exit 0. SPEC SHALLs E-TYPE-071 here.
- 2026-08-24 SUFFICIENCY NATURAL EXPERIMENT (probe-sufficiency*.mjs). Putting a <match> in the
  component body trips sourceNeedsLiveFallback, forcing the LIVE re-parse — which yields exactly the
  node the proposed translate-expr.js:296 fix would yield. Result:
  * row 1 slot=  BASELINE empty+duplicated -> LIVE-proxy `<div class="h"><em>SLOTTED-EM</em></div>`,
    slot attr stripped, no duplication. THE BRIDGE FIX IS THE WHOLE FIX FOR ROW 1.
  * row 3 parametric, SPEC-correct decl `control: snippet(n: string)`: BASELINE silent-empty exit 0
    -> LIVE-proxy E-CODEGEN-INVALID-LOGIC `_scrml_render_value(el, <strong>${"LBL"}</strong>)`.
    SECOND DECISION SITE: component-expander.ts:3150-3157 pushes the substituted lambda body as a
    RAW STRING `bare-expr.expr` with no exprNode — markup text in a JS argument position.
  * row 2 body={ <em/> } on a plain `snippet` prop: empty on BOTH paths. SPEC §16.5 defines only
    `slot=` for zero-parameter snippets — the prop-value form is SPEC-SILENT. RULING, not a fix.
  => THE THREE ROWS DO NOT SHARE ONE ROOT. Row 1 alone is closed by the bridge.
  (Harness correction: my first row-3 assertion matched "LBL", which the `label="LBL"` ATTRIBUTE also
  matches, so a dead render site read as a pass. Re-asserted on `<strong>` inside span.c.)
- 2026-08-24 MAPS: zero hits for `reparseSynthesizedFile` / `nativeParseFile` across all 13 maps.
  The fact that a component body is re-parsed by the NATIVE parser BY DEFAULT (no --parser flag) is
  absent from the whole map set. Routing hole.
