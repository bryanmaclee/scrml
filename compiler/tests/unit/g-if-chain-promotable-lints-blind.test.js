/**
 * g-if-chain-promotable-lints-blind.test.js
 *
 * SITES 7 and 8 of the §17.1.1 if-chain descent class. NOT in the dispatch's
 * named site list — they were turned up while working site 5, and they are
 * here because leaving them open would ship an INCONSISTENT TOOL: `scrml
 * promote` has three modes, sites 4 and 5 fixed `--each` and `--engine`, and
 * `--match` is the third. A tool that finds a promotable site under an
 * `if=`/`else` chain in two of its three modes is worse than one that finds it
 * in none, because the two working modes teach you to trust the third.
 *
 * MEASURED 1 / 1 / 0 across plain / lone-`if=` / `if=`+`else` before the fix,
 * on ONE source file (the same `${ function render() { if…else if… } }` in
 * three wrappers whose only difference is a `<div else>` sibling):
 *
 *   | site | walk                                              | lost               |
 *   |------|---------------------------------------------------|--------------------|
 *   |  7   | lint-i-match-promotable.js walkFileForIfChains     | I-MATCH-PROMOTABLE |
 *   |      |   (+ collectCellTypeAnnotations, the type map it   | + `promote --match`|
 *   |      |    classifies enum-exhaustiveness from)           |   -> "no sites"    |
 *   |  8   | lint-i-fn-promotable.js collectFunctionDecls       | I-FN-PROMOTABLE    |
 *   |      |   (+ collectNonPureFnNames, its E-FN-003 probe)   |                    |
 *
 * WHY BOTH WALKS IN EACH FILE, not just the harvesting one. In each file the
 * second walk builds a set the first one CONSULTS — the enum type map in one,
 * the non-pure-callee set in the other. Fixing only the harvest would reach a
 * branch-declared `function` while the probe set still did not, and a `fn`
 * calling it would be wrongly tagged promotable. Masked-pair rule: both halves
 * or neither. (Site 6 in this same dispatch is the case where that rule was
 * learned the expensive way.)
 *
 * THE FIX routes all four through `ifChainChildNodes`
 * (compiler/src/ast-if-chain.js), the shared enumerator PR #805 extracted.
 *
 * MEASURED MIGRATION: 1912 corpus files — 0 diagnostic changes, 0 emit
 * changes. `scrml promote --match` over the same corpus, base vs fix: file list
 * identical, 0 files migrate.
 *
 * VALUE-asserting (R26): compiles real .scrml end-to-end so `collapseIfChains`
 * runs; a synthesized AST would bypass the locus.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { promoteMatchOnFile } from "../../src/commands/promote.js";

const D = "$" + "{";

function withTmp(source, fn) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-ifchain-prom-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source, "utf8");
    return fn(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const codes = (source, code) =>
  withTmp(source, (file) => {
    const r = compileScrml({ inputFiles: [file], write: false });
    return [
      ...(r.errors ?? []),
      ...(r.warnings ?? []),
      ...(r.lintDiagnostics ?? []),
    ].filter((d) => (d.code || "") === code).length;
  });

// A promotable enum if/else-if chain in a `function` body, inside a `${…}`
// logic island that sits inside the markup element under test.
const LOGIC = `${D}
  function render() {
    if (@phase is .Idle) {
      return 'a'
    } else if (@phase is .Loading) {
      return 'b'
    } else if (@phase is .Error) {
      return 'c'
    } else if (@phase is .Success) {
      return 'd'
    }
    return 'z'
  }
}`;

const src = (openTag, elseArm) => `<program>
type Phase:enum = { Idle, Loading, Error, Success }
<open>: boolean = true
<phase>: Phase = .Idle
${openTag}${LOGIC}</div>
${elseArm ?? ""}<p>${D}render()}</p>
</program>
`;

const plain = src(`<div class="wrap">`);
const loneIf = src(`<div class="wrap" if=@open>`);
const ifElse = src(
  `<div class="wrap" if=@open>`,
  `<div class="wrap2" else><p>closed</p></div>\n`,
);

describe("g-if-chain-promotable-lints-blind", () => {
  // -- SITE 7 --------------------------------------------------------------
  describe("SITE 7 — I-MATCH-PROMOTABLE + promote --match", () => {
    test("the lint fires under an if=/else chain", () => {
      expect(codes(ifElse, "I-MATCH-PROMOTABLE")).toBe(1);
    });

    test("PARITY: if=/else matches lone-if= and plain (the oracles)", () => {
      expect(codes(plain, "I-MATCH-PROMOTABLE")).toBe(1);
      expect(codes(loneIf, "I-MATCH-PROMOTABLE")).toBe(1);
      expect(codes(ifElse, "I-MATCH-PROMOTABLE")).toBe(codes(loneIf, "I-MATCH-PROMOTABLE"));
    });

    test("promote --match finds the site (was status:no-sites)", () => {
      const res = withTmp(ifElse, (file, dir) =>
        promoteMatchOnFile(file, null, { dryRun: true }, dir));
      expect(res.status).not.toBe("no-sites");
      expect(res.count).toBe(1);
    });

    test("PARITY: promote --match agrees across all three shapes", () => {
      const run = (s) => withTmp(s, (file, dir) =>
        promoteMatchOnFile(file, null, { dryRun: true }, dir).count);
      expect(run(plain)).toBe(1);
      expect(run(loneIf)).toBe(1);
      expect(run(ifElse)).toBe(1);
    });
  });

  // -- SITE 8 --------------------------------------------------------------
  describe("SITE 8 — I-FN-PROMOTABLE", () => {
    // The SECOND walk in lint-i-fn-promotable.js — `collectNonPureFnNames`.
    // Without this test the hunk was load-bearing but UNGUARDED: deleting it
    // left all four of this branch's other test files green.
    //
    // The set it builds is what makes the E-FN-003 "a `fn` may not call a
    // non-pure `function`" probe faithful. A `function` declared inside an
    // `if=`/`else` branch was missing from it, so a caller whose body calls
    // that function looked clean and was WRONGLY advertised as promotable to
    // the pure `fn` form. Promoting on that advice would then fail E-FN-003 at
    // the declaration site — the lint sending an author into an error.
    //
    // MEASURED: 1 diagnostic with the descent (on `helper`, correctly), 2
    // without it (a FALSE one on `caller`).
    test("a caller of a BRANCH-declared function is not advertised as promotable", () => {
      const src = `<open> = true
<div if=@open>${D} function helper() { return 3 } }<p>a</p></div>
<div else><p>c</p></div>
${D}
  function caller() {
    return helper() + 1
  }
}
<p>v ${D}caller()}</p>
`;
      const diags = withTmp(src, (file) => {
        const r = compileScrml({ inputFiles: [file], write: false });
        return [...(r.errors ?? []), ...(r.warnings ?? []), ...(r.lintDiagnostics ?? [])]
          .filter((d) => (d.code || "") === "I-FN-PROMOTABLE");
      });
      expect(diags.length).toBe(1);
      expect(diags.map((d) => d.message).join("\n")).toContain("helper");
      expect(diags.map((d) => d.message).join("\n")).not.toContain("`function caller`");
    });

    test("fires under an if=/else chain", () => {
      expect(codes(ifElse, "I-FN-PROMOTABLE")).toBe(1);
    });

    test("PARITY: if=/else matches lone-if= and plain (the oracles)", () => {
      expect(codes(plain, "I-FN-PROMOTABLE")).toBe(1);
      expect(codes(loneIf, "I-FN-PROMOTABLE")).toBe(1);
      expect(codes(ifElse, "I-FN-PROMOTABLE")).toBe(codes(loneIf, "I-FN-PROMOTABLE"));
    });
  });
});
