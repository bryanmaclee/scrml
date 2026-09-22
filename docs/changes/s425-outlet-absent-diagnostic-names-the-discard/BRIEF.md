# BRIEF — `W-OUTLET-ABSENT-SOFT-NAV-DISABLED` must name the discard, and §34's severity rationale must be struck

**change-id:** `s425-outlet-absent-diagnostic-names-the-discard`
**dispatched:** S425-bryan, 2026-09-21
**base:** `origin/main` (the worktree is cut from `origin/main`, NOT from the dispatching checkout — S346)
**ruling:** bryan, S425 — *"your recs go"*, ratifying option **(c)** of the fork tabled in
`g-outlet-absent-composition-resolves-the-route-slot-by-tag-and-discards-the-chosen-main-s-authored-children`:
*"keep the behaviour; fix the diagnostic — name the discard in the lint text and strike §34's false
`informational only`."* **(c) was ratified UNCONDITIONALLY. Option (a) — refusing the shape — is NOT
in scope here** and has gone back to bryan as a separate ruling because its migration measured
non-zero (§8).

**direction-of-change: INERT.** Nothing about what compiles, what is refused, or what a program means
may move. This is diagnostic TEXT plus a normative-prose correction. If you find yourself changing a
predicate, a fire condition, or a severity, STOP — that is out of scope.

---

## The defect, PA-measured by execution on `428e390d`

A `pages/`-bearing project whose `<program>` shell declares no `<outlet>` has its **first `<main>`
commandeered as the route-composition slot, and composition REPLACES that element's children** — they
are deleted from every composed page. A/B on the reporter's own 12-line case:

| variant | `shell-authored-child` in emitted `index.html` |
|---|---|
| `<main>` holds the authored `<div>` **and** `<outlet/>` | **1** — survives (the slot is a SIBLING `<div data-scrml-outlet>`) |
| `<main>` holds the authored `<div>`, `<outlet/>` removed | **0** — silently discarded |

Scope of the loss: **the authored children of whichever element the fallback finder picks** — NOT
shell markup generally. A `<header>` outside that `<main>` survives intact. Do not overstate it.

And it is live in-corpus: `examples/23-trucking-dispatch/app.scrml`'s `<main>` carries an
`<h1>Welcome`, a description, a "Get started" card and a stress-test callout; built static, `app.html`
carries all three markers and **all 24 composed route pages carry zero**, with the build printing
`scrml build complete`.

## What the diagnostic says today, and why it is the thing that misled an adopter

`compiler/src/ast-builder.js` (locate by the string `"W-OUTLET-ABSENT-SOFT-NAV-DISABLED"`, NOT by a
remembered line — line numbers in this repo rot, see the entry's own corrections) emits, verbatim:

> `…with no <outlet>, soft navigation and <a> link-boost have no region to swap into and fall back to
> hard (full-document) navigation. **If SSR-first hard navigation is your intent, this lint is
> informational only — no action required.** To enable soft navigation, add a single <outlet/> …`

**"no action required" is false.** Action IS required whenever the chosen `<main>` has authored
children, because they are deleted. The reporter read exactly this sentence, concluded the trade was
"full page loads instead of soft nav — a performance choice", removed their `<outlet/>`, and **lost a
generated 73-link reference sidebar from all 99 pages of `scrml.dev`.** They caught it by diffing the
emitted artifact before shipping; nothing warned them.

`compiler/SPEC.md` §34's catalog row for the same code carries the same false claim in normative
prose: *"…fall back to hard (full-document) navigation; **this is informational only (SSR-first hard
navigation still works)**."*

## SCOPE — exactly three edits

1. **`compiler/src/ast-builder.js`** — rewrite the message so it names the discard. It MUST state
   that the shell's first `<main>` becomes the composition slot and that its authored children are
   replaced on every composed page. **Strike the "no action required" clause** — replace it with the
   conditional truth: informational only *if that `<main>` has no authored children you need to keep*.
   Keep the existing remedy sentence (`add a single <outlet/>`) and the §20.8.1 pointer. Keep the code
   and `severity = "info"` EXACTLY as they are.

2. **`compiler/SPEC.md` §34** — strike the `(SSR-first hard navigation still works)` parenthetical and
   the "informational only" claim from the row, and replace them with the measured behaviour. Add a
   `> **Provenance:** adopter:scrml-site-2026-08-19-outlet-discards-shell-children-repro` line per
   Rule 4b — this is a normative-prose correction, so it owes one.

3. **`compiler/SPEC.md` §20.8.1** — the sentence *"A multi-page project (`pages/` present) whose shell
   declares no `<outlet>` SHALL emit W-OUTLET-ABSENT-SOFT-NAV-DISABLED and fall back to hard
   navigation"* is silent on the discard. Add ONE sentence recording it as current behaviour.
   ⚑ **Do NOT write it as a `SHALL`** — §20.8.1.1's marker-never-tag `SHALL` already says the slot is
   marker-keyed, which this behaviour violates; blessing it normatively would ratify the bug. Record
   it descriptively and cross-reference the open gap.

## MUST NOT

- Do not touch `findBareMainOpenTag`, the composition path, or `logicRanges`.
- Do not change the code's severity, its fire condition, or `W-PROGRAM-SPA-INFERRED`'s mutual
  exclusion with it.
- Do not implement option (a). It is bryan's, unruled, and its migration is non-zero.

## Tests

Two files assert this code — find them by grepping the code string, and update any that assert the
message TEXT:
`compiler/tests/integration/navigate-w-outlet-absent.test.js` ·
`compiler/tests/integration/trucking-dispatch-smoke-integration.test.js`

**Add a pin that the message names the discard** (assert on a distinctive substring of the new text),
so a future reword cannot silently drop it again — that is the whole failure this change repairs.

## Verification required before reporting DONE

1. `bun test compiler/tests/integration compiler/tests/unit` — report pass/fail COUNTS and, if
   anything fails, the failure NAME-SET, never just the count.
2. **An emit differential**: this change is INERT, so compile the corpus before and after and prove
   **zero artifact diffs and zero diagnostic-code deltas.** A changed message string may move
   diagnostic TEXT; it must not move any CODE or any emitted artifact. State the command you ran.
3. Re-run the A/B reproducer above and paste the NEW message verbatim.

Report: files touched, the verbatim new message, the differential result, and whether the locus this
brief named held, was refined, or was wrong.
