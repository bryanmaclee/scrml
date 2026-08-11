# BRIEF — the tool import prune drops `$`-prefixed locals; and the each-body decl guard is one position wide

**Dispatched:** 2026-08-11 (S338-bryan) · **Base:** `fix/tool-import-prune-dollar` off `origin/main`
**Origin:** the S313/S316 review floor, run against **PR #508** (S339-peter, already MERGED).
**Provenance:** `review:docs/pr-reviews.md #508` · Rule 7 (`pa-scrml-overlay.md`, ratified S338)

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED CHECKOUT: **STOP and report.**
2. `git rev-parse --show-toplevel` MUST equal that worktree. 3. `git status --short` clean.
4. `bun install`. 5. `bun run pretest`; use `bun run test`, never bare `bun test`.

Worktree-absolute paths on every Read/Write/Edit. NEVER `cd` into the main checkout — use
`--cwd "$WORKTREE_ROOT"` / `git -C "$WORKTREE_ROOT"`. Echo your startup `pwd` in the first commit.
**Scratchpad unique to you:** `…/scratchpad/toolprune/`.
**NEVER `--no-verify`.** Two agents used it unauthorized today; both self-disclosed; it is still a
violation and the rule is absolute.

**Crash recovery:** commit after EACH meaningful change; `progress.md` in this change dir, append-only,
timestamped. Four agents died mid-task today; one lost a finding that existed nowhere on disk.

**MAPS:** `.claude/maps/primary.map.md` + Task-Shape Routing. Stamp is behind HEAD — treat map claims as
hypotheses. Report which map content was load-bearing, "none" included.

---

## F1 — HIGH, LIVE ON `main`, PA-VERIFIED

`compiler/src/codegen/emit-tool.ts:302-305` + the call sites at `:348-351`.

```ts
function identReferencedInSrc(name: string, src: string): boolean {
  if (!name) return false;
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(src);
}
```

`\b` cannot match before a leading `$` (both sides are non-word), so a `$`-prefixed import local is
classified DEAD even when referenced. When every spec is judged dead, `:350` drops the whole import.

**PA-verified on merged `main`:**

```scrml
// lib3.scrml
${ export function routeScore(x) { return x * 2 }
   export function ensureSchema() { return 1 } }

// tool3.scrml
<program kind="tool">
${ import { routeScore as $rs } from "./lib3.scrml" }
export function main() { return $rs(21) }
</program>
```
`bun compiler/bin/scrml.js compile tool3.scrml -o out` → **exit 0, zero diagnostics**, and `out/tool3.js`
contains `return $rs(21);` with **no import line at all**. Runtime: `ReferenceError: Can't find variable: $rs`.

**THE FIX IS ALREADY IN THE TREE, AND ITS COMMENT NAMES THIS EXACT HAZARD.**
`compiler/src/codegen/emit-server.ts:330-337` is the S207 prune that `emit-tool.ts`'s own comment claims
to match:

```ts
  // \b is unreliable for `$`-prefixed names but scrml import locals are plain
  // identifiers; guard the boundaries manually to avoid matching `name` inside
  // `otherName` / `name2` / `_name`.
  const re = new RegExp("(^|[^A-Za-z0-9_$])" + name.replace(…) + "([^A-Za-z0-9_$]|$)");
```

So the claim "matches the S207 import-prune granularity" is **false**, the hazard was already written
down in-tree and not carried over, and this is a duplicated liveness predicate that drifted on its
**first** copy.

**Preferred fix, in order:**
1. **Drive the decision off the resolved symbol table, not off text.** This is a **Rule 7** case: a regex
   over SOURCE TEXT in a POST-AST stage. The structural route is demonstrably in hand — `E-SCOPE-001`
   does NOT fire on `$rs`, which proves the binding was already resolved. Note the predicate reads
   *scrml* source text to decide the fate of an *emitted JS* import: two different languages either side
   of lowering. If you find the symbol table genuinely unavailable at this point in codegen, say so with
   evidence and fall back to (2).
2. **Otherwise call `localServerImportNameUsed`** (export it if needed) so there is ONE predicate, not
   two. **Do not write a third.** Five separate defects today were a hand-maintained predicate that
   drifted from its sibling.

**Test:** the existing `g-tool-over-imports-all-lib-exports.test.js` uses only plain names, which is why
this shipped green. Add an aliased import, a `$`-prefixed local, an `_`-prefixed local, and an
all-specs-dead case.

---

## F2 — MED-HIGH, INTRODUCED by #508: the each-body decl guard inspects only `body[0]`

