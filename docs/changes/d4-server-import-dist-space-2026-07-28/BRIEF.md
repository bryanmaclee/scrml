# BRIEF — D-4: server import specifiers are emitted in SOURCE space, not stripped DIST space

**Dispatched:** 2026-07-28 (S296-bryan-XPS). **Baseline `main` `89db7981`** (compiler v0.7.1).
**Agent:** scrml-js-codegen-engineer · `isolation: "worktree"` · model opus.
**Reported by:** adopter `dc`, as their "D-4".

> **Identity note (`pa-base v2.6`).** This brief lands in the PUBLIC repo. The reporting party is
> referenced by HANDLE only, and the identifying FACTS are sanitized too — v2.6: *"system shape,
> internal artifact IDs, business domain and engineering process each identify a party on their own,
> and survive a find-and-replace of the name."* The engineering rationale below is untouched
> (*"rationale stays, attribution goes"*); the reproducer is PA-authored and synthetic, not adopter
> source. Full provenance lives in the private record (`scrml-support`).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

**S99 leak history: this project has had repeated path-discipline leaks (sub-agent Edit/Write or `cd`
leaking into the MAIN checkout). Do not become the next incident.**

Before ANY other tool call:

1. `pwd` via Bash. Output MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is under any other repo (e.g. `scrml-support/.claude/worktrees/`), STOP and report
   (S90 CWD-routing failure). Save it as `WORKTREE_ROOT`.
   **NOTE the root: this is the XPS clone — `/home/bryan/...`, NOT `/home/bryan-maclee/...`.
   Older archived briefs carry the ASUS path; it is wrong here.**
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` MUST equal `WORKTREE_ROOT`.
3. `git -C "$WORKTREE_ROOT" merge --no-edit main` — pick up baseline `89db7981`. Confirm clean.
4. `git -C "$WORKTREE_ROOT" status --short` — confirm clean after merge.
5. `cd "$WORKTREE_ROOT"` ONCE at startup. **NEVER `cd` into the main repo**
   (`/home/bryan/scrmlMaster/scrml` without the `.claude/worktrees/agent-*` segment) for ANY command
   (S126 incidents #14/#15). Use `--cwd "$WORKTREE_ROOT"` / `git -C "$WORKTREE_ROOT"` /
   worktree-absolute paths exclusively.
6. `bun install` (worktrees don't inherit node_modules; pre-commit `bun test` fails without it).
7. `bun run pretest` (populates `samples/compilation-tests/dist/`; gitignored, empty in fresh worktrees).

**Editing discipline (S126):** apply edits via Bash (`perl`/`python`/heredoc/`cp`) on
WORKTREE-ABSOLUTE paths containing the `.claude/worktrees/agent-<id>/` segment — NOT via Edit/Write.
Echo the target path before each write; re-verify with `git -C "$WORKTREE_ROOT" diff` after.

**Crash recovery (mandatory):** commit after EACH meaningful change (WIP commits expected) and keep
an append-only timestamped `progress.md` in the change dir. Your branch + progress.md are the only
recovery anchor if you die mid-task.

If ANY startup check fails: DO NOT proceed. Report and exit.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` in full, then follow §"Task-Shape Routing" for a
**codegen emit-path fix** (domain.map.md codegen-emit rows + structure.map.md `compiler/src/codegen/`).

