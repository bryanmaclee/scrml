# progress — tool-import-prune (F1 HIGH + F2/F3 each-body decl guard)

Append-only. Timestamps are local (MDT).

## 2026-08-11 — startup

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a69ac06f6d5189f1e` (worktree, OK).
- `git rev-parse --show-toplevel` = same. `git status --short` clean.
- **Base deviation, surfaced:** the worktree was provisioned at `4076e0fb` on branch
  `worktree-agent-a69ac06f6d5189f1e` — i.e. the PARENT of the brief commit. The brief's stated base
  (`fix/tool-import-prune-dollar` @ `46b252cc`) is checked out in the SHARED checkout, so it could not
  be checked out here. Resolved with `git merge --ff-only 46b252cc` (clean fast-forward, one commit:
  the BRIEF itself). Working branch stays `worktree-agent-a69ac06f6d5189f1e`; content is identical to
  `fix/tool-import-prune-dollar` @ `46b252cc`. PA lands by file-delta, so the branch name is immaterial.
- `bun install` → 217 packages. `bun run pretest` → exit 0.

## F1 — reproduced, then fixed

**Reproduced verbatim on the base**, `$`-aliased import in a `kind="tool"`:
`bun compiler/bin/scrml.js compile tool3.scrml -o out` → exit 0, **zero** `E-` diagnostics
(4 lints + 1 `W-PROGRAM-REDUNDANT-LOGIC`, none of them about the import), emitted `out/tool3.js`
carries `return $rs(21);` and **no import line at all**.

- `node --check out/tool3.js` → **PASS**. Blind, exactly as the brief said.
- `bun out/tool3.js` → `ReferenceError: $rs is not defined`, exit 1.

### On the brief's preferred route (symbol table) — NOT available as stated

The brief's option 1 says the structural route is "demonstrably in hand" because `E-SCOPE-001` does
not fire on `$rs`. That inference proves the binding **resolved**; it does not give a **use** set,
and those are different queries. Evidence:

- `symbol-table.ts:1095 SYMResult` = `{ filePath, errors, fileScope, stats }`.
- `symbol-table.ts:1056 Scope` = `{ kind, parent, stateCells, importBindings, qualifiedPath,
  localAliases }`. `importBindings: Map<localName, ImportBindingRecord>`, and
  `ImportBindingRecord` (`:259`) = `{ localName, exportedName, sourcePath, pinned, declNode }`.

So the symbol table can answer "is `$rs` a bound import?" (yes) but **not** "is `$rs` referenced?".
There is no reference set, no use-count, and no `referenced` flag anywhere in `SYMResult`.

Building one is possible — `forEachIdentInExprNode` (expression-parser.ts) is the primitive, and
`route-inference.ts:3888 collectReferencedNames` is a walker built on it (though not reusable here:
it deliberately does NOT recurse into `function-decl` bodies, and `$rs` is referenced inside
`function main`). But a NEW walker would be a **fourth** liveness notion, hand-maintained against a
node-kind allowlist of "which kinds carry an ExprNode", whose failure direction is
**drop a live import → runtime ReferenceError**. That is the same defect class as F1 itself and as
F3's kind allowlist. Adding an AST-kind allowlist to fix a bug whose sibling *is* a kind allowlist
is self-defeating. Took fallback (2), plus an input correction the brief did not ask for:

### What landed

1. `localServerImportNameUsed` **exported** from emit-server.ts — now the ONE local-import liveness
   predicate in codegen. `identReferencedInSrc` deleted. No third predicate written.
2. The prune's **input** corrected. It scans `emitted module body ∪ scrml source root` instead of
   the scrml source root alone. The emitted module is where the import actually lives; emit-server's
   S207 prune scans exactly this shape (`scanBody` = `finalEmitted` ∪ `_serveImportReachabilityExtra`).
   Both roots over-approximate liveness, so the union does too — root 1 can only KEEP more, never drop.
3. `generateToolJs` passes body **plus the §64.3 main harness** as the emitted root, so the scan root
   is "the whole module minus the headers" by construction rather than by an assumption about what
   the harness contains.

### Scope correction caught by an existing test — worth recording

My first cut also made the prune apply *unconditionally* (I gated on the union being non-empty, which
it always is). That turned `standalone-tool-target.test.js` → `#4 a quoted-kebab imported name emits
syntactically valid JS` RED: a hand-built fileAST with `main: body: []` and no `_sourceText`, whose
import is referenced nowhere, started getting pruned.

That failure was **correct** and I reverted the widening. The shipped gate is
`if (source.endsWith(".scrml") && bodyRefSrc)` — prune only when the file carries real source text.
Widening it is a behavior change in the UNSAFE direction (more dropping) that nobody asked for. The
landed change is now strictly monotone in the SAFE direction versus shipped behavior: same
applicability, strictly more keeping. Zero fixture migration needed.

### Tests

`compiler/tests/integration/g-tool-import-prune-drops-dollar-local.test.js`, 6 cases. Two of them
actually discriminate `\b` from the shared predicate; the other four are coverage the brief asked for
but which `\b` also passes (noted below, so nobody mistakes them for bite-proof).

- `$`-prefixed local survives **and the emitted tool is EXECUTED** (`Bun.spawnSync`) — DISCRIMINATING.
- a `$`-prefixed OTHER name must not keep the bare local alive: body references only `$rs`, import
  local is `rs`. `\b` matches `rs` inside `$rs` (`$` is non-word → boundary) and falsely KEEPS;
  the shared predicate puts `$` in the excluded neighbour class and correctly drops — DISCRIMINATING.
- `_`-prefixed local — NOT discriminating. `_` **is** a word char, so `\b_rs\b` matches fine. The
  brief asked for the case; recording that it does not bite.
- plain aliased local, longer-identifier substring, all-specs-dead — not discriminating either.

**Bite-proof, both directions:** swapped `localServerImportNameUsed`'s body back to `\b` → the two
discriminating cases go RED (4 pass / 2 fail); restored → 6 pass. Restore verified byte-identical
via `git diff`.

## F2 + F3 — measured, then fixed by construction

### Brief-locus correction (the brief is right; my first fixture was wrong)

My first reproduction used `<rows>: string[]` with no `key=` and got `E-SCOPE-001`, i.e. it looked
like F2 did NOT reproduce. That was a **fixture artifact**. On the brief's own shape — object rows
plus `key=@.id` — F2 reproduces **exactly** as written: `E-codes: []`, and the emitted
`page.client.js` contains `_scrml_each_tn_6.textContent = String(nm);` with no declaration of `nm`
anywhere. Recording this because the wrong fixture would have justified a "cannot reproduce, brief
locus wrong" report, and it would have been wrong. **All six loci in the brief are confirmed.**

### Full BEFORE matrix (brief's fixture, decl at body[0] and body[1])

| form | body[0] before | body[1] before |
|---|---|---|
| `let nm = @.name` | E-EACH-BODY-DECL-UNSUPPORTED | **SILENT MISCOMPILE** |
| `const nm = @.name` | E-EACH-BODY-DECL-UNSUPPORTED | **SILENT MISCOMPILE** |
| `lin nm = @.name` | **SILENT MISCOMPILE** (F3) | **SILENT MISCOMPILE** |
| `~nm = @.name` | E-CODEGEN-INVALID-LOGIC | E-CODEGEN-INVALID-LOGIC |
| `function nm() {…}` | E-EACH-BODY-DECL-UNSUPPORTED | **SILENT MISCOMPILE** |
| `type Nm:enum {…}` | E-SCOPE-001 | E-SCOPE-001 |
| `var nm = 1` | E-CODEGEN-INVALID-LOGIC | **SILENT MISCOMPILE** |

**Beyond the brief:** `var nm = 1` at body[1] is a silent miscompile too. The brief says `var` "fails
loudly via E-CODEGEN-INVALID-LOGIC" — true at body[0], **false at body[1]**. Instrumenting the emit
site shows why: `var nm = 1` parses to `["bare-expr", "tilde-decl"]`, so its `tilde-decl` is at index
1 even when the author wrote it as the interpolation's only statement. The `body[0]`-only read missed
it. Same for `~nm = @.name`.

AFTER: every cell above is `E-EACH-BODY-DECL-UNSUPPORTED`.

### The predicate

`typeof stmt.kind === "string" && stmt.kind.endsWith("-decl")`, looped over the whole `body`. The
AST's own `<x>-decl` naming convention IS the node telling you it is a declaration, so `lin-decl`,
`tilde-decl`, `type-decl` and every future kind are covered with no allowlist. Verified empirically
(not from the SPEC or memory) that all seven forms above land on a `*-decl` kind at this site.

Deliberately NOT unified with the five other hand-maintained decl-kind sets already in the tree
(`indirect-callee-resolver.ts:98`, `emit-library-shared.ts:382`, `type-system.ts:4752`,
`build-source-map.ts:71`, `ast-builder.js:19343` — all different from each other). That is the same
drift class, but unifying them is out of this brief's scope. **Filed for PA.**

### Migration measurement — REQUIRED by the brief, result: ZERO

Own comparator (`corpus-scan.mjs`), not `scripts/corpus-emit-differential.ts`. All 56 committed
`.scrml` files containing `<each>` across `examples/ samples/ benchmarks/ stdlib/
compiler/tests/conformance/cases/ docs/` (of 1292 `.scrml` total), compiled with `E-` codes collected
from BOTH `errors` and `warnings`. Ran it twice: once with the fix, once with `emit-each.ts` stashed
to base.

- fixed tree: fires on **1** file
- base tree: fires on the **same 1** file
- **newly rejected by this change: 0 files**

The one hit is `samples/compilation-tests/gauntlet-s20-sql/sql-in-for-loop-001.scrml`, which is
#508's pre-existing flip, not mine. No migration ruling needed; nothing to surface as a stop.

### The falsified sample header — corrected, shape NOT rewritten

`sql-in-for-loop-001.scrml` line 2 read `// Should compile clean; the batch planner may rewrite.`
Corrected to an accurate expected-error header. I did **not** rewrite the sample's shape, because
that would delete what the sample is for — and doing so would have buried the finding below.