`compiler/src/codegen/emit-each.ts:1370` (`if (body.length > 0 && body[0])`) → the new guard at `:1384`.
A declaration in any NON-FIRST statement position of the same interpolation is never examined.

```scrml
<each in=@rows key=@.id>${ @.id
let nm = @.name }<li>${nm}</li></each>
```
→ `errors: []`, and the emitted client JS does `String(nm)` with **zero** declarations of `nm`.
Byte-for-byte the miscompile #508 closed, one statement over.

**The N+1th position here is literally `body[1]`.** The standing rule from this repo's own record:
*"when round N finds an N+1th position, stop fixing positions."*

## F3 — MED, PRE-EXISTING, same class: `lin-decl` is not in the kind allowlist

The guard enumerates `let-decl | const-decl | function-decl`. `ast-builder.js` also emits `lin-decl`,
`tilde-decl`, `state-decl`, `export-decl`, `type-decl`. Verified on BOTH refs: `${ lin nm = @.name }` in
an each body → `errors: []`, `String(nm)`, zero declarations, evaluating the factory throws
`ReferenceError`. (`var` and `~` fail loudly via `E-CODEGEN-INVALID-LOGIC`; `type` is inert.)

**Fix F2 and F3 together, BY CONSTRUCTION:** loop over `body` rather than reading `body[0]`, and test
"is this a declaration kind?" rather than matching a three-name allowlist — so `lin-decl` and every future
kind are covered without a sixth patch. This is exactly the retrofit-vs-by-construction test
(`.pa-base/profile` STAGE): a hand-maintained list of kinds is the retrofit; asking the node what it is
is the construction.

---

## DIRECTION OF CHANGE — measure, do not assume

F2/F3 widen an existing **newly-rejecting** diagnostic. #508 already flipped one committed sample to a
hard error without measuring: `samples/compilation-tests/gauntlet-s20-sql/sql-in-for-loop-001.scrml`,
**whose own line 2 reads `// Should compile clean; the batch planner may rewrite.`** The rejection is
correct on the merits (that file was already a latent silent miscompile), but nothing recorded it.

**You must:** grep the FULL corpus (`examples/`, `samples/`, `conformance/cases/`, `benchmarks/`,
`stdlib/`) for the shapes F2 and F3 newly reject; report the COUNT and the FILES. A non-zero count is a
separate ruling — STOP and surface it, do not migrate unilaterally. Also fix or annotate that sample's
now-false header comment as part of this change.

---

## OUT OF SCOPE

- `docs/known-gaps.md` — **OFF LIMITS**, contended by concurrent agents. Report gap text in `progress.md`.
- F5 (an unreferenced import is now dropped ENTIRELY, so a lib with top-level side effects — a `?{}` /
  `<schema>` module carrying `new SQL(...)` per §44.2 — would never be evaluated). **Unverified residual,
  not a proven defect.** Do not fix; construct the case, report what you measure, and file it.
- F6 (a plain `<program>` consumer still over-imports; the fix is tool-scoped). File only.
- The `883` vs `884` conformance-count discrepancy in #508's PR body. Note only.

---

## VERIFICATION — DO NOT REPORT DONE WITHOUT THIS

1. Every reproducer above compiled on your branch AND on `origin/main`, with the diagnostic multiset
   both sides — **and for F1, EXECUTE the emitted tool** (`bun out/tool3.js`). `node --check` is not
   enough; this defect is invisible to it.
2. Migration count + files for F2/F3, per above.
3. Bite-proof every new test, both directions: corrupt, confirm RED, restore, confirm GREEN.
4. `bun run test` — compare failure **NAME SETS**, never counts. ⚠ That suite is **order-dependent and
   self-seeding** (it produced 53, 49 and 51 on the SAME tree today, because some `benchmarks/todomvc/dist`
   tests are satisfied by a gitignored dist the first run creates). **Do not quote a baseline count.**
5. ⚠ `scripts/corpus-emit-differential.ts` has FIVE known silent failure modes found today. If you use it:
   real `.git` on both sides, DISTINCT compiler roots, clean trees, capture BOTH `result.errors` and
   `result.warnings` (`E-DG-002`-class diagnostics live in `warnings`), and more than one run. Prefer your
   own comparator.
6. If you touch `compiler/src`, regen `docs/FACTS.md` AFTER your last content commit.

**Report:** files touched, final SHA, what landed vs deferred, every locus above that turned out wrong
(they are PA-located-verify), and anything you think this brief gets wrong. **You are authorized to argue
against it** — including arguing that F1 belongs to Peter's lane and should be routed rather than fixed.
My judgement is that a HIGH producing a green compile and a runtime `ReferenceError` on `main` outweighs
the lane split, and a note is going to Peter either way.