**Map currency: maps reflect commit `c700c435`; HEAD is `89db7981` — STALE by several landings.**
Post-map compiler-source landings you MUST factor in: S290 (#205–#211), S292 (#213/#215/#216/#217 —
`runtime-template.js`, `schema-differ.js`, `db-migrate.js`, NEW `sql-table-refs.js`), S293
(#214/#218/#222 — `emit-lift.js`), S294 (#224 `api.js` `collectErrors`, #226 `emit-each.ts`,
#227 `emit-variant-guard.ts`/`ast-builder.js`). **Treat maps as a starting hypothesis; verify against
current source via grep/Read.**

Feedback in your report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR
"not load-bearing."

---

# THE BUG (adopter-blocking; REPRODUCED by the PA on `89db7981`)

A `.scrml` file under `pages/` that imports another local `.scrml` module emits a **server** import
specifier that does not resolve, so the emitted `.server.js` throws `Cannot find module` at runtime.
**Compile is exit 0 with zero errors.**

## Reproducer (version-stamped; PA-verified on `89db7981`, v0.7.1)

Three files. `models/auth.scrml`:

```scrml
${
    export const ROLE_PATRON = "patron"

    export fn rolePath(role) {
        if (role == ROLE_PATRON) return "/patron"
        return "/"
    }
}
```

`app.scrml` — the CONTROL (root-level importer, works today):

```scrml
<program auth="optional">
    ${
        import { rolePath, ROLE_PATRON } from './models/auth.scrml'

        server fn homeFor() {
            return rolePath(ROLE_PATRON)
        }
    }
    <h1>home</h1>
</program>
```

`pages/login.scrml` — the SUBJECT (one segment deep, broken):

```scrml
<page auth="optional">
    ${
        import { rolePath, ROLE_PATRON } from '../models/auth.scrml'

        server fn resolveHome() {
            return rolePath(ROLE_PATRON)
        }
    }
    <h1>login</h1>
</page>
```

Compile: `bun compiler/bin/scrml.js compile <dir> --output-dir <dir>/dist` → **exit 0, 0 errors.**

### Observed vs expected

| emitted file | source | emitted specifier | artifact actually at | resolves? |
|---|---|---|---|---|
| `dist/app.server.js` | `app.scrml` (root) | `./models/auth.server.js` | `dist/models/auth.server.js` | YES |
| `dist/login.server.js` | `pages/login.scrml` | `../models/auth.server.js` | `dist/models/auth.server.js` | **NO — above dist/** |

Executed (`cd dist && bun -e "await import('./login.server.js')"`):

```
error: Cannot find module '../models/auth.server.js' from '<...>/dist/login.server.js'
```

The control (`app.server.js`) imports fine — so the failure is specific to the `pages/` coordinate space.

**Depth-2 confirms a CONSTANT one-segment overshoot** (= exactly the stripped `pages/` prefix):
`pages/auth/login.scrml` → `dist/auth/login.server.js` emits `../../models/auth.server.js`;
correct is `../models/auth.server.js`.

**The CLIENT half is CORRECT at both depths** (`login.html` loads `models/auth.client.js`; depth-2
loads `../models/auth.client.js`). This is server-only — do NOT "fix" the client path.

## ROOT CAUSE — an extension-only rewrite that never re-bases

`compiler/src/codegen/emit-server.ts`, in the import-emission loop (~L1846–1880, the block whose
comment starts "Emit JS imports from use-decl and import-decl nodes (§40)"):

```ts
let jsSource: string = stmt.source;              // "../models/auth.scrml"  ← SOURCE space
const isLocalScrml = jsSource.endsWith(".scrml");
if (isLocalScrml) {
  jsSource = jsSource.replace(/\.scrml$/, ".server.js");   // "../models/auth.server.js"
}
```

It swaps the extension and emits the **source-space** relative path verbatim. The dist layout strips
a leading `pages/` segment, so the specifier is off by exactly that segment.

## GOVERNING SENTENCE (Rule 4 — the layout is CORRECT; the specifier is the defect)

SPEC **§47.9.5**, "Leading `pages/` segment strip (S100, MPA shell composition, 2026-05-17)":

> "When the dist-relative directory of a source file begins with `pages/` as a segment-aligned prefix
> ... the `pages/` segment is stripped from the dist directory so that route URLs and dist paths
> coincide. `pages/customer/home.scrml` produces `dist/customer/home.html` (NOT
> `dist/pages/customer/home.html`) ... Implementation: `pathFor` in `compiler/src/api.js`."

So the dist layout is NORMATIVE and correct. **This is a bug fix, not a ruling** — the specifier must
be computed in the post-strip dist space to agree with a layout the SPEC already mandates.
Do NOT change `pathFor`, the dist layout, or SPEC §47.9.

## PATTERN TO MIRROR (both already in-tree — do not invent a new approach)

1. **Same file, ~1700 lines up:** `emit-server.ts:138` `computeServedPath()` ALREADY does this
   correctly — `stripPagesPrefix(_pathDirname(_pathRelative(outputBaseDir, filePath)))`, with a
   comment "Mirrors api.js `pathFor` via the shared `stripPagesPrefix`." `stripPagesPrefix` is
   ALREADY imported in this module.
2. **The ESM client emitter:** `emit-client-esm.ts:306–311` computes exactly the specifier shape you
   need, both sides stripped:
   ```ts
   const fromDir = stripPagesPrefix(ctx.importerDistDir || ".");
   const toPath  = stripPagesPrefix(registryKey);
   const rel = relative(fromDir, toPath).split(/[\\/]/).join("/");
   return rel.startsWith(".") ? rel : `./${rel}`;
   ```

## AVAILABLE CONTEXT (already plumbed — no new params needed)

- `emit-server.ts` `generateServerJs` already has `const filePath: string = fileAST.filePath;` (L1264).
- `fileAST._outputBaseDir` is set in `codegen/index.ts:1755`, BEFORE the `generateServerJs` call at
  L1811, and is already read inside emit-server (L4311, L4939).
- So both halves are reachable: importer dist dir = `stripPagesPrefix(dirname(relative(outputBaseDir,
  filePath)))`; target dist path = same transform applied to `resolve(dirname(filePath), stmt.source)`.
- `outputBaseDir` may be **null** for legacy single-file callers — in that case PRESERVE today's
  behavior exactly (no re-base). Byte-identical output when there is no `pages/` segment is REQUIRED.

## SCOPE — two changes, both required

**(1) `emit-server.ts` — re-base the local `.scrml` import specifier into stripped dist space.**
Apply to the local-`.scrml` rewrite in the import loop (and the deferred-import path that reuses the
same `jsSource`, if it re-derives it). Preserve: `scrml:`/`vendor:` passthrough, channel-import
filtering, the S207 tree-shaking/deferral, default-import handling.

**(2) `api.js` `checkServerImportInvariant` (~L2469–2620) — re-base the GUARD too.**
`W-SERVER-IMPORT-UNEMITTED` exists precisely to catch a server import that "throws at RUNTIME —
`Cannot find module`", and it **did NOT fire on this reproducer.** Its own comment states why:
"Works in **SOURCE-path space**: `./X.server.js` reverses to `./X.scrml`, resolved against the
importing file's source dir." Source space is the ONE space where this path is always correct, so the
guard is structurally blind to the entire coordinate-space class (same shape as S276's
"the test oracle shared the implementation's blind spot"). After fix (1), reversing a **dist-space**
specifier back through source space will MIS-RESOLVE — so (2) is not optional polish, it is required
to keep the guard honest and non-false-firing.

## VERIFICATION — do NOT mark DONE without ALL of these

1. **The reproducer above**: `dist/login.server.js` imports `./models/auth.server.js`, and
   `cd dist && bun -e "await import('./login.server.js')"` **succeeds**. Same for the depth-2 variant
   (`pages/auth/login.scrml` → `../models/auth.server.js`).
2. **Control unchanged**: `dist/app.server.js` still emits `./models/auth.server.js`.
3. **Byte-identity on the no-`pages/` case**: a project with no `pages/` directory MUST emit
   byte-identical `.server.js` to baseline. Prove it by diffing artifacts before/after.
4. **R26 EMPIRICAL** — recompile REAL sources on the post-fix baseline and diff artifacts:
   `examples/23-trucking-dispatch/` (nested `pages/` — the canonical multi-file app),
   plus `samples/compilation-tests/` and the other `examples/`. Report the count of `.server.js`
   files whose import specifiers CHANGED, and confirm every change is a correction (resolves on disk).
   A grep/shape check, NOT "tests pass".
5. **W-SERVER-IMPORT-UNEMITTED sanity**: it must NOT false-fire on the corpus after (2), and it SHOULD
   fire on a deliberately-dangling import (prove the gate still bites — corrupt an input, confirm red,
   restore, confirm green).
6. **Suite**: `bun run test` (chains pretest). Report pass/fail counts and compare against a baseline
   run on the unmodified worktree — do not attribute pre-existing failures to yourself.
7. **Add regression tests** pinning the emitted specifier for: root importer, depth-1 page, depth-2
   page, and the no-`pages/` byte-identity case.

## REPORT BACK

Workspace path · final branch + SHA · files touched · the emitted-specifier before/after table ·
R26 artifact-diff counts · suite numbers vs baseline · maps feedback line · anything deferred.

**The PA runs an independent S239 adversarial review on your diff before landing. Expect a fix round.**
