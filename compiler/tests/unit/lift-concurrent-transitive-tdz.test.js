/**
 * lift-concurrent-transitive-tdz.test.js — regression test for S212
 * g-lift-concurrent-transitive-exclusion-tdz (filed docs/known-gaps.md §S212).
 *
 * Sibling of bug-56-cps-scheduler-tdz-and-non-decl.test.js. The Bug-56 fix
 * folded body-DG `reads` edges into the lift-concurrent scheduler so a statement
 * that DIRECTLY reads an await-bound local forces a batch boundary. This test
 * covers the two facets that fix left open:
 *
 *   Facet A (transitive exclusion) — a statement that reads a SYNC-but-excluded
 *   local (one that itself depends on an await result) was batched AHEAD of that
 *   local's declaration. The independence check looked only at DIRECT deps on
 *   group MEMBERS; an excluded statement at an index >= the batch seed was
 *   invisible. The fix fixpoints the body-DG edges into a transitive dependency
 *   closure so excluded-ness propagates through any chain of intervening locals.
 *   This also required the body-DG to SEE reads captured inside lambda/arrow
 *   bodies (`profiles.map(pr => f(n))`), which `forEachIdentInExprNode`
 *   deliberately skips (lin scope) — body-dg-builder.ts now collects those
 *   lambda-body free reads conservatively.
 *
 *   Facet B (the let-accumulator) — a `let acc = []` reassigned later (e.g. in a
 *   `for` loop) was lifted into the `const [...] = await Promise.all([...])`
 *   destructure, then crashed at the reassignment with "Assignment to constant
 *   variable". The reassignment lowers to a `tilde-decl` (not a bare-expr
 *   assign); the scheduler now treats a decl whose name is reassigned anywhere
 *   later in the body (including nested control-flow bodies) as batch-ineligible.
 *
 * Both bugs produce `node --check`-CLEAN JS — the emit parses fine. They are
 * runtime TDZ / const-reassign crashes, only detectable by asserting the
 * declaration-vs-use ORDER and the batch CONTENTS of the emit.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/lc-transitive-tdz");

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compileSource(name, src) {
  const inputPath = join(FIXTURE_DIR, name);
  writeFileSync(inputPath, src);
  const outDir = join(FIXTURE_DIR, "dist-" + Math.random().toString(36).slice(2, 8));
  compileScrml({
    inputFiles: [inputPath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  let clientJs = "";
  function findClient(dir) {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) findClient(p);
      else if (ent.name.endsWith(".client.js")) clientJs = readFileSync(p, "utf-8");
    }
  }
  findClient(outDir);
  return clientJs;
}

/** Slice out one function body from the emitted client.js for focused asserts. */
function fnBody(code, mangledPrefix) {
  const start = code.indexOf(mangledPrefix);
  if (start < 0) return "";
  // Grab a generous window — the body is small and the next blank-line
  // separator reliably bounds it.
  const tail = code.slice(start);
  const end = tail.indexOf("\n\n\n");
  return end >= 0 ? tail.slice(0, end) : tail.slice(0, 800);
}

// ---------------------------------------------------------------------------
// Facet A — transitive exclusion (no TDZ on a sync-but-excluded local)
// ---------------------------------------------------------------------------

