/**
 * g-each-body-decl-any-position (S338) — `E-EACH-BODY-DECL-UNSUPPORTED` must fire
 * for a declaration in ANY statement position of an `<each>` body interpolation,
 * and for ANY declaration kind.
 *
 * This is also the FIRST test anchor for `E-EACH-BODY-DECL-UNSUPPORTED` — PR #508
 * shipped the diagnostic with no test at all, which is why both holes below rode
 * along undetected.
 *
 * The class: a declaration inside an `<each>` body interpolation has no
 * `exprNode`/`raw`, so the each emitter drops it — while a later `${name}` in the
 * row template still lowers to a bare `String(name)`. The emitted per-item render
 * factory then throws on a dangling reference and the WHOLE list renders empty,
 * with zero diagnostics. §17.7.3 scopes the each body to the `@.` sigil + an
 * optional `as` alias, not author-declared locals, so the guard fails CLOSED.
 *
 * The two holes closed here:
 *
 *   F2 — the guard read `body[0]` only. A declaration in any non-first statement
 *        position was never examined, and the N+1th position is literally
 *        `body[1]`. Measured before the fix: `${ @.id \n let nm = @.name }` →
 *        `errors: []` and `textContent = String(nm)` with no declaration of `nm`.
 *        Byte-for-byte the miscompile #508 closed, one statement over.
 *
 *   F3 — the guard matched a three-name allowlist (`let|const|function`), so
 *        `lin-decl` walked straight through into the same silent miscompile even
 *        at position 0.
 *
 * The fix asks the NODE what it is (the AST's `<x>-decl` kind convention) rather
 * than matching a name list, so `lin`, `~`, `type` and every future declaration
 * kind are covered without a further patch.
 *
 * NOTE on what these tests assert. The contract closed here is that the shape is
 * REJECTED — the diagnostic is the fix. They deliberately do NOT assert on the
 * emitted `.client.js`, because the compiler WRITES its artifacts even on a hard
 * error: the CLI exits 1 and prints `FAILED — 1 error`, but `page.client.js` is
 * still on disk carrying the dangling `String(nm)`. That fail-open artifact write
 * is pre-existing, orthogonal to this fix, and reported separately — it is not
 * something these tests should silently encode as expected behavior.
 *
 * MEASURED before landing: across the 56 committed `.scrml` files that use
 * `<each>` (examples/ samples/ benchmarks/ stdlib/ conformance cases/ docs/), the
 * widening newly rejects ZERO files. The single file that fires,
 * `samples/compilation-tests/gauntlet-s20-sql/sql-in-for-loop-001.scrml`, fires
 * identically on the base — it is #508's pre-existing flip, not this change's.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/** Build a page whose `<each>` body interpolation holds `declSrc` at `position`. */
function page(declSrc, position) {
  const interp = position === 0 ? declSrc : `@.id\n${declSrc}`;
  return `<div>
\${ <rows>: { id: number, name: string }[] = [] }
<each in=@rows key=@.id>\${ ${interp} }<li>\${nm}</li></each>
</div>
`;
}

function compile(src) {
  const dir = mkdtempSync(join(tmpdir(), "each-decl-"));
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dir, "page.scrml"), src);
  const result = compileScrml({
    inputFiles: [join(dir, "page.scrml")], write: true, outputDir: dist, log: () => {},
  });
  // A diagnostic may ride either stream; E-DG-002-class codes live in `warnings`.
  const codes = [...new Set([...(result.errors ?? []), ...(result.warnings ?? [])]
    .map((d) => d.code).filter((c) => c && String(c).startsWith("E-")))];
  let client = "";
  try {
    const f = readdirSync(dist).find((x) => x.endsWith(".client.js"));
    if (f) client = readFileSync(join(dist, f), "utf8");
  } catch { /* no client emitted */ }
  return { codes, client };
}

// Every declaration form that can appear in an each-body interpolation.
// `var` is not scrml, but it parses to a `tilde-decl` and rode the same hole.
const DECL_FORMS = {
  let: "let nm = @.name",
  const: "const nm = @.name",
  lin: "lin nm = @.name",
  tilde: "~nm = @.name",
  function: "function nm() { return 1 }",
  var: "var nm = 1",
};

describe("g-each-body-decl-any-position — the guard covers every position", () => {
  for (const [label, src] of Object.entries(DECL_FORMS)) {
    test(`F2: a \`${label}\` declaration at body[1] (the N+1th position) is rejected`, () => {
      const { codes } = compile(page(src, 1));
      expect(codes).toContain("E-EACH-BODY-DECL-UNSUPPORTED");
    });
  }
});

describe("g-each-body-decl-any-position — the guard covers every kind", () => {
  for (const [label, src] of Object.entries(DECL_FORMS)) {
    test(`F3: a \`${label}\` declaration at body[0] is rejected`, () => {
      const { codes } = compile(page(src, 0));
      expect(codes).toContain("E-EACH-BODY-DECL-UNSUPPORTED");
    });
  }
});

describe("g-each-body-decl-any-position — no false fire", () => {
  test("a plain `@.` field read in the each body still compiles clean", () => {
    const src = `<div>
\${ <rows>: { id: number, name: string }[] = [] }
<each in=@rows key=@.id>\${ @.id }<li>\${@.name}</li></each>
</div>
`;
    expect(compile(src).codes).not.toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });

  test("an `as` alias read in the each body still compiles clean", () => {
    const src = `<div>
\${ <rows>: { id: number, name: string }[] = [] }
<each in=@rows as row key=@.id>\${ row.id }<li>\${row.name}</li></each>
</div>
`;
    expect(compile(src).codes).not.toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });

  test("multiple non-declaration statements in one each-body interpolation are fine", () => {
    const src = `<div>
\${ <rows>: { id: number, name: string }[] = [] }
<each in=@rows key=@.id>\${ @.id }<li>\${@.name}</li><span>\${@.id}</span></each>
</div>
`;
    expect(compile(src).codes).not.toContain("E-EACH-BODY-DECL-UNSUPPORTED");
  });
});
