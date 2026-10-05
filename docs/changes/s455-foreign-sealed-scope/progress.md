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

## 8. CORRECTION to §7 — the regex census over-counted; the AST census is authoritative

The regex extractor guesses openers; in flogence it counted `_{}` MENTIONS IN COMMENTS as slices
(e.g. app.scrml: 33 regex vs 16 real), and in a test file a `"_={"` string literal swallowed the
next real slice (it missed tool-library-in-process-db-w5b.test.js:262). Re-measured with
`.tmp/extract-ast.ts`, which takes every `kind:"foreign"` node from the compiler's own
splitBlocks + buildAST:

- flogence (dcb8701): **804 slices across 23 files; 0 read an uncrossed scrml name**; 13 read
  `require` (preserved). 0 `import.meta`.
- repo examples/ samples/ conformance/cases/ stdlib/ (2338 .scrml files): **13 slices; 3 read an
  uncrossed name** — the same three protect conformance cases (codes-only fixtures).
- scrml-support/docs/gauntlets: 0 (no file contains the sigil at all).

## 9. Build (commit 0a5ce95d3)

Mechanism: `compiler/src/codegen/foreign-seal.ts` — slice carried as source text in a template
literal, built ONCE per distinct source by `new Function("require","__dirname","__filename", …)`
(strict, `//# sourceURL=<file>:<line>`), cached on the helper; call site
`await _scrml_foreign_seal("<file>:<line>", \`async function (<in>) {…}\`)(<in>)`. ReferenceError
escaping a slice gets " (raised in the foreign-code slice at <file>:<line>: only the names in its
in:{} header cross into a slice, plus host globals - SPEC §23.2.4a)" appended.

Findings during the build:
- Bun re-prints a non-ASCII char inside a `String.raw` template in compiler SOURCE as a `\uXXXX`
  escape, which `String.raw` keeps literally (a `§` arrived in the artifact as `§`). Helper
  text is ASCII-only; the section sign is a JS escape inside the emitted string literal.
- emit-library's leaked-foreign-syntax check matches `/_=\s*\{/` over the emitted module, so the
  helper text must never spell the opener.
- protect-flow read the helper's `new Function` as the CODE EVALUATOR and poisoned every protect
  compile using a slice (E-PROTECT-006 on a `Date.now()` slice). Fixed by modelling the seal call
  as host code (fail-closed `hostCall`), not walking it.
- Bun resolves `new Function(...)` without the global binding — a Proxy on globalThis.Function sees
  zero constructions — so build-once is tested by driving the EMITTED helper directly.
- Pre-existing (not fixed): a statement-form slice with no top-level `;`/`return` (e.g. a lone
  `try {…} catch {…}`) is classified single-expression and wrapped in `return (…)`; on base that was
  E-CODEGEN-INVALID-LOGIC, now E-FOREIGN-007 (clearer, same refusal).
- Pre-existing (not fixed): `lang="ts"` slices are not transpiled; type syntax fails (now
  E-FOREIGN-007 instead of E-CODEGEN-INVALID-LOGIC).

Semantics changes beyond the seal itself (all executed in foreign-sealed-scope.test.js):
- protect: a protected value crossing into a slice now comes back out protected (host-call rule).
  `in:{u}` + `u.reveal("passwordHash")` INSIDE the slice was clean on base and is E-PROTECT-006 now —
  but `.reveal` inside opaque text was never lowered and throws at runtime (rows have no `.reveal`),
  so that program never worked. A hash-derived value (`h.length`) crossing in now also fires
  E-PROTECT-006 where base relied on E-PROTECT-004 alone — more conservative, still refused.
- hmac-key constness: a key produced by a slice now carries its crossings' constness only (host
  rule) — a `process.env` read inside a slice is no longer "runtime evidence"; fail-closed direction.

Tests migrated (fixtures read uncrossed locals/imports and only ran because of the leak):
standalone-tool-target (banner/n, c, clamp, addup ×2), tool-library-in-process-db-w5b (8 sites),
conf-W5B-IN-PROCESS-DB-LIBRARY (c). Shape asserts updated: foreign-inline-codegen,
foreign-lang-library-decl, w5b (2). Three protect conformance cases cross what they read (reveal moved
out of the slice); their contracts are unchanged.

Full gate at 0a5ce95d3 (pre-commit hook): 30729 pass / 0 fail / 58 skip. `bun conformance/run.ts`:
exit 0, 1271/1321 pass + 50 xfail. New conformance neg goes RED on base ("string,string").

## 10. Whole-corpus impl#1 emit differential (scripts/corpus-emit-differential.ts, write:true)

base = 498540d03 (code == c5c95bc64), head = 4c0fb21b1. Roots examples,samples,conformance,stdlib,
benchmarks. Enumerated base 2345 / head 2348 (+3 = the three new conformance cases).

- Compile outcome: 0 newly failing, 0 newly passing.
- Artifacts: 11456 compared, 11444 byte-identical, **12 differ — every one from a source containing
  `_={`** (13 slice-bearing sources; the 13th, foreign-crossing-shadow-neg, is an E-FOREIGN-006 compile
  error and emits nothing): 2 capability cases (server.js), 7 foreign cases (tool .js), 3 protect cases
  (server.js; also source-migrated). 0 artifacts added/removed.
- Syntax (effective goggle): 75 failing both sides, failure SET identical. Script-goggle-on-all +3 are
  the new cases (two ESM tools with top-level await, one compile-error case) — not their load context.
- Diagnostic CODE changes: 2 — W-TYPE-031-UNPROVEN on `let r = u.reveal(…)` in the two MIGRATED reveal
  cases (a new source line, not a compiler change).
- Diagnostic TEXT-only: 1431 — all but 4 vanish when the harness work-dir path (`.tmp/diff/base` vs
  `.tmp/diff/head2`, printed RELATIVE by the CLI so the tool's normalizer misses it) is normalized
  (2341 identical). The 4: E-FOREIGN-006 wording (crossing-shadow-neg) and the three migrated protect
  cases (new source lines; E-PROTECT-006 now names the seal call as the opaque site).
- First head capture (0a5ce95d3) found a real defect: the helper's literal `undefined` tripped
  W-CG-UNDEFINED-INTERPOLATION on every slice-bearing server bundle — fixed in 4c0fb21b1.
