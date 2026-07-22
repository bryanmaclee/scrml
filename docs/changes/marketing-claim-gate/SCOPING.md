# SCOPING — the marketing claim-gate (and the PA that rides it)

**change-id:** `marketing-claim-gate`
**Authored:** S280 (2026-07-22, bryan) · scoping only, nothing built
**Status:** `current` — **OQ-1..OQ-4 RULED by bryan (S280, "your rec")**: all four resolved to the PA lean. Ready to dispatch U1+U2.
**Destination when landed:** `docs/changes/marketing-claim-gate/SCOPING.md` (held in scratchpad — S279 is live in the shared checkout)

---

## §1 The problem

Marketing output makes **claims**. A claim that was true when written rots silently: the syntax changes, the count moves, the Nominal section never ships. Unlike compiler output, nothing fails when a marketing claim goes stale — it just sits there being wrong in front of the exact audience it was written to persuade.

bryan's stated worry, verbatim: *"my worry is that the marketing PA will not maintain the discipline to ensure that everything we put out is up to date. AI hallucinations would be very anti-productive."*

**This is a GATE problem, not a discipline problem.** Per flobase CORE: a reasoning record is navigable, never authoritative; "done" means the executable gate passes, never "the PA says so." A marketing PA with no gate is by definition landing on served reasoning. The fix is not a more careful PA — it is a gate that makes carefulness unnecessary.

### §1.1 Empirical evidence (S280, this session)

Drafting one letter to Tris Oaten produced **two** wrong claims, both PA-authored, inside a full Profile-A session:

| # | Claim | Class | Caught by |
|---|---|---|---|
| 1 | "packages, docs, tooling — you're right, I don't have a good answer" | fact | PA, by running `ls stdlib/`, `wc -l SPEC.md`, `ls compiler/src/commands/` — **21 stdlib modules, ~41k lines of spec, 10 CLI verbs all existed** |
| 2 | "the framework layer is the thing scrml replaces" | framing | **bryan.** Every word factually defensible; the framing implied a React-swap and understated the claim |

And in bryan's **original** email to Tris (pre-S280), the worked example used `@name` decls, `<machine>`, and `->` match arms — **all three now invalid syntax.** That one is pure fact-class and a compile-gate would have failed it on sight.

Sample size of one letter: 3 defects, 2 of them mechanically catchable.

---

## §2 The claim taxonomy (the load-bearing analysis)

Not all claims are gateable, and conflating them is how a gate gets oversold. Five classes:

