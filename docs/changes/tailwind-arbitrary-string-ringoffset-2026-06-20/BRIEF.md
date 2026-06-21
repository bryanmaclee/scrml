# BRIEF — tailwind-arbitrary-string-ringoffset-2026-06-20

> Archived verbatim per pa.md S136. Dispatched by sPA ss8 (promotion-tailwind), isolation:worktree, opus. Base HEAD `a3b08cbb` (origin/main, S210 — after the A2 W2 `<api>` parser landing; tailwind-classes.js + the bug-1 tailwind tests are UNCHANGED at this base). Lands on `spa/ss8` via sPA file-delta (you commit on YOUR agent branch; the sPA re-integrates).

Change-id: `tailwind-arbitrary-string-ringoffset-2026-06-20`. This is the **bug-1 Tailwind arbitrary-value remainder** — TWO of the three remaining sub-arcs (the third, safelist/@apply, is design-deferred and OUT of scope). The Bug-1 composing-family arc (ring/shadow/gradient/transform/filter) is ALREADY DONE (S191, approach C). This dispatch adds two small, already-ruled mechanical extensions to the arbitrary-value engine. Everything is contained to ONE source file: `compiler/src/tailwind-classes.js`.

## SCOPE — strictly this, nothing else
- **IN:** (sub-arc 1) string-shaped arbitrary values `content-['text']` / `font-[Inter]`; (sub-arc 3) lone arbitrary `ring-offset-[<len>]`. Code in `compiler/src/tailwind-classes.js` + tests.
- **OUT (do NOT touch):**
  - Sub-arc 2 (safelist / `@apply` lint precision) — design-deferred (SPEC §26.5), escalated to the PA. Do not build any safelist config, `@apply` parsing, or `#{}`-class-scan suppression.
  - **Do NOT edit `compiler/SPEC.md`, `compiler/SPEC-INDEX.md`, `docs/known-gaps.md`, `master-list.md`, or any `spa-lists/*`** — those are PA/sPA-owned at re-integration. Source + tests ONLY.
  - Do NOT widen `VALID_MATH_FUNCTIONS` (e.g. `attr`/`counter`) — `content-[attr(...)]` is a separate normative change, not in scope.
  - Do NOT change the composing families (ring/shadow/gradient/transform/filter) already shipped.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (S99 leak-history — hard gate)
Your worktree path = WORKTREE_ROOT, an absolute path that MUST contain the `.claude/worktrees/agent-<id>/` segment under `/home/bryan-maclee/scrmlMaster/scrml/`.
## Startup (BEFORE any other tool call)
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If under any OTHER repo (e.g. `scrml-support`, `scrml-spa-ss8`, or the main `scrml` checkout), STOP + report (S90 CWD-routing). Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. `git rev-parse --abbrev-ref HEAD` + `git log --oneline -1` — confirm base `a3b08cbb`. If older, `git merge main` or report.
4. `git status --short` clean.
5. `bun install` (node_modules may need linking). 6. Sanity: `bun test compiler/tests/unit/bug-1-tailwind-arbitrary-value-emit.test.js` GREEN at baseline.
If ANY fails: STOP + report.
## Path discipline
- Apply ALL edits via Bash (`perl`/`python3`/heredoc/`cp`) on WORKTREE_ROOT-absolute paths that include the `.claude/worktrees/agent-<id>/` segment — NOT relative paths, NOT main-checkout paths. Echo the path before each write; `git diff`/`grep` after.
- NEVER `cd` into the main repo or a sibling worktree. Use `git -C "$WORKTREE_ROOT"`, worktree-absolute paths.
- First commit message includes verbatim `pwd`: `WIP(tw-arb): start at <pwd>`.

# COMMIT DISCIPLINE
Commit per sub-arc (code + its tests together — coupled, no transiently-red window). Before DONE: `git status` clean. Update `$WORKTREE_ROOT/docs/changes/tailwind-arbitrary-string-ringoffset-2026-06-20/progress.md` per sub-arc. **NEVER `--no-verify`** (the pre-commit hook is the gate; do not bypass, do not set `core.hooksPath`).

# RULE 4 — SPEC NORMATIVE (read, do not edit)
The arbitrary-value model is SPEC §26.4 (lines ~16085-16137) + the composing model §26.7 (~16231+). The supported-prefix list (§26.4) and accepted-function list (§26.4.1) are normative — but you are NOT editing them; the sPA proposes the §26.4/§26.7 currency note to the PA. Your job is the CODE + TESTS that match the behavior below. Read §26.4 + §26.4.1 + §26.7 (ring-offset paragraph) to confirm the emit shapes, then implement.

