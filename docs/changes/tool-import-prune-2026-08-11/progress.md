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
