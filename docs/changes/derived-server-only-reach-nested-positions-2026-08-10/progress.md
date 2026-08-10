# progress — E-DERIVED-SERVER-ONLY-REACH misses non-top-level derived cells

Append-only. Newest entries at the bottom.

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-adde4ceabc51763db`
Branch: `worktree-agent-adde4ceabc51763db`  ·  Base: `191b4a36`

---

## 2026-08-10 — startup

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-adde4ceabc51763db` (OK, worktree-rooted).
- `git rev-parse --show-toplevel` matches; tree clean at `191b4a36`.
- `bun install` → 217 packages. `bun run pretest` → 13 test samples compiled to
  `samples/compilation-tests/dist/`.
- **BRIEF was NOT in the worktree** — the worktree base predates the BRIEF commit. Read verbatim from
  the main checkout and archived here (`BRIEF.md`) before the main checkout switched off that commit
  and the path disappeared. Archive note appended to the file.

## 2026-08-10 — R26 reproduction on the PRE-FIX build (locus hypothesis: HELD)

Compiled the BRIEF's reproducer with the shipped compiler at `191b4a36`.

- `case-loop.scrml` (derived cell in a `for`-loop `lift` body): **exit 0, warnings only, NO
  `E-DERIVED-SERVER-ONLY-REACH`**.
  - `find out -name '*.server.js'` → **0**
  - `_scrml/auth.js:51: return Bun.password.hash(password, { algorithm: "argon2id" });`
  - `case-loop.client.js:20: const { hashPassword } = _scrml_stdlib.auth;`
  - `case-loop.client.js:33: _scrml_cs_derived_declare("h", () => hashPassword(_scrml_cs_reactive_get("pw")));`
  - `case-loop.client.js:22: _scrml_cs_reactive_set("pw", "secret");`
- `case-top.scrml` (identical cell at top level): **fires `E-DERIVED-SERVER-ONLY-REACH` as an error.**

AST-path probe over the reproducer:

```
shipped walk (body+children): 0
generic structural walk:      1  ->  h @ $[0].children[3].children[0].body[0].body[0].expr.node.children[0].body[0]
```

**The BRIEF's predicted path `…expr.node.children[0].body[0]` is exact. Locus HELD.**

## 2026-08-10 — measurement before writing code

`shipped` vs `generic` structural walk over **1363** parsed `.scrml` (samples, examples, stdlib,
compiler/tests incl. conformance, benchmarks, docs):

| | count |
|---|---|
| shipped walk total derived cells | 52 |
| generic walk total | 52 |
| delta files | **0** |
| duplicate-identity fires | **0** |
| cycles found in the AST | **0** |
| exotic constructors (Map/Set/Date) inside `nodes` | **none** |
| walk wall-time, whole corpus | shipped 18.3 ms → generic 52.8 ms (+34.5 ms across 1363 files) |
| max structural depth | 37 |

Skip-list sensitivity: adding `imports`/`exports`/`components`/`typeDecls` to the skip set changes the
count by **0** — no derived cell is reachable only through them, so the minimal skip-list
(`span`,`spans`,`parent`,`loc`,`_scope`,`_record`) is unbiased and fail-closed.

**Migration on this machine's corpora: ZERO. `../assetManagement` (the adopter shakedown app) is NOT
cloned here and is therefore UNMEASURED.**

## 2026-08-10 — POSITION axis, measured pre-fix (via `runRI`)

| fixture | pre-fix fires |
|---|---|
| p00 top level | 1 |
| p01 `for`-loop `lift` body | **0 (leak)** |
| p02 `while`-loop `lift` body | **0 (leak)** |
| p03 `if=`-gated subtree | 1 |
| p04 `<each>` row body | **0 (leak)** |
| p06 `<engine>` state-child body | **0 (leak)** |
| p07 component body | 0 at `runRI`-only, **1 through the full pipeline** (CE inlines `component-def.raw` before RI) |
| p08 loop inside a conditional | **0 (leak)** |
| p10 `kind="tool"`, nested (NEGATIVE) | 0 |
| p20 nested + RHS-local shadow (NEGATIVE) | 0 |
| p21 nested + name only in a string literal (NEGATIVE) | 0 |
| p22 nested + client-safe module (NEGATIVE) | 0 |

