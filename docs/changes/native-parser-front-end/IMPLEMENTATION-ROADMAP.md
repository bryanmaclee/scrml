---
tags: [native-parser, charter-B, implementation-roadmap, M-ladder, front-end, s112]
status: ACTIVE
date: 2026-05-20
session-opened: S112
audience: PA (orchestration) + scrml-js-codegen-engineer dispatches
---

# Native-Parser Front-End — Implementation Roadmap

The trackable per-sub-step decomposition of the charter-B M-ladder. This is the analog
of the (now-superseded) quoted-text `IMPLEMENTATION-ROADMAP.md` — the single artifact
the PA tracks the multi-quarter native-parser arc against.

**Authority chain (read before dispatching any milestone):**
- `scrml-support/docs/deep-dives/scrml-native-parser-front-end-charter-2026-05-20.md` —
  charter dive (the master plan; M-ladder Q4.A, estimates Q4.B, retirement Q5).
- `scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md` — S98 DD
  (D2 JS engine graph, D3 type catalog, D5 JS subset, D7 milestones + gating criteria).
- `docs/changes/native-parser-front-end/SPIKE-markup-js-seam-2026-05-20.md` — R1 seam
  spike (the markup↔JS seam contract; punch-list §6 P1-P13).
- `compiler/native-parser/README.md` — M1 AS BUILT (M1.1-M1.4 complete).
- SPEC §4.18 (code-default body mode + display-text literal — implemented natively at MK3).

---

## §0 Overview

### §0.1 What charter B is

The scrml-native parser replaces the **entire compiler front-end** — the heuristic
block-splitter (`block-splitter.js`, 2056 LOC, 12 heuristics) AND Acorn (the JS layer)
AND BPP (`body-pre-parser.ts`) AND the two statechild re-tokenizers' scaffolding — with
ONE composed-engines scrml-native parser. Ratified S111 (user: "B"). M1 (composed-engines
lexer) is COMPLETE (S99-S103). This roadmap covers everything past M1.

### §0.2 The M-ladder (charter dive Q4.A)

```
JS layer:      M1 ✅ → M2 → M3 → M4 ─┐
                                      ├→ M5 → M6
Markup layer:        MK1 → MK2 → MK3 → MK4 ─┘
```

| Mn | Layer | Scope | Charter est. |
|---|---|---|---|
| M1 | JS | Composed-engines lexer | ✅ COMPLETE (S99-S103) |
| **M2** | JS | JS **expression** parser; `ParseMode` engine; `Expr` AST per D3 | 30-60h |
| M3 | JS | JS **statement** parser; function bodies in-line (subsumes BPP) | 35-70h |
| M4 | JS | Full bounded JS subset (all D5 MUST PARSE + MUST ADD) | 25-55h |
| **MK1** | Markup | Markup scanner — `BlockContext` engine + context-grid boundaries | 20-45h |
| MK2 | Markup | `TagFrame` engine — `<tag>` tree, 3 closer forms, `TagKind` | 25-55h |
| MK3 | Markup | `BodyMode` + `DisplayTextLiteral` — §4.18 native quoted-text | 18-38h |
| MK4 | Markup | Markup↔JS seam; re-tokenizer scaffolding deletion | 27-46h (R1-tightened) |
| M5 | Both | Pipeline swap behind `--parser=scrml-native` + canary | 16-36h |
| M6 | Both | Joint retirement — BS + Acorn + BPP deleted; flag retired | 12-28h |

Headline: **~239-518h, midpoint ~380h (~10-14 focused sessions)** past M1.

### §0.3 Critical path + parallelization

```
M2 → { M3 → M4  ‖  MK3 } → MK4 → M5 → M6      ‖ = parallel
       MK1 → MK2 slide in alongside M2/M3
```

- **M2 (JS expression parser) and MK1 (markup BlockContext engine) parallelize** — no
  shared files, both depend only on M1 (done). These are the S112 first dispatches.
- MK3 needs M2 (interpolation bodies delegate to the JS expression parser).
- MK4 (the seam) needs M3/M4. MK4 is R1-de-risked (spike landed S111).

### §0.4 The two "ParseContext" things — disambiguated (READ THIS)

The source docs use the name `ParseContext` for **two different things**. This roadmap
disambiguates them — briefs MUST use these names:

