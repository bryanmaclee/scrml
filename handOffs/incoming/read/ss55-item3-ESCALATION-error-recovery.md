# sPA ss55 → PA · item 3 PARKED — design ruling needed (ErrorRecovery / oracle contract)

**List:** `spa-lists/ss55-self-host-v2-lexer-completion.md` · **Item:** 3 — slice-4c ErrorRecovery threading
**Status:** **PARKED** (not dispatched) — needs a PA design ruling. Per sPA contract I parked it and continued to items 4-5.

## The blocker — item 3's premise contradicts the token-diff oracle
Item 3 asks to "replace the `deferAdvance` swallow-unknown stub with **honest error-token emission + recovery**: on a malformed lexeme, emit an `ErrorToken` … Oracle: impl#1's error-token stream on malformed inputs." But I verified impl#1's ACTUAL behavior:

- **Stray chars:** impl#1's lexer **silently skips** them — `compiler/native-parser/lex-in-code.js:864-866`: `// Unknown — skip` → `advance(cursor,1); return true;` — **NO token emitted.**
- **Unterminated string/regex/template:** impl#1's scanners **truncate at EOF and emit the (partial) normal token** (StringLit/RegexLit/TemplateChunk with truncated raw) — **NOT a distinct error token.**
- **impl#2 (self-host-v2) TODAY already matches this** — its slice-1 `deferAdvance` stub silently skips unknowns, and its scanners truncate identically. So on malformed inputs **impl#1 and impl#2 already produce the same token stream** (both green under the current oracle).

⇒ There is **no impl#1 "error-token stream" to diff against** — impl#1 has no lexer-level error tokens. If impl#2 starts emitting honest `ErrorToken`s, it will **DIVERGE from impl#1 → the token-diff oracle goes RED** on every malformed input, unless the oracle's contract is changed to allowlist/normalize that divergence.

## The fork (PA ruling — this is BOTH a language-posture AND an oracle-contract decision)
- **Option A — parity (silent-skip):** impl#2 keeps impl#1's silent-skip/truncate. Item 3 shrinks to: formalize `deferAdvance` as an *intentional* skip and (optionally) thread an inert `recovery` field into `LexState`/`step` for the parser wave WITHOUT changing token output. Oracle stays green trivially. Lowest risk; but the lexer stays "swallow-and-continue," not fail-closed.
- **Option B — fail-closed divergence (impl#2 does it BETTER):** impl#2 emits honest `ErrorToken`s per the §4 fail-closed-Nominal invariant the item invokes. This deliberately makes self-host-v2 *diverge from* (improve on) impl#1 — consistent with the "self-host is a from-scratch rewrite that SHOWCASES scrml, not a mechanical parity port" ratification. **Cost:** the token-diff oracle (the wave's correctness contract) must be amended to handle impl#2-emits-a-token-impl#1-doesn't (e.g. strip `ErrorToken`s before diffing, or map impl#1-skip ≈ impl#2-ErrorToken). Changing the oracle contract is PA territory.

**sPA lean (not a ruling):** Option B fits the project philosophy + the §4 invariant the item cites, but it is a genuine two-part design decision (diverge-from-impl#1? + how does the oracle stay honest?) that only the PA can make. I did NOT guess.

## Impact on the rest of the list
Items 4 (BareVariant) and 5 (value-keyword-regex) do NOT depend on item 3 — I'm proceeding with them on the item-2 base (`fe53bf78`). When you rule on item 3, it re-fires against whatever tip items 4-5 land at. The lexer reaches "token-class complete" via 1/2/4/5; item 3 is the fail-closed-posture refinement, cleanly separable.
