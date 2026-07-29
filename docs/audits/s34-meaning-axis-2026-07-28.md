---
status: current
last-reviewed: 2026-07-28
purpose: Audits the SPEC §34 error-code catalog on the MEANING axis — does each row DESCRIBE the diagnostic the code actually fires on? Complements the S260 severity/trigger/cite audit, whose TRIGGER bucket was explicitly a floor of 5.
baseline: main@ed2515e7
---

# §34 Error-Code Catalog — MEANING Axis (2026-07-28)

**Axis.** Not severity, not liveness. The question is: *does the row describe the right
diagnostic?* S260 (`scrml-support/docs/audits/s34-catalog-vs-impl-2026-07-16.md`) covered
severity / section-cite / no-fire, and explicitly scoped its TRIGGER-MISMATCH bucket as
"**not fully mechanized … Treat as a FLOOR**" of 5 hand-confirmed rows, noting that a general
trigger audit "needs per-code message-vs-prose comparison." That comparison is this sweep.

---

## 0. Corrections to the dispatch premise (verify-before-you-scope)

Three of the brief's structural claims did not survive contact with the file. Recording them
because they change what a follow-up sweep should target.

| Brief claim | Reality at `ed2515e7` |
|---|---|
| §34 has **two row formats** — a short table `~:15982` and a long-form catalog `~:18878` | **No.** `:15982` is **§21.6**, a per-SECTION "Error Codes" summary — not §34 at all. §34 is **one** table (`18728`–`19565`) whose rows merely vary in verbosity. S260 explicitly scoped the per-section summaries OUT. |
| Line refs `~:15982` / `~:18878` / `~:19033` | Stale except `:19033`. §34 now spans **18724–19565** (S260 audited `17812–18618`; the file grew ~900 lines). |
| "Check both, and check they agree" | Retained but **reframed**: the productive comparison is **§34 row vs per-section summary row**, which is exactly the `E-IMPORT-007` shape. Done in §4 below — 269 codes appear in both. |

**Methodology self-correction.** My first cross-reference pass reported §53.11/.14/.15 and §49
as dead. They are **not** — §53 heads its subsections as `## §53.1 Motivation`, with the section
sign *inside* the heading, which my extractor's `^#+ +[0-9]` pattern missed. Corrected extractor
(`^#+ +§?[0-9]`) lifted the heading set 1437 → 1503 and cleared both. **That false alarm is
retracted.** The §28 / §3.5 / §39.5.5 findings below survive the corrected extractor.

---

## 1. Coverage statement — read this before trusting any row below

### Mechanized across **all 803** §34 codes (complete)
- **Fire-site existence** — every catalog code grepped against `compiler/src/` +
  `compiler/native-parser/` for `"CODE"` / `'CODE'`. Result: **619 of 803 rows have a fire
  site**; 645 distinct codes are referenced in source.
- **Section-cite resolution (DEAD-XREF axis) — COMPLETE.** All 951 `(code, cite)` pairs / 367
  distinct cites checked against the full 1503-heading set. This axis is exhaustive.
- **§34-vs-per-section-summary divergence screen** — 297 non-§34 summary rows; **269 codes
  appear in both**; word-overlap scored; the low-overlap tail read by hand.

### Hand-verified on the MEANING axis (the partial part — be honest about the tiers)
- **Tier A — full fire-site condition read** (surrounding code, not just the message): **21
  codes.** `E-PA-002`…`E-PA-007`, `E-IMPORT-007`, `E-IMPORT-010`, `E-META-001`, `E-SQL-004`,
  `E-CG-001`, `E-CG-003`, `W-PROGRAM-001`, `W-AUTH-001`, `E-TYPE-001`, `E-COMPONENT-019`,
  `E-DG-001`, `E-TYPE-023`, `E-BPP-001`, `E-SCHEMA-011`, `E-TYPE-051`.