| Thing | Source | This roadmap's name | Owned by |
|---|---|---|---|
| The JS-layer statement-vs-expression context **engine** | S98 D2 | `<engine for=ParseMode>` (RENAMED from D2's `ParseContext` — parallels `LexMode`) | M2 |
| The shared context **object** (the seam substrate — cursor + tokens + node sink + brackets + recovery + errors + `delegationStack`) | R1 spike §3.1 | the **parse context object**, built by `makeParseContext` extending M1's `makeLexContext`; the variable is `ctx` | MK1 |

### §0.5 Discipline carried by every native-parser dispatch

- **`.scrml` canonical + `.js` shadow per file** (README ANOMALY-2). Every new file is a
  `.scrml` (canonical Pillar-5b SHAPE) + a 1:1 `.js` executable shadow. Tests import the
  `.js`. The shadow retires at M5 (charter Q8).
- **Pillar 5b** — every state-shape construct points to an `<engine>`; every `fn` body
  justifies its calculation classification at the file header (D1 charter two-table test).
- **Acorn is the conformance ORACLE, never the design template.**
- **Composed engines** — Mario-scale (5-15 variants/engine); §51.0.Q.1 hierarchy for
  nesting. M1's `lex-mode.scrml` is the pattern to extend.
- **One-cursor invariant** (R1 spike §3.3) — markup + JS layers share ONE `Cursor`; no
  layer copies a sub-range; no `Span` carries a base-offset. (Designs out the cross-seam
  span-bug class.) Load-bearing from MK1 forward.

### §0.6 Status at S112 OPEN

- Charter dive PA-actions: A1 (roadmap SUPERSEDED banner) ✅ S111; R3/OQ-2 (§4.18.1/§40.8
  reconcile) ✅ S111 (`78faa65`); R1 seam spike ✅ S111. OQ-1 (v0.4 manifest) + A2
  (staleness-index refresh) — open, non-blocking.
- Interim-BS posture: **Option I-B** (case-by-case patching) per charter Q6.B — do NOT
  pre-invest the ~65h I-A throw-away fix. Trigger for I-A: 2+ distinct code-bearing-body
  misclassification bugs blocking delivery within one quarter.

---

## §1 M2 — JS expression parser (DISPATCH-READY)

**Goal (S98 D7 M2 gating):** Conformance Tier 1+2 PASS on the expression subset; the
`ParseMode` engine demonstrably governs context; the 5+ `preprocessForAcorn`
Acorn-workaround failure modes demonstrably do NOT exist (regression test per class).

**Inputs:** S98 D3 (`Expr` AST shape), D5 (MUST PARSE expression rows + MUST ADD list),
D7 M2 gating. M1's `lex(source): Token[]` is the token source.

**File ownership (new files under `compiler/native-parser/`):** `parse-mode.scrml`/.js
(the `<engine for=ParseMode>` JS context engine), `ast-expr.scrml`/.js (the native
`Expr` enum + node constructors per D3), `parse-expr.scrml`/.js (the expression parser).
M2 does **not** modify `lex.scrml` and does **not** create the markup-layer files.

| Sub-step | Scope | Est. | Depends |
|---|---|---|---|
| **M2.1** | Parser substrate + `ParseMode` engine + **primary expressions**. A token cursor over M1's `Token[]`; `type ParseMode:enum` + `<engine for=ParseMode initial=.TopLevel>` (expression-relevant variants); `ast-expr.scrml` `Expr` enum per D3; parse: literals (number/string/template/regex/bool — M1 lexes, M2 builds AST), identifiers, `@`-cells, parenthesized exprs, array literals, object literals. Extend the conformance harness for the expression subset. | 8-15h | M1 ✅ |
| **M2.2** | **Operator expressions** — binary operators with full JS precedence (the precedence-climbing core), unary (prefix + postfix `++`/`--`), assignment operators (incl. `??=`/`&&=`/`\|\|=`), conditional `?:`, sequence `,`. | 7-14h | M2.1 |
| **M2.3** | **Call / member / arrow-head / function-expression** — call exprs, member access (dot + computed), optional chaining `?.`, `new`, arg spread; arrow functions + function expressions (parse the HEAD; block bodies forward-reference M3's statement parser — stub-or-defer the body, documented); tagged templates. | 8-16h | M2.2 |
| **M2.4** | **scrml-extension expression forms** (D5 MUST ADD) — bare variants `.X` (§14.10), `is`/`is not`/`is some`/`is given`/`is .Variant` (§42), `not` value+prefix, `match expr {}` (§18), `~` (§32), `?{sql}` (§8), `<#id>` (§36), `render` (§14.9), `lift` (§10), `fail` (§19), `::Variant` (§14). **This closes the 5+ `preprocessForAcorn` Acorn-workaround failure modes — one regression test per fixed class** (M2 gating criterion). | 7-15h | M2.3 |

---

## §2 MK1 — markup `BlockContext` engine (DISPATCH-READY)

**Goal (charter Q4.A MK1 gating):** markup-layer block-stream output for every
conformance-corpus file is structurally equivalent to the current BS block tree (modulo
the intentional improvements — no `text` raw captures for compound/match bodies);
reviewable for D1 charter conformance.

**Scope boundary:** MK1 is the **context-grid** ("which scrml context are we in") — NOT
the `<tag>` tree. MK1 recognizes the `BlockContext.InMarkupTag` *boundary*; the `TagFrame`
engine that pairs openers with closers is **MK2**.

**Inputs:** charter Q1.C (`BlockContext` engine sketch — 9 variants), R1 spike §3.1 (the
shared parse-context object) + punch-list P1/P2/P3. M1's `lex.scrml` `makeLexContext`
is the substrate to extend.

**File ownership (new files under `compiler/native-parser/`):** `parse-ctx.scrml`/.js
(the shared parse context object — `makeParseContext` extending `makeLexContext` with a
node sink + `delegationStack`; punch-list P1), `block-context.scrml`/.js (the
`<engine for=BlockContext>`), `parse-markup.scrml`/.js (the markup trampoline, mirroring
`lex.scrml`). MK1 may **import** `makeLexContext` from `lex.scrml` but does **not** edit
`lex.scrml`, and does **not** create the JS-parser files (M2 owns those).

| Sub-step | Scope | Est. | Depends |
|---|---|---|---|
| **MK1.1** | **Shared parse-context object + `BlockContext` engine skeleton.** `parse-ctx.scrml` `makeParseContext` extending M1's `makeLexContext` — one `cursor`, one `BracketStack`, one `ErrorRecovery`, one error stream, + a node sink + `delegationStack` (punch-list P1; one-cursor invariant P2). `type BlockContext:enum` (9 variants per charter Q1.C) + `<engine for=BlockContext initial=.TopLevel>` skeleton + `rule=` contract. The trampoline `parse-markup.scrml` (loop dispatching by `BlockContext`, mirroring `lex.scrml`). | 7-15h | M1 ✅ |
| **MK1.2** | **Context-boundary recognition.** Recognize the 7 block-opener sigils (`${`/`?{`/`#{`/`!{`/`^{`/`~{`/`_{`) + brace-depth closing; recognize the `<ident` markup-tag-context boundary (entering `.InMarkupTag` — the tag TREE is MK2). `.InLogicEscape` as a §51.0.Q.1 composite state-child realized as a `DelegationFrame` push (punch-list P3); since the JS layer is not wired until MK4, the delegated body is captured as a span/stub frame at MK1. `_{}` opaque passthrough (§23). | 7-16h | MK1.1 |
| **MK1.3** | **Comments + sub-context stubs + conformance.** `//` line comments + `<!-- -->` HTML comments recognized **structurally** (not heuristically — eliminates BS heuristics #6/#7). The `.InCss`/`.InSql`/`.InErrorEffect`/`.InMeta`/`.InTest` sub-context stubs at sketch-depth (charter Q1.C). MK1 conformance: block-stream equivalence vs the current BS block tree on the conformance corpus. | 6-14h | MK1.2 |

---

## §3 Downstream milestones (decompose into sub-steps when scheduled)

Milestone-level scope only — the charter dive + S98 D7 have the detail. Each gets a
per-sub-step decomposition appended to this roadmap when its turn comes (as M2/MK1 did).

- **M3 — JS statement parser.** Statement grammar; function bodies parsed **in-line**
  (subsumes BPP — `body-pre-parser.ts` deletes by construction); error-recovery engine
  accumulates skipped tokens + re-syncs. Gating: Tier 1+2 PASS full statement subset.
- **M4 — full bounded JS subset.** All D5 MUST PARSE + MUST ADD; `preprocessForAcorn`
  regex cascades NOT NEEDED. Gating: Tier 1+2 full corpus; Tier 3 spans PASS-with-deltas.
- **MK2 — `TagFrame` engine.** The `<tag>` tree, 3 closer forms (`</>`/`</name>`/`/>`),
  structural-element recognition, `TagKind` (closed-rule calc). Punch-list P4
  (`markupValueAllowedAfter`), P5 (`TagFrame` exposes stack depth). Gating: tag-tree +
  closer output equivalent to BS; the 5 BS classifier heuristics demonstrably gone.
  **Blocked-precondition:** OQ-2/R3 (§4.18.1/§40.8 program-body mode) — RESOLVED S111
  (`78faa65`: `default-logic` is a distinct THIRD body-mode). MK2 detailed design honors
  three body-modes (free-text / code-default / default-logic).
- **MK3 — `BodyMode` + `DisplayTextLiteral`.** §4.18 native quoted-text. Punch-list P6
  (reuse M1's template-literal engine shape), P7 (thread `bodyMode` into delegation
  frames). Gating: every §4.18 worked example parses; `E-UNQUOTED-DISPLAY-TEXT` fires
  per §4.18.7. **Needs M2** (interpolation bodies delegate to the JS expression parser).
- **MK4 — markup↔JS seam.** Lift R1 spike §3 as the contract; punch-list P8/P9/P10/P11
  (incl. the deep-nesting smoke test). Re-tokenizer scaffolding deleted. Needs M3/M4.
- **M5 — pipeline swap behind `--parser=scrml-native`** + canary soak.
- **M6 — joint retirement.** Delete BS + Acorn + BPP + re-tokenizer scaffolding; retire
  the flag; native parser self-hosts its own `.scrml` source (charter Q8).

---

## §4 Cross-cutting

### §4.1 R1 seam spike punch-list (P1-P13) → milestone mapping

| P# | Item | Lands at |
|---|---|---|
| P1 | Build the markup layer on the shared `makeParseContext` (one cursor / brackets / recovery / errors / node sink + `delegationStack`) | **MK1.1** |
| P2 | State the one-cursor invariant as a hard brief constraint | **MK1.1** (every MK brief) |
| P3 | `BlockContext.InLogicEscape` as a §51.0.Q.1 composite state-child / `DelegationFrame` push | **MK1.2** |
| P4 | `markupValueAllowedAfter(lastKind)` discriminator in the JS layer's `InCode` dispatch | **MK2** |
| P5 | `TagFrame` exposes stack depth (for `CloseCondition.TagFrameBalanced`) | **MK2** |
| P6 | `DisplayTextLiteral.InInterpolation` reuses the M1 template-literal engine shape | **MK3** |
| P7 | Thread `bodyMode` into every markup→JS `DelegationFrame` | **MK3** |
| P8-P11 | Seam contract (R1 §3); cross-seam error rules; re-tokenizer-scaffolding deletion framing; deep-nesting smoke test | **MK4** |
| P12 | Anomaly A1 already reconciled (IMPLEMENTATION-ROADMAP SUPERSEDED banner) | done — no action |
| P13 | OQ-2/R3 SPEC clarification | done S111 (`78faa65`) |

### §4.2 Conformance

Acorn-as-oracle (S98 D6). JS layer: conformance test exists from M1
(`compiler/tests/parser-conformance-lexer.test.js`) — M2+ extend it to AST-level Tier
1+2. Markup layer: NEW harness diffing the markup block-stream against the current BS
block tree (charter Q4.B cross-cutting line, 8-18h — folded into MK1.3 + extended each MK).

### §4.3 Interim BS posture

**Option I-B** (case-by-case patching) per charter Q6.B. The live BS keeps its
code-bearing-body misclassification bug class for the whole arc; patch specific bugs as
they surface. **Do NOT** pre-invest the ~65h Option I-A throw-away fix. Trigger to
reconsider I-A: 2+ distinct code-bearing-body misclassification bugs block delivery
within one quarter.

---

## §5 Progress tracker

| Milestone / sub-step | Status | Dispatch | Landed | Notes |
|---|---|---|---|---|
| M1 (lexer) | ✅ COMPLETE | — | S99-S103 | M1.1-M1.4; 7 LexMode state-children substantive |
| M1.5 — expr-literals.js conformance flip | ⬜ pending | — | — | regex-token normalizer (native `RegexLit` vs Acorn's regex-token surface); minor polish, non-blocking M2 |
| **M2.1** substrate + ParseMode + primary | ⏳ DISPATCHED S112 | — | — | parallel w/ MK1.1 |
| M2.2 operators | ⬜ pending | — | — | depends M2.1 |
| M2.3 call/member/arrow-heads | ⬜ pending | — | — | depends M2.2 |
| M2.4 scrml-extension exprs | ⬜ pending | — | — | depends M2.3; closes Acorn-workaround failure modes |
| **MK1.1** shared ctx + BlockContext skeleton | ⏳ DISPATCHED S112 | — | — | parallel w/ M2.1 |
| MK1.2 context-boundary recognition | ⬜ pending | — | — | depends MK1.1 |
| MK1.3 comments + sub-context stubs + conformance | ⬜ pending | — | — | depends MK1.2 |
| M3 / M4 / MK2 / MK3 / MK4 / M5 / M6 | ⬜ pending | — | — | decompose when scheduled (§3) |

**Legend:** ⬜ pending · ⏳ in flight · ✅ complete · 🟥 blocked
