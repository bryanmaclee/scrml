# progress — url-comment-context (2026-07-09)

## Triage (DONE)
- Reproduced both confirmed baselines (stage BS): CSS `url(http://…)` → E-CTX-003
  Unclosed 'css'; markup prose `http://` → E-CTX-001/003. Root cause: `//` eaten as
  line comment through EOL, swallowing `}` / `</p>`.
- Empirical sweep of current behavior:
  - `#{ color:red // note }` COMPILES today → `//` IS a working CSS comment (SPEC §27.2).
    ⇒ brief's "CSS has no `//` comment" is SPEC-divergent; a context-narrowing fix would
    REGRESS this. Fix must be SPEC-preserving (URL-exemption only).
  - `url(//cdn.example.com/x.png)` (protocol-relative) ALSO fails — same bug class,
    broader than the 2 brief cases. Rule 2 → handle it too.
  - `<match>`/`<each>` arm prose with a URL ALSO fails (findStructuralBodyEnd path).
  - compound state-decl `<Card> = { ... url(...) }` compiles clean (scanCompoundBlockEnd
    not independently triggered by the tested shapes; the state-decl-with-css-child
    failure was the MAIN-LOOP css bug cascading).

## Fix sites identified
1. Main loop `//` handler (~L2238, inline) — CSS brace ctx + markup-text. [both brief cases]
2. `findStructuralBodyEnd` (~L682) — `<match>`/`<each>` raw-body arm prose URLs.
3. `scanCompoundBlockEnd` (~L1994) — compound span scan (mirror #2 for consistency).
   - `skipTriviaForCompoundScan` (~L458) LEFT ALONE: only skips LEADING trivia, stops at
     the scheme letter, never reaches a URL's `//`; delicate R28-BUG-3 machinery.

## Fix design
Module-level helper `urlSlashesAt(source, slashPos)` → true when the `//` is URL content:
  (a) immediately preceded by `:` (scheme `://`), OR
  (b) inside an unclosed CSS `url(...)` token on the current line (protocol-relative).
Applied ONLY in CSS + markup-text (NOT logic/SQL — URLs there are quoted strings, already
handled by `openStringQuoteAt`). Narrow: fires only on real URLs, so genuine `// comment`
lines (whitespace/nothing before `//`) still strip normally → §27 preserved.

## Native parser (Charter B) — SAME bug in markup prose, FIXED
- `--parser=scrml-native`: css-url PASSED already (native CSS uses shapeCssBlock,
  not the comment path); markup-url FAILED (E-MARKUP-002 / E-CTX-001) — same
  `//`-eats-`</p>` bug in the markup trampoline (parse-markup.js emitComment).
- Fix: pure `urlSlashesAt(cursor)` in block-context.js (mirror of the JS helper);
  emitComment consults it for the Line form only, in markup context. Logic bodies
  (dispatchInLogic, line ~1536) untouched — JS `//` semantics preserved.
- Both .js (live) + .scrml (S115 lockstep mirror) updated.
- Parity-neutral: parser-conformance within-node gate residuals UNCHANGED (the 3
  over-budget fixtures router/regex/solid-spreadsheet are PRE-EXISTING; verified
  identical residuals at true baseline, block-splitter-only, and full-fix states).

## Out-of-scope same-class bug SURFACED (not fixed — different file)
- `compiler/src/match-statechild-parser.ts` `skipMatchComment` (~L99) has the SAME
  `//`-eats-to-EOL bug for a URL in `<match>`/`<engine>` arm PROSE. My BS
  findStructuralBodyEnd fix makes BS capture the arm body correctly, but the
  arm-body RE-TOKENIZER then drops the arm's `</>` (E-MATCH-PARSE-001). Different
  file, outside the brief's stated fire site — surfaced for a follow-on dispatch.
  (engine-statechild-parser.ts likely has the parallel site.)

## Pre-existing unrelated defect NOTED
- `#{ color:red // note }` compiles but the `//` CSS comment LEAKS into output
  (`this: ; is: ;` property mangling). Identical before my change (my fix does not
  fire — space before `//`). Separate CSS-comment-stripping defect, out of scope.

## Status
- [x] Triage + empirical sweep
- [x] BRIEF.md + progress.md
- [x] Implement helper + 3 block-splitter sites (main loop, findStructuralBodyEnd,
      scanCompoundBlockEnd); skipTriviaForCompoundScan left untouched
- [x] Native parser check + fix (.js + .scrml)
- [x] Tests: conf-url-comment (8, BS structure), url-comment-context (4, e2e
      compile), native-url-comment (9, native) — 21 new, all green
- [x] Full gate green — 19691 pass / 65 skip / 0 fail (unit+integration+conformance)
