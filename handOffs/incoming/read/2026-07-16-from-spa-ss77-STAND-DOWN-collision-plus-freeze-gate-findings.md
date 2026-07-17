# sPA ss77 → PA — STAND-DOWN (session collision) + freeze-gate findings

**From:** sPA ss77 (fired as `/spa 76`; no ss76 exists — user disambiguated to ss77)
**Date:** 2026-07-16 · **Branch:** `spa/ss77` @ `32cb0a89` — **NOT ADVANCED, zero commits**
**Worktree:** `../scrml-spa-ss77` (base `origin/main` `32cb0a89`) · **List:** `spa-lists/ss77-conformance-markup-parse-4.md`
**Disposition:** stood down on user ruling. Nothing landed. Everything below is handed over.

---

## 1. WHY I STOOD DOWN — a second sPA is running ss77 concurrently

**A second sPA ss77 session is live and shares my worktree.** I did not commit, because a commit
would have swept its in-flight files into my branch and double-pinned codes it is authoring right now.

Evidence (measured, not inferred):

| Fact | Detail |
|---|---|
| My worktree created | `15:56:05` — `git worktree add -b spa/ss77 ../scrml-spa-ss77 origin/main` succeeded, so nothing existed there before |
| My briefs written | `16:00:12` → `docs/changes/conformance-ss77-markup-parse-2026-07-16/BRIEF-{COMMON,A,B,C,D}*.md` |
| **Foreign briefs appear in MY worktree** | `16:01:38`–`16:02:32` → `docs/changes/ss77-{context-boundary,forbidden-jsisms,handler-each-sigil,style-element}-2026-07-16/BRIEF.md` |
| They name a different dispatcher | *"Dispatched by sPA ss77, 2026-07-16. Agent: **scrml-js-codegen-engineer**, isolation:worktree"* — I dispatched 4 **general-purpose** agents |
| Different decomposition | Their 4-way split (context-boundary / forbidden-jsisms / handler-each-sigil / style-element) ≠ my 4-way split (A markup / B handler-write-switch / C ctx-style / D syntax) |
| Foreign agent worktrees | `agent-a6b169d57f93e2954` (`16:02:56`), `agent-a270a865386760d2b` (`16:03:53`) — interleaved with my four at `16:01`, not mine |

**Their agents are authoring literal duplicates of my finished work:**

- `agent-a6b169…` → `conformance/cases/each/at-dot-{outside,inside}-each-{pos,neg}` = **E-SYNTAX-064** (my D2)
- `agent-a270a8…` → `conformance/cases/style/element-rejected-{pos,neg}` = **E-STYLE-001** (my C2)

Different case-ids, same codes → both would land green and silently double-pin the same surfaces.

**I touched nothing of theirs.** Their 4 BRIEF.md dirs are left in place, untouched. I did NOT delete
their worktrees or branch (an idle-looking sPA is a live Claude session, not a greppable process —
S257). **I also removed my own case dirs from `conformance/cases/` in the shared worktree** so their
`git add -A` cannot sweep my cases in as coverage they didn't author and can't explain. My work is
parked inert (§4 below).

> **PA action:** decide which ss77 session owns the branch, and whether the other's work is absorbed
> or discarded. The findings in §3 are independent of that decision and are the real payload here.

---

## 2. Item disposition — 7 of 10 codes authored, 3 CANNOT BE PINNED

Suite: baseline **695/695** → group runs verified **699/699** (C, D) and **705/705** (B, +10 exactly).
All green, all uncommitted. Coverage was verified against artifacts, not list markers: 9 of 10 codes
had zero presence in any `expected.json`; E-CTX-001's 3 grep hits were all `notCodes` ABSENCE
assertions, so its presence case was genuine work. **No no-op items.**

| # | Code | Status | Notes |
|---|---|---|---|
| 1 | E-MARKUP-002 | **BLOCKED — dead code + SPEC divergence** | §3.1, §3.3 |
| 2 | E-MARKUP-003 | **BLOCKED — dead code** | §3.1 |
| 3 | E-MARKUP-VALUE-UNCLOSED | **BLOCKED — not fireable in any pipeline** | §3.5 |
| 4 | E-MULTI-STATEMENT-HANDLER | authored (4 cases, both fire sites) | — |
| 5 | E-WRITE-NOT-IN-LOGIC-CONTEXT | authored (2 cases) | — |
| 6 | E-CTX-001 | authored (2 cases) — first presence coverage | fired at a **5th** site the list omits |
| 7 | E-SWITCH-FORBIDDEN | authored (4 cases, all **three** fire sites) | — |
| 8 | E-SYNTAX-042 | authored (2 cases) | — |
| 9 | E-SYNTAX-064 | authored (2 cases) | + divergence §3.4 |
| 10 | E-STYLE-001 | authored (2 cases) | — |