Two positions turned out NOT to be AST positions at all and are therefore out of any walk's reach:

- **`<match>` markup arms** store their body as RAW TEXT (`match-block.armsRaw` + a single `text`
  bodyChild). Separately, `${ const <h> = … }` inside an arm does not even parse — the arm
  closer-scanner reads the `<h>` as an open tag and fires `E-MATCH-PARSE-001`. Deferred finding.
- **`component-def`** stores its body as `raw` at build-AST time, but Stage 3.2 CE inlines it before
  `runRI`, so the full pipeline DOES see it. Already covered pre-fix; pinned as a non-regression.

## 2026-08-10 — INCIDENTAL FINDINGS (out of scope, reported not fixed)

1. **A failing compile still writes the leaking artifacts.** `p00-top-level` fires
   `E-DERIVED-SERVER-ONLY-REACH` and reports `FAILED — 1 error`, yet the output directory still
   contains `p00-top-level.client.js` with `const { hashPassword } = _scrml_stdlib.auth;` and a
   722-line `_scrml/auth.js` carrying `Bun.password.hash`. The refusal is a diagnostic, not an
   emission gate.
2. **The adjacent-position leak is real, not theoretical.** A plain `${ hashPassword(@pw) }`
   interpolation (no `const <name>`) inside a `<match>` arm compiles clean, emits zero `.server.js`,
   and ships `Bun.password` ×4 in `_scrml/auth.js`. §5 of the unit test already documents this class
   as not-closed; this is an empirical confirmation.
3. **`collectFileLevelBindingRoots` (`route-inference.ts:2600`) has no `seen` set** and descends
   every property. A synthetic cyclic AST fed to `runRI` dies there with
   `RangeError: Maximum call stack size exceeded` before reaching anything else. Pre-existing, not
   live (zero cycles in the parsed corpus), not fixed here — but it is why §10's walk tests drive
   `collectDerivedCellDecls` directly instead of through `runRI`.

## 2026-08-10 — THE FIX (commit `ffdd7540`)

`compiler/src/route-inference.ts` — `collectDerivedCellDecls` now walks STRUCTURALLY: every array-
and object-valued property is descended by default, with a short justified deny-list
(`DERIVED_CELL_WALK_SKIP_KEYS` = `span`, `spans`, `parent`, `loc`, `_scope`, `_record`). `seen` is
now an identity set over EVERY visited object, not just over nodes reached through an array, which is
what gives termination on a cycle and single-firing on a shared subtree. The false "at any depth" doc
comment is replaced with the measured account.

`expr` was deliberately NOT added to a field list. Two instances of one class (this, and the
`emit-client.ts` seed walker drifting against `dependency-graph.ts`) is the converge-not-enumerate
signal named in the brief.

`collectDerivedCellDecls` is now `export`ed, because the termination/identity properties are
properties of THIS walk and driving them through `runRI` fails for an unrelated reason (finding 3).

### Position axis, post-fix

Every position that leaked now fires; every negative stays silent:

| fixture | pre-fix | post-fix |
|---|---|---|
| p00 top level | 1 | 1 |
| p01 `for`-loop `lift` body | **0** | **1** |
| p02 `while`-loop `lift` body | **0** | **1** |
| p03 `if=`-gated subtree | 1 | 1 |
| p04 `<each>` row body | **0** | **1** |
| p06 `<engine>` state-child body | **0** | **1** |
| p08 loop inside a conditional | **0** | **1** |
| p10 `kind="tool"` nested (NEG) | 0 | 0 |
| p21 string-literal-only (NEG) | 0 | 0 |
| p22 client-safe module (NEG) | 0 | 0 |
| p23 nested RHS-local `const` shadow (NEG) | 0 | 0 |
| p20 nested lambda-param shadow | 0 | 1 |
| p24 top-level lambda-param shadow (CONTROL) | 1 | 1 |

