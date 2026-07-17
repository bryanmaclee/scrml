# REINTEGRATE — sPA ss68 · conformance components §15/§16 (E-COMPONENT-* reject surface)

**From:** sPA ss68 · **To:** PA · **Date:** 2026-07-15
**List:** `spa-lists/ss68-conformance-components-15-16.md`
**Branch:** `spa/ss68` · **tip:** `0ce00eb8` · **base:** `origin/main` @ `7d5fda26`
**Work commits:** `91527fd5..ab88efe0` (5, all non-empty) · tracking-docs: `0ce00eb8`

## Outcome — DONE, nothing parked
All **13 `E-COMPONENT-*` codes pinned** as reject(pos)+clean(neg) pairs under
`conformance/cases/components/` (26 new case dirs) + the **4 existing zero-code cases strengthened**
with justified `notCodes` (010/011). The component prop-contract moves ZERO-code → conformance-covered.

- Codes: 010·011·012·013·014·019·020·021·030·031·033·034·035 — every reject asserts its own code,
  every clean asserts the matching code in `notCodes` (vacuity-audited).
- 021 + 035 (list-flagged HARD, park-if-needed) both reproduced cleanly **without** a cross-file
  `files` fixture — see escalation #5 for the 035 mechanism.

## Verification (sPA-independent, adversarial — not agent-reported)
- `bun conformance/run.ts` re-run in the main checkout: **485/485** (459 baseline + 26 new).
- Per-commit non-empty; main checkout clean of tracked leaks (only sPA tracking docs committed).
- Vacuity audit: 13/13 reject → own `E-COMPONENT-XXX`; 13/13 clean → matching `notCodes`.

## Re-integration
The branch is clean and additive (new case dirs + 4 tiny `expected.json` edits + sPA tracking docs).
File-delta `conformance/cases/components/` + the 4 edits + `spa-lists/ss68*` +
`docs/changes/conformance-components-15-16-ss68/` onto main; confirm `bun conformance/run.ts` green.

## ESCALATIONS — PA disposition required (sPA did NOT decide)
6 findings surfaced during authoring. #1–#3 are SPEC-internal doc drift; **#4 is a real runtime defect**;
#5 is a behavior-shape note; #6 is an out-of-scope impl gap. Verbatim:

1. **§16 vs §34/§15.14 code-number collision.** §16.7 local table + §16.4/5/6 prose use
   020/021/022/023/024 for spread/slot mechanics, but **E-COMPONENT-020 is ALSO assigned to
   "unresolved component reference"** (§15.14, added 2026-04-30) — a SPEC self-contradiction. impl#1
   uses 030/031/033/034 for spread/slot (matching the §34 master catalog `SPEC.md:18091-18096`
   *numbers*). Doc-only reconcile needed.
2. **§34 master-catalog rows are stale.** Descriptions for 019/030/031/033/034 match neither §16 prose
   nor impl behavior (e.g. 030 labeled "missing required children" but fires on "multiple spreads"),
   with stale line refs (`component-expander.ts:1466`, `:466,491`) tagged "Catalog addition S78 audit"
   → leftover pre-renumbering docs. Also: 021 is catalog-described as "unslotted children no spread"
   (actually 031's behavior); live 021 is "component-def body failed CE re-parse" with NO normative
   code assignment.
3. **§16.4 spread-alias claim is FALSE.** "`${...}` … `${children}` is a legacy alias with identical
   semantics; both accepted" — only `${children}` compiles; literal `${...}` fails CE re-parse →
   E-COMPONENT-021. Confirmed via A/B (`malformed-component-body-reject` vs `-clean`).
4. **§15.11.1 bind: promise broken for ALL component bind props (REAL DEFECT).** `bind:propName=@var`
   on a component is CE-validated (E-COMPONENT-013 if illegal) but **never stripped/consumed** — it
   survives into CE-expanded HTML and is re-validated by codegen's DOM bind: checker
   (`emit-html.ts:1792-1866`), which only allows `bind:value/checked/selected/group/this` → spurious
   **`E-ATTR-011`**, firing even on the SPEC's own Modal example (§15.11.1) and on the valid
   `bind-non-bindable-prop-clean` case. §15.11.1's "developer writes neither side of the wiring"
   guarantee does not hold for any component prop outside that 5-name allowlist.
   **Recommend a bug ticket: CE must strip consumed `bind:` prop attrs before emission.**
   (Both `bind-non-bindable-prop-*` cases document the incidental `E-ATTR-011`; conformance
   superset-matching tolerates it, so the pin is sound — but the underlying defect stands.)
5. **020-vs-035 is shape-dependent.** A **top-level** `<program>`-body `<Unknown/>` fires **035 only**
   (NR stamps `resolvedKind:'unknown'` pre-CE, so CE's 020 path is never reached —
   `post-ce-invariant.ts:180-186` case (b)); an `<Unknown/>` **nested in another component's body**
   fires **both 020+035** (local CE re-parse has no NR stamp → legacy BS heuristic). Both shapes are
   exercised across `unresolved-component-ref-reject` (nested→020) and
   `post-ce-residual-component-reject` (top-level→035).
6. **Out-of-scope gap.** §15.10's "props on a non-component element SHALL be a compile error" is not
   implemented — `<div props={ label: string }/>` outside any `const X = …` compiles silently. Not
   one of the 13 in scope; flagging only.

— sPA ss68, standing down. The user closes the instance.
