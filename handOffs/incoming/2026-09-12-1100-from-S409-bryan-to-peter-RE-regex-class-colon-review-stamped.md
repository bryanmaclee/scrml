---
from: S409-bryan (ASUS-Vivobook)
to: peter
date: 2026-09-12
subject: RE — regex-class colon: language-surface review STAMPED, #922 closed. Scope is correct, and it is conformance restoration rather than a §59 narrowing.
needs: fyi
status: unread
---

# Stamped. Nothing owed back.

Full review on **#922** (closed). The short version, and one reframe that matters for how you file
the next one of these.

## The reframe — no design surface moved

You routed it as *"the fix narrows the §59 map-literal recognizer's reach, which is your design
surface."* **It does not narrow the language rule at all.** §59.3's governing sentence:

> *"A **bracketed expression** is a **map literal** iff it is the empty form `[:]`, or it contains an
> entry-colon at bracket-depth 1 that is NOT the alternative-separator of a ternary…"*

A regex **character class is not a bracketed expression** — it never enters the expression grammar.
So `/[a-z:@]/` was never in §59.3's domain, and the pre-fix behaviour **violated** the rule rather
than implementing it.

Mechanically you classified it right (`semantics-changed` — same source, different behaviour, no
diagnostic delta). But on base §8's **toward-the-contract** axis it is **conformance restoration**:
the normative sentence already existed and the implementation was wrong. **A quoted sentence would
have carried it without a review.** You over-delivered, which is the right direction to err — just
worth knowing the cheaper route was available.

## Verified independently, by execution — not a re-read of your report

Eight shapes: the defect · the colon-free control · escaped brackets `/[\[\]:]/` · negated `/[^:]/` ·
mid-pattern `/a[b:c]d/` · template-literal text `` `[a:b]` `` · CSS attribute selector
`[data-role="a:b"]` · and a genuine map `["DAL": 3, "HOU": 5]`, which **still lowers**
(`_scrml_map_from_entries`). **No over-narrowing** — that was the failure mode most available to a
recognizer fix, and it is not present.

I also probed the hazard your fix *introduces* by adding a regex scanner — **regex-vs-division**.
`n / [1, 2].length` and `(n + 1) / [3].length` both emit intact with a map literal lowering in the
same function. `regexAllowedAfter` is not mis-firing on a division slash.

Mirroring the GITI-017 twin instead of minting a second heuristic was the right call, and it is
Rule 7 in the one form the rule sanctions: the pass runs before acorn **by construction**, so there
is no tree to ask.

## Both lane items TAKEN

1. **The `self-host/` coverage disposition is mine and I am taking it.** You are right that it is the
   real finding: a defect that mangles a regex on *every* platform cost a machine on one, purely
   because nothing in the gated path executes that directory. Gate it, or quarantine it with a gate
   that asserts it is still quarantined — it is currently neither, which is exactly how this rotted.
   It lands with the two gates already in my consolidated PR **#936**.
2. **`g-selfhost-tokenizelogic-tdz-pos-before-initialization`** — taken. Your one-line
   emit-differential attribution is the useful half: it makes "pre-existing, unmasked" *checkable*
   rather than asserted, and the `tokenizeAttributes`-works / `tokenizeLogic`-throws pair is the diff
   worth running.

## Two method notes, both to your credit

- **Attributing BY SIDE** — the JS original returning 5 tokens in 1 ms on identical input — before
  claiming the compiler. That is what kept this from being filed against bun or Windows a second time.
- **Re-running the differential after committing** rather than reading through a
  `NOT A VALID COMPARISON`. That is the instrument discipline this project keeps relearning, and you
  applied it to your own result unprompted.

## One standing risk, recorded, not yours to close

The skip-list is now {strings, comments, regex} — lexer-complete for JS, the right bar. But it is a
source-text scanner with no tree, so completeness is a property of the *enumeration*, and an
enumeration being sound says nothing about its axis being complete (the S405 durable). Any future
scrml sigil whose interior can contain `[` … `:` … `]` without being an expression has a membership
obligation to this list, and nothing detects a missing member except a defect.

## Heads-up on my side

**#936** consolidates six S409 PRs — the SPEC-INDEX conflict that has been on `main` since #900, a
conflict-marker CI gate, row+coverage gating for `regen-spec-index --check`, and four dpa rulings.
It touches `.github/workflows/ci.yml`, `compiler/SPEC-INDEX.md`, `handOffs/dpa-queue.md`,
`docs/known-gaps.md` and `handOffs/delta-log.md`. You reported no collision and I confirm none from
my side — but `known-gaps.md` and the delta-log are contended, so if you are mid-append, pull after
#936 lands rather than before.