# THE FILE — `compiler/src/tailwind-classes.js` (all changes here)
Key loci (line numbers approximate — grep to confirm):
- `ARBITRARY_PREFIX_MAP` (~1602) — direct prefix→property map.
- `ARBITRARY_DECL_TRANSFORM` (~1723) — prefix→full-declaration-body transform (where `ring`, `col-span`, directional transforms live). `BOX_SHADOW_COMPOSE` (~567) + `ringShadowSetter` (~576) are in scope here.
- `ARBITRARY_OVERLOADED_PREFIXES` (~1842) — prefix→property where the property depends on value shape (`text`/`bg`/`border`).
- `validateArbitraryCss(raw)` (~1975) — the bracket-value validator returning `{kind, css}` or `{error}`.
- `registerRing()` (~584) — the NAMED ring/ring-offset utilities; MIRROR these emits exactly.

## Sub-arc 1 — string-shaped arbitrary values (`content-['text']`, `font-[Inter]`)

### (a) New value-kind `string` in `validateArbitraryCss`
Insert a string-detection branch **AFTER the backtick check (~line 1993) and BEFORE the top-level-underscore list-split block (~line 2006)** — order matters: a quoted value with underscores must stay ONE token, not split into invalid segments.

Rule: if `raw` begins AND ends with the SAME quote char (`'` or `"`), length ≥ 2:
- Reject (E-TAILWIND-001, reason names the embedded quote) if the INTERIOR contains that same quote char (ambiguous/unterminated).
- Otherwise return `{ kind: "string", css: <quote> + interior-with-top-level-underscores→spaces + <quote> }`. Per the Tailwind underscore-as-space convention, convert `_`→space in the interior (a quoted string is literal text — a simple `.replace(/_/g, " ")` on the interior is correct; do NOT do paren-depth splitting inside a string). Note in a comment that `\_`-escape (literal underscore) is NOT supported, consistent with the existing list-split code which also doesn't handle `\_`.

The existing whitespace check (~1981) and injection-vector check (~1987, `/[;{}<>]/`) run BEFORE this and stay — so `content-['a;b']` / actual-whitespace stay rejected. Good (keep them).

### (b) `content` prefix (direct map)
Add to `ARBITRARY_PREFIX_MAP`: `"content": "content"`. So `content-['hello']` → `content: 'hello'`, `content-["x"]` → `content: "x"`. (Direct map; any value-kind maps to the `content` property — string/ident/number/list all pass through.)

### (c) `font` prefix (overloaded — number→weight, else family)
Add to `ARBITRARY_OVERLOADED_PREFIXES`:
```js
"font": (v) => (v.kind === "number" ? "font-weight" : "font-family"),
```
So `font-[Inter]` → `font-family: Inter`, `font-['Helvetica_Neue']` → `font-family: 'Helvetica Neue'`, `font-[550]` → `font-weight: 550`. (Tailwind v3: numeric arbitrary `font-` is font-weight; everything else is font-family.)

### Sub-arc 1 — exact expected DECL bodies (assert via `getTailwindCSS` full-string match; compute the escaped selector by running, mirror existing §-test style):
| class | decl body |
|---|---|
| `content-['hello']` | `content: 'hello'` |
| `content-["hello"]` | `content: "hello"` |
| `content-['hello_world']` | `content: 'hello world'` |
| `content-['']` | `content: ''` |
| `font-[Inter]` | `font-family: Inter` |
| `font-[ui-monospace]` | `font-family: ui-monospace` |
| `font-['Helvetica_Neue']` | `font-family: 'Helvetica Neue'` |
| `font-[550]` | `font-weight: 550` |
| `md:font-[Inter]` | wraps in `@media (min-width: 768px) { ... }` (variant integration still works) |

Rejections (assert `getTailwindCSSWithDiagnostic` → `diagnostic.code === "E-TAILWIND-001"`): `content-['a'b']` (embedded quote), `content-['a;b']` (injection vector), `font-['a"b']` (mixed/embedded quote).

