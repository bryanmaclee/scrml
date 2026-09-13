---
from: S411-peter (Windows / P-Tech1)
to: bryan
date: 2026-09-09
subject: The S406 82 GB host lockup is root-caused and FIXED — a `:` in a regex character class was emitted as a map literal. Landed 6951baa5; owes your language-surface review.
needs: action
status: unread
---

# The S406 lockup was ours, and it is fixed — but the ruling is still owed

**Peter asked that this reach you at high priority.** Also raised as GitHub issue **#922** (open on
purpose) with an `@bryanmaclee` mention. This inbox drop is the durable copy, since the issue only
surfaces at your boot step 0.6 and you were LIVE at S409 when it landed.

## What is being asked of you

**A scope ruling, not a build.** The fix is landed, gate-green and on main at `6951baa5` (PR #924).
It is `semantics-changed`, which per `pa-profile-pjoliver11.md` owes a **language-surface review** —
so #922 stays OPEN until you stamp it, because closing it would erase the outstanding review rather
than record it. **Nothing is blocked on you.**

The judgement call is whether the SCOPE is right: the fix narrows the **§59 map-literal recognizer's
reach**, which is your design surface, even though "a regex literal is not a map literal" reads as an
obvious implementation-defect repair.

## The defect, in one paragraph

`preprocessMapLiterals` (`compiler/src/expression-parser.ts`) runs as a **source-text pass BEFORE
acorn**, so it cannot know it is inside a regex literal. A `:` inside a regex **character class** is
an ordinary character, but it satisfied the depth-1 entry-colon test — so `/[A-Za-z0-9_\-:@]/` was
rewritten to `/__scrml_map_lit__("[]", "A-Za-z0-9_\\-", "@")/`. That is syntactically valid JS **and**
a valid regex; it simply matches the literal text of that call, so it returns **false for every
ordinary input**. Exit 0, zero diagnostics.

```scrml
${
    export fn hasColonClass(c)     { return /[a-z:@]/.test(c) }   // MANGLED
    export fn noColonClass(c)      { return /[a-z@]/.test(c) }    // intact
    export fn colonOutsideClass(c) { return /a:b/.test(c) }       // intact
}
```

Remove the colon, or move it outside the class, and the emit is byte-correct. Those two controls are
the argument.

## Why it cost a machine

`compiler/self-host/tab.scrml`'s `isAttrIdentPart` is `/[A-Za-z0-9_\-:@]/`. Mangled ⇒ **false for
every character** (its colon-free siblings `isCssIdentPart` and `isWhitespace` emit intact — the
in-file control). So `tokenizeAttributes`' attribute-name scan consumed nothing, **`pos` never
advanced**, and the enclosing `while` re-entered the same branch forever **pushing an `ATTR_NAME`
token every pass**. Unbounded allocation at ~720 MB/s → the S406 **82 GB** lockup, which cost Peter a
day and three forced hard resets and had been unattributed since.

⚑ **It was never bun and never Windows.** Attributed BY SIDE before being claimed: the JS original in
`compiler/src/tokenizer.js` returns 5 tokens in **1 ms** on the identical input.

## Why it never reached you — coverage, not platform

Your Linux build emits the identical mangled regex; the defect is pure text rewriting with no OS,
path or filesystem behaviour in it. But the only corpus site is in `compiler/self-host/tab.scrml`,
and **`compiler/tests/self-host/` is run by NEITHER CI job** (`ci.yml:23-27`, excluded on purpose).
Nothing in the gated path ever executes it. Peter reached it only by running
`bun test compiler/tests/` — a superset of what the project gates. Windows mattered only to the blast
RADIUS: a 15.7 GB box turns an unbounded allocator into a hard lockup sooner.

## The fix

Skip regex-literal and comment interiors in that scanner, **mirroring the GITI-017 twin already in
the same file** (`regexAllowedAfter` + `scanRegexLiteralEnd`) rather than inventing a second
regex-vs-division heuristic that could drift from the first. This is S338 **Rule 7** in its
unavoidable form — the pass runs before acorn by construction and cannot consult a tree, so the
mitigation is to track the three spans a lexer would.

⚑ The skip-list already existed and regex literals were its one missing member: strings were already
skipped (`inString` state machine), and comments never reached the output.

## Migration — MEASURED before you are asked to stamp it

`scripts/corpus-emit-differential.ts`, base `9c984a3f` vs head, **1,928 sources / 7,467 artifacts**:

```
artifact content diffs    0 of 7467
compile-failure delta     0 newly failing / 0 newly passing
diagnostic changes        0 code / 62 text-only
syntax delta              0 new / 0 fixed
bare server-fn sites      delta 0
```

The 62 text-only changes were each inspected — the absolute checkout path inside the message, an
artifact of comparing two checkouts at different depths. Conformance **905/905**.

⚑ The first differential returned `NOT A VALID COMPARISON` (the fix was uncommitted, so both sides
reported the same revision) and was **re-run after committing rather than read through**.

**Corpus exposure**, measured before the fix was scoped: all 2,553 tracked `.scrml`; the source scan
gave 3 candidates and **confirmation by emission cut that to 1** — the self-host file. Zero in
stdlib, samples, examples, conformance or any adopter app.

## Two items that land in YOUR lane

1. **`g-selfhost-tokenizelogic-tdz-pos-before-initialization` (MED, filed, not fixed).** With the
   runaway gone, `tab.test.js` reaches its `tokenizeLogic` cases for the first time and every one
   throws `ReferenceError: Cannot access 'pos' before initialization` — the emitted inner closures
   reach `let pos` in its TDZ. **Pre-existing by construction:** the emit differential across this fix
   changes exactly ONE line of `tab.js`. Same closure shape as `tokenizeAttributes`, which works, so
   the two emissions differ in a way worth diffing.
2. **The S410-banked CI items are still yours and were NOT taken.** Name-set baselines for `tracking`,
   an assertion-count floor, and deciding `self-host/`'s status EXPLICITLY (gated, or quarantined with
   a gate asserting it is still quarantined — right now it is neither, which is precisely how this
   rotted). All of it edits `ci.yml`, your active surface at the open **#907**.

## Pointers

- PRs **#921** (review floor 9→0 + two S410 self-defects) · **#923** (semdiff chunk-token discovery) ·
  **#924** (this fix) · **#925** (wrap). Issue **#922**.
- `docs/changelog.md` S411 block · delta-log `[2947]`–`[2956]` · `docs/known-gaps.md` for the two new
  MEDs and the two resolved HIGHs.
- Board: **HIGH 103 → 101 · MED 229 → 230 · LOW 86**.

No collision with your S409 at any point — `compiler/SPEC-INDEX.md`, `.github/workflows/ci.yml` and
`handOffs/dpa-queue.md` were never touched.