p20/p24 are a matched pair: a lambda PARAMETER is not a shadow by design
(`collectDerivedRhsLocalNames` stops at a nested binder — "erring narrow here is the fail-closed
direction"), and it now behaves identically at top level and nested. Position stopped mattering,
which is the property under test.

### Guard coverage (brief's six)

1. tool carve-out — §9 NEGATIVE; carve-out is a whole-file predicate applied by the Step 3b caller.
2. no double-counting — §10 "reachable by TWO paths" + "two DISTINCT cells".
3. no descent into baggage + termination — §10 cycle / self-reference / shared-array / skip-list
   (all six keys) / Map-valued property. Corpus termination: 2358 tracked files, 0 throws.
4. shadowing — §9 nested `const` shadow NEGATIVE + the top-level/nested lambda-param control pair.
5. string-literal inertness — §9 NEGATIVE, nested.
6. performance — below.

## 2026-08-10 — CORPUS REGRESSION SWEEP: delta EXACTLY ZERO

`runRI` over the **2358 TRACKED** `.scrml` files (`git ls-files '*.scrml'`), base `191b4a36` vs
head, dumping every error + warning code per file:

```
base: RI over 2358 tracked files (2358 ok / 0 threw) in 8511ms
head: RI over 2358 tracked files (2358 ok / 0 threw) in 9130ms
diff base head -> (no output), exit 0
```

**Zero new fires, zero lost fires, zero new throws.** Migration cost on this machine's corpora is
ZERO. `../assetManagement` is NOT cloned here and remains UNMEASURED.

(Methodology note: an earlier sweep used a directory glob and reported 1363 vs 1400 files across two
runs — the full test suite runs between sweeps and writes untracked `.scrml` fixtures, which moves
the denominator. The tracked-file list makes the comparison deterministic.)

## 2026-08-10 — PERFORMANCE

Isolated walk, whole corpus (1363 parsed files): **18.3 ms → 52.8 ms**, i.e. +34.5 ms total,
**+0.025 ms per file**. A full single-file compile is ~200-275 ms, so the walk is ~0.01% of it.

RI stage over 2358 tracked files, 3 runs each:

```
base: 9289 / 8623 / 8468 ms   (median 8623, mean 8793)
head: 8842 / 8622 / 9507 ms   (median 8842, mean 8990)
```

+2% mean / +2.5% median at the RI stage — inside the run-to-run spread (base spread 821 ms, head
spread 885 ms). No node-kind bound was needed.

## 2026-08-10 — CONFORMANCE (commit `beef0db3`)

- `conformance/cases/derived/e-derived-server-only-reach-nested-loop/` — the codes half of the
  position axis. Conformance corpus: **881/881 pass**.
- `compiler/tests/conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js` — the ARTIFACT half.
  Compiles to a real output dir (`write: true`) and greps the files the emitted HTML actually loads
  via `<script src=…>`. Grepping the in-memory `clientJs` alone would have MISSED the leak: pre-fix
  the `Bun.password.hash(...)` body arrived in the hashed `scrml-runtime.*.js`, not in `.client.js`.

  Non-vacuity verified — the same predicate run over the LEAK source's output reports
  `Bun.password: true`, `argon2id: true`, `hashPassword: true`, `.server.js: 0`.

## 2026-08-10 — R26 EMPIRICAL VERIFICATION (post-fix build), verbatim

Leak variant (`case-loop.scrml`, the BRIEF's reproducer):

```
error [E-DERIVED-SERVER-ONLY-REACH]: ... The RHS of derived cell `const <h>` reaches
`hashPassword` (from `scrml:auth`) — a server-only stdlib module (§12.2 Trigger 3). ...
FAILED — 1 error, 2 warnings
```

Corrected variant (`case-corrected.scrml` — the call moved into `function computeHash`):

```
Compiled 1 file in 276.4ms -> .../r26-corrected/

$ find r26-corrected -name "*.server.js"          # must be NON-EMPTY
r26-corrected/case-corrected.server.js

$ grep -o '<script[^>]*src="[^"]*"' case-corrected.html
<script src="scrml-runtime.01uvgtga.js"
<script src="case-corrected.client.js"

$ grep -n "Bun.password\|argon2id\|hashPassword" case-corrected.client.js scrml-runtime.01uvgtga.js
GREP_EXIT=1                                        # EMPTY — no match in either loaded script

$ grep -n "hashPassword" case-corrected.server.js
4:import { hashPassword } from "./_scrml/auth.js";
39:    return await hashPassword(pw);

$ grep -c "_scrml/" case-corrected.html
0                                                  # the HTML never references _scrml/
```

`_scrml/auth.js` and `_scrml/crypto.js` still contain `Bun.password` on disk — that is the
SERVER-side stdlib module directory, imported by `case-corrected.server.js` and never referenced by
the emitted HTML. That is the correct placement, and it is why the artifact test's predicate is
"referenced by the HTML the browser gets" rather than "anywhere under dist/".

## 2026-08-10 — FULL GATE, base vs head

`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`, run twice on
the same machine — once with `route-inference.ts` + the unit test reverted to `191b4a36` and the two
conformance additions removed, once at head:

```
BASE: 22253 pass / 70 skip / 1 todo / 0 fail — 22324 tests, 1218 files, 418.74s, EXIT=0
HEAD: 22289 pass / 70 skip / 1 todo / 0 fail — 22360 tests, 1219 files, 436.42s, EXIT=0
```

Delta **+36 tests, all passing, zero failures on either side** — 27 new unit tests (§9 POSITION + §10
WALK), 8 in the artifact conformance test, 1 conformance corpus case. No pre-existing failure was
inherited and none was introduced.

## 2026-08-10 — Rule 4 gate, verified independently against SPEC.md

`compiler/SPEC.md:3706` (§6.6.19 normative statements), verbatim:

> "A `const <name>` derived cell whose RHS **reaches** a local binding introduced by an `import` from
> a module in the §12.2 Trigger 3 `ESCALATION_SERVER_ONLY_MODULES` set — or from any submodule of one
> — SHALL be a compile error, **`E-DERIVED-SERVER-ONLY-REACH`**."

Matches the BRIEF's quote byte-for-byte. §6.6.19 (`SPEC.md:3694-3763`) read in full: there is no
positional qualifier anywhere in the section. `:3708` says the reach SHALL be detected "at any depth
**within the RHS**" — that is depth inside the RHS, a different axis from where the CELL sits, and
it does not restrict the SHALL at `:3706`. The only carve-out in the section is `kind="tool"`
(`:3713`). **Conformance restoration confirmed; no amendment needed and none made.**

Optional follow-up for the PA (NOT done — outside the brief): §34's catalog row (`SPEC.md:19483`)
says "at any depth" only about the RHS. One clarifying clause noting that the SHALL is independent of
the cell's POSITION in the tree would close the misreading that produced this bug. It is a wording
change, not a normative one.

## 2026-08-10 — WHAT THE PA SHOULD FILE (I did not edit `docs/known-gaps.md` — PA-owned)

1. **RESOLVE** `g-derived-server-only-reach-misses-for-loop-lift-body` (HIGH). Closed by `ffdd7540`
   at the CLASS level, not the position level: six measured positions, structural walk, +36 tests.
2. **NEW (HIGH, security)** — `g-derived-server-only-reach-error-does-not-gate-emission`. The
   refusal is a diagnostic, not an emission gate. `scrml compile` reports `FAILED — 1 error` and
   still writes `case.html` plus the two `<script src=…>` artifacts it loads, containing
   `Bun.password` / `argon2id` / `hashPassword`, with zero `.server.js`. Reproduced at the CLI and at
   the `compileScrml({write:true})` API. A pipeline that compiles then deploys `dist/` without
   checking the exit code ships the leak with a red build. Executable GAP PIN lives in
   `conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js` §1 and its expectations must INVERT (not be
   deleted) when the gate lands.
3. **NEW (LOW, latent)** — `g-collect-file-level-binding-roots-has-no-seen-set`.
   `route-inference.ts:2600` descends every property with no identity set; a cyclic AST is a
   `RangeError: Maximum call stack size exceeded`. Not live (zero cycles in 1363 parsed corpus files)
   and pre-existing.
4. **CONFIRMED, existing** — `g-cell-initialiser-and-markup-interp-server-only-reach-do-not-escalate`
   reproduces empirically: `${ hashPassword(@pw) }` inside a `<match>` arm compiles clean, zero
   `.server.js`, `Bun.password` ×4 in `_scrml/auth.js`.
5. **NEW (LOW, parser)** — a `<match>` MARKUP arm body cannot host `${ const <h> = … }`: the arm
   closer-scanner reads the `<h>` as an open tag and fires `E-MATCH-PARSE-001`. Independently, the
   arm body is stored as raw text (`match-block.armsRaw`), so no AST walk can see into it.
