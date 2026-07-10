# progress — conformance-css-style-65-2026-07-10

Status: COMPLETE (14 cases authored, all green; oracle 279 -> 293).

## Verify-first ground truth (confirmed)
- `grep -rlF '<theme' | 'E-STYLE-CONFLICT' | '#{' conformance/cases/` -> ZERO pre-existing §65 coverage. No duplication.
- `bun conformance/run.ts` baseline -> **279/279**. After this dispatch -> **293/293** (+14).
- Bridge gate `bun test compiler/tests/conformance/corpus-bridge.test.js` -> 294 pass / 0 fail.

## Scope reconciliation — the brief's "Wave-1 LANDED" list is BROADER than what impl#1 actually emits
The SPEC §65 banner (SPEC.md:34925) is explicit: **ONLY the §65.2 flat-specificity
conflict-checker (`E-STYLE-CONFLICT` + `W-STYLE-CONFLICT-POSSIBLE` + the R1/R2/R3 carve-outs)
is IMPLEMENTED and wired**. The most recent §65 landing (`66580dd8`) added `<theme>` tokens
**Phase A only (recognition + typer)**. Everything else the brief listed under "Wave-1 LANDED"
is, per the SPEC banner + an empirical impl#1 probe, the **follow-on impl wave (Phase B / Wave-2 /
Full)** that flips the banner — NOT yet emitted.

Conformance cases MUST pass against impl#1 (`run.ts` runs every case regardless of
`language-version` — there is NO skip for "future"). So a case asserting an unemitted code goes RED.
I therefore authored the EMPIRICALLY-IMPLEMENTED surface and SKIPPED the rest (below), per
EMPIRICAL-FIRST + Rule 4 (author to SPEC; where impl lags SPEC, do not fabricate a passing case).

### Authored (implemented + green) — category `style/`, 14 cases
| case-id | code(s) | §SPEC |
|---|---|---|
| conflict-tag-x-class | E-STYLE-CONFLICT (error) | §65.2.1 flagship |
| conflict-tag-x-tag | E-STYLE-CONFLICT (error) | §65.2.4 tag×tag |
| conflict-id-x-class | E-STYLE-CONFLICT (error) | §65.2.4 id×* + §65.5 (specificity deleted) |
| r1-universal-star-layer | (none — R1 floor-layer) | §65.2.4 R1, §65.5 |
| r2-bem-modifier-soft | W-STYLE-CONFLICT-POSSIBLE (info) NOT hard | §65.2.4 R2 |
| program-scope-overlap-soft | W-STYLE-CONFLICT-POSSIBLE (info) NOT hard | §65.2.4 R3, §65.9 |
| conditional-hover-layer | (none — deterministic layer) | §65.2.2 |
| disjoint-different-tag | (none — provably disjoint) | §65.2.4 |
| disjoint-attr-values | (none — mutually-exclusive attr) | §65.2.4 |
| clean-single-rule | (none — no false positive) | §65.2 / §65.14 |
| theme-tokens-recognized | (none — Phase-A recognition) | §65.3.2, §65.9 |
| theme-for-variant-inference | (none — infer from for=) | §65.6, §14.10 |
| theme-variant-not-in-set | E-TYPE-063 (error) | §65.6 |
| bare-variant-no-theme-ambiguous | E-VARIANT-AMBIGUOUS (error) | §65.6 |

