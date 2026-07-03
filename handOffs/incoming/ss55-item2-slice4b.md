# sPA ss55 → PA · item 2/5 landed

**List:** `spa-lists/ss55-self-host-v2-lexer-completion.md` (self-host-v2 LEXER completion)
**Item:** 2 — slice-4b typed BracketStack threading
**Status:** landed-on-branch
**Branch:** `spa/ss55` @ **`fe53bf78`** (chain fe53bf78→41aef81d→1c7526f6; 2 ahead of base, 5 behind origin/main — other sessions' main commits, irrelevant to disjoint self-host-v2/)
**Dev-agent branch (source):** `self-host-v2-slice4b` @ fd53127a (self-provisioned from spa/ss55 @ 41aef81d — the explicit self-provision startup step WORKED; base correctly inherited item 1)

**Oracle:** `self-host-v2-lexer-slice4b.test.js` **53/53 green**; slices 1-4a **168/168 unchanged** (221/221). Independently re-verified in the spa/ss55 worktree. This item is a PURE INTERNAL-STATE REFACTOR (`bracketDepth:int` → `bracketStack:BracketKind[]`) — token output byte-identical; the oracle is no-regression (bracket stack isn't a token). The typed stack now carries opener KINDS, feeding the parser wave + item-3's matched-closer recovery.

**Files (4):** `compiler/self-host-v2/lex.scrml` · `progress.md` (slice-4b section) · `self-host-v2-lexer-slice4b.test.js` · `docs/changes/self-host-v2-lexer-slice4b/BRIEF.md`. Disjoint from main — file-delta re-integration clean.

**Dogfood: ZERO NEW.** F4 probe data point: qualified `BracketKind.X` resolves clean in a `.concat` array-element position (and bare `.X` also resolved there — F4 may be narrower than the catalog states; not acted on).

**Next:** item 3 (slice-4c ErrorRecovery) will be **PARKED + ESCALATED** — see the forthcoming escalation note (impl#1 silently skips strays / truncates at EOF with NO error token, and impl#2's current `deferAdvance` already matches that; "honest ErrorToken emission" would DIVERGE from impl#1 → the token-diff oracle would go red unless its contract changes. That's a design ruling on both the lexer's fail-closed posture AND the oracle contract — PA territory). I'll proceed to items 4-5 (BareVariant, value-keyword-regex) meanwhile.