**18 candidate cases total, all verified green.** None landed.

---

## 3. FINDINGS — ranked by value to the freeze gate

### 3.1 ⭐ `type-system.ts:9154` guard bug — E-MARKUP-002 + E-MARKUP-003 + E-STATE-004 are DEAD CODE

**The entire §35 attribute-validation block never executes, in ANY pipeline.**

```js
// compiler/src/type-system.ts:9154
if (stateTypeRegistry && n.name && n.resolvedCategory !== "user-component") {
```

Markup AST nodes carry **`tag`, not `name`**. Instrumented dump of `<p foo="bar">text</p>`:

```
keys: ["id","kind","tag","attrs","children","selfClosing","closerForm",…,"resolvedCategory"]
node: {"kind":"markup","tag":"p","attrs":[{"name":"foo",…}],…,"resolvedCategory":"html"}
```

`n.name` is `undefined` → the guard never passes → `validateMarkupAttributes` (`:7787`) is **never
called**. Proven by patching the guard to fall back to `.tag` and watching the codes fire exactly as
their guards predict, then reverting to silence them again:

| source | main (as-is) | with `.tag` fallback |
|---|---|---|
| `<td colspan="two">Cell</td>` | `W-PROGRAM-001` | **`E-MARKUP-002`** + `W-PROGRAM-001` |
| `<p foo="bar">text</p>` | `W-PROGRAM-001` | **`E-MARKUP-003`** + `W-PROGRAM-001` |
| `<p data-foo="bar">text</p>` | `W-PROGRAM-001` | **`E-MARKUP-003`** (warning branch, `:7834`) |
| `<p class="x">text</p>` | `W-PROGRAM-001` | `W-PROGRAM-001` (correctly silent) |

**Collateral:** `E-STATE-004` (`:7851`) lives in the same dead function — also dead. Its §34 row
(SPEC.md:18104) claims *"Emitted at `compiler/src/type-system.ts`"*. It is not.

**Per user ruling this is ESCALATE-ONLY — no fix dispatched.** Rationale for the ruling: reviving 3–4
previously-silent ERROR codes could turn existing green corpora/tests red across the suite; that
blast radius is a PA call. **The one-line fix would make all four codes straightforwardly authorable
— the verified reproducers above are ready to become cases.**

### 3.2 ⭐ `on:` event handlers are silently dead at runtime — zero diagnostics, no SPEC basis

Two sources differing only in `onclick` vs `on:click`, driven through the adapter's `run()`, one click:

| form | emitted | click → state |
|---|---|---|
| `onclick=startGame()` | `addEventListener("click", …)` | `count: 0` → **`1`** |
| `on:click=startGame()` | `addEventListener(**":click"**, …)` | `count: 0` → **`0`** |

The `on:` path **leaks the colon into the event name**, so the listener never matches a real click.
Compounding:

- **The quoted form is inert too**: `on:click="startGame()"` compiles clean and ships
  `<button on:click="startGame()">` verbatim into the HTML with **no wiring at all**.
- **SPEC never sanctions `on:`.** The only mention maps Vue's `v-on:click` → scrml `onclick=`
  (§34 W-LINT-012). Yet `isEventHandlerAttrName` matches `/^on:/i`, and `multi-statement-scan.ts`
  calls it *"`on:<word>` namespaced-event syntax (Svelte-derived; §5.2.x)"* — citing a §5.2.x that
  does not define it.
- **The corpus cannot see it**: 3 existing cases use `on:click` (`reactive/server-fn-cps-*`), all
  (a)-codes-only with no runtime half.

So `on:` is an impl-invented form with broken codegen and no SPEC basis. **No case was authored
blessing either silence** — the disposition is a design call (ratify `on:` in SPEC + fix codegen, OR
reject it with a diagnostic; today it is neither). Freeze-gate relevant: this is exactly the
silent-drop class §34 treats as unacceptable for E-SWITCH-FORBIDDEN.

### 3.3 E-MARKUP-002 — the default pipeline contradicts a normative SHALL

SPEC §4.4.1 (SPEC.md:420): *"If the innermost open tag's name does not match, this SHALL be a compile
error (**E-MARKUP-002**)."* Measured:

| source | default (what conformance drives) | `--parser=scrml-native` |
|---|---|---|
| `<p>hello</div>` | `E-CTX-001` | `E-CTX-001` + **`E-MARKUP-002`** |
| `<div><p>hello</div></p>` | `E-CTX-001` | `E-CTX-001` + **`E-MARKUP-002`** |
| `<p>hello</p>` | silent | silent |

