# progress — native-lift-markup-closetag-span-2026-06-04

## Startup (2026-06-04)
- pwd: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a2d6a18443a3e1561
- merged e9d1f3cb (clean fast-forward), HEAD == e9d1f3cb confirmed
- bun install + bun run pretest OK
- maps read: primary.map.md (full) + domain.map.md "Native-Parser Swap Orientation" + structure.map.md "Native-Parser File Table"

## PHASE 0 — root-cause confirmation (REVISED diagnosis)
Symptom reproduced: native fails `lift <li>x</li>` with E-STMT-MISSING-SEMICOLON + E-STMT-UNCLOSED-BLOCK; default clean.

Brief hypothesis was (a) parse-markup.js slice span opener-only OR (b) parse-expr.js close-end derivation.
EMPIRICAL PROBES DISPROVED BOTH:
- `parseMarkupTrace("<li>x</li>", {inMarkupValueSlice:true})` returns nodes[0].span.end == 10 (FULL element, past `</li>`). CORRECT.
- With trailing tokens (`<li>x</li>; } }</ul>`) still nodes[0].span.end == 10. CORRECT.
- Instrumented parseMarkupValue: sliceStart=27, sliceCloseEnd=10, closeEnd=37 — CORRECT close-end.

REAL ROOT (token-stream level, NOT span):
The native lexer (lex-in-code.js) eagerly tokenizes the WHOLE `${...}` code body, INCLUDING the markup-as-value bytes `<li>x</li>`, as JS. Token dump at the markup-value entry:
  [LessThan @27-28 <] [Ident @28-30 li] [GreaterThan @30-31 >] [Ident @31-32 x] [LessThan @32-33 <] [RegexLit @33-41 "/li>; } "] [EOF @41-41]
The `</li>` close-tag's `/` (at pos 33) immediately follows a `<` (LessThan @32-33). `regexAllowedAfter(LessThan)` returns TRUE, so the lexer starts a RegexLit at `/` and runs to end-of-body (no closing `/`), SWALLOWING `/li>; } }` into one runaway RegexLit @33-41.
`advancePastSourcePos(cursor, closeEnd=37)` then can't resync: the runaway RegexLit straddles 37 (ends at 41 > 37) so the cursor parks on it, and the rest of the body (`; } }` block closers) was eaten by the regex. Downstream TAB sees the leftover bogus token => E-STMT-MISSING-SEMICOLON + E-STMT-UNCLOSED-BLOCK.

Why default is clean: Acorn (default JS lexer) NEVER sees the markup-value bytes — block-splitter+ast-builder carve the markup-value region out BEFORE JS lexing. Confirmed: acorn tokenizes `x</li>` as "Unterminated regular expression" ERROR (same runaway-regex behavior); the default pipeline avoids it by never JS-lexing markup-value interiors.

## Fix site decision: NEITHER (a) NOR (b) — it's a LEXER regex/division mis-decision (call it (c)).
Site: lex-in-code.js dispatchInCode `/`-regex branch (~L483). Fix: when the `/` is source-adjacent to a preceding `<` (LessThan) — i.e. a `</` close-tag sequence — treat `/` as division (skip the regex branch), so the markup-value interior tokenizes into short walkable tokens and advancePastSourcePos resyncs cleanly past the full element.
Safety: `a < /b/` (genuine JS regex-after-less-than) has a SPACE — `<` and `/` are NOT source-adjacent — so the adjacency guard leaves it untouched. Only the no-space `</` (close-tag) is affected, which is never a legitimate regex start in scrml code position.

GATE: PROCEED — localized lexer fix (the expected "localized span-computation"-class shape, just at the token layer not the span layer). Not a multi-stage fork.

## Implementation (2026-06-04)
Fix is TWO coupled parts (both required for byte-identical):

### Part 1 — lexer regex/division carve-out (lex-in-code.js dispatchInCode ~L483)
A `/` source-adjacent to a preceding `<` (LessThan) — the `</` close-tag — is treated as DIVISION, not a regex start. Stops the runaway RegexLit that swallowed the close-tag + rest of body. Adjacency guard (`lastTok.span.end === startPos`) leaves genuine `a < /re/` (gap-separated) untouched.
RESULT: native parses `lift <li>x</li>` to exit 0, zero E-STMT — BUT then the `x` text child was dropped (NEW divergence surfaced).