| Class | Example from the Tris letter | Gate | Automatable |
|---|---|---|---|
| **C1 — Code** | any ` ```scrml ` block | compile + ghost-lint on the current compiler | ✅ **fully** (exists for README) |
| **C2 — Derived number** | "745 conformance cases" · "21-module standard library" · "~41,000 lines of specification" | regenerate from the repo, diff against on-disk | ✅ **fully** (mirror `state.ts`) |
| **C3 — Capability** | "the client/server split gets inferred" · "confidentiality floors on database reads" | cite resolves to a real SPEC § or conformance case **and that § is not Nominal** | ⚠️ **partial** — cite-resolution and Nominal-detection automate; whether the cite *supports* the sentence does not |
| **C4 — Comparative** | "TypeScript, React, Next, Prisma, Zod, Tailwind, NextAuth, Vite — that's the surface area one compiler covers" | none mechanical | ❌ human ruling |
| **C5 — Framing** | "the framework layer is the thing scrml replaces" | none mechanical | ❌ human ruling |

**C1 + C2 are the hallucination-prone classes and both automate completely.** That is the answer to the stated worry. C4/C5 are judgment, they stay bryan's, and the gate must not pretend otherwise — overselling it is how a gate becomes a rubber stamp.

### §2.1 ⭐ The Nominal trap — the scrml-specific highest-risk vector

`compiler/SPEC.md` carries **74 Nominal / spec-ahead markers**. A Nominal section is fully specified and **not implemented**.

So a C3 claim can be *spec-backed and functionally false at the same time* — the single most dangerous shape in this project, because the citation makes it look verified. "scrml has realtime feeds over external DB writes" cites §38.13, which is real, normative, and **unbuilt**.

This is checkable. Nominal banners are greppable, so the C3 gate rejects any cite landing in a Nominal section unless the doc explicitly marks the claim as forward-looking.

**No other project in the ecosystem has this hazard in this form.** It is the strongest single argument for building the gate rather than trusting a contract.

---

## §3 Survey — what already exists (depth-of-survey discount, applied)

Per PRIMER §12: audit estimates for "new infrastructure" routinely overstate by 2-5× because existing infrastructure partially covers the gap. Survey run before scoping:

| Asset | What it does | Reusable for |
|---|---|---|
| **`scripts/extract-readme-scrml.js`** (S101, ~150L) | extracts ` ```scrml ` fences from `README.md`, compiles each, runs `lintGhostPatterns`, exits 1 on any failure; `// gate: skip` opt-OUT marker | **C1 — nearly verbatim.** README-specific only in `const README_PATH` and log strings |
| **`scripts/git-hooks/pre-push`** | fires the README gate **only** when the push payload contains `refs/tags/v*` | trigger model to widen |
| **`scripts/state.ts`** | `--write` regenerates every `@generated:*` doc section from derive-functions; `--check` regenerates in-memory, diffs, **exit 1 on stale** | **C2 — the exact pattern**, anchor-replace and all |
| **`docs/tutorial-snippets/`** (11 `.scrml`) | tutorial code already lives as real compilable files, not fences | precedent: extract-to-real-file beats fence-only |
| **`.github/workflows/ci.yml`** | `gate` (required) · `tracking` · `windows` | where the new checks hang |
| **`scrml-voice-author`** agent | already described as *"structurally a guard against fabricating expertise the user does not actually have"*, verbatim-quote-citation as mechanism | precedent for citation-as-gate; the C3 shape |

**Finding: the gate is ~70% built.** S101 already solved C1 for one file and wrote down the rationale that is now bryan's worry, verbatim: *"README.md is the community-facing SoT and accuracy is the load-bearing intent."*

This is an extension arc, not a build arc.

---

## §4 Units (independently landable, value-ordered)

### U1 — the C1 compile-gate  ·  **RESHAPED S280 after measurement** · SMALL-MEDIUM

> **⚠️ The original U1 (generalize fence-extraction to a glob set) was measured and REJECTED.
> Gate REAL FILES, not fences.** Rationale below — this is the load-bearing correction of the arc.

**The measurement that reshaped it.** Built `scripts/claim-gate.js` (the generalized fence extractor) and ran it over the public surface in `--report` mode: **24 files, 149 blocks, 92 failures.** Sampling the failures showed the number does not mean what it looks like:

| Failure | Actual cause |
|---|---|
| `E-COMPONENT-020: TodoRow is not defined in this file` | defined in an EARLIER block |
| `E-STATE-UNDECLARED: @count` | declared in an EARLIER block |
| `E-ENGINE-004: unknown type HealthRisk` | declared in an EARLIER block |
| `E-SCHEMA-001` / `E-SQL-004: no db=` | snippet is a fragment; the `<program db=>` root is elsewhere |
| `W-TAILWIND-UNRECOGNIZED-CLASS` | the known FP S279 triaged (`g-tailwind-lint-false-positive-on-same-file-hash-class`) |

Doc snippets are **fragments of a continuous narrative**. Compiling each standalone in an empty temp dir measures *"is this a self-contained program"* — not *"is this claim stale."* The 92 is an upper bound on nothing. (A strong empirical signal carrying a conclusion it could not support: pa-base §0, on the first run of the tool built to prevent it.)

**Finding 1 — the existing README gate is VACUOUS.** `README.md` has 4 scrml blocks; **all 4 carry `// gate: skip`.** The S101 gate has reported green since 2026-05-18 while checking **zero** blocks. S101 hit the fragment problem and the opt-out absorbed the entire surface. **An opt-out gate under fragment pressure degrades to zero coverage** — demonstrated, in this repo, not hypothesised.

