---
status: current
last-reviewed: 2026-08-01
---

# §34 catalog truthfulness — the catalogued-but-unfireable population

**Filed:** S310 (bryan · 2026-08-01). **Ruling:** bryan S310 — *"file the build arc."*
**Oracle:** `bun scripts/s34-census.ts --full` (committed with this doc; re-run it, do not re-derive).

## Why this is freeze-blocking

Per **§62.2** the conformance corpus IS the versioned contract. A catalogued diagnostic that cannot
fire is therefore a **false claim in the contract about to be frozen** — and it inflates the freeze
denominator, so it also distorts how far away 1.0 looks.

S305 and S307 found nine such codes *by hand*, one at a time, each by trying to make it fire and
failing (`E-ENGINE-001`, `E-MW-006`, `E-TYPE-042`, `E-ENGINE-006/-007/-008/-009/-011/-012`). This arc
replaces that anecdotal discovery with a computed population.

## The measurement

`bun scripts/s34-census.ts` over **804** §34 rows (723 host + 81 native §34.1):

| bucket | count | meaning |
|---|---|---|
| STRUCK | 28 | already retired — must never enter a denominator |
| PINNED | 335 | a conformance case positively asserts it fires |
| IMPL-SITES | 320 | live + unpinned + **has** an emitter → fire-attempt work (the tier-1 campaign's lane) |
| DECLARED-AHEAD | 13 | no emitter, but the row declares reserved/Nominal → honest |
| **FALSE-CLAIM** | **108** | no emitter anywhere **and** the row promises a live diagnostic |

The 108 triage into four dispositions:

| disposition | count | disposition rule |
|---|---|---|
| **BUILD-ARC** | **65** | normative home carries a `SHALL`/`MUST` and nothing emits it → **build** (bryan S310) |
| HOME-NO-SHALL | 29 | has a home but no SHALL — weaker claim; strike-or-downgrade, needs a ruling |
| ORPHAN-INDEX | 6 | appears ONLY inside §34 — phantom row; strike per the S307 `E-ENGINE-006..012` precedent |
| NOMINAL-HOME | 8 | home sits in a Nominal/spec-ahead section → honest; reclassify the row, do not strike |

## The governing sentences (§1 gate — quoted, not summarised)

§34 declares itself *"a reference index… The authoritative definition… is in the referenced section."*
So the normative claim lives in the referenced section, and these are what it says:

- `SPEC:3773` — *"**Error condition:** The compiler SHALL emit E-LIFECYCLE-001 if a `cleanup()` call, a
  `<timer>`, or a `<poll>` appears outside any element scope…"*
- `SPEC:3852` — *"The compiler SHALL emit E-LIFECYCLE-004 if a `cleanup()` call is detected where the
  first argument is not function-typed."*
- `SPEC:3856` — *"The compiler SHALL emit E-LIFECYCLE-005 if a `cleanup()` call appears directly inside a
  [server-annotated] function…"*
- `SPEC:4195` — *"The compiler SHALL emit E-LIFECYCLE-011 if the `running` attribute references a
  variable [that is undeclared or non-`@`]…"*

These are unmet normative obligations — the same class as S305's `E-ENGINE-001` ("both §51.5 SHALLs
violated"), not catalog hygiene.

## The headline family — §6.7 lifecycle: 35 catalogued, 8 built

Only `E-LIFECYCLE-009/010/012/015/017/018` and `W-LIFECYCLE-002/007` have emitters. The remaining
**21** (12 `E-` + 9 `W-`) are a third of the whole BUILD-ARC set, from one S84 "catalog addition" wave
that outran its implementation. The catalog says the language has 35 lifecycle diagnostics; it has 8.

The load-bearing one is `E-LIFECYCLE-002`: `cleanup(closeConnection())` **invokes eagerly and registers
the return value** as the teardown handler. Silent, and wrong in the direction of leaking the resource
the call was meant to release.

## Empirical confirmation — W1's representative, verified BY EXECUTION

The census is a triage; this discharges the execution check for the wave's headline code, so W1 starts
from a verified fact rather than a grep.

Reproducer (compiled against `main` at this arc's base):

```scrml
<program>
  <div>
    ${
      function closeConnection() {
        return 1
      }
      cleanup(closeConnection())
    }
  </div>
</program>
```

`bun compiler/bin/scrml.js compile <file>` → **exit 0**, ZERO `E-LIFECYCLE-*` diagnostics. This is the
exact shape §6.7.3 says SHALL emit `E-LIFECYCLE-002`. Confirmed: the code cannot fire.

**Incidental lead (NOT verified, do not scope from it).** The same run emitted
`W-DEAD-FUNCTION: Function 'closeConnection' has no callers` — while `closeConnection` sits inside
`cleanup(...)`. Reachability does not appear to see through `cleanup()` as a call site, which hints the
`cleanup()` surface is more broadly unwired than its diagnostics alone. W1 should establish what
`cleanup()` actually lowers to BEFORE writing the checks; if it is inert, "add the diagnostic" is the
wrong shape of fix and the wave needs re-scoping.

## Locus — PA-located-verify (base §5: a locus is a HYPOTHESIS)

TRACED, not searched — the six live lifecycle codes are emitted from:

- `compiler/src/codegen/emit-html.ts` — `E-LIFECYCLE-009/010/012/018`, `W-LIFECYCLE-002/007`
  (the `<timer>`/`<poll>` element diagnostics)
- `compiler/src/type-system.ts` — `E-LIFECYCLE-015/017`

**Hypothesis for the dead ones (VERIFY FIRST):** `E-LIFECYCLE-001/002/004/005` are `cleanup()`
argument-shape and scope checks, which is type-system-shaped work, so `type-system.ts` is the likely
home rather than codegen. The agent SHALL report whether that held, was refined, or was wrong.

## Waves

Ordered by guarantee-value, not by count.

- **W1 — §6.7 lifecycle `cleanup()` core** (`E-LIFECYCLE-001/002/004/005`). Smallest coherent slice that
  closes a normative obligation.
  **CORRECTION (S310, after this doc first landed):** an earlier revision said "the four with quoted
  SHALLs." Only **three** are — `-001`, `-004`, `-005` (SPEC:3773/3852/3856). **`E-LIFECYCLE-002` has NO
  `SHALL` sentence**; it is specified by a worked example (SPEC:3796, 5058), a summary-table row
  (SPEC:4870) and an error-message line (SPEC:5065). It stays in W1 on COHERENCE, not on its own
  normative force: `E-LIFECYCLE-004`'s catalog row states verbatim *"Same family as E-LIFECYCLE-002 but
  covers non-call non-function shapes"*, so building `-004` while leaving `-002` dead ships half a
  family. That is a weaker justification than the other three and should be stated as such.
- **W2 — §6.7 lifecycle remainder** (`E-LIFECYCLE-006/007/011/014/016/019..022` + the 9 `W-LIFECYCLE-*`).
- **W3 — the rest of BUILD-ARC** (44 codes across ~30 families: `E-ASSIGN-*` ×4, `E-HTML-*` ×3,
  `E-SCHEMA-007..009`, `E-USE-003/004/006`, `E-TYPE-027/028/072`, `E-COMPONENT-001/022/023`, …).
  Re-run the oracle at W3 start — W1/W2 will have moved the population.
- **W0 (parallel, cheap) — the 6 ORPHAN-INDEX rows.** No normative home anywhere. **Coverage-checked
  S310** so the strike deletes a dead row, never a live idea:

  | phantom | claims | disposition |
  |---|---|---|
  | `E-COMPONENT-003` | multiple `${...}` spreads in one component body | **duplicate of LIVE `E-COMPONENT-020`** (§15.14/§16.4, same trigger) → strike |
  | `E-COMPONENT-005` | caller provides children, component has no spread | **duplicate of LIVE `E-COMPONENT-021`** (§16.4, same trigger) → strike |
  | `E-PROTECT-002` | protected field access may run client-side | §11 is **"Reserved — Folded"**; `protect=` moved to §52/§14.8.9. Superseded by LIVE `E-PROTECT-004` (§14.8.9 protect-floor) → strike as fold-orphan |
  | `W-PROTECT-001` | fn touches protected field, not `server`-annotated | same §11 fold-orphan; §12.2 inference + §14.8.9 own this now → strike |
  | `E-COMPONENT-002` | required slot not filled at call site | **NO live coverage found** → strike the row, but FILE the behaviour as a gap |
  | `E-COMPONENT-004` | slot fill names a nonexistent slot | nearest sibling `E-COMPONENT-023` is itself unfireable → strike the row, FILE the behaviour |

  So: 4 clean strikes (2 duplicates of live codes, 2 orphans of a folded section) + 2 strikes that owe a
  filed gap. Each row gets the recorded search per pa-base §2.

**Each wave lands its §34 rows WITH its implementation** (Rule 4). A wave that builds the emitter but
leaves the row unpinned has not closed its slice — the conformance case is the merge-blocker.

## Definition of done (per wave)

1. The code fires on a real `.scrml` reproducer, verified BY EXECUTION (not by grepping emitted text —
   the S265/S268/S307 "emitted ≠ runs" trap, three occurrences).
2. A conformance case pins it (`expect.codes`), pos + neg halves.
3. `bun scripts/s34-census.ts` shows the code has LEFT the FALSE-CLAIM bucket.
4. Migration measured against the corpus BEFORE landing — every one of these is **newly-rejecting**
   (pa-base §8): source that compiles today starts failing. Assumed-zero is not measured-zero.
5. Full S239 adversarial pass before merge.

## HOME-NO-SHALL (29) — the bucket is partly a DETECTOR ARTIFACT, not a disposition

I originally offered this as one ruling (strike / downgrade / build the 29). **That framing was wrong**,
and `E-LIFECYCLE-002` is the proof: it sits in this bucket purely because the SHALL detector is
line-scoped, while it is plainly a member of a SHALL-bearing family. The 65/29 split is therefore
APPROXIMATE — the boundary is an artifact of how the probe reads, not a property of the codes.

Reading the 29, they are mostly the SAME families as BUILD-ARC:

| cluster | codes | note |
|---|---|---|
| §6.7 lifecycle | `E-LIFECYCLE-002`, `E-LIFECYCLE-013`, `W-LIFECYCLE-005`, `W-LIFECYCLE-009` | belong with W1/W2 |
| §11 fold-orphan | `E-PROTECT-001` | same dissolved section as the W0 protect phantoms |
| §41.13 parseVariant | `E-PARSEVARIANT-DISCRIMINATOR-MISSING`, `-UNKNOWN-VARIANT`, `-INVALID-PAYLOAD` | a SHIPPED feature (S65) whose boundary-parse errors never got emitters |
| §40 program/middleware | `E-PROG-001/002/005`, `E-MW-004` | one subsystem |
| §15/§16 component/type | `E-TYPE-070/073`, `E-COMPONENT-024` | one subsystem |
| singletons | the remaining ~12 | per-code reads |

**So this is not a separate ruling.** Fold them into the same per-family waves and decide with the
family, which is the unit the evidence actually supports. The one genuinely distinct sub-question is the
parseVariant trio: a shipped, adopter-facing primitive whose declared failure modes cannot fire.

## Honest caveats

- **The census is a TRIAGE, not a verdict.** FALSE-CLAIM membership is a hypothesis that still owes an
  execution check. What it *is* authoritative about is the negative: zero emitter mentions anywhere
  means the code cannot fire today.
- **The SHALL detector is line-scoped** — it matches a `SHALL`/`MUST` on the same line as the code, so a
  SHALL on an adjacent line is missed. That biases the count DOWN: 65 is a floor, not an inflation.
- **This session's own first census was wrong.** Scanning only `compiler/src` + `native-parser` reported
  121 dead; widening to all source trees gave 104 and split out 17 that live only in tests/tooling —
  17 false dead-code claims averted. The probe-trap notes in the script header are load-bearing.
