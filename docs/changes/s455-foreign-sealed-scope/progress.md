# progress — s455-foreign-sealed-scope (append-only)

## 1. Startup (base c5c95bc64 == origin/main)

Worktree verified; `bun install` + `bun run pretest` clean. BRIEF archived (commit c9a6352b1).

## 2. Governing sentence (SPEC §23.2.4a, read with §23.2.3 / §23.2.4 / §23.2.6 in full)

> **Crossing grammar (`in:{}` header).** … The named values are the ONLY things that cross — there
> is NO free lexical capture (the slice sees only what `in:{}` names).

§23.2.3's CG row and §23.2.4a's "Codegen" paragraph both describe the EMITTED shape ("splices the
verbatim slice into an async IIFE with the `in:{}` names as params") — that shape is exactly what
violates the governing sentence, so those two paragraphs are what this change rewrites (to meaning).

## 3. Locus — PA pointer did NOT hold on the line number

`compiler/src/codegen/emit-logic.ts` `case "foreign"` is at **:3491** on base (PA said ~:3342); the
emit is `await (async (${params}) => { ${inner} })(${argList});` at :3646. Same arm, same mechanism;
only the line drifted.

## 4. Reproduction on base (c5c95bc64; compiler at HEAD c9a6352b1 = base + BRIEF only)

Source (`.tmp/repro/a/app.scrml`, `<program lang="js" db="./app.db">`):

    const banner = "MODULE-BINDING"
    function probe() {
      const hidden = "ENCLOSING-LOCAL"
      const a = _={ _scrml_sql.unsafe("SELECT 1 AS one") }=
      const b = _={ hidden }=
      const c = _={ banner }=
      return { a: a, b: b, c: c }
    }

Compile: `errors: []` (exit 0). Emitted server handler:

    const hidden = "ENCLOSING-LOCAL";
    const a = await (async () => { return (_scrml_sql.unsafe("SELECT 1 AS one")); })();
    const b = await (async () => { return (hidden); })();
    const c = await (async () => { return (banner); })();

Executed (POST through the emitted WinterCG `fetch`, CSRF double-submit satisfied):

    status: 200
    body: {"a":[{"one":1}],"b":"ENCLOSING-LOCAL","c":"MODULE-BINDING"}

All three reproduce: the raw db handle, an enclosing local not in `in:{}`, and a module binding.

## 5. lang="ts" — impl#1 does NOT transpile slices

A slice with type syntax (`const doubled: number = n * 2`) in a `<program lang="ts">` fails TODAY with
`E-CODEGEN-INVALID-LOGIC … Unexpected token` (the validate-emit gate parses the artifact as JS). So
"ts slices work" means the type-free subset, and any mechanism that keeps the slice as JS text keeps
exactly that behaviour. Pre-existing; out of scope; reported.

## 6. Mechanism probes

- **Re-sealing real code from `Function.prototype.toString` is UNSOUND under Bun.** Bun re-prints
  every module it loads: comments are dropped and `typeof require` was constant-folded to
  `"function"` inside the function text. A seal built from `toString()` seals Bun's transpiled text,
  not the author's slice — and const-inlining could move a module value INTO the slice. Rejected.
- **A slice held as a STRING and built once with the `Function` constructor** sees only globals.
  Probed: `require` / `__dirname` / `__filename` are MODULE-scoped in Bun ESM (not globals) — they
  are host context, not scrml scope, so they must be handed in explicitly. Handed in as the
  constructor's outer parameters, `require("./c.cjs")`, `await import("./m.js")` (resolved relative
  to the module), `__dirname`, `__filename`, `Bun`, `fetch` all work. `"use strict"` must be stated
  (Function bodies are sloppy by default; the old IIFE was strict module code) — probed: strict →
  `undeclared = 1` throws ReferenceError. `//# sourceURL=<file>:<line>` attributes the stack frame.
  `import.meta` is a SyntaxError in Function code (no module context) — the one host form lost.

## 7. Corpus measurement (read-only; extractor `.tmp/extract-slices.ts`, acorn free-name walk)

- repo examples/ samples/ conformance/cases/ stdlib/: 13 files, 13 slices. 10 clean. **3 name a free
  scrml local** — all three are `protect` conformance cases (`raw-egress-e004`,
  `reveal-suppresses-e004`, `reveal-wrong-column-e004`) whose slice is `JSON.stringify(u…)` with `u`
  NOT crossed. They are CODES-only cases (E-PROTECT-004 is a source-text gate); nothing executes them.
- scrml-support/docs/gauntlets: 0 files.
- flogence (dcb8701): 23 files, **847 slices; 834 clean; 0 name a free scrml binding.** 13 use
  `require` (module-scoped host context in Bun ESM — preserved by the mechanism, see §6). 0 use
  `import.meta`, `__dirname`, `__filename`.
- compiler/tests: several tests write free-capture slices (`standalone-tool-target.test.js`
  `_={ console.log(banner(n)) }=`, the protect integration tests). Assessed per test after the build.