### OPEN TENSION for PA — §8.10 vs §17.7.3 (surfaced, not resolved)

That sample exists to probe "a `?{}` inside iteration — Tier 2 hoist candidate (§8.10)". The canonical
way to write a per-row query is to bind its result to a per-row local:

```
<each in=users as user>
  ${ let posts = ?{`SELECT title FROM posts WHERE user_id = ${user.id}`}.all() }
  <li>${user.name} — ${posts.length} posts</>
</each>
```

§17.7.3 forbids the local; §8.10 wants the shape. Hoisting the query out of the `<each>` removes the
per-row correlation that makes it a batch-planner candidate at all. So E-EACH-BODY-DECL-UNSUPPORTED
does not just reject a bad habit — as things stand it makes the per-row-query shape **inexpressible**,
and the §8.10 batch-planner probe has no canonical spelling. The guard's own message says "compute the
value OUTSIDE the `<each>`", which is exactly what a correlated per-row query cannot do.

This is a design ruling (support each-body locals by replaying the binding into the per-item factory,
per the §17.7.3 note the guard's comment already anticipates — vs keep failing closed and give §8.10 a
different canonical shape). **Not resolved here. Not migrated unilaterally.**

### Tests

`compiler/tests/integration/g-each-body-decl-any-position.test.js`, 15 cases — and it is the **first
test anchor for `E-EACH-BODY-DECL-UNSUPPORTED` in the tree**. Before this, `grep -rl` across
`compiler/tests` returned nothing; #508 shipped the diagnostic with no test, which is exactly why both
holes rode along undetected.

6 F2 (each form at body[1]) + 6 F3 (each form at body[0]) + 3 no-false-fire (`@.` read, `as` alias,
several non-decl statements in one interpolation).

**Bite-proof, each hole INDEPENDENTLY:**

- restore `body[0]`-only (`body.slice(0, 1)`) → 8 fail (all 6 F2, plus `~`/`var` at body[0] — they sit
  at index 1 even as a sole statement); restore → 15 pass.
- restore the three-name allowlist → 6 fail (`lin`/`~`/`var` at both positions); restore → 15 pass.

### Separate finding — artifacts are WRITTEN on a hard error (fail-open)

Found while writing these tests. On the F2 shape the CLI prints `FAILED — 1 error` and exits **1**
(correct), but `out/page.client.js` is still written **and still contains the dangling `String(nm)`**.
A downstream step that trusts the presence of artifacts rather than the exit code would serve a
broken bundle. Pre-existing, orthogonal to F1/F2/F3, NOT fixed here. The tests deliberately assert on
the diagnostic only, so they do not silently encode the fail-open write as expected behavior.
