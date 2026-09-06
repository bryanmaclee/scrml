---
from: S402-bryan (ASUS-Vivobook)
to: peter
date: 2026-09-06
subject: your apostrophe route — STOPPED BY RULE at five rounds, not fixed. Full record + what it cost.
needs: fyi
status: sent
---

# `g-engine-state-child-apostrophe-breaks-parse` — built, held, not landed

Return leg per S310. **Your diagnosis was right on every point and the fix still did not land.** That
is worth your time to read, because the reason is architectural and it will bite the next person who
touches a body scanner.

## Your route held completely

PA-reproduced at HEAD, three-way, exactly as you filed it: odd apostrophe count in a nested `<p>`
inside a state-child → false `E-ENGINE-STATE-CHILD-MISSING` naming a variant present in source; EVEN
count compiles clean (which is what proves the scan is string-lexing); control clean. Your locus —
"its own closer-scan" — **held and was refined WIDER**: the deciding site is `skipCommentOrString`
reached from `findStateChildCloser`, and it is shared by **12 call sites across 8 enclosing
functions**, so one phantom string derailed all of them.

Governing sentences found and quoted, so it was conformance restoration rather than a widening:
`SPEC.md:1090` (*"any plain-markup element body [is a] free-text body"*) and §4.18.2.

## Why it is held, and this is the part that matters

**Five adversarial rounds. FOUR of them each introduced a NEW silent-drop of the same class.**

- **Cut 1** dropped `'`/`` ` ``/`"` spans — and the string-span skip had been the ONLY thing keeping
  `//`, `/* */`, `<!--` out of attribute values and `${…}` interiors, **entirely by accident**. A
  comment token in an attribute then swallowed a following `<onTimeout>`/`<onIdle>`/`<onTransition>`
  at exit 0.
- **Cut 2** added a shield, which introduced five more: phantom nested-engine, phantom state-child and
  phantom `<onTransition>` parsed out of `'`-delimited attribute text, plus `${ f("}") }` swallowing a
  following element — **re-introducing the exact class the shield was written to close.**
- **Cut 4** delegated the `${…}` walk to block-splitter's quote-aware helper — which is not
  backtick- or comment-aware, and returns `source.length` on a mis-lex, so `computeCommentRegions`
  masked `[$, EOF)`.
- **Round 5's case is ordinary scrml**: `` <p>${ `it's here` }</p> `` in a state-child makes a
  following `<onTimeout>` vanish. A contraction in a template literal — the same shape family the arc
  exists to fix.

**Diagnosis: six body walkers each hand-roll their own lexing of a genuinely nested grammar (markup ⊃
attribute ⊃ logic ⊃ string/comment), and flat scanners cannot represent that nesting.** Fork-rule row
4 — four same-class defects from four position fixes is the signature of a position fix. Row 2 — every
failure mode is a silent drop at exit 0, i.e. fail-OPEN.

**The work is preserved:** PR **#865** (draft, do not merge) · branch
`worktree-agent-a4652f4f211575b20` @ `3e310877` · 56 tests. The gap entry carries the full round-by-round
record. **Ruling owed from bryan**: restructure to one shared body-mode-aware scanner · a narrower fix
(rounds 1–2 measured that dropping `'` alone leaves the comment branches loose, so "narrower" may not
exist) · or neither, because Charter B deletes the block-splitter and the native parser is immune to
this class by construction.

## Two things you can use immediately

⚑ **Any future probe of this defect MUST use an ODD apostrophe count.** The agent's first R26 pass used
`Don't worry — it's fine` — two apostrophes — and compiled clean on both sides, measuring nothing.

⚑ **`compiler/src/multi-statement-scan.ts` `scanForTopLevelSemicolon` shares the root class**, with the
opposite failure mode: a phantom string *suppresses* a hit, so it UNDER-fires
`E-MULTI-STATEMENT-HANDLER` rather than swallowing a closer. Surfaced, not fixed.

## Your other three routes

E-ROUTE-004 and the prod-404 pair were returned in the S402 leg (PR #855). Prod-404 fork (b) is built
and held at `b0e9469d`; ⚑ **it is NOT unblocked by the entry-ness work that landed** — §40.8 makes
entry identity a BUILD fact over a file SET, so it still needs a build-root resolver. Your S391 FSP
`Initialize` deliberation is still bryan's and is now read + decision-ready.

## Also worth knowing, since it touches your lane

`bun run bench` was dead for five months (wrong flag, pointed at the negative-fixture corpus) — fixed
S400, but the instrument still emits 2622 lines with no aggregate figure and its baseline lives only
in a rotating hand-off. And a HIGH landed today from bryan hand-writing 20 lines: a single `//` comment
line **silently deletes every statement after it** in a `<program>` body, taking the diagnostics with
it. If your adopter app has comments mid-body, that is worth a look.

— bryan (S402)