**The native parser honors §4.4.1; the default live path emits E-CTX-001 instead** (block-splitter
`:3297`). This is corroborated inside the codebase — `native-parser/tag-frame.js:2074-2080` reasons
through the same conflict and concludes *"a mismatched `</name>` against the innermost open tag is
E-MARKUP-002; an EOF-unterminated tag → E-CTX-001; a stray closer → E-CTX-003."*

⇒ **impl#1 and impl#2 disagree on the code for a closer mismatch, and §4.4.1 sides with impl#2.**
No case authored: asserting E-MARKUP-002 fails; asserting E-CTX-001 enshrines impl#1 against a SHALL.
**Needs a PA ruling** — fix live BS `:3297` to E-MARKUP-002, or amend §4.4.1. Should not be settled
by a conformance case.

### 3.4 `@.` inside `<empty>` is silent — §17.7.4 requires E-SYNTAX-064

§17.7.4 normative: *"The `<empty>` body SHALL NOT reference `@.` … Use of `@.` inside `<empty>` is
`E-SYNTAX-064` per §17.7.3."* impl#1 emits **nothing**, verified silent across all three paths —
interpolation (`<empty><p>${@.name}</p></empty>`), attribute (`<empty><a href=@.email>`), and
shorthand (`<empty : @.name>`).

**Root-caused:** `inEachBodyScope()` (`type-system.ts:12504`) returns true anywhere under an `each:`
scope label; `case "each-block"` (`:12143`) pushes `each:<nodeKey>` and the `<empty>` sub-element body
is walked beneath that same scope → all three guards take their skip path. This is the **scope
predicate**, not walk coverage — the latter was ruled out by proving the `<empty>` body IS visited
(`${@nonexistentCell}` inside `<empty>` fires `E-STATE-UNDECLARED`). Fix: walk the `<empty>` body
outside the `each:` scope, or label it distinctly. **Parked, not golden-captured.**

### 3.5 E-MARKUP-VALUE-UNCLOSED — not fireable in ANY pipeline; its SPEC cite is orphaned

Two independent blockers:

1. **Harness-unreachable.** Its only fire site is `native-parser/parse-expr.js:2323`. `api.js:1112`
   gates the native parser behind `parser === "scrml-native"` — *"STRICTLY OPT-IN. `parser` defaults
   to `null`."* The adapter calls `compileScrml` at 4 sites (`:82`, `:394`, `:842`, `:936`) and
   **never passes `parser`** (zero grep hits). The harness always runs the live BS+TAB path.
2. **Dead even natively.** `parse-expr.js:2323` is reached only if `parseMarkupViaLazyRequire()`
   returns null / no nodes / a span-less first block. The markup layer's error recovery **always**
   yields a spanned node for any `<…`, so the fall-through is dead. Ten adversarial shapes
   (`<li>hello }`, `<li }`, `<li attr=" }`, `<li><span>a }`, lone `<`, `lift <li }`, …) under **both**
   parsers: never fires. Actual: `E-CTX-001` (or `E-EXPR-UNEXPECTED` for a degenerate `<`).
3. **Orphaned cite.** The list and SPEC.md:18610 both cite **§10.2**. §10.2 (SPEC.md:6682) is
   *"Context-Coercion Rules for `lift`"* — a coercion table whose only codes are
   `E-TYPE-010`/`E-TYPE-011`, with **zero** normative text about markup-value closing. The code's only
   SPEC presence is its own §34 registry row; **no normative statement backs it.** The row's own claim
   also inverts: it says *"Distinct from E-CTX-003 … and E-MARKUP-002"* — but E-CTX-001/E-CTX-003 are
   exactly what these shapes emit.

⇒ **Retire the code, or give it a real fire site + normative text.** Not authorable today.

### 3.6 The conformance contract cannot reach 81 of native's own diagnostics

**81 codes fire ONLY in `compiler/native-parser/` and nowhere in `compiler/src/`** — essentially the
whole `E-EXPR-*` + `E-STMT-*` families. None can fire through the harness while the adapter is
hard-wired to the live path.

**Bounded for V1:** of those 81, exactly two appear in any spa-list — `E-MARKUP-VALUE-UNCLOSED`
(ss77 item 3) and `E-UNQUOTED-DISPLAY-TEXT` (ss28, **not** in the campaign manifest, which is
ss56–ss77). So the audit did not sweep the unreachable families into tier-1 via *this* mechanism.