describe("S212 Facet A: transitive batch-exclusion — sync local depending on an await is not batched ahead of its decl", () => {
  const src = `< db src="./test.db" tables="profiles">
    \${
        server function loadProfileRows() {
            return ?{\`CREATE TABLE IF NOT EXISTS profiles (project TEXT, text TEXT); SELECT project, text FROM profiles\`}
        }
        function tokenize(s) { return s.split(" ") }
        function score(qtf, tf, profiles, n) { return n }

        function routeSemantic(query) {
            const rows = loadProfileRows()
            const profiles = rows.map(r => ({ project: r.project, tf: tokenize(r.text) }))
            const qtf = tokenize(query)
            const n = profiles.length
            const scored = profiles.map(pr => ({ project: pr.project, score: score(qtf, pr.tf, profiles, n) }))
            return scored
        }
    }
    <button onclick=routeSemantic("hi")>go</button>
</>
`;

  test("const profiles is declared BEFORE any use; profiles.{length,map} never appear inside Promise.all", () => {
    const code = compileSource("facet-a-transitive.scrml", src);
    const body = fnBody(code, "function _scrml_routeSemantic");
    expect(body.length).toBeGreaterThan(0);

    // `const profiles = ...` must exist as a sequential declaration.
    expect(body).toMatch(/const profiles = rows\.map/);

    // The TDZ-prone reads of `profiles` must NOT live inside the Promise.all
    // array (`[^\]]` scopes to inside the bracket — entries never contain `]`).
    expect(body).not.toMatch(/Promise\.all\(\[[^\]]*profiles\.length/);
    expect(body).not.toMatch(/Promise\.all\(\[[^\]]*profiles\.map/);

    // Declaration-before-use ORDER: `const profiles` precedes `const n` (reads
    // profiles) and `const scored` (reads profiles + n), and `const n` precedes
    // `const scored`.
    const profilesIdx = body.indexOf("const profiles = ");
    const nIdx = body.indexOf("const n = ");
    const scoredIdx = body.indexOf("const scored = ");
    expect(profilesIdx).toBeGreaterThanOrEqual(0);
    expect(nIdx).toBeGreaterThan(profilesIdx);
    expect(scoredIdx).toBeGreaterThan(nIdx);
  });

  test("the independent pure const (qtf) STILL batches with the await (feature not regressed)", () => {
    const code = compileSource("facet-a-feature.scrml", src);
    const body = fnBody(code, "function _scrml_routeSemantic");
    // `qtf = tokenize(query)` reads only the param — it should still ride the
    // Promise.all alongside the fetch.
    expect(body).toMatch(
      /Promise\.all\(\[[\s\S]*?_scrml_fetch_loadProfileRows[\s\S]*?_scrml_tokenize_\d+\(query\)[\s\S]*?\]\)/,
    );
    // And the destructure binds both names.
    expect(body).toMatch(/const \[rows, qtf\] = await Promise\.all\(\[/);
  });
});

// ---------------------------------------------------------------------------
// Facet B — the let-accumulator (reassigned binding never const-destructured)
// ---------------------------------------------------------------------------

describe("S212 Facet B: a reassigned `let` is never lifted into the const Promise.all destructure", () => {
  const src = `< db src="./test.db" tables="profiles">
    \${
        server function loadProfileRows() {
            return ?{\`CREATE TABLE IF NOT EXISTS profiles (project TEXT, text TEXT); SELECT project, text FROM profiles\`}
        }
        function tokenize(s) { return s.split(" ") }

        function accumulate(query) {
            const rows = loadProfileRows()
            const qtf = tokenize(query)
            let acc = []
            for (r of rows) {
                acc = acc.concat(tokenize(r.text))
            }
            return acc
        }
    }
    <button onclick=accumulate("hi")>go</button>
</>
`;

  test("`let acc = []` emits sequentially; it is NOT a member of the Promise.all const-destructure", () => {
    const code = compileSource("facet-b-let-accum.scrml", src);
    const body = fnBody(code, "function _scrml_accumulate");
    expect(body.length).toBeGreaterThan(0);

    // The reassigned binding must keep its own sequential `let` line.
    expect(body).toMatch(/let acc = \[\];/);

    // It must NOT appear inside the destructured `const [...]` of the batch.
    expect(body).not.toMatch(/const \[[^\]]*\bacc\b[^\]]*\] = await Promise\.all/);

    // The reassignment must be present (and is now legal against a `let`).
    expect(body).toMatch(/acc = acc\.concat/);
  });

  test("the independent consts (rows, qtf) STILL batch (feature not regressed)", () => {
    const code = compileSource("facet-b-feature.scrml", src);
    const body = fnBody(code, "function _scrml_accumulate");
    expect(body).toMatch(/const \[rows, qtf\] = await Promise\.all\(\[/);
  });
});
