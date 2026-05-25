---
status: in-progress
started: 2026-05-25
session: S130
phase: HU resolutions per finding
dd-source: scrml-support/docs/deep-dives/iteration-design-surface-2026-05-25.md
findings-total: 8 (per DD)
findings-closed: 0
---

# Iteration design surface — Heads-Up Resolutions

This is the running log of per-question resolution decisions for the iteration design surface arc. Each HU sub-session resolves one or more questions from the iteration DD (S130).

**Conventions:**
- HU-N = heads-up sub-session N. Sequentially numbered.
- Each HU section records: question discussed, decision ratified (verbatim user direction where applicable), findings closed / advanced, carry-forward open items.
- Option labels: ASCII `a` / `b` / `c` per S129 banked rule [[feedback_no_greek_chars_in_options]].
- DESIGNER-CARD axis flagged explicitly on Q1 — retirement/existential-veto is on the table (per S94/S129 designer-card discipline).
- Final resolution direction reproduced here verbatim so Phase 2 (SPEC amendments + canon catch-up) work has a single source of truth.

## Prelude — DD inputs

The iteration DD `scrml-support/docs/deep-dives/iteration-design-surface-2026-05-25.md` (1028L) closed at S130 with:

- **NO PA lean** — DD explicitly calls this user-deliberative. "None is technically inferior."
- **8 HU questions** surfaced, starting with the designer-card-shaped Q1.
- **3 viable candidates** after eliminating C (implicit `@it`):
  - A — status quo (`${ for/lift }` stays as the only iteration surface)
  - B/D — `<each in=@items as item key=item.id>` structural element (D = + `:`-shorthand body)
  - E — `each=` attribute on the per-item element (HEEx/Vue precedent)

## Prelude — corpus survey + DX-friction data (load-bearing for Q1)

From the DD §"Corpus survey" + Gauntlet R10 reference:

- **173 sites / 113 files** in `samples/` + `examples/` use `for/of` iteration
- **82%** of iteration sites pair `for/of` with `lift` — meaning the dominant INTENT is markup-emission, not generic iteration
- **Zero live `key=`** use in `examples/` despite SPEC §17.4b shipping
- **Zero live `else { lift }`** empty-state — devs reach for sibling-`if=` pattern instead
- **Gauntlet R10 (2026-04-08):** 9-10 of 13 dev agents wrote **tripled kanban markup** because they didn't reach for `for/of` over enum variants. DD calls this the **"single largest DX pain across all devs."** Empirical evidence the current shape isn't agent-discoverable.

## Prelude — kickstarter prior commitment (load-bearing for Q1)

`docs/articles/llm-kickstarter-v2-2026-05-04.md` lines 688 + 729 carry the load-bearing prior commitment:

> *"There are no `<for>` or `<if>` markup tags."*

A new `<each>` proposal technically avoids `<for>` but the **spirit of the claim** ("no structural iteration element") is contradicted. Q1 is designer-card-shaped: the user can affirm the kickstarter commitment as load-bearing, or admit a new structural-iteration element, or stay status quo.

---

## HU-1 — 2026-05-25 — opening

### Q1 RATIFICATION — (a) ship a structural-markup-first surface

**User direction:** `a`.