**Still a hole in the Road-B/W5 gate:** `conformance/README.md` states *"Native is correct iff it
passes the 1.0 suite."* A suite that cannot reach 81 of native's own diagnostics does not discharge
that gate. **Post-freeze / impl#2 adapter question — not a V1 blocker.** Flagged, not ruled on.

### 3.7 ⚠ Freeze-denominator methodology — the audit's "fireable" classifier looks unsound

The S256 audit defines a V1-HOLE as a *"real default-pipeline fire site, zero coverage"*. This run
found **two distinct ways a code passes that classifier while being unpinnable**:

1. **Not on the default pipeline** — native-parser-only sites (§3.6). Measured: does not affect the
   campaign's 196.
2. **Live fire site that is never invoked** — the dead-code class (§3.1). **This one DOES affect the
   campaign**: E-MARKUP-002 and E-MARKUP-003 both have live `compiler/src` fire sites and pass a
   naive grep, but their enclosing function is unreachable.

⇒ **A grep for a fire site does not establish invocability.** I could not measure how many other
tier-1 codes sit in dead or unreachable guards — that is a PA-scope re-audit, not an sPA task, and it
requires per-code execution probing rather than grep. **Recommend the PA re-check the S256 tier-1 set
for invocability before treating 196 as the freeze denominator.** In this list alone the true count
is **7 of 10**, with 3 codes that cannot be frozen as V1 surfaces because they cannot fire at all.

*(Honesty note: I first claimed the denominator was overstated via the native-only mechanism, then
retracted it after measuring §3.6 — the retraction was correct for that mechanism. §3.1 then surfaced
a third mechanism I had not measured. The denominator question is open on the dead-code axis.)*

### 3.8 SPEC / §34 catalog defects (cheap fixes, freeze-gate artifacts — §34 is what implementers read)

- **E-STYLE-001 row is wrong** (SPEC.md:18107): `| E-STYLE-001 | §9 | CSS: syntax error in `#{}` style block | Error |`
  — a **completely different trigger** from the code's sole fire site, and it mis-attributes the
  section (§9, should be §4.17). There is no `#{}`-CSS-syntax-error fire site anywhere in
  `compiler/src/`; the only emitter is the `<style>`-element rejection. impl#1 and §4.17 are correct;
  the row is wrong.
- **E-SWITCH-FORBIDDEN row cites stale fire sites**: `ast-builder.js:4514, 7121` — actual are
  `2231, 8614, 12654`.
- **§4.14 line 1048** cross-refs §5.2.2 for the multi-statement rule; the rule is at **§5.2.3**.
- **§4.4.1 self-contradiction**, independent of impl: line 422 says a closer inside `${ }` is
  **E-CTX-002**, while registry row @17907 assigns that same trigger to **E-MARKUP-003**.
- **E-MARKUP-003 duplicate/stale rows** (@17907 §4.4.1 vs @18099 §24.1) — already flagged in
  `scrml-support/docs/audits/s34-catalog-vs-impl-2026-07-16.md:62`, but **that audit reads the guards
  as live** (*"fires for unknown/custom attribute"*); per §3.1 they are dead. The audit's note that
  the `data-*`/`aria-*` warning branch is *"masked in conformance by errors-stream-win"* is also wrong
  about the mechanism — it is masked because **the function is never invoked**. Worth correcting there.
- **§3.2 vs §4.17 tension** (secondary, under-specified): §3.2 (SPEC.md:272) says *"An unclosed context
  at end of file SHALL be a compile error (E-CTX-003)"* and §3.1's table makes Markup a context — yet
  §4.17 mandates E-CTX-001 for an unclosed raw-content element at EOF. Empirically the structural site
  `:3683` (unterminated `<match>`) emits **both**; the `:3749` raw-content site emits only E-CTX-001.
  They coexist as scoped, but the general "unclosed markup tag at EOF" classification is under-specified.
- **`W-DEAD-FUNCTION` false-positive** on `<Idle : startGame()>` — the DG does not appear to count a
  `:`-shorthand body as a call site. Incidental; separate family; not chased.

---

## 4. WHERE THE ARTIFACTS ARE

**Nothing is committed. `spa/ss77` is still `32cb0a89`.**

- **18 candidate cases, all verified green**, parked INERT at
  `../scrml-spa-ss77/docs/changes/conformance-ss77-markup-parse-2026-07-16/candidate-cases/<category>/<case-id>/`
  — deliberately **outside** `conformance/cases/` so `run.ts`'s `readdirSync` discovery does not pick
  them up and the concurrent session cannot sweep them in as live coverage. **To land: move a category
  dir back under `conformance/cases/` and re-run.** Categories: `block-grammar`(2) · `style`(2) ·
  `parse-syntax`(4) · `markup-handler`(4) · `reactive`(2) · `control-flow`(4).
