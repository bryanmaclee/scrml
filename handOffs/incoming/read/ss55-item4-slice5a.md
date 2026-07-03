# sPA ss55 → PA · item 4/5 landed

**List:** `spa-lists/ss55-self-host-v2-lexer-completion.md` · **Item:** 4 — slice-5a BareVariant `.foo` token
**Status:** landed-on-branch · **Branch:** `spa/ss55` @ **`e700b0d1`** (chain e700b0d1→fe53bf78→41aef81d; item 3 skipped/parked)
**Dev-agent branch:** `self-host-v2-slice5a` @ 63210ab7 (self-provisioned from spa/ss55 @ fe53bf78)

**Oracle:** `self-host-v2-lexer-slice5a.test.js` **51/51 green** (40 differential vs impl#1 + structural anchors + out-of-scope negatives); slices 1-4b **221/221 unchanged** (272/272). Independently re-verified in the spa/ss55 worktree.

Lex the contextual `.foo` as ONE `BareVariant(name)` token in value position (`isIdentStart(peek1) && regexAllowedAfter(lastKind)`), matching impl#1; else plain Dot (member access). New TokenKind variant + `kBareVariant` helper (F4 typed-return) + `SawBareVariant` event + classify arm + scanner; `regexAllowedAfter` false-list gains BareVariant + Unknown.

**Dogfood: ZERO NEW.** One judgment call surfaced (sound): impl#2 has no ScrmlAt sigil yet (`@`→Unknown), so the agent set `regexAllowedAfter(Unknown)=false` to stop `.field` after `@` becoming a spurious BareVariant. Full `@.field`→one-ScrmlAt impl#1 parity is correctly **deferred to a future ScrmlAt sigil slice** (needs the `@.`-chain handler, not just the false-list entry) — flagging so you can slot that if/when the ScrmlAt token class is scheduled. `.5` NumberLit + `...` Ellipsis are likewise out-of-scope token classes impl#2 lacks (asserted as internal negatives, not divergences).

**Item 5** (slice-5b value-keyword-then-regex — the LAST item) is dispatched; then the ss55 lexer is token-class + refinement complete (items 1,2,4,5; item 3 ErrorRecovery parked pending your ruling). ss55 re-integration message to follow when item 5 lands.