- **Tier B — emitted-message-template vs row prose compared** (real meaning evidence; the
  surrounding condition not read): **50 codes** — the pairs printed in the worksheet, spanning
  `E-AUTH-*`, `E-COMPONENT-*`, `E-CONTRACT-*`, `E-ERROR-*`, `E-LIN-*`, `E-TILDE-*`, `E-TYPE-*`,
  `W-*`. Divergent pairs were escalated to Tier A; the rest read as consistent.

### NOT covered — do not read silence here as OK
- **366 long-form live rows** (trigger ≥200 chars). These carry `(S###)` provenance markers and
  `emitted at file:line` self-cites, i.e. they were authored or revised recently. **Unaudited.**
  They are the natural next sweep, and the `E-SCHEMA-011` finding below proves recency is *not*
  a guarantee of correctness.
- **96 mid-length live rows** (80–199 chars). Unaudited.
- **~54 terse native-parser rows** (`E-EXPR-*` / `E-STMT-*`). Screened for fire-site existence
  only; meanings not compared. Low risk (mechanical parse-error codes) but unverified.
- **184 rows with no fire site** — S260's DEAD/RESERVED set. Deliberately not re-litigated.
- **Count delta:** my extractor yields **803** unique codes; `error.map.md` says **799**. A
  4-code gap I did not chase — it does not affect any finding here, but the map's count
  methodology and mine disagree and one of them is wrong.

---

## 2. WRONG-MEANING findings — **5**

The class this sweep exists for: the row describes a *different diagnostic* than the code fires on.

