# capitalized-tag-registry-resolution — progress

Append-only. Change-id: `capitalized-tag-registry-resolution`.
Gap: `g-capitalized-unknown-tag-neither-normalized-nor-rejected` (MED).
Base: `e8fdd44c`.

---

## Startup verification

```
pwd                     = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a838683744eb569ef
git rev-parse --show-toplevel = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a838683744eb569ef
git status --short      = (clean)
git log -1              = e8fdd44c
bun install             = 218 packages installed
bun run pretest         = Compiled 13 test samples -> samples/compilation-tests/dist/
```

Footprint fence honoured: NOTHING under `compiler/src/codegen/` and NOT
`compiler/src/dependency-graph.ts` was touched.

## MAPS

`.claude/maps/primary.map.md` read in full (stamp `a0344d75`, base `e8fdd44c`).

Load-bearing finding: **"The compiler ships TWO parsers: the live pipeline
(block-splitter.js + ast-builder.js) and `compiler/native-parser/`
(`--parser=scrml-native`, also feeding the LSP semantic-tokens provider).
native-parser/ has had ZERO diff since `df2ac831`."** — the fix lands on the
live pipeline only; native-parser parity for tag canonicalization is an
explicitly-surfaced deferral rather than an oversight.

Secondary (routing): the Task-Shape Routing table has no row for
name-resolution / tag classification; the nearest rows point at schema.map.md
(AST node shapes) and error.map.md (diagnostic codes). Neither was needed —
this change adds no AST node type and no §34 code.

Also load-bearing as a hazard check: **"`<outlet>` is NOT a dedicated AST node.
It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is
`<main>`. Every consumer matches structurally."** Confirms that rewriting
`node.tag` is a semantically live operation for structural tags too, which is
why TC carries an explicit `SCRML_NON_ELEMENT_TAGS` guard and why
`canonicalElementName` deliberately does NOT consult the curated `REGISTRY`
(which contains `program` / `each` / `errors`).

## Reproduction on base `e8fdd44c` (PRE-FIX)

| source | errors | emitted `<body>` |
|---|---|---|
| `<program><Widget/></>` | `["E-COMPONENT-035"]` | `<Widget />` |
| `<program><Button>click</></>` | `[]` | `<Button>click</Button>` |
| `const Button = <div class="cmp">c</>` + `<Button/>` | `[]` | `<div data-scrml="Button" class="cmp">c </div>` |

Plus the named corpus instance
`samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-bare-011.scrml`:
`errors: []`, emitted body contains `<Button>click</Button>` VERBATIM. Both
halves of the brief's claim reproduce exactly.

Root cause located precisely, and it is NOT where the gap title implies. NR
(`name-resolver.ts` `resolveName`) is ALREADY spec-correct: §15.15.2 step 4
matches built-in HTML elements case-insensitively, so `<Button>` is stamped
`resolvedKind: "html-builtin"` — which is exactly why it escapes VP-2's
`E-COMPONENT-035` (that fires on `unknown` + uppercase, and `<Widget/>` is
`unknown`). The break is the SPELLING half: BS classifies by capitalization
alone (`isComponentName`, a pre-registry syntactic stage), so the node still
spells itself `Button`, and every downstream element consumer lowercases its own
registry lookups but emits `node.tag` verbatim.

## The fix — Stage 3.055 (TC), `compiler/src/tag-canonicalizer.ts`

New per-file pass, wired in `api.js` immediately after NR, that makes each
markup node's spelling agree with the classification NR already made:

1. `resolvedKind` user-component / user-state-type / scrml-lifecycle -> untouched
   (a REGISTERED `Button` still beats `<button>`);
2. `resolvedKind` html-builtin -> `tag` rewritten to the canonical element
   spelling, legacy `isComponent` cleared;
3. `unknown` / unstamped -> untouched (`<Widget/>` still rejected).

Post-condition: `<Button>` compiles to exactly what `<button>` compiles to.

**Why not inside NR:** SPEC §15.15.6 — *"NR SHALL NOT mutate any existing AST
field; it adds only the two advisory fields."* Putting the rewrite in NR would
violate a normative SHALL, so TC is a distinct stage that CONSUMES NR's stamp.

**Why `resolvedKind` and not `isKnownElementName`:** the brief proposed keying
arm 2 on `isKnownElementName` (HTML u SVG u MathML u custom-hyphen). Keying on
NR's stamp instead is both narrower and strictly safer, and it is what SPEC
§15.15.2 step 4 actually says (registry source 4 is "the registry from
`compiler/src/html-elements.js`", which `isHtmlElement` implements as REGISTRY +
`rendersToDom`). The wider predicate would have reached tags NR resolves to
`unknown` — including `<Title>`, `<A>`, `<B>`, `<P>`, `<Q>`, `<Big>`, `<Small>`
which appear in the live corpus as ENGINE STATE names and match-arm variants,
not markup. See the Deferral section.

