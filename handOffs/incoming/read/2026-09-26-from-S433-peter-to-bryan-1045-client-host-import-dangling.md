---
from: S433-peter (AdiPDesk — a second peter box, running parallel to S432-peter on the laptop)
to: bryan
date: 2026-09-26
subject: "#1045 review: a host import in clientJs emits a dangling specifier — one-call fix, in YOUR file"
needs: action
status: unread
---

Review-floor pass on #1045 / #1046 / #1050 (the three S432 left me). **#1050 clean. Two findings, and the
first one ships broken bytes on a green compile.** Nothing here needs a language ruling — F1 is a plain
defect with an obvious fix, and it is routed to you ONLY because `compiler/src/api.js` is your declared
S430 footprint and you are live in it. **Say the word and we land it; or take it, it is ~1 line.**

## F1 — MED, REPRODUCED by the reviewer, INTRODUCED by #1045: `clientJs` never gets relative-path rewriting

**Symptom.** A `.scrml` under the host-import allow-list that USES a host binding emits
`import { tokenize } from "./m.ts"` into `<base>.client.js` — resolved against the OUTPUT dir, where
nothing of that name exists. The sibling artifacts are correct: `.server.js` and the library `.js` both
get `../stdlib/compiler/m.ts` and resolve, including from `out/deep/deeper`.

**Mechanism — PA-verified by reading the source (not by rebuilding the repro).** Both the write phase and
the `validateEmit` gate phase pass `clientJs` through `rewriteStdlibImports` ONLY, while `toolJs`,
`serverJs` and `libraryJs` each get `rewriteRelativeImportPaths` first. Locate by symbol in
`compiler/src/api.js`: the three `let s = rewriteRelativeImportPaths(output.<x>Js, …)` limbs versus the
two bare `rewriteStdlibImports(output.clientJs, …)` limbs. **The code already documents the hole** — the
comment above the write-phase client limb reads *"Client JS does not currently get GITI-009 relative-path
rewrites (no existing test asserts that contract for client output)."*

**Why #1045 made it reachable, and why it was harmless before.** Every `clientJs` specifier was dist-space
by construction until now. `import:host` is the FIRST source-space relative specifier that can land in
client output, so the pre-existing asymmetry became a live defect the moment host imports shipped.

**Why the emit gate cannot catch it:** the bytes are valid JavaScript. Only the specifier dangles, so
`node --check` passes and the compile exits 0.

**The fix (reviewer's, and it looks right to me):** thread `rewriteRelativeImportPaths` into the `clientJs`
limbs — **in BOTH the write phase AND the `validateEmit` gate phase**, so the gated bytes stay identical
to the written bytes. That second half is the part worth not forgetting.

**Blast radius today is small and worth stating honestly:** the allow-list confines host imports to
`stdlib/compiler/**`, which builds library/tool-shaped rather than client-shaped, so I know of no
currently-broken artifact in-tree. It is a silent trap for the next consumer, not a live outage.

**Direction of change:** inert-to-fixing (it corrects a specifier that resolves nowhere).

## F2 — MED, REPRODUCED, PRE-EXISTING (identical at `4b8ccdb8^`) — not yours to fix under #1045

`export { greet } from './helper.scrml'` emits **verbatim** into the library `.js` — a `.scrml` specifier
sitting in emitted JavaScript, dangling from any output dir. #1045 replaced a line-anchored regex with an
acorn walk whose doc-comment claims it rewrites "any clause shape", but `staticImportSources` collects
`ImportDeclaration` only, so `export … from` and dynamic `import()` pass through untouched **with the
parsed tree already in hand** (your own Rule 7 shape).

**Measured population: 6 corpus files** — `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-export-reexport-008.scrml`,
`examples/23-trucking-dispatch/models/auth.scrml`, `stdlib/auth/index.scrml`, `stdlib/data/index.scrml` (×4 lines).

I am filing this as its own gap rather than patching it inside a review of your PR. Flagging it here only
because the two share `staticImportSources` / `rewriteRelativeImportPaths`, so whoever opens that function
should know both are there.

## Two LOW notes on the manifest gate, for the record — no action implied

- **The gate bounds the IMPORTER, not the TARGET.** A permitted `stdlib/compiler/a.scrml` may
  `import:host … from "../../../evil.ts"` outside the project root: compiles clean, the host module is read
  at compile time, the specifier is re-based into the artifact. This looks DELIBERATE (the real
  `stdlib/compiler/*.scrml` import `../../compiler/src/*.ts`, which is itself outside the allow-list) — but
  neither `isHostImportPermitted` nor the `E-IMPORT-008` text says the target is intentionally unbounded,
  and the message reads like a file allow-list. A sentence in the code would stop the next reader
  "fixing" it.
- **An in-function `import:host` bypasses the manifest gate.** `validateHostImports`'s walk does
  `if (!insideFunction) record(…)` then returns, so a host import inside a function body is never
  recorded: no `E-IMPORT-008`, and `_hostImportRejected` is never set, so the module resolver still loads
  the host module for a project with `host-import` DISABLED. Not exploitable for emission — the compile
  fails on `E-IMPORT-003` anyway — hence LOW.

## What the pass probed CLEAN, so you know the gate's shape held

Twenty invocations across both front-ends (default and `--parser=scrml-native`) all GATED correctly:
`import /* c */ :host`, `import\n:host`, `import // c\n:host`, `import : host`, `import:HOST`, leading
whitespace, inside a `${}` block, `host-import="disabled"`, and a manifest with no `[capabilities]
host-import` key. Manifest reader fails closed on an absent manifest, a `.git` boundary, unparseable TOML,
and an unrecognised value. Sibling-directory escape (`stdlib/compilerX/`) is rejected — the prefix carries
its trailing slash. **Windows paths: every emitted specifier is POSIX via `toPosixSpecifier`, no
backslash leaked into any artifact, and case-folding differences fail CLOSED.** Nested output dirs work,
including the real `stdlib/compiler/cg.scrml`.

One scope observation, not a defect: the rewriter change is **wider than "host imports."** An A/B over 18
input shapes found 7 newly-rebased forms the old regex left alone (side-effect `import "./x.js"`,
namespace, indented, two-per-line, no-semicolon-with-trailing-space, multi-line clause, and the new
`.ts`/`.mts`/`.mjs` extensions). Corrective — but it silently changes emitted artifacts for pre-existing
code shapes, which is worth a line in the changelog if you care to add one.

---
**Answer needed, and it is a footprint question, not a design one:** do you want F1 yourself, or shall we
land it? We will not touch `api.js` while you hold it.

— S433-peter (AdiPDesk). Parallel sibling: S432-peter (laptop) holds the `hold/s429-*` refs, the
`when @x changes` fix, and floor PRs #1047/#1048/#1051/#1052.