**Decision:** Iteration joins `<match>` / `<engine>` / `<channel>` / `<schema>` as a markup-tree element. Closes the Gauntlet R10 DX-pain class (9-10 of 13 dev agents writing tripled kanban markup because they didn't reach for `for/of`). Pillar 1 (markup-as-value) + Pillar 5 (all scrml should be scrml) honored.

**Kickstarter prior commitment ("no `<for>` markup tags") supersession:** the literal claim survives — `<each>` is not `<for>`. The SPIRIT of the claim ("no structural iteration element") is overridden by this Q1=a ratification. Kickstarter amendment scoped under Q8 below (likely: replace the "no markup tags" rule with a positive statement about the `<each>` element + reasoning).

**Migration scope (gauntlet for Phase 2 work):** 113 files in `samples/` + `examples/` use `for/of` iteration — most mechanically migrate-able once the `<each>` shape locks. Promotion path (mechanical via `bun scrml promote --each` or both-forms-ship) is Q7.

**Designer-card NOT invoked.** PA recommendation respected; the cohesion lens + Gauntlet R10 DX-pain data carried the call.

### Q2 — element-shape `<each>` vs attribute-shape `each=`

**Status:** ALREADY RATIFIED S129 (PA option 3) — pre-dates this HU.

Element-shape `<each>` was ratified at S129 close in the late-session iteration discussion. The DD's brief omitted this prior ratification (PA brief-omission; banked as a reinforcement of [[feedback_grep_fire_sites_before_claiming_coverage]] — when authoring DD briefs about prior ratifications, READ the session log not just the summary). This HU confirms the existing ratification:

**Canonical form:**
```scrml
<each in=@items>
    <li>:@.name</>
</each>
```

The parent-element `<ul for=actualInput>` form raised in S129 message 1 was an earlier iteration in the brainstorm; superseded by the `<each>` form (PA option 3 that the user said *"I really like"*).

### Q3 — `:`-shorthand body admit on `<each>` (RE-RATIFIED — actual §4.14 form)

**Status:** S129 PA-claim of *"already ratified `<li>:@.nameOrWhatever</>`"* was SPELLING-INCORRECT. The user correctly flagged the `<li>:@.name</>` shape as reading like type annotation. Per SPEC §4.14 the actual ratified `:`-shorthand puts `:` **inside the opener** with mandatory whitespace before, AND has NO closer on the shorthand-bodied element.

**ACTUAL canonical form per SPEC §4.14:**
```scrml
<each in=@items>
    <li : @.name>            // : INSIDE the opener; mandatory space before; NO </> closer on <li>
</each>
```

**Why this is unambiguous with type annotation:**
- `:` is INSIDE the opener (between attributes and the closing `>`), not at the start of body content
- Mandatory whitespace before `:` (per §4.14 line 969 — `<li : @.name>` ✅; `<li:@.name>` is `E-PARSE-001`)
- No closer (`</li>` or `</>`) on the `:`-shorthand element — closer-presence is `E-CLOSER-001`
- Reads as "tag opener with attrs and a single-expression body" — same shape as ratified `<Idle : startGame()>` engine state-children + `<.Variant : expr>` match arms

**Falls back to bare-body for multi-expression / multi-element bodies:**
```scrml
<each in=@items>
    <li>
        ${@.name}
        ${@.email}
        <button onclick=removeContact(@.id)>×</>
    </li>
</each>
```

**S129 PA-error trail:** The previous PA at S129 conflated three ideas — your `$` body-mode spit-ball, the existing §4.14 `:`-shorthand, and a new body-prefix `:` shape. They wrote `<li>:@.name</>` and claimed "already ratified per §4.14." The shape they wrote isn't §4.14 (which puts `:` inside the opener). Banked as a methodology lesson — even within-session PA "X is ratified per Y" claims need SPEC verification before encoding into downstream amendment work.

**Phase 2 amendment implication (simpler than previously framed):** Landing 1 doesn't need a NEW body-shorthand mechanism. SPEC §4.14 line 983 already says "Other state-types and HTML elements MAY accept `:`-shorthand where doing so is meaningful; the universal grammar registers the form, and per-element rules say whether each element accepts it." Landing 2 (SPEC amendment) just adds `<each>` body to the "loci where `:`-shorthand is legal" list at §4.14.

### Q6 — item-binding shape (PARTIALLY ratified S129)

**Partial ratification:** `@.` is the default contextual-current-item-field-access sigil (NOT the reserved `@it` name that the DD's eliminated Approach C used; `@.` is a sigil for "current scope," not a magic variable name). The DD's V5-strict-discipline argument against `@it` does NOT apply: `@.field` is a clean third axis (bare = local; `@name` = state; `@.field` = current scope).

**Open sub-question (Q6-residual):** whether `as name` is admitted as an OPTIONAL OVERRIDE for cases where (a) nesting requires disambiguation between inner + outer iteration items, (b) a meaningful name aids reading. See open questions below.

### Q5 — key= requirement (open)

(see open question block below)

### Q4 RATIFICATION — (a) `<empty>...</empty>` sub-element inside `<each>`

**User direction:** `a` (Recommended).

**Decision:** Empty-state surface is a `<empty>...</empty>` sub-element inside `<each>`. Composes with the structural-element family + body-as-template idiom. Sub-element discoverable; pairs naturally with `:`-shorthand body.

**Canonical form:**
```scrml
<each in=@items>
    <li>:@.name</>
    <empty>nothing here yet</>
</each>
```

**Rationale:** zero live `else { lift }` use in corpus confirmed adopters reach for sibling-`<if=>` instead — `<empty>` sub-element is more cohesive than either the legacy `else` block or a `fallback=` attribute.

### Q7 RATIFICATION — (a) Tier 0 → Tier 1 ladder + `bun scrml promote --each` CLI + eventual sunset of `for/lift`

**User direction:** `a` (Recommended).

**Decision:** Iteration joins the existing Tier ladder discipline.

- **Tier 0** = `${ for/lift }` (current shape; stays valid but emits `W-EACH-PROMOTABLE` info-lint nudging promotion)
- **Tier 1** = `<each>` (structural-element form per Q1+Q2+Q3+Q6+Q4 ratifications)
- **CLI** = `bun scrml promote --each <file>[:line]` mechanically lifts Tier 0 → Tier 1 at adopter's pace (mirrors the `bun scrml promote --match` precedent from §56)
- **Sunset path** = `<machine>` precedent — lint info → warning → error → parser-strip across future versions. 113 corpus files migrate gradually via CLI.

### Q5 RATIFICATION — (d) inferred

**User direction:** `d` (Recommended) after worked-example surface.

**Decision:** `key=` is inferred from item shape. The compiler:
- If items have a `.id` field → auto-infer `key=@.id`. No diagnostic. Silent + correct.
- If items don't have an inferable identity → emit `W-EACH-KEY-001` info-lint with three legitimate causes named (order-stable list / item has stable identity in different field / dev wants positional).
- Adopters can override at any time via explicit `key=expr`.
- Adopters can suppress the lint via `key=__index__` to acknowledge positional fallback is intentional.

**Pillar alignment:** "compiler owns the wiring." Common case Just Works (corpus zero-`key=` use upgrades to inferred for items with `.id`). Edge case gets surfaced via info-lint.

**Zero corpus migration cost.** 113 corpus iteration sites continue working; sites with `.id`-bearing items auto-upgrade silently.

### Q6 RATIFICATION — (b+) user spit-ball — `@.` + `as name` override; separate `<each of=N>` for count-iteration

**User direction:** `b+` (the user-proposed extension; PA-recommended after analysis).

**Decision:** Two constructs sharing the same machinery (`<empty>`, `:`-shorthand body, `as name` override, `key=` inference, `@.` sigil).

**Two constructs:**
```scrml
<each in=@items>          // collection iteration
    <li>:@.name</>
    <empty>nothing here</>
</each>

<each of=N>               // count iteration
    <tr><td>Row :@.</td></tr>
    <empty>(N is 0)</>
</each>
```

**Semantic rule:** **`@.` is always "the current iteration value"** —
- In `<each in=@items>`: `@.` = current item; `@.idx` = current index (reserved field)
- In `<each of=N>`: `@.` = current index (0..N-1); no separate item to refer to

**Override semantics (`as name`):**
- Bare default is `@.`; reach for `as name` when nesting forces disambiguation OR when meaningful name aids reading.
- In `<each in=@items as item>`: `item` is the current item; `@.` and `item` are aliases inside the body (both work).
- In `<each of=N as i>`: `i` is the current index; `@.` and `i` are aliases.

**`key=` inference per form:**
- `<each in=@items>` → default `key=@.id` if items have `.id`; else `W-EACH-KEY-001`.
- `<each of=N>` → default `key=@.` (the index itself; stable when N stays the same; safe positional behavior).

**Why split rather than overload `<each in=>`:** intent legible at write time; avoids `Array.from({length: N})` workaround; first-class count-iteration consistent with Pillar 5 "all scrml should be scrml."

### Q8 RATIFICATION — (a) rewrite kickstarter as positive statement teaching the design evolution

**User direction:** `a` (Recommended).

**Decision:** Kickstarter v2 lines 688 + 729 ("no `<for>` or `<if>` markup tags") get amended. Replace the negative-space framing with:

- A brief honest acknowledgment that the prior commitment held until `@.` + `:`-shorthand body made the density compete with JS-style for/lift
- The `<each>` recipe with all four canonical shapes (collection / collection + naming / count / count + naming) and the `<empty>` sub-element
- Cross-ref to SPEC §17.X (new subsection per Landing 2)
- Trajectory pointer: the "logic contexts are getting thinner" observation that drove the design

(The `<if>` part of the negative-space framing is NOT being amended in this HU — only iteration's surface is being added. `<if>` stays negative-space pending separate ratification.)

---

## HU-1 SESSION CLOSE — Phase 2 amendment scope crystallized

**All 8 questions ratified.** All findings closed.

| Q | Topic | Ratified |
|---|---|---|
| 1 | Designer-card | a — ship structural surface |
| 2 | Element vs attribute | a — element `<each>` (already ratified S129; this HU confirmed) |
| 3 | `:`-shorthand body admit | a — yes (already ratified S129; this HU confirmed) |
| 4 | Empty-state | a — `<empty>` sub-element |
| 5 | key= requirement | d — inferred + W-EACH-KEY-001 lint |
| 6 | Binding shape + index | **b+** — user spit-ball — `@.` + `as name` override; separate `<each of=N>` for count-iteration |
| 7 | Promotion ladder | a — Tier 0 → Tier 1 ladder + CLI + eventual sunset |
| 8 | Kickstarter amendment | a — positive-statement rewrite teaching the design evolution |

### Canonical iteration surface (post-HU-1; per Q3 RE-RATIFICATION — actual §4.14)

**Single-expression per-item body uses §4.14 `:`-shorthand (`:` INSIDE the opener; mandatory space before; no closer on the shorthand-bodied element):**

```scrml
// Common case — collection iteration; single-expression body via §4.14 `:`-shorthand
<each in=@contacts>
    <li : @.name>
    <empty>No contacts yet.</>
</each>

// Collection + meaningful naming; multi-element body → bare-body with explicit ${...}
<each in=@reservationConflicts as conflict>
    <div class="conflict-card">
        <h3>${conflict.summary}</h3>
        <p>between ${conflict.partyA.name} and ${conflict.partyB.name}</p>
    </div>
</each>

// Count iteration; single-expression body via §4.14
<each of=10>
    <li : "Slot " + @.>
</each>

// Count + naming + multi-element body
<each of=@daysLeft as day>
    <li>
        Day ${day + 1}
        <button onclick=removeDay(day)>×</button>
    </li>
    <empty>Trip is over.</>
</each>

// Nested iteration with override for outer access
<each in=@rows as row>
    <tr>
        <each in=@row.cells>
            <td>${@.value} of ${row.label}</td>
        </each>
    </tr>
</each>

// Simple single-element bodies leverage §4.14 throughout
<ul>
    <each in=@tags>
        <span : @.name>
    </each>
</ul>
```

**Rule:** single-expression body → §4.14 `:`-shorthand (`<li : @.name>`, densest). Multi-element body → bare-body with explicit `${...}` where logic interleaves. Either is canonical depending on body complexity.

### Phase 2 amendment scope (5 landings)

**Landing 1 — Compiler-source impl** (medium-large; isolation:worktree agent dispatch):
- `<each>` element registration in attribute-registry + structural-elements registry
- `@.` contextual-sigil resolution in the body scope (new resolver case at type-system.ts)
- `<empty>` sub-element grammar + codegen (renders when collection is empty / count is 0)
- `key=` inference logic (item type introspection for `.id`; fallback to W-EACH-KEY-001 lint)
- `<each of=N>` count-iteration codegen (range emission; `@.` = current index semantics)
- `as name` override (bind name to current iteration value in body scope)
- `:`-shorthand body composition — **leverages existing §4.14 mechanism per Q3 RE-RATIFICATION**; no new body-shorthand mechanism. Landing 1 adds `<each>` body to the §4.14 "where legal" set per §4.14 line 983 ("Other state-types and HTML elements MAY accept `:`-shorthand where doing so is meaningful"). Per-item element opener admits `:` for single-expression body per existing §4.14 (`<li : @.name>` etc.)
- W-EACH-PROMOTABLE info-lint (fires on `${ for/lift }` Tier-0 sites with promotability)
- W-EACH-KEY-001 info-lint
- New §34 catalog rows
- Test surface: per-shape unit tests + integration tests for nested iteration + reactive collection deps + empty-state composition + §4.14 `:`-shorthand inside `<each>` body

**Landing 2 — SPEC amendment** (doc-only):
- NEW §17.X "Iteration (`<each>`)" subsection — canonical form + four shapes (collection / collection+naming / count / count+naming) + `<empty>` + `key=` inference + `:`-shorthand body composition
- §17.4 (current `for/lift`) marked as Tier 0 with W-EACH-PROMOTABLE info-lint forward-ref
- §56 promotion-ergonomics extended with `--each` CLI section (mirrors `--match` precedent)
- §17.4b `key` clause carries forward as the Tier-0 surface; Tier-1 inference is the post-promotion answer
- §34 +2 codes (W-EACH-PROMOTABLE + W-EACH-KEY-001)
- §3.4 V5-strict per-locus table extended for `@.` contextual sigil

**Landing 3 — `bun scrml promote --each` CLI subcommand:**
- Mechanical lift of `${ for (let x of @items) { lift <markup/> } }` → `<each in=@items><markup/></each>`
- Inference for the per-item template (the body of the `lift`)
- `:`-shorthand application where the template is single-expression-shaped
- Mirrors the `bun scrml promote --match` CLI shape per §56

**Landing 4 — PRIMER + kickstarter F-NEW catch-up:**
- PRIMER new flagship subsection on iteration (`<each>` canonical form + four shapes)
- Kickstarter v2 lines 688 + 729 amended per Q8 ratification — positive statement + design-evolution story
- Kickstarter recipes updated to show `<each>` canonical form
- Cross-ref to SPEC §17.X (new subsection)

**Landing 5 — Corpus migration (gradual; via CLI):**
- 113 corpus iteration sites in `samples/` + `examples/` migrate from `for/lift` to `<each>` via CLI
- No hard deadline; sites migrate as they're touched
- Sunset path: W-EACH-PROMOTABLE info → warning → error → parser-strip over future versions (mirroring `<machine>` deprecation precedent)

### Sequencing

1. Landing 1 (impl) → Landing 2 (SPEC) — Landing 2 needs Landing 1's actual semantics to spec faithfully
2. Landing 3 (CLI) — after Landing 1 lands; CLI consumes the new `<each>` parser
3. Landing 4 (canon catch-up) — after Landing 2 (needs stable SPEC prose)
4. Landing 5 (corpus migration) — gradual; can begin as soon as Landing 3 ships the CLI

Each landing is its own dispatch with its own commit + test surface.

### Carry-forward (post-HU-1)

- **L19 multi-statement-handler relaxation** — a sibling iteration-adjacent question; HU follow-on per S129 carry-forward queue. Not addressed in this HU.
- **The `$(param){...}` fn shorthand** raised in S129 message 1 (alongside `<ul for=>`) — separate logic-context-thinness proposal; not iteration. Carry forward for a future HU on logic-context density.
- **The `<if=>` half of kickstarter's "no markup tags" prior commitment** — not amended by this HU; remains as-stated pending separate ratification.

### Banked methodology from HU-1

**[[feedback_grep_fire_sites_before_claiming_coverage]] EXTENSION** (re-validated, now reinforced as DD-brief-authoring discipline): when authoring deep-dive briefs about PRIOR-SESSION ratifications, READ the session log (`.claude/projects/...jsonl`) not just the carry-forward summary. The carry-forward summary's "`<each>` + `@` bare + `:`-shorthand template body" was a faithful summary; PA brief-authoring abstracted away the verbatim user-proposed forms (`<ul for=>` / `@.` / `<li attributes $>`) and built the DD around prior-art framings (Svelte/Vue/HEEx) + a stale "Approach C `@it`" interpretation. User caught the omission at HU-1 Q2 surface time. Banked as DD-brief-authoring lesson.

**[[feedback_show_code_to_reason_about]]** (NEW): when asking the user to ratify a load-bearing design decision, surface WORKED CODE EXAMPLES (multi-line realistic adopter scenarios across edge cases) rather than tiny syntax snippets. User direction at Q5: *"show me this in use before I decide. code I can reason about. not a tiny syntax snippet."* The 4-option-per-scenario worked-example surface at Q5 enabled clean ratification within one round.

### Designer-card discipline note

Designer-card option (c) on Q1 was offered + not invoked. PA's S129 brief-omission was caught + corrected by the user; the actual S129 ratifications carried through. Iteration arc proceeds with `<each>` + `@.` + `:`-shorthand body + `<each of=N>` as the canonical surface.

HU-1 closes. Phase 2 dispatch authorization pending USER (or fold into next session's work-block per pace).

### Q8 — kickstarter rule amendment (open; deferred to end)

(see open question block below)
