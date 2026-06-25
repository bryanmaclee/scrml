# sPA ss28 — native-parser / markup tokenization ⚠ HAZARD-FLAGGED

**Launch:** `read spa.md ss28` · **Branch:** `spa/ss28` · **Worktree:** `../scrml-spa-ss28`

**Fill:** the parser-termination + markup-tokenization residuals that live in the NATIVE parser / markup-scan layer — a non-terminating compile (rails-dev), a markup-comment angle-bracket mis-tokenization, and the quoted-text §4.18 native-only fire. NEW S221. ⚠ **HAZARD — needs native-parser expertise + heavy conformance verification** (native parser mid-migration; S115/S162 `.scrml`-mirror lockstep hazards; a no-forward-progress fix can shift the conformance corpus). **PA may prefer to hold this for a native-parser-specialist dispatch rather than a generic sPA** — flagged accordingly.

## Shared ingestion
The **native-parser front-end** (`compiler/native-parser/`) + the markup tokenization/comment scanner: `nativeParseFile`, the token-advance/no-forward-progress invariant, the markup-section comment scan, and the conformance oracle. **READ FIRST:** `.claude/maps/primary.map.md` (the legacy-BS vs native-parser fork) + `docs/changes/ss7-rails-dev-hang/FINDINGS.md` (8 reduced reproducers; the full sample IS the minimal repro) + the parser-conformance harness (`compiler/tests/parser-conformance-lexer.test.js`). Per S115/S162: a native-parser `.js` fix may NOT have a current `.scrml` mirror — brief the conditional re-sync, don't assume lockstep.

## Core files
`compiler/native-parser/*` (`nativeParseFile`, lex, parse-markup) · `meta-eval.ts:380` (the re-parse entry that reaches the rails-dev loop) · the markup-section comment scanner · `compiler/tests/parser-conformance-*.test.js`

## Items (least-ingestion-first)

1. **`g-markup-comment-angle-bracket-parsed-as-tag`** (MED) `[status=open]` — a literal `<tag>` inside a `//` MARKUP-section comment is parsed as real markup (`// NOT a <form> … <each>` had `<form>`/`<each>` consumed as opening tags → corrupted a downstream `<match for=LogPhase>` → `E-MATCH-PARSE-001`). `//` in JS/logic sections is inert to angle brackets; markup-section `//` is not. **Fix:** the markup-section comment scanner must suppress angle-bracket tokenization. Repro: `// foo <bar> baz` in a markup body. Reporter flogence #2. Most bounded.
2. **`nominal-3` — quoted-text model §4.18 compiler fire** `[status=nominal]` — the `E-UNQUOTED-DISPLAY-TEXT` under-quote fire is NATIVE-PARSER-ONLY (`parse-markup.client.js:493`), absent from the default pipeline (S220 verify-before-claim CATCH — the type-system hit was the MIRROR `W-DISPLAY-TEXT-OVERQUOTE`). Wiring it is native-parser work. Verify the native-parser fire path before claiming it buildable on the default pipeline.
3. **`g-mount-hang-rails-dev`** (MED, robustness) `[status=open]` — `compile` infinite-loops at 100% CPU inside `nativeParseFile` (reached from `meta-eval.ts:380` re-parse) on `samples/gauntlet-r18/rails-dev.scrml` → exit 124, 0 output (reclassified S211; the "mount hang" diagnosis was WRONG). A parser that fails to terminate on malformed input hangs the whole compiler. **Fix target:** instrument `nativeParseFile` on the full repro to find the no-forward-progress token (the full sample is the minimal repro — block ACCUMULATION loops; 8 reduced repros all error cleanly). Heaviest — ordered last; needs the most native-parser depth.

## Progress
`ss28.progress.md`. Land on `spa/ss28`; ping PA inbox per-item. Do NOT advance main / push. ⚠ **FULL conformance suite mandatory** on every land (native-parser shifts the corpus) + the `.scrml`-mirror conditional-re-sync check (S115/S162). **If the assigned sPA lacks native-parser depth, STOP at #3 and hand back** — PA may route #3 to a native-parser-specialist dispatch instead. PA re-integrates (S67 + R26 + conformance + mirror-grep).