Positive-conflict + R1/R2/R3 negatives (the brief's explicit ask): satisfied by
conflict-* (positive), r1-universal-star-layer (R1), r2-bem-modifier-soft (R2),
program-scope-overlap-soft (R3). program-scope-overlap-soft brackets conflict-tag-x-class:
identical selectors, scope decides hard-vs-soft.

### SKIPPED — brief-listed Wave-1 codes that impl#1 does NOT yet emit (Phase-B / v1.next)
Verified by empirical probe against the impl#1 adapter (compile() over the TS reference compiler):
- **E-THEME-TOKEN-UNKNOWN** — Phase B (codegen use-site lowering). theme-body-parser.ts:31 +
  ast-builder.js:15155 name it as Phase-B-owned; a `color: <undeclared>` reference emits NOTHING today.
- **E-DEFAULTS-MISUSE / W-STYLE-DEFAULTS-DEAD** — Wave-2. `<defaults>` is not validated
  (attribute-registry.js:492 registers it "no attributes; E-DEFAULTS-* behaviour is Wave-2 impl");
  a `.class` inside `<defaults>` emits nothing.
- **E-STYLE-IMPORTANT-INTERNAL / W-STYLE-IMPORTANT-INTEROP** — Wave-3. `!important` inside a
  component `#{}` emits nothing (not present in compiler/src at all).
- **E-STYLE-CONDITION-OVERLAP** + same-axis `@media` recursion (§65.2.3) — Full. Two overlapping
  `@media` ranges on one property emit nothing (not present in compiler/src).
- **E-STYLE-VALUE-*** (style-as-value) — explicitly out-of-scope per brief (Wave-2).
- **Built-in reset + :where()-flat emission** — Wave-1-remaining EMISSION (not a diagnostic);
  no observable runtime effect yet (see harness-gated note).
- **E-STRUCTURAL-ELEMENT-MISPLACED for `<theme>`** — did NOT reproduce cleanly. `<theme>` is
  ACCEPTED at multiple loci (program scope, file top-level); inside a component body it produces
  E-COMPONENT-020/021/035 (the component parser rejects it), not the §65.9/§65.10-promised
  E-STRUCTURAL-ELEMENT-MISPLACED. Not authored (no clean Wave-1 misplacement signal for theme).
- **E-NAME-COLLIDES-RESERVED for a `theme`/`defaults` component name** — did NOT fire (a component
  named `theme` compiles clean). §65.9/§65.10 promise the collision; not wired. Not authored.

## Harness-gated runtime (flagged)
All 14 cases are **(a)-codes-half only** — consistent with the sibling channel/endpoint/capability
categories (also codes-only). The (b) runtime half is NOT authorable for the §65 Wave-1 surface:
- E-STYLE-CONFLICT is a compile-time contract; a hard-conflict case ERRORS (no runnable artifact).
- Reactive theming's `:root` `--var` patch (the one DOM-observable §65 runtime, per the brief) is
  **Phase-B codegen — NOT emitted**, so there is nothing to observe. The `<theme>` tokens do not
  yet lower to `:root` custom properties; `@mode` switching does not yet patch the DOM.
- CSS property VALUES are not surfaced in the normalized serialized `<body>` (happy-dom does not
  expose computed styles in the conformance serialization), so even a clean case's CSS effect is
  not assertable via the current adapter. No adapter seam is missing for Wave-1 — the effect simply
  is not emitted yet. Revisit when Phase B lands the `:root` patch (a computed-style/`:root`-var
  read would be the harness seam to add then).

## impl-vs-SPEC divergences surfaced (escalate to PA — do NOT bless impl, do NOT decide)
1. **`<theme>` misplacement diagnostic** — §65.9 + §65.10 say misplacement reuses
   E-STRUCTURAL-ELEMENT-MISPLACED. Impl fires E-COMPONENT-020/021/035 for a `<theme>` in a component
   body and ACCEPTS `<theme>` at file top-level (only W-PROGRAM-001). The §65.10-promised structural
   diagnostic surface is not wired for theme. (Phase-A gap, not a Wave-1 blocker for the cases here.)
2. **`theme`/`defaults` name-collision** — §65.9/§65.10 say a component/user-type named
   `theme`/`defaults` reuses E-NAME-COLLIDES-RESERVED. Impl accepts `const theme = <...>` clean.
3. **Reactive-theming consumer wiring (minor, arguably-correct)** — `<theme for=@mode>` does NOT
   register itself as a consumer of `@mode` in Phase A: a theme cell with NO other reader/writer
   trips **E-DG-002** ("no readers", warning). The canonical §65.13 shape always has a toggle writer,
   so this is invisible in practice (theme-for-variant-inference uses the writer shape and is clean),
   and a never-switched theme cell IS genuinely dead — but strictly, §65.6 frames the theme as
   reading `@mode` to select the active variant, which would make it a consumer. Flagged for the
   Phase-B consumer-wiring pass.

None of the three blocks the authored cases; all three are Phase-B/Wave-2 surface the brief listed
as "Wave-1 LANDED" but which is not yet emitted.