- **My dispatch briefs** (archived verbatim): same change dir,
  `BRIEF-{COMMON,A-markup-tagclose,B-handler-write-switch,C-ctx-style,D-syntax}.md`.
- **Progress + boot notes:** `../scrml-spa-ss77/spa-lists/ss77.progress.md`.
- **The other session's 4 BRIEF.md dirs** are in the same worktree under
  `docs/changes/ss77-*-2026-07-16/` — **left untouched, not mine.**
- Agent worktrees holding the originals (may be GC'd — the candidate-cases copy is the durable one):
  `agent-acf9c1e419bc23d93` (B, 10 cases) · `agent-acdb375bcd1bd1bd2` (C, 4) ·
  `agent-a96d8b9f6ad7bd0e8` (D, 4) · group A's was auto-cleaned (it authored nothing by design).

---

## 5. CORRECTIONS TO UPSTREAM ARTIFACTS (found while working)

- **The list's footprint has drifted** — line refs are stale and several codes have fire sites the
  list does not name. Confirmed actuals: E-CTX-001 has **5** sites (`block-splitter.js:3099/3286/3297/
  3683/**3749**` — the list's `:2989` is stale; `:3749` is the raw-content EOF site the presence case
  actually uses, and the only one with verbatim normative text naming code+condition+recovery at
  §4.17/SPEC.md:1121). E-SWITCH-FORBIDDEN has **3** (`2231/8614/12654`; `:17696` is a dedup consumer,
  `:17709` an unreachable post-parse sweep). E-MULTI-STATEMENT-HANDLER has a 2nd site at
  `symbol-table.ts:7583`. E-SYNTAX-064 has **3** emit sites (`9088/11431/12594`) — the list's `:13819`
  **does exist** but is `atDotEachOnlyMessage()`, the shared *message builder*, not an emit site.
- **My own brief was wrong twice** (recorded so it does not propagate):
  1. I told group B that `on:click="a; b"` is a POS for E-MULTI-STATEMENT-HANDLER. **It fires
     nothing** — `scanForTopLevelSemicolon` treats the attribute's own delimiting quotes as an
     expression-internal string literal, so the `;` is never a top-level hit. The working POS is
     SPEC §5.2.3's own invalid worked example (**unquoted** `onclick=startGame(); track("start")`).
     Chasing this trap is what surfaced §3.2.
  2. I told group D that *"`is not not` is NOT scrml"*. **SPEC contradicts this** — §42.8 normatively
     specifies *"The `is not not` double-negation pattern (presence check) SHALL compile to
     `(x !== null && x !== undefined)`"*, §42.7's suppression rule names the `is not / is some /
     is not not` desugaring, and the parser carries an `is-not-not` binary op. `is some` is the
     preferred idiom, but `is not not` appears to be a ratified legacy form. **This looks
     mis-transcribed from the native-parser `.scrml`-mirror predicate-drift finding** (which is about
     the mirrors, not the language) — that conflation should not propagate into further briefs. No
     effect on D's cases.

---

## 6. RECOMMENDED NEXT ACTIONS (PA-owned; no sPA ruling made on any of these)

1. **Resolve the ss77 session collision** — pick an owner for `spa/ss77`; absorb or discard the other
   session's work. My 18 cases are inert and safe to absorb or drop.
2. **Rule on `type-system.ts:9154`** (§3.1). One line; revives 3–4 tier-1 codes; needs a full-suite
   blast-radius measurement first. Highest value/effort ratio in this list.
3. **Rule on E-MARKUP-002 closer-mismatch** (§3.3): fix live BS `:3297`, or amend §4.4.1.
4. **Rule on `on:`** (§3.2): ratify + fix codegen, or reject with a diagnostic. Currently neither.
5. **Rule on E-MARKUP-VALUE-UNCLOSED** (§3.5): retire, or give it a fire site + normative text.
6. **Re-audit the S256 tier-1 set for invocability** (§3.7) before trusting 196 as the freeze
   denominator. Grep ≠ fireable.
7. **Fix the §34 catalog rows** (§3.8) and correct `s34-catalog-vs-impl-2026-07-16.md`'s dead-code
   mischaracterization.
8. **Fix `@.`/`<empty>` scope predicate** (§3.4), then author the POS.

**End state:** items 4–10 authored-not-landed · items 1–3 blocked-escalated · branch not advanced ·
main untouched (`git status` on main confirmed clean of ss77 artifacts throughout).
