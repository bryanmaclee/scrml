# scrml — Session 404 (bryan · ASUS-Vivobook) — WRAP

**Date:** 2026-09-06. Booted `/boot` Profile A onto `069e86fd`. **Successor to a LIVE S403-peter.**
**4 PRs landed** (#874 #875 #876 #877). Mechanical state — landings, counts, the session stream —
is in `docs/changelog.md` and `handOffs/delta-log.md` ([2856]–[2875]); this file carries only what
those cannot.

**The framing: the session opened on a ruling and turned into a verification audit.** bryan ruled
`int`/`number` in two messages. Everything after is instruments and gates being wrong — including
mine, twice, and one of those is the sharpest miss on the board.

---

## ⚑⚑ LIVE SIBLING — read before touching anything

**`S403-peter` was LIVE all session and is not wrapped.** Different machine (Windows clone), his own
lane. His in-flight arc: `docs/changes/library-mode-structural-routing-2026-09-06/`, worktree
`agent-a451e4f6606fbf34e` @ `4f139aa1`, touching `compiler/src/codegen/emit-library.ts` (+297/−54).
**The PA half is owed on HIS side** (S239 pass, the 71-changed-output verification, the full-suite
gate, the language-surface review). I stayed disjoint from it all session and did not touch
`emit-library.ts` or his worktree.

⚑ **Do NOT read this hand-off's silence about his arc as "nothing in flight."** The S401→S400
precedent is on the board: a wholesale `hand-off.md` rewrite ate a collaborator's pickup section.
This file is bryan-lane; peter's state lives in `../scrml-support/handOffs/active-sessions/S403-peter.md`.

---

## ⏭ NEXT-SESSION PICKUP

### 1. ⚑⚑ TWO RULINGS OWED, both from this session's own findings

**(a) The `${`-in-a-top-level-template root — the biggest thing found today.**
`g-splitblocks-consumes-dollar-brace-inside-a-top-level-template-truncating-the-string`, **HIGH**.
```scrml
<full>: string = `hello ${1 + 1} world`     // → "hello "   exit 0, ZERO diagnostics
<full>: string = `${@first} ${@last}`       // → ""         exit 0, ZERO warnings
```
`splitBlocks` tracks back-ticks only under a `meta` frame, so at top level the `${` opens a logic
block and the string is truncated there. ⚑ **There is NO working path**: nested inside `${}` the
splitter keeps the template whole and codegen then fails to lower the `@` sigil →
`E-CODEGEN-INVALID-LOGIC`. Top level lies, nested errors.
**Why it is a RULING and not a fix:** §44.8 already requires the `?{` scanner to respect
template-literal boundaries, added after *that* form produced silent data loss (*"Per S49,
silent-bad-output is unacceptable"*). **Nothing governs `${`** — searched §3.1, §4.18, §7.4.2,
§40.8, no governing sentence. Rule 4 outcome (2). The question is a §3.1 context-grid one: does a
back-tick shield `${` in a top-level default-logic body, and what about back-ticks in markup prose?
Corpus blast radius **0 real sites** (all 37 interpolated-template inits are indented) — blast
radius, NOT demand evidence.

**(b) The `int`/`number` BUILD, now that the ruling exists.** Not a new decision — a build gated on
its own measurement. Shape: bare `int` desugars to an implicit `number(integral)` so it enters the
§53.4 predicated path (**PA-verified it does not today**: `type-system.ts:3111` gates on
`indexOf("(") > 0`, so a bare annotation never becomes a `tPredicated` and never touches a zone),
with `integral` kept INTERNAL — no new adopter-visible predicate, the §55.1 14-item catalog stays
closed. **PA-decided sub-fork on fork-rule row 1 (limit beats widen); bryan may veto.**
⚑ **The gate is an ARTIFACT differential, not a diagnostic one** — `f(x: number)` into an `int`
parameter is `semantics-changed` (a boundary check appears where nothing is emitted today), and no
diagnostic moves. And ⚑ **position 3 has ZERO implementation** — this is "write the argument
assignability check", not "add a normalization"; see [2858].

### 2. THE INSTRUMENT — re-run it, do not re-quote it
`bun scripts/int-number-census.ts --summary` (`--json`, `--roots=`, `--selftest`; ⚑ the flag needs
the `=`). Q3 5-root: **69 provable / 93 strict of 120 · 43 integral literals · 0 non-numeric**.
Q4 reverse: **0 of 81**, a measurement not a floor. §7.5.1 has been corrected in place and now says
so, naming the instrument.

### 3. RULINGS OWED — carried, unchanged
- **dpa-030…044** — fifteen items, ALL `COMPLETE (ADVISORY)`, all bryan-lane, awaiting ratification.
- **The apostrophe restructure fork** (#862 OPEN / #865 DRAFT, held at five rounds). The inbound
  `2026-09-03-from-peter-to-bryan-engine-state-child-apostrophe…` is still bryan-owed and unarchived
  for that reason.
- **The worktree sweep** — 48 sweepable, **36 branches carrying work that never reached main**.
  ⚑ **86 worktrees remain after this session's 6b cleanup.** Dry run recorded S402; nothing removed.
- The `/` route collision · the pre-CE alias-mount residual · `g-cli-emits-artifacts` tier.

### 4. RULED THIS SESSION — do not re-open
- **`int` is a REFINEMENT (subtype) of `number`.** Option (a). The §53.4 three-zone model decides
  each site; the safe direction (`int` → `number`) never rejects.
- **FSP `Initialize` = coherent-(A)** + the handshake-response-shape design insight, both ratified.
  Return leg delivered to peter (#874); the build is his follow-on.

---

## 🔭 DURABLE

**Three findings this session, one shape:** a type alias voids the annotation that uses it · a
top-level template silently truncates · argument types are unchecked. **You write ordinary code, the
compiler accepts it, and it silently does the wrong thing.** bryan's S402 *"that was 100% of the
sample of what I attempted with the type system"* was not bad luck — it is the shape of the surface.

**A NO-DIFFERENCES verdict over a path never taken is vacuous, not clean.** Two zeros this session
proved it, both surfaced by an agent against its own work: the corpus artifact differential is
BLIND to #877's HIGH fix (0 translations reached `translateTemplateLit` over 1920 sources), and
`extractInitLiteral`'s population is 0 (278 calls, the only distinct argument is `""`). **Ask what
a zero measured before reading it as coverage.**

**A wrap PR is where a code-bearing change is least likely to be read.** #873 carried
`type-system.ts` +170 inside an 85-file docs-and-maps diff, merged unreviewed, and was the LAST
OWED review-floor item. The pass that found the defect ran only because the probe still named it.

---

## ⚑ MISSES (mine)

1. **★★★ I verified a COUNT and asserted a VALUE.** I filed a HIGH stating "a 22-character value now
   inhabits a `<= 8` predicate unchecked." I had checked the guard count (base 2 → HEAD 0) and never
   read the value. Both sides emit `""`; the base guards were **vacuous**. #873 had removed a guard
   that was **masking** a worse pre-existing bug, and satisfying my own DONE-PROBE would have
   restored the mask. A dispatched agent falsified it at the artifact level and was right.
   **Verifying one observable does not verify the claim you build on it.**
2. **★★ I briefed the arc's size wrong** — "`fieldTypeEquals` gets the normalization its siblings
   have" implied position 3 exists with one gap. It has **zero implementation**; that pair is bounded
   to §14.8.8 SQL-row width subtyping and reached from nowhere else.
3. **★★ I mis-read bryan's own ruling.** He described (a) and I recorded (b); the clause that
   discriminates ("int is a subtype of number") is (a)'s thesis while (b)'s text was "keep them
   DISTINCT". I noticed the clause and then wrote that the two options "express the same truth".
4. **★★ I relayed a reachability claim I had not verified** (component re-parse / meta-emit). The
   agent tried three times to construct a reaching case, failed, and **declined to certify it**.
5. **★ My cross-check greps were the wrong instrument, twice** — `\b` matches inside `int[]` (the
   71-vs-74 gap), and 9 enum-payload "hits" were inside `//` comments. Both times the parsing
   instrument was right and my regex was not.
6. **★ `--roots` needs the `=`** and I passed it space-separated, silently measuring the whole tree.
   The probe printed its own `scope:` line; I had grepped past it. Third instance of that trap here.

## Gate at close
Cloud `gate` **GREEN** on every PR this session (#874 #875 #876 #877). `tracking` RED — pre-existing
and filed (`g-dev-server-tests-expire-their-wait-budgets-in-cloud-ci-only`, plus
`g-types-check-red-on-main-with-12-pre-existing-diagnostics`, newly filed and independently
re-confirmed twice). Local post-commit reported 54 browser failures each time — **triaged, not a
regression**: docs-only diffs cannot move compiler behaviour, and after `bun run pretest` the flagged
file passes 26/0 (the known stale-gitignored-fixture class).
Gaps **HIGH 96 · MED 217 · LOW 90 · Nominal 7**. Review floor: see the wrap commit.

⚑ **This wrap's PR is deliberately titled `wrap(s404): …` and NOT left to `--fill`.** Left alone,
`gh pr create --fill` titles from the branch (`wrap/s404`), producing a merge subject the
recent-sessions matcher cannot see — the gap filed this session, which swallowed S402. Titling with
the paren form is the one-word workaround until that gap is ruled; **do the same next wrap, or this
session vanishes from the index too.**
