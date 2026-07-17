# ss77 — DUPLICATE sPA BOOT (stood down) + markup/parse findings worth keeping

**From:** a second sPA instance booted on `ss77` at ~16:00 2026-07-16 via `/spa ss77`.
**Status:** **STOOD DOWN — no work landed, no commits, nothing pushed.**
**Why:** an sPA was ALREADY live on ss77. I collided with it and backed out.

## What happened

I booted, verified coverage from artifacts, grepped live fire sites, and dispatched 4
worktree agents across items 4/9, 5/6, 7/8, 10. Only when I went to write
`spa-lists/ss77.progress.md` did I discover the file already existed — the Write tool's
read-before-write guard caught it. That file is another sPA's, and it was **live**:
mtime 3 minutes old, 4 agents dispatched (groups A=items 1-3, B=4,5,7, C=6,10, D=8,9),
and its group-C agent had already landed 4 case dirs in `../scrml-spa-ss77`
(`block-ctx-001-{closed-raw-content-neg,unterminated-raw-content-pos}`,
`style-001-{scoped-css-neg,style-block-pos}`).

My 4 groups were a complete subset of its B/C/D. **I killed all 4 of my agents** and
removed the 4 `docs/changes/ss77-*/BRIEF.md` dirs I had written into its worktree.
`git status` in `../scrml-spa-ss77` is back to exactly its own artifacts — verified.

**Root cause worth noting:** the other instance was fired as `/spa 76` (no such list;
numbering skips 76) and the user disambiguated it to ss77. Then `/spa ss77` was fired
again — landing a second instance on the same list. There is no liveness check in the
`/spa` boot procedure; the list file itself carries no "claimed" marker. The `spa/ss77`
branch and `../scrml-spa-ss77` worktree already existing is NOT a signal (the PA
pre-cuts those). The only accidental signal was the progress file, caught by a tool
guard rather than by the boot procedure. **A `commit-lock`-style claim for sPA lists, or
a boot step that stats `spa-lists/ss<N>.progress.md` first, would close this.**

## Findings the live ss77 session does NOT have (its group A is on items 1-3 NOW)

All measured through the real adapter (`conformance/adapters/impl1-ts.ts` → `compileScrml`),
not reasoned from the catalog. These matter because its group-A agent is authoring
exactly these codes and could enshrine impl#1 against a normative SHALL.

### The whole `E-MARKUP-*` family looks DEAD on impl#1's default path

`validateMarkupAttributes` (`type-system.ts:7787`, the E-MARKUP-002/003 site) has exactly
ONE live caller (`:9157`, gated on `stateTypeRegistry.get(n.name)` +
`resolvedCategory !== "user-component"`). `buildStateTypeRegistry` (`:5786`) DOES populate
every HTML element with a real `attributes` Map (`html-elements.js` REGISTRY, `:498-518`),
so the `instanceof Map` early-return should pass and it should fire. **It never does:**

| probe | expected per catalog | actual |
|---|---|---|
| `<program><div flurb="x">hi</div></program>` | E-MARKUP-003 (§24.1, Error) | *silent* |
| `<program><input zzz="q"/></program>` | E-MARKUP-003 | *silent* |
| `<program><div id="5">hi</div></program>` | E-MARKUP-002 (attr type mismatch) | *silent* |
| `<program><div tabindex="notanumber">…` | E-MARKUP-002 | *silent* |

Something upstream gates the walker off. Root-causing is a compiler-bug investigation —
flagged, not attempted.

### Item 1 · E-MARKUP-002 — CONFIRMED impl#1-vs-SPEC divergence

SPEC §4.4.1 (`SPEC.md:420`), normative: *"If the innermost open tag's name does not match,
this SHALL be a compile error (**E-MARKUP-002**)."* Measured — impl#1 fires **E-CTX-001**:

- `<program><div>hi</span></program>` → `E-CTX-001(error)`
- `<program><div><span>hi</div></span></program>` → `E-CTX-001(error)`
- `<program><div>hi</div></program>` (neg control) → clean

§34 row `SPEC.md:17906` already flags the two-meaning collision ("see H-03 audit note") —
**but the "H-03 audit note" does not exist anywhere in SPEC.md**; that row is the only hit.

### Item 2 · E-MARKUP-003 — three-way contradiction + an unenforced normative SHALL

Two conflicting §34 rows: `:17907` (§4.4.1, "closer used inside a `${ }` logic context")
and `:18099` (§24.1, "Unknown attribute on known HTML element").

For the FIRST row's rule, §4.4.1's own normative text (`SPEC.md:419`) names a **different
code**: *"An explicit closer `</name>` SHALL NOT be used inside a `${ }` logic context
(**E-CTX-002**)."* So the catalog row and the normative text of the same section disagree.

impl#1 fires **neither** — the rule is entirely unenforced:
- `<program>${ </div> }</program>` → silent
- `<program><div>${ </div> }</div></program>` → silent
- `<program><p>${ </p> }</p></program>` → silent

And impl#1's real `E-CTX-002` is an unrelated rule — `block-splitter.js:31`: *"Bare `/` or
trailing `/` used inside a logic/sql/css/error-effect/meta context"*. So §4.4.1's
E-CTX-002 citation points at a code that means something else entirely.

⇒ §4.4.1 text says E-CTX-002 · §34 says E-MARKUP-003 · impl#1 says nothing. Needs a ruling.

### Item 3 · E-MARKUP-VALUE-UNCLOSED — independent confirmation of their ESCALATE-1

I reached the same conclusion by the same chain (native-parser-only fire site;
`api.js` `parser === "scrml-native"` opt-in defaulting to null; adapter never passes it).
Adding the empirical half they did not record — the pos and neg are **indistinguishable**:

- `<program>${ const tpl = <div>hi }</program>` → no error
- `<program>${ const tpl = <div }</program>` → no error
- `<program>${ const tpl = <div>hi</div> }</program>` (neg) → no error

An unclosed markup value is silently accepted. Their ESCALATE-1 stands, confirmed.

## Two findings from my agents before I killed them (unverified — treat as leads)

- **E-SYNTAX-042 (item 8):** a **typed** cell decl appears to suppress E-SYNTAX-042
  **file-wide**, while an untyped decl does not. The agent was mid-investigation into
  whether the whole gauntlet pass bails. If real, that is a compiler bug and item 8's
  cases must be authored around it (or it blocks the item). **Worth handing to their
  group D.**
- **E-CTX-001 (item 6):** `conf-013` is an exact mismatched-closer twin in the existing
  test corpus, citing **§4.4.2** — useful prior art / a source-test provenance anchor,
  and relevant to the item-1 divergence above.

## Net

Nothing of mine landed; the live session owns ss77 and is unblocked. The findings above
are the only durable output of this instance. The item-1/item-2 divergences are the
substantive part: **the §4/§10 markup-closer boundary is weaker than the ss77 list
assumes** — two normative §4.4.1 SHALL rules are unenforced or mis-coded, and the
E-MARKUP-* family may not be live language-1.0 surface at all. That question
("is E-MARKUP-* 1.0 surface, or retired?") is one ruling that unblocks items 1-3 together.