| # | Code | What the row says | What it actually fires on | Fire site | Proposed corrected row |
|---|---|---|---|---|---|
| 1 | **`E-PA-002`** | §11.3 · "Protect analyzer: invalid `protect=` syntax" | The `<db src=>` file **does not exist** (or is a driver URI that cannot be introspected at compile time) **AND** ≥1 `tables=` name has no recoverable `CREATE TABLE` in any `?{}` block. Nothing to do with syntax. | `compiler/src/protect-analyzer.ts:820-840` | `\| E-PA-002 \| §52 \| Shadow-DB schema resolution failed: the `<db src=>` file does not exist (or `src=` is a driver URI not introspectable at compile time), AND at least one `tables=` name has no recoverable `CREATE TABLE` in any `?{}` block. Remedy: declare the tables in a `<schema>` block and run `scrml db-migrate`. \| Error \|` |
| 2 | **`W-PROGRAM-001`** | §4.12 · "Unnamed nested `<program>` with no distinguishing attributes" | The file has **no `<program>` root element at all** (and is not a pure-module file, and not a non-entry `<page>` file). The *opposite* subject — absence of a root, not an unnamed nested one. | `compiler/src/ast-builder.js:18967-18977` (sole emit site) | `\| W-PROGRAM-001 \| §4.12 \| No top-level `<program>` root element found in a file that is neither a pure module nor a non-entry `<page>` file. Consider wrapping the file body in `<program>…</program>` for explicit db / protect / HTML-version configuration. \| Warning \|` — **and see §6, bug 1: the documented guarantee is unbuilt.** |
| 3 | **`W-AUTH-001`** | §52.11 · "`<var server>` has no detectable initial load pattern" | **Two unrelated diagnostics share this code.** (a) matches the row (`type-system.ts:10820`). (b) **undocumented:** "File has `protect=` fields but no explicit `auth=` attribute — auth middleware auto-injected (`auth="required"`, `csrf="auto"`)" (`route-inference.ts:5330`). | `type-system.ts:10820` + `route-inference.ts:5330` | Keep the existing row for (a); **allocate a fresh code for (b)** — this is the exact `E-IMPORT-007`/§41.4 shape bryan ruled on at S297 (allocate, don't renumber). Suggested: `W-AUTH-002` · §52 · "`protect=` fields present with no explicit `auth=`; auth middleware auto-injected at `auth="required"` / `csrf="auto"`. Add `<program auth=…>` to control this explicitly." · Warning. |
| 4 | **`E-COMPONENT-019`** | §15.11 · "Callback prop type mismatch" | A **malformed `props`-block declaration line** — the text fails `/^ident\??\s*:\s*(.+)$/`. A syntax/format error, not a type mismatch. Both fire sites agree with each other and disagree with the row. | `component-expander.ts:892` + `ast-builder.js:3418` | `\| E-COMPONENT-019 \| §15.11 \| Malformed declaration line in a `props` block. Expected `name: type`, `name?: type`, `name: type = default`, `bind name: type` (bindable), or `name: fn-signature` (function prop). \| Error \|` |
| 5 | **`E-CG-001`** | §47 · "Codegen: unresolvable variable reference in output" | **Two unrelated meanings, neither of which is "unresolvable variable reference".** (a) `index.ts:1709` — "node `<id>` has an unrecognized **type**; likely a compiler bug". (b) `emit-client.ts:2962/2974` — the §14.8.9 **protected-field egress backstop failed CLOSED** because acorn could not parse the emitted client bundle. | `codegen/index.ts:1709`; `codegen/emit-client.ts:2962`, `:2974` | Split. (a) `\| E-CG-001 \| §47 \| Internal: an AST node carries an unrecognized type at codegen. Compiler defect. \| Error \|`. (b) needs its **own** code under §14.8.9 — see §6, bug 3. |

---

## 3. DEAD-XREF findings

Complete for the whole catalog. Three families are **new** (S260 reported only the §11.x set).

| Cited § | Codes | Why it fails to resolve | Proposed target |
|---|---|---|---|
| **§28.2 / §28.3 / §28.4 / §28.5** — **NEW** | 16: `E-LIFECYCLE-012/013/014/015/017/018/019/020/021/022`, `W-LIFECYCLE-011/012/013/014`, `E-TIMEOUT-003`, `W-TIMEOUT-001` | §28 is "Compiler Settings" and **stops at §28.1** (`html-content-model`). There is no §28.2–.5. The cited content (`<poll>`, `<request>`, `animationFrame()`, `<timer>`) is not in §28 at all. | **§6.7.x** — `§6.7.6 <poll>`, `§6.7.8 <timeout>`, `§6.7.9 animationFrame()`, `§6.7` for the timing model. S260 hinted at this ("the §6.7/§28 lifecycle family") without filing it. |
| **§3.5** — **NEW** | `E-BPP-001` | §3 ("Contexts") **stops at §3.4**. Worse: **no body-pre-parser section exists anywhere in SPEC.md** — grep finds no heading for BPP / "body pre-parser". The code has **no normative home at all**. | Needs a real section. The stage is BPP in the `BS→TAB→CE→BPP→PA→RI→TS→MC→DG→CG` pipeline; nearest existing normative anchor is §4 (block structure). **PA call required** — this is a missing-spec gap, not a re-cite. |
| **§39.5.5** — **NEW, landed THIS window** | `E-SCHEMA-011` | §39.5 ("Column Constraints") exists; its subsections jump **.7 / .8 / .9** — there is no §39.5.5. The row even asserts "**§39.5.5 declares exactly ONE production**". The normative text *does* exist, at **`SPEC.md:21663`**, but sits in §39.5's **body**, unnumbered. | Either re-cite to **§39.5**, or add a `#### 39.5.5` heading at `:21663`. Preferred: add the heading — the row's self-description ("§39.5.5 declares…") then becomes true. |
| §11.3 / §11.3.2 / §11.3.3 / §11.4 / §11.5 — **S260 already filed** | 10: `E-PA-001`…`E-PA-007`, `E-PROTECT-001/002`, `W-PROTECT-001` | §11 is a folded stub ("State Objects and `protect=` (Reserved — Content Folded)", `:7111`) carrying only a Fold Decision Log. No §11.3 / §11.5 exists. **Confirmed independently.** | **§52** per the Fold Decision Log — matching S260's recommendation. Credit S260; no new work. |

`§49` deserves a footnote: it has **no top-level `## 49.` heading** (only `## 49.1`, `## 49.2`, …),
unlike every other section. Bare-`§49` cites resolve by family so nothing is broken today, but it
is a structural anomaly in a file whose headings are otherwise uniform.

---

## 4. SELF-INCONSISTENT findings

Screened all 269 codes carrying both a §34 row and a per-section summary row. Most agree. Real divergences:

| Code | §34 says | The other table says | Implementation | Verdict |
|---|---|---|---|---|
| **`E-META-001`** | "`^{ }` block requires runtime but `meta.runtime` is `false`" — **one** trigger | §22.11 (`:16824`) lists **three**: (1) runtime variable in compile-time `^{}`, (2) `meta.runtime === false`, (3) JS-host ambient global in any `^{}` body | **All three fire.** `meta-checker.ts:1209` (ambient global), `:1387` + `:1432` (runtime variable), `:1782` (`meta.runtime === false`) | §34 names **1 of 3**, and the one it names is the least common. §22.11 is correct. **Adopt §22.11's text into §34.** |
| **`E-SQL-004`** | "`?{}` block has no `db=` declaration in any ancestor `<program>`" | §44 row (`:24315`) adds: "**AND the file is not a module-with-db-context (§44.7.1)**" | `emit-server.ts:5115` gates on `eSqlFireEligible` — library-shaped files route to `E-SQL-009`, not `E-SQL-004` | §34 **overstates** when the code fires (omits the carve-out). Adopt the §44 wording. Minor. |
| `E-TYPE-051`, `E-META-004`, `E-SQL-005` | — | — | — | Screened as low-overlap by the heuristic; read by hand; **consistent**. No finding. |

**Incomplete-but-not-wrong rows** found in passing (Tier A reads, worth a cleanup pass but not
mis-describing the code):

- **`E-PA-003`** — row: "Bun SQLite schema introspection failed". Two conditions: `PRAGMA
  table_info` threw (`:248`) **and** in-memory shadow-DB creation failed (`:310`/`:343`). Row
  covers the first only.
- **`E-PA-005`** — row: "`tables=` attribute absent". Also fires when `tables=` is *present* but
  parses to an empty list (`:1060`).
- **`E-DG-001`** — row: "circular dependency in reactive graph". Impl is narrower and specific:
  a cycle in **`awaits` edges** (`dependency-graph.ts:3683`).
- **`E-CG-003`** / **`E-TYPE-001`** — vague umbrella rows over ≥2 dissimilar fire sites each.
  Defensible as written; imprecise. Not counted as WRONG-MEANING.

**Confirmed coherent (calibration instance 1).** `E-IMPORT-007`: §34 (`:19238`) and §21.6
(`:15988`) agree — auto-gather closure > 5000 files — and match `api.js:940-948` exactly, with
the fire-site line now correct. §41.4 (`:22912`) cleanly names `E-IMPORT-010` for the
client-context case, and `E-IMPORT-010` has **zero fire sites**, consistent with its "NAMED and
RESERVED; NOT yet implemented" note and with Rule 4 (no §34 row until it fires). **The S297 fix
is coherent.** No action.

---

## 5. Maps — were they load-bearing?

**Partially, and honestly: less than the rebuild intended for this task shape.**

- `primary.map.md` **routed correctly** — its "a diagnostic code — ANY code, any prefix" row
  sends you to `error.map.md`, and its `E-PA-*` row names `protect-analyzer.ts` as the sole fire
  site. That row alone saved a grep.
- `error.map.md` was **load-bearing for `E-PA-002` specifically**: its family table already
  carried the correct implemented meaning ("`src=` file does not exist AND one or more `tables=`
  names have no `CREATE TABLE`; emit at :828") — i.e. **the map was already right where §34 is
  wrong.** That is a strong signal: the map is a better meaning-oracle than the SPEC row today.
- **Where they were not load-bearing:** this audit's mechanized core — row extraction, cite
  resolution, fire-site joins, §34-vs-summary diffing — is whole-catalog work that no map
  addresses, by design. All five WRONG-MEANING findings came from source reads, not maps. The
  maps' error-family table names ~20 families; the catalog has 803 codes.
- **One map gap worth filing:** `error.map.md` states the catalog is **799** codes; my
  extraction yields **803**. The map documents its own methodology carefully and warns against
  hand-rolled greps, so this is worth reconciling rather than dismissing.

---

## 6. Looks like a real compiler bug, not a doc defect — **NOT fixed, surfaced only**

1. **`W-PROGRAM-001`'s documented guarantee is unbuilt.** §34 (`:18805`), the §4.12 summary row
   (`:899`), and §4.12 prose (`:748`, `:891`) *all agree with each other* that an unnamed nested
   `<program>` warns and gets a compiler-assigned identifier. **Nothing implements that.** The
   sole emit site fires on an entirely different condition (no `<program>` root). So the catalog
   is self-consistent and uniformly wrong, and a real normative guarantee has no enforcement.
   Note `W-PROGRAM-TITLE-NESTED` already occupies adjacent nested-`<program>` territory — the
   unnamed-nested rule may have been silently absorbed or dropped. **Needs a drop-ruling
   cross-check before anyone "fixes" it** (cf. the `E-ATTR-012` dropped-by-design precedent).

2. **`W-AUTH-001` conflates a security-adjacent auto-escalation with a UX hint.**
   `route-inference.ts:5330` fires when a file has `protect=` fields but no explicit `auth=`, and
   reports that **auth middleware was auto-injected** (`auth="required"`, `csrf="auto"`). That is
   a materially different, security-relevant event from "your server cell has no initial load" —
   and it is undocumented in §34. An adopter filtering `W-AUTH-001` as a benign
   no-initial-load hint would silently suppress notification that the compiler injected auth
   config on their behalf.

3. **`E-CG-001` conflates an internal compiler defect with the §14.8.9 confidentiality
   backstop.** `emit-client.ts:2962` is the fail-closed protected-field egress check — an
   unverifiable bundle is treated as a potential leak. `index.ts:1709` is a plain "compiler bug,
   please report" internal error. Sharing one code means any adopter or CI rule suppressing
   `E-CG-001` as an internal-error class **also suppresses the security backstop**. These want
   separate codes on blast-radius grounds, independent of the doc fix.

4. **`E-BPP-001` has no normative section anywhere.** Not a dead cite that can be re-pointed —
   the body pre-parser stage is simply unspecified in SPEC.md while emitting a catalogued code.

---

## 7. Reproducing / extending this

Worksheets are regenerable; nothing here depends on a saved artifact.

```
# §34 bounds at this baseline
grep -n '^## 34\.\|^## 35\.' compiler/SPEC.md          # -> 18724 / 19566

# heading set — MUST allow the `## §N.M` form or you get false dead-cites
grep -oE '^#{1,6} +§?[0-9]+(\.[0-9]+)*[a-z]?' compiler/SPEC.md | sed -E 's/^#+ +//; s/^§//' | sort -u

# fire sites for any code
grep -rn --include='*.ts' --include='*.js' -F '"<CODE>"' compiler/src compiler/native-parser | grep -v '\.test\.js'
```

**Next sweep should take the 366 long-form live rows.** `E-SCHEMA-011` (landed this window,
dead cite, self-referential claim about a section that does not exist) is the proof that
provenance markers and recency do not substitute for verification.

## Tags
#scrml #audit #spec #s34 #diagnostics #error-codes #meaning-axis #wrong-meaning #dead-xref
#self-inconsistent #e-pa-002 #w-program-001 #w-auth-001 #e-component-019 #e-cg-001 #e-meta-001
#e-schema-011 #e-bpp-001 #protect-floor #one-code-two-guarantees
