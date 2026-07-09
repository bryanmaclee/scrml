# BRIEF — url-comment-context (2026-07-09)

## Task
Fix a confirmed compiler miscompile: a bare URL in CSS `url()` or in markup prose
makes the block-splitter fail with E-CTX-003 (unclosed context). The `//` in
`http://` is mis-treated as a `//` line comment that eats to end-of-line,
swallowing the closing `}` of a `#{}` CSS block or the `</p>` close tag.

Empirically confirmed baselines:
```
#{ background: url(http://example.com/a.png) }   →  E-CTX-003 Unclosed 'css' (+ 'div')
<p>Visit http://example.com now</p>              →  E-CTX-001/003
```

## Fire site
`compiler/src/block-splitter.js`, comment-handling region. The S144 `openStringQuoteAt`
guard already handles a `//` INSIDE a quoted string (`"https://..."`). The gap is an
UNQUOTED `//` in CSS `url(http://…)` (bare) and markup prose (`Visit http://x`).

## Desired behavior (per brief) vs SPEC (Rule 4)
Brief's stated desired behavior: `//` is a comment ONLY in JS/logic context; NOT in
CSS (`#{}`) or markup TEXT.

CONFLICT (Rule 4): SPEC §27.1 says "`//` is a single-line comment. It is valid in ALL
scrml contexts." §27.2 explicitly lists CSS as accepting `//`. So the brief's premise
("CSS has no `//` line comment") is SPEC-divergent, and empirically `#{ color:red // note }`
COMPILES today (BS strips the `//` CSS comment). Dropping `//`-as-comment in CSS would
REGRESS that + violate §27.

Resolution: fix the confirmed bug in a SPEC-PRESERVING way. Keep `//` a universal comment
(§27) in CSS/logic/markup, and EXEMPT actual URLs only: a `//` that is a URL scheme
separator (`://`) or sits inside a CSS `url(...)` token is DATA, not a comment. This fixes
both confirmed inputs (+ protocol-relative `url(//cdn)` + match/each-arm prose URLs) without
regressing `//` comments anywhere. The broader §27-narrowing the brief describes would be a
SPEC amendment requiring ratification — surfaced to PA, NOT silently implemented.

## Region discipline
Shared file with a LIVE S246 session (§65 CSS element-recognition). Touch ONLY the
comment-handling region. Do NOT touch §65 `<theme>`/`<defaults>`/css-conflict logic.

## Native parser
Check `compiler/native-parser/` with `--parser=scrml-native`; fix same bug if present.

## Deliverables
- SPEC-preserving URL-aware fix at the `//`-comment sites.
- Conformance/integration tests for the two confirmed inputs + regression guards.
- Full pre-commit gate green (0 fail).