## Files touched

- `compiler/src/html-elements.js` — NEW `canonicalElementName()` + the
  `SVG_CANONICAL_BY_LC` recovery map. Deliberately does NOT consult `REGISTRY`.
- `compiler/src/tag-canonicalizer.ts` — NEW. Stage 3.055.
- `compiler/src/api.js` — Stage 3.055 wiring after NR.
- `compiler/src/landmark-tag.ts` — UPSTREAM NOTE updated: the classifier it
  flagged as unfixed is now fixed; its capitalization branch is retained as the
  no-NR-stamp path.
- `compiler/PIPELINE.md` — Stage Index row + full Stage 3.055 contract section.
- `compiler/tests/unit/capitalized-tag-registry-resolution.test.js` — NEW.
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-bare-011.scrml`
  — see the fixture ruling below.

## Fixture ruling — `phase1-use-bare-011.scrml`

KEEP `<Button>`, unchanged. What the gauntlet fixture tests is named in its own
first line: *"`use` capability import at file preamble (§41.2)"* — the subject is
the `use scrml:ui` preamble, and the `<Button>` body is incidental filler. It
now resolves to the HTML `button` element and is validated as one, which is the
correct post-fix behaviour for that source and leaves the fixture's actual
subject untouched. Editing it would only hide the one live artifact-diff
datapoint this change has.

## Verification

### Before / after, the three regression shapes

| source | errors BEFORE | body BEFORE | errors AFTER | body AFTER |
|---|---|---|---|---|
| `<program><Button>click</></>` (UNREGISTERED) | `[]` | `<Button>click</Button>` | `[]` | `<button>click</button>` |
| `const Button = <div class="cmp">c</>` + `<Button/>` | `[]` | `<div data-scrml="Button" class="cmp">c </div>` | `[]` | `<div data-scrml="Button" class="cmp">c </div>` |
| `const Button = <button class="cmp" type="submit">go</>` + `<Button/>` | `[]` | `<button data-scrml="Button" class="cmp" type="submit">go </button>` | `[]` | (unchanged) |
| `<program><Widget/></>` | `["E-COMPONENT-035"]` | `<Widget />` | `["E-COMPONENT-035"]` | `<Widget />` |

Element-validation parity (the point of normalizing — pre-fix nothing ever
validated the node AS a button):

| source | errors | body |
|---|---|---|
| `<Button bind:value=@name>click</>` | `["E-ATTR-011"]` | `<button data-scrml-bind-value="_scrml_bind_bind_value_1">click</button>` |
| `<button bind:value=@name>click</>` | `["E-ATTR-011"]` | *(byte-identical)* |

LIVE cross-file registered-component case —
`compiler/tests/integration/fixtures/a5/cross-file/app.scrml`, whose `<Header/>`
is an IMPORTED component whose name collides with the HTML `<header>` element:
`errors: []`, body root `<nav data-scrml="Header" …>` (the component's own root),
`html.includes("<Header") === false`. The component won, as registration — not
capitalization — requires.

### Corpus artifact diff

Harness: compile every `.scrml` in the repo individually
(`compileScrml({ write: true })`), record `{ errorCodes, emittedHtml }`, diff.

```
comparable set (present in both runs): 2201 files
identical (diagnostics + emitted html): 2200
DIAGNOSTIC-SET CHANGES: 0
EMITTED-HTML CHANGES:   1
  samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-bare-011.scrml
    -     <Button>click</Button>
    +     <button>click</button>
```

Exactly one file, and it is the file the brief pre-measured. Re-measured
migration count: **1**, matching.

(36 keys appear only in the after-set: transient `compiler/tests/unit/__fixtures__/**`
files written by unit-test runs between the two snapshots. Gitignored, not corpus.)

### Test suite, diffed BY TEST NAME

Baseline: a clean tree materialized from `git archive e8fdd44c` into the
scratchpad (a first attempt that ran in the live worktree was DISCARDED — it
raced the source edits and would have been a contaminated baseline).

```
BASE  e8fdd44c : 28559 pass / 203 skip / 1 todo / 34 fail lines -> 31 UNIQUE failing names
AFTER dfd9ce54 : 28658 pass / 216 skip / 1 todo / 31 fail lines -> 31 UNIQUE failing names

comm -13 (new failures)     : EMPTY
comm -23 (resolved failures): EMPTY
```

The failing-NAME sets are identical. Zero new failures.

### Pre-existing findings, NOT touched (out of scope)

- `phase1-use-bare-011.scrml` emits its `use scrml:ui` preamble line into the
  document `<body>` as literal text (`<body>\nuse scrml:ui\n…`). Present
  identically in the before snapshot; unrelated to this change. §41.2 `use`
  capability imports should not reach the emitted body.
