# MK3.2 — DisplayTextLiteral literal scanning (non-interpolation)

Per-agent progress file (append-only). A parallel M3.4 dispatch runs concurrently —
do NOT share a progress.md.

## Startup

- 2026-05-20 — worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a2db0149b0105480a
- Startup verification PASS: pwd under .claude/worktrees/agent-, repo root matches,
  tree clean, `git merge main` fast-forwarded to 3524e69b, all predecessor file
  pairs (display-text-literal / body-mode / parse-markup / parse-ctx / tag-frame
  .scrml+.js) present, `bun install` ok, `bun run pretest` ok.

## Reading

- Maps read: primary / structure / dependencies / schema.
- Roadmap §0 / §3.3 (MK3.2 row — authoritative scope) / §4.4 K-class.
- Charter dive Q1.E (DisplayTextLiteral sketch) / Q3.A (§4.18 mapping) / Q3.B
  (worked-example trace) read.
- SPEC §4.18 (§4.18.1-§4.18.9) read IN FULL via SPEC-INDEX (lines 1106-1268).
- Predecessor native-parser files read in full: display-text-literal .scrml+.js,
  body-mode .scrml+.js, parse-markup .js, parse-ctx .js, cursor.js, span.js,
  lex-in-template.js, lex-in-single-string.js, tag-frame.js (diagnostic sink).

## SPEC findings (load-bearing)

- §4.18.3 — `"`-only delimiter; `'` and backtick are ORDINARY interior chars;
  `\"` and `\\` are escape sequences. §4.18.4 — `\${` escapes a literal `${`.
  A backslash before any other char is malformed → E-PARSE-001.
- §4.18.5 — whitespace inside the literal is VERBATIM (no collapse, no strip).
- §4.18.3 / §4.18.7 — unterminated literal (EOF or body closer before the
  closing `"`) → E-CTX-001 against the OPENING `"`; recover by treating the
  captured text from the opening `"` through the closer/EOF as the literal's
  content and continuing.
- The display-text-literal escape set is DELIBERATELY MINIMAL (`\"` `\\` `\${`)
  — NOT the full JS escape table. MK3.2 does NOT reuse lex-in-single-string's
  scanStringEscape (which decodes `\n`/`\xHH`/`\uHHHH`/...); it uses a
  literal-specific escape scanner.

## Scope (roadmap §3.3 MK3.2 row)

IN: display-text-literal's `.Outside`/`.InLiteralText` scanning logic — the `"`
open/close transitions, `\"`/`\\`/`\${` escapes, verbatim whitespace, `'`/backtick
as ordinary chars; emit the DisplayTextLiteral AST node; unterminated → E-CTX-001.

NOT IN (forward-refs to MK3.3, documented): `${...}` interpolation (.InInterpolation
delegation to the M2 JS expression parser); E-UNQUOTED-DISPLAY-TEXT (§4.18.7).

## Plan

1. display-text-literal.js — the literal-scanning surface: scanDisplayTextLiteral
   (the `.Outside`→`.InLiteralText`→`.Outside` traversal), the escape scanner,
   makeDisplayTextLiteralNode, the E-CTX-001 unterminated diagnostic.
2. display-text-literal.scrml — fill the `.Outside`/`.InLiteralText` engine bodies
   + mirror the new live surface 1:1.
3. Conformance — extend parser-conformance-markup.test.js with the MK3.2 section.

## Progress

- 2026-05-20 — progress file (commit 0de8e8fd). Startup verification PASS;
  pre-commit gate baseline 13362 pass / 0 fail / 88 skip / 1 todo (the
  non-browser subset the hook runs).
- 2026-05-20 — display-text-literal.scrml/.js — the MK3.2 literal-scanning
  surface (commit 9d5c8a49). scanDisplayTextLiteral (the .Outside ->
  .InLiteralText -> .Outside scan); classifyEscape + scanLiteralEscape (the
  \" \\ \${ escapes + the malformed-escape E-PARSE-001 path);
  makeLiteralSegment + makeDisplayTextLiteralNode (the {kind, segments,
  exprs, span, terminated} node); the ctx.diagnostics sink (E-CTX-001 +
  E-PARSE-001). The .Outside/.InLiteralText engine bodies filled in the
  .scrml. .js + .scrml written in lockstep — exported surfaces 1:1.
  Smoke-verified: basic literal / escapes / verbatim whitespace / ' + `
  ordinary / unterminated E-CTX-001 / malformed escape / interp-stop seam.
- 2026-05-20 — parser-conformance-markup.test.js — 11 MK3.2 describe blocks
  §44-§54 (commit ca85ab47). Markup conformance suite 364/0 (+55 MK3.2
  tests). Covers escape classification/scanning, the basic scan, ' + `
  ordinary chars, the three escapes, verbatim whitespace, unterminated
  E-CTX-001 recovery, malformed-escape E-PARSE-001, the interpolation-stop
  seam, the AST node, and the SPEC §4.18 worked examples.

## MK3.3 forward seam (documented)

- scanDisplayTextLiteral returns `stoppedAtInterp: true` at an un-escaped
  `${`; the cursor is left AT the `$`. MK3.3 resumes there — opens the
  .InInterpolation composite state-child, pushes an Interpolation
  DelegationFrame, delegates the `${expr}` body to the M2 JS expression
  parser, and on the matching `}` returns to .InLiteralText to continue
  accumulating segments.
- The DisplayTextLiteral node already carries an `exprs` array (empty at
  MK3.2); MK3.3 fills it + splits `segments` at each interpolation — the
  one-node-per-literal `{segments, exprs}` shape (SPEC §4.18.4 / D3).
- E-UNQUOTED-DISPLAY-TEXT (SPEC §4.18.7) — a parse OUTCOME of the
  code-default body grammar (a body-mode-aware dispatch that decides
  literal-vs-bare-code). NOT in MK3.2 (no code-default body scan exists
  yet); MK3.3 wires it.

## SPEC discrepancy noted (non-blocking)

- SPEC §4.18.3 says `\"` and `\\` are "the only two escape sequences"
  inside a display-text literal; §4.18.4 then adds `\${`. MK3.2 treats all
  THREE as valid (§4.18.4 governs `\${`) — the roadmap MK3.2 row + the
  charter Q1.E sketch both enumerate the three. The §4.18.3 "only two"
  phrasing predates / does not cross-reference §4.18.4's `\${`. Surfaced
  to PA — a one-line §4.18.3 editorial fix ("the escape sequences `\"`,
  `\\`, and — per §4.18.4 — `\${`") would remove the apparent conflict.
  Non-blocking: the implemented behavior is the union, which is what every
  authority (roadmap, charter, §4.18.4) agrees on.

## Verification

- Full `bun run test` — see the final report block.
