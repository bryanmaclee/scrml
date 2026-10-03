# progress — s451-boot-show-dupattr

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a724463613952e325 (base origin/main ce00c296a)

## Reproduced on main (all three, before any change)
- `<p id="s" show=(@step == 2)>` → no diag; step 1 renders `<p id="s">` VISIBLE, step 2 `<p id="s" show="">`.
- `<p if=@ok if=(@step==2)>`, `<p else else>`, `class="a" class="b"`, `<program reset="none" reset="none">` → no diag (first wins).
- `req req("m")` → only the Level-1-message refusal; not counted as a repeat. (`is some is some` already caught: the bootstrap reads `is`/`some` as opener words — `is` twice is a `mods` repeat.)

## Governing sentences
- §17.2: "The element EXISTS in the DOM regardless of `expr`." / "When `expr` evaluates to false, the element is hidden. The compiler generates a CSS `display: none` toggle." / "`show=` is distinct from `if=`: `show=` hides, `if=` removes."
- §17.1.1: "`if=`, `else-if=`, and `else` MAY coexist on the same element with `show=`. … first conditionally included in the DOM by the if-chain rule and then additionally subject to the `show=` visibility rule (§17.2). The two attributes compose without conflict."
- §34 E-ATTR-WRITER-CONFLICT (§5.5.3/§5.5.4): "`style=(expr)` with `if=`/`show=` … (`style`/`display` surface)".
- Duplicate attributes: §4, §5, §24, §34 searched — NO rule / code. → E-BOOTSTRAP-UNSUPPORTED.
- §55.1 / §55.12: `req` / `is some` are presence predicates (argument = message only, §55.10); `length(>2) length(<9)` is a conjunction.

## Landed
1. parse.scrml `repeatedAttrDiags` — at the end of parseOpener, every NON-declaration opener (element, `<program>`, state-child, `<effect>`, `<*x>`): a repeated name (case-insensitive) → E-BOOTSTRAP-UNSUPPORTED at each repeat. `class` vs `class:active` distinct. Decl openers stay with analyze `repeatedWordDiags`.
2. analyze `repeatedWordDiags`: a presence validator (`req`, `is some`) repeats regardless of argument.
3. §17.2 `show=`: Core `Attr.Show(test)`; analyze `AttrKind.AShow` (resolveShow / typeShowAttr = checkCond, no child narrowing); lower `showAttr`; print → `rt.visibility(scope, el, () => test)`; runtime `visibility` (captures the element's own inline display, toggles `none`). Composes with if-chains automatically (arm body is the element with its attrs).
   - E-ATTR-WRITER-CONFLICT: `style=(expr)` + `show=`.
   - Refused (E-BOOTSTRAP-UNSUPPORTED): quoted/valueless/braced condition; on a use (unless the decl has a field named `show`), `<*x>`, `<slot>`; `<each>`/`<errors>` already refused it.
   - State-children: ANY attribute other than `rule=` was ignored → now refused (closes 4 engine-twin FAILs that silently accepted `history`, `internal`, payload attrs, `bogus`).
4. Second-bind refusal skips the same-name pair (one diagnostic per fault; the parser's repeat refusal owns it).

## Counter (scripts/bootstrap-conformance.ts)
- before: PASS 91 · FAIL 57 · UNSUPPORTED 641
- after:  PASS 91 · FAIL 53 · UNSUPPORTED 645 (4 engine twins FAIL→UNSUPPORTED via the state-child attribute refusal)

## Dogfood
- The runtime already had a module-local `function show(x)`; adding `export function show` made Bun SILENTLY drop the export (Node rejects: "Identifier 'show' has already been declared"). Named the runtime fn `visibility`.

## Fix round (S239 review of 40902674c — MED + LOW-1 + LOW-2)
- MED: analyze `attrCaseDiags` (every non-use element) — a case variant of a scrml control name (if / else-if / else / show / ref / as / in / key / of / all / deps / rule, `on…`, any `x:y`) → E-BOOTSTRAP-UNSUPPORTED; exact `ref=` on an HTML element refused (§6.7.1a, not in the bootstrap). `<program>`: `unknownProgramAttrDiag` refuses a case variant of a program / control name instead of W-ATTR-001. SPEC names no attribute-name-case rule.
- LOW-1: parser repeats compare exactly; the case-folded repeat is HTML-only (attrCaseDiags) and program (via the variant refusal). Use fields `a` / `A` stay distinct (tested at runtime).
- LOW-2: parser `quotedInterpDiags` — a quoted value (any opener, incl. a decl's own value) holding `${` → E-BOOTSTRAP-UNSUPPORTED (§5.5.3 template not implemented). The §66.19.4 worked program's `style="background:${hex}"` was emitted literally; typer.test.js pin +1.
- Counter: PASS 89 → 88 · FAIL 48 · UNSUPPORTED 653. The lost PASS is `type-state-codes/e-state-undeclared-neg` (twin) — `<p onClick=f()>`: the bootstrap wired a `Click` event that never fires; codes-only case, so it passed vacuously on that axis. Now refused (the MED ruling). ⚑ PA: HTML would treat `onClick` as `onclick`; an alternative is to lower-case event names rather than refuse.