### Part 2 — markup-value child Text/Comment content recovery (parse-expr.js + translate-stmt.js)
Root of the dropped `x`: the M6.2a bridge (translate-stmt.js translateMarkupValueToLiveNode -> synthLiveChildren -> mapBlocksToNodesForBridge) passed `source=""`, so synthTextNode's `value: sliceSpan(source, span)` returned "" for every Text child. Native Text blocks carry ONLY a span (no inline .text), so content MUST be recovered by slicing.
Fix: parse-expr.js attaches `mvNode.sliceSource = sliceTail` (the markup-value slice, 0-based at `<`) onto the MarkupValue node; child blocks carry SLICE-LOCAL spans (shiftMarkupBlockSpan shifts only the TOP block), so sliceSpan(sliceTail, childSpan) recovers verbatim text. translate-stmt.js threads sliceSource through synthLiveMarkupNodeFromBlock -> synthLiveChildren -> mapBlocksToNodesViaLazyRequire (5 sites). Absent -> "" (pre-existing crash-free path, unchanged).

### Minimal repro: BYTE-IDENTICAL native==default, exit 0, node-check ok, 0 E-STMT.

## Tests (2026-06-04)
Added compiler/tests/unit/native-lift-markup-closetag-span.test.js (12 tests, all pass):
- R26 byte-parity (native client.js === default) across 5 shapes: single paired / nested / interpolation / with-attrs / self-closing.
- zero E-STMT-MISSING-SEMICOLON / E-STMT-UNCLOSED-BLOCK + zero fatal errors on native for each.
- child text `x` RECOVERED on the lift markup node (single + nested).
- self-closing case asserted as a no-regress guard.

## PHASE 3 — R26 EMPIRICAL VERIFICATION (verbatim)
Per-shape: diff -r OUTPUT DIRS (emitted .js/.html), node --check native client.js, E-STMT count on native log.

### Minimal repro fixtures (compiler/tests/fixtures/native-lift-closetag-*.scrml)
- single  (`lift <li>x</li>`):                 default exit 0 / native exit 0 / diff -r BYTE-IDENTICAL / node --check ok / E-STMT 0
- nested  (`lift <li><span>x</span></li>`):    default exit 0 / native exit 0 / diff -r BYTE-IDENTICAL / node --check ok / E-STMT 0
- interp-attrs (`lift <li class="cell">${col}</li>`): default exit 0 / native exit 0 / diff -r BYTE-IDENTICAL / node --check ok / E-STMT 0

### Real affected-test sources
- promote-each shape (`lift <li>placeholder</li>` in Tier-0 for): BYTE-IDENTICAL / node --check ok / E-STMT 0
- bug65 shape (`lift <li onclick=@phase.advance(.Active)>${col}</li>` — close-tag + attr-handler + interpolation): BYTE-IDENTICAL / node --check ok / E-STMT 0

ALL shapes PASS the R26 gate. (Output dirs are byte-identical including emit; the I-PARSER-NATIVE-SHADOW info line is on the log/stderr, not in emitted output files.)

## OPTIONAL — blast-radius confirmation
- 3 affected unit test files (promote-each / lift-engine-advance-bug65 / each-in-tier0-lift-bug72): 52/52 pass under DEFAULT (no regression). These tests assert the close-tag shape that R26 now proves byte-identical under native.
- Real affected sources R26-byte-identical under native: promote-each `lift <li>placeholder</li>`, bug65 `lift <li onclick=@phase.advance(.Active)>${col}</li>`, board `lift <div><LoadCard .../></div>` (all BYTE-IDENTICAL native==default, E-STMT 0; board exits 1 in isolation only on E-COMPONENT undefined LoadCard — IDENTICAL on both pipelines).
- Corpus scan (20 close-tag-lift candidate files): 9 now native E-STMT-clean. The 11 residual-E-STMT files (board/billing/drivers/...) have E-STMT from OTHER native gaps (F2 SQL `?{}` in server-fn — e.g. board lines 46/57), NOT the close-tag shape: board native E-STMT unchanged 8→8 pre/post my fix, and board's close-tag lift IS byte-identical in isolation. My fix neither regresses nor touches the F2 family.

## FINAL STATE
- Pre-commit gate: 15953 tests, 0 fail (+12 new). Within-node 1005/0 (histogram −19, all DECREASES — convergence; no class increase; no rebump needed — allowlist tolerances already cover, test passes).
- All 3 source edits + 1 new test + 3 fixtures committed. Tree clean.
