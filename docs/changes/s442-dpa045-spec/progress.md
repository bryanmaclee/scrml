- 2026-09-29 start at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a33767a8215d9e61d (base origin/main 6dccbd6c)
- 2026-09-29 STEP 1 (E) measurements done — results below. Probe sources in ws-matrix/ (renamed .scrml.txt so no corpus sweep picks them up); counter in measure-backslash.ts.

## E(a) — whitespace-β oracle diff (shipping compiler, default parser, HEAD 6dccbd6c)

| # | surface | source bytes | emitted | verbatim? |
|---|---|---|---|---|
| 1 | plain `<p>` at top level (HTML) — leading/trailing/runs/tabs/newlines | `WSA:   lead and trail   :WSA`, `   WSB`, `WSC   `, `WSD  two   three`, tabs, `line1\nline2` | byte-identical | YES |
| 2 | `<div>` body with newline + indentation after `>` | `\n    WSE …\n        WSE2 …\n` | byte-identical (indent kept) | YES |
| 3 | `${}`-adjacent text in plain `<p>` | `before ${@x}   after   ${@x}  end` | spaces around each `<span data-scrml-logic>` kept | YES |
| 4 | `if=`-guarded element (template) | `   WSQ  if-guarded   div   ` | byte-identical inside `<template>` | YES |
| 5 | plain `<p>`/`<span>` nested in a match arm / engine state child (client JS string) | `   WSK  match-arm   nested-p   ` / `   WSP …   ` | byte-identical in the arm's `return "<p>…"` | YES |
| 6 | engine `:`-shorthand display-text literal | `"   WSO  engine  shorthand   "` | inner bytes verbatim, quotes stripped | YES |
| 7 | engine / match BLOCK-form display-text literal | `"   WSN  engine   block   literal   "` | whitespace verbatim BUT the quote marks ship as content (known Call-2 defect) | YES (ws) / quotes wrong |
| 8 | component body (`const Box = <div>…</>`), text directly in body | `\n      WSJ   comp   body   ${…}   tail\n  ` | `\nWSJ comp body <span…> tail\n` — indentation stripped, runs collapsed to 1 space | NO |
| 9 | `<p>`/`<span>` nested inside a component body | `   WSA  p-in-comp   ${@n}   tail   ` | ` WSA p-in-comp <span…> tail ` — runs (incl. leading/trailing) collapsed to 1 space, not stripped | NO |
| 10 | component body, single-line, no trailing ws in source | `<section>WSC-single-line  two  spaces</section>` | `WSC-single-line two spaces </section>` — runs collapsed AND a trailing space ADDED | NO |
| 11 | component body, multi-line `<p>` with tabs | `WSA line one\n          line two …` / `WSB\ttab\tsep` | newlines kept, indentation stripped, tab→single space | NO |
| 12 | `lift <li>` text inside a `for` in `${}` (client DOM build) | `   WSR  lifted   ${it}   li   ` | `createTextNode("WSR lifted")`, interp, `createTextNode("li")` — each segment TRIMMED + runs collapsed; the spaces around `${it}` are DELETED (renders `WSR liftedali`) | NO — content loss |
| 13 | markup-as-value in `${}` (`const frag = <p>…</p>`) | `   WSD  markup-as-value   ${@n}   end   ` | `"WSD markup-as-value"`, interp, `"end"` — trimmed + collapsed, interp-adjacent spaces deleted | NO — content loss |
| 14 | `lift <li><span>…</span></li>` | `   WSE  nested-in-lift   ` | `"WSE nested-in-lift"` | NO |
| 15 | `lift <li>WSF-a${it}b…</li>` (no ws) | `a${it}b` | `"WSF-a"`, interp, `"b-no-spaces"` | YES (nothing to lose) |

Summary: the static-HTML path for plain markup (top-level / `<program>` markup, `if=` templates, markup nested in match arms and engine state children, both display-text-literal loci) preserves whitespace byte-for-byte. Three paths do NOT: (i) component-definition bodies (collapse runs, strip indentation, tab→space, and in one case ADD a trailing space); (ii) markup built client-side from logic (`lift`, markup-as-value) — per-segment trim + collapse, which DELETES the whitespace adjacent to `${…}` (a visible content change, not a cosmetic one). SPEC §4.18.5's "runs collapse, leading/trailing strips" is false for the main path and only partly describes the other two (the component path collapses but does not strip; the lift path strips AND drops interp-adjacent spaces, which §4.18.5 never described).

## E(b) — backslash-in-plain-markup-free-text count

Method: `splitBlocks` (the shipping block splitter) over every `.scrml` in the seven dirs; text blocks whose parent is a plain-markup element are free-text; excluded: `<program>`/`<page>` bodies (default-logic), engine/match bodies + state-children/arms (code-default — scanned separately for display-text-literal escapes), `<pre>`/`<code>` bucketed as raw-content. Probe-validated (C:\Users path, `\n` in prose, `<pre>` regex, `\"` block-form, `\\` shorthand all detected). Blind spot: markup inside `${…}` (lift / markup-as-value) is not split by the BS; covered by the full-text grep below.

| dir | .scrml files | backslashes in free-text | in raw-content `<pre>/<code>` | root text |
|---|---|---|---|---|
| examples | 71 | 0 | 0 | 0 |
| samples/compilation-tests | 805 | 0 | 0 | 0 |
| conformance/cases | 1127 | 0 | 0 | 0 |
| stdlib | 53 | 0 | 0 | 0 |
| docs/tutorial-snippets | 15 | 0 | 0 | 0 |
| docs/readme-snippets | 9 | 0 | 0 | 0 |
| compiler/self-host-v2 | 58 | 0 | 0 | 0 |
| **total** | **2138** | **0** | **0** | **0** |

Cross-check: raw grep finds 347 `\` chars on 161 lines in 38 files; every one is in logic — ~99 lines JS string escapes (`\n` in `emit(...)` strings, `"\""`, `"\\"`), ~41 lines regex literals (`/\d/`, `/\+/g`, the `pattern(/…\s…/)` state-decl attribute in examples/30), ~22 lines comments. None is in a markup free-text body, including markup nested in logic.

Code-default escape catalog (§4.18.3) use: display-text literals seen = 40 (37 `:`-shorthand, 3 block-form). `\"` = 0, `\\` = 0, `\${` = 0. Zero uses of the catalog anywhere in the corpus. (Side finding: the block splitter itself splits `"lit \${5}"` into text `"lit \` + a live logic block `${5}` — a third locus where `\${` is not honoured.)