**Finding 2 — the correct pattern already exists, works, and is wired to nothing.** `docs/tutorial-snippets/` holds **11 real `.scrml` files**; `docs/tutorial-snippets/verify-tutorial.sh` compiles them. Run at S280:

```
Summary: 10 pass / 1 fail / 11 total
Failed: 05-signup-form.scrml — E-SQL-004
```

Same content as `tutorial.md`. **Fence-extraction: 9 failures, nearly all spurious. Real-file compilation: 1 failure, and it is GENUINE** — a `?{}` with no `db=`. E-SQL-004 was newly wired at S264 (#90); S274 migrated 4 samples for it and **missed this one**. A real broken public file, surfaced by a script nothing runs.

**Revised U1 scope:**
1. Fix `docs/tutorial-snippets/05-signup-form.scrml` (the genuine E-SQL-004 finding; completes the S264/S274 migration).
2. Generalize `verify-tutorial.sh` → `scripts/snippet-gate.js`: compile every `.scrml` under a declared **snippet corpus**, exit 1 on any failure. No opt-out marker — a file either compiles or it does not, so there is no escape hatch to degrade through.
3. Migrate `README.md`'s 4 blocks to real files under the corpus (today: zero coverage). Prose references the file; the file is the single source of truth.
4. Wire into `ci.yml` **`gate`** (per OQ-2).
5. Keep `scripts/claim-gate.js` as a **`--report`-only measurement instrument** — useful for surveying a surface before migrating it, never merge-blocking.

**Delivers:** every public code sample compiles on the current compiler, verified by construction rather than by discipline. Kills the defect class in bryan's original Tris email (`@name` / `<machine>` / `->`).

**Why this beats the fence approach on every axis:** no context problem (a file is a whole program), no escape-hatch degradation (no marker to abuse), single source of truth (prose can't drift from the file it cites), and it is the pattern the repo already chose.

### U2 — `FACTS.md` + `--check`  ·  MEDIUM
A generated, human-readable facts file, derived at build time. Candidate facts (all mechanically derivable today):
conformance case count · SPEC.md line count · stdlib module count + names · CLI verb list · LSP provider list · editor grammar list · open/closed adopter issue counts · deploy targets · example/sample counts · compiler version.
Mirror `state.ts` exactly: `--write` regenerates, `--check` exits 1 on stale, `@generated:` anchors. Wire `--check` into `gate`.
**Rule:** marketing docs reference `FACTS.md`; they never hardcode a number.
**Delivers:** C2 closed. Also makes marketing sessions *cheap* — see §7.

### U3 — C3 claim-cite tags + the Nominal rejector  ·  MEDIUM
A tag convention mirroring the existing `<!-- @gap id=… sev=… status=… -->` grammar:
```
<!-- @claim spec=§14.8.9 -->            capability backed by a normative section
<!-- @claim conformance=fn/purity -->   capability backed by an executable case
<!-- @claim nominal=§38.13 -->          explicit forward-looking claim (allowed, must be marked)
```
Resolver verifies: the § exists · the conformance case directory exists · **the § is not inside a Nominal banner** unless tagged `nominal=`.
**Delivers:** the §2.1 trap closed. C4/C5 remain explicitly ungated by design.

### U4 — the marketing repo + PA contract  ·  SMALL-MEDIUM · **LAST**
Only after U1-U3 exist, because the gate is what bounds the PA.

**Repo split — by whether a claim must be true, not by topic:**
- **Gated content** (anything that leaves the building — posts, README, site copy, letters, conference material) lives where the compiler is, under CI. The gate needs a live compiler; a separate repo pinning a compiler version drifts, and that is the S240 trap already lived once with scrml-support 141 commits behind.
- **Process** (drafts, strategy, audience notes, voice ledger, correspondence history) → the new marketing repo or `scrml-support`. In-progress by nature; does not belong in a current-truth-only repo.

**PA sizing — satellite, not a full instance.** Reads: `FACTS.md` + voice ledger + `pa-base` §1/§5 + the claim-class rules. Does **NOT** read SPEC-INDEX or the PRIMER. That omission is what makes it cheap, and it is safe *only because* U1-U3 mean it cannot assert an unverified fact.

---

## §5 Rulings — ALL RESOLVED (bryan, S280: "your rec")

Every OQ below resolved **to the PA lean**. Recorded verbatim-as-ruled:
- **OQ-1 → (b)** everything public-facing is gated, outbound letters included.
- **OQ-2 → `gate`** (required, merge-blocking) for U1+U2.
- **OQ-3 → gate the artifact, not the author** — bryan's own prose is gated identically to PA output.
- **OQ-4 → U1+U2 now, U3+U4 after freeze.**

The original framing is preserved below for provenance.

### Original open questions

**OQ-1 — Gate scope.** Which content is gated? Options: (a) README + docs/website + a new `marketing/` dir; (b) everything public-facing including outbound letters; (c) README + marketing only, leave docs/website on its current footing.
*PA lean: (b).* The Tris letter carried a code block and was wrong. Anything that leaves the building is public.

**OQ-2 — CI placement.** `gate` (required, merge-blocking) or `tracking` (non-required)? *PA lean: `gate` for U1/U2.* A wrong public claim is worse than a wrong internal test. Counter-argument: it adds a red that blocks compiler work for a marketing-doc typo, during freeze.

**OQ-3 — Does the gate bind bryan's own prose, or only PA output?** A gate that only fires on PA-authored content is half a gate; one that fires on everything means bryan's own drafts can block a push. *PA lean: gate the artifact, not the author* — but this is genuinely bryan's call.

**OQ-4 — Sequencing vs V1.** U1+U2 are ~1 session and deliver ~80% of the protection. U3+U4 are a second. Does any of it land before the 1.0 cut, or does the whole arc queue behind freeze? *PA lean: U1+U2 now* (cheap, and marketing is happening *now* — the Tris letter is out the door), **U3+U4 after freeze.**

---

## §6 Out of scope (explicit)

- **C4/C5 gating.** Comparative and framing claims stay human-ruled. Not a deferral — a design statement. Automating them would produce false confidence, which is worse than no gate.
- Any actual marketing *content*. This arc builds the gate only. (Rule 1 still binds: no marketing work unless bryan raises it.)
- Changing `docs/website`'s existing build.
- Retro-auditing already-published content. Separate sweep if wanted; note the currently-published corpus has **never** passed a claim gate.

---

## §7 Estimate + the throughput argument

| Unit | Size | Basis |
|---|---|---|
| U1 | ~2-3h | extractor is 150L, README-specific in one constant + log strings |
| U2 | ~4-6h | ~10 derive functions + anchor plumbing; `state.ts` is the template |
| U3 | ~4-6h | tag grammar + resolver + Nominal-banner detection |
| U4 | ~3-4h | repo init + contract authoring; no new mechanism |

**U1+U2 ≈ one session** and close both fully-automatable classes.

**The throughput argument (bryan's second concern — "dozens of sessions for marketing").** The expensive part of the Tris letter was not writing it. It was six tool calls hand-verifying stdlib counts, SPEC line counts, CLI verbs, LSP providers, and adopter-issue tallies — plus one round-trip catching a defect that verification would have prevented. `FACTS.md` makes that free.

**The gate does not cost marketing sessions. It is what makes a marketing session an hour instead of a session.**

---

## §8 Recommendation

Build **U1 + U2 before instantiating any marketing PA** — the same sequencing as the flobase rule to ship the unverified-reasoning sweep before the serve-reasoning layer. A PA without a gate is precisely the thing bryan is worried about; a PA with one is bounded by construction.

Answer OQ-1..OQ-4, then U1+U2 is a single focused dispatch.