## Sub-arc 3 — lone arbitrary `ring-offset-[<len>]`
Add a `"ring-offset"` entry to `ARBITRARY_DECL_TRANSFORM`, kind-dispatched, MIRRORING the named `ring-offset-{w}` (registerRing ~line 600-603) and named `ring-offset-{color}` (~line 614):
```js
"ring-offset": (v) => {
  if (v.kind === "color" || v.kind === "var" || v.kind === "keyword") {
    // color form — mirror named ring-offset-{color}-{shade} (sets only the color var)
    return `--tw-ring-offset-color: ${v.css}`;
  }
  // length / number — mirror named ring-offset-{w}: width + offset-shadow var + the compose shorthand
  return `--tw-ring-offset-width: ${v.css}; --tw-ring-offset-shadow: var(--tw-ring-inset,) 0 0 0 ${v.css} var(--tw-ring-offset-color, #fff); ${BOX_SHADOW_COMPOSE}`;
},
```
`parseArbitraryValue("ring-offset-[2px]")` yields prefix `"ring-offset"` (first `-[`), so the exact-key declTransform lookup hits this and NOT `ring`. The declTransform list-rejection (~2299) already rejects a list value for declTransform prefixes — correct (ring-offset-width is single-token).

### Sub-arc 3 — exact expected DECL bodies:
| class | decl body |
|---|---|
| `ring-offset-[2px]` | `--tw-ring-offset-width: 2px; --tw-ring-offset-shadow: var(--tw-ring-inset,) 0 0 0 2px var(--tw-ring-offset-color, #fff); box-shadow: var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow, 0 0 #0000)` |
| `ring-offset-[#ff0000]` | `--tw-ring-offset-color: #ff0000` |
| `ring-offset-[var(--c)]` | `--tw-ring-offset-color: var(--c)` |
| `ring-offset-[red]` | `--tw-ring-offset-color: red` |

Composition check (test): `ring-[3px] ring-offset-[2px]` both resolve, the ring shadow's `calc(3px + var(--tw-ring-offset-width, 0px))` and the offset width compose with no single-property collision.

# TESTS
- **Sub-arc 1:** extend `compiler/tests/unit/bug-1-tailwind-arbitrary-value-emit.test.js` with NEW `describe` §-sections (follow the existing §-numbered style + the `getTailwindCSS` / `getTailwindCSSWithDiagnostic` / `findUnrecognizedClasses` imports already at the top): `content-[...]` strings (single/double quote, underscore→space, empty), `font-[...]` (family ident, quoted family, numeric→weight), variant integration (`md:font-[Inter]`), rejections (embedded/mixed quote, injection vector), and a **lint-regression** §: `findUnrecognizedClasses('<div class="content-[\\'hello\\'] font-[Inter]">')` returns ZERO diagnostics for those two classes (they now resolve), and `findUnsupportedTailwindShapes` likewise no longer fires on them. Also assert a control typo (`fontt-[Inter]` or `contentt-['x']`) STILL fires the lint (no over-suppression).
- **Sub-arc 3:** extend `compiler/tests/unit/bug-1-tailwind-ring-family.test.js` with a NEW §-section for arbitrary `ring-offset-[<len>]` width form, `[#hex]`/`[var()]`/`[keyword]` color form, the composition case above, and a lint-regression (`ring-offset-[2px]` no longer fires W-TAILWIND-UNRECOGNIZED-CLASS).
- Assert FULL output strings (compute escaped selectors by running the code — do NOT hand-guess escaping).

# VERIFY — S138 R26 (MANDATORY before DONE)
1. `bun test compiler/tests/unit/bug-1-tailwind-arbitrary-value-emit.test.js compiler/tests/unit/bug-1-tailwind-ring-family.test.js compiler/tests/unit/bug-1-tailwind-unrecognized-class.test.js` — all GREEN.
2. **Empirical re-emit probe (paste commands+output in report):** a tiny node/bun script importing `getTailwindCSSWithDiagnostic` from the worktree source, printing the emit for: `content-['hello']`, `content-['hello_world']`, `font-[Inter]`, `font-['Helvetica_Neue']`, `font-[550]`, `ring-offset-[2px]`, `ring-offset-[#ff0000]`, `ring-[3px] ring-offset-[2px]` (as two classes). Confirm they match the tables above.
3. **Full suite:** `bun run test` (incl. browser). Record the baseline count at startup and confirm 0 NEW failures at end. If fixtures/golden-CSS shift, re-baseline and explain.

# FINAL REPORT
WORKTREE_PATH · FINAL_SHA · BRANCH · FILES_TOUCHED (expect: `compiler/src/tailwind-classes.js` + 2 test files) · per-sub-arc commit SHAs · R26 probe output (commands + emit) · the exact `validateArbitraryCss` insertion point you used · full-suite delta (baseline→final) · any uncertainty (flag for the sPA, do not improvise).

Build incrementally; the design is locked (approach C; Tailwind v3 semantics; mirror the named utilities). Surface — don't improvise — anything ambiguous.
