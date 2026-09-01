/**
 * g-if-chain-iteration-lints-and-promote-blind.test.js
 *
 * SITES 2-4 of the §17.1.1 if-chain descent blind-spot class. Three walks, one
 * copied fact, one shared enumerator.
 *
 * THE SHAPE. `collapseIfChains` (ast-builder.js) rewrites an `if=`/`else-if=`/
 * `else` chain that HAS an else arm into `{kind:"if-chain", branches:
 * [{condition, element}], elseBranch}`. Branch bodies live under
 * `branches[].element` + `elseBranch` — NONE of the container keys these walks
 * recurse into (`children`/`body`/`bodyChildren`/`nodes`/`arms`/
 * `templateChildren`/`consequent`/`alternate`/`components`) — and `branches`
 * is an array of RECORDS, so even listing it among generic keys would not
 * reach `element`. A lone `if=` is never collapsed, which is why adding a
 * `<div else>` sibling is the ONE-VARIABLE discriminator, and why the lone-
 * `if=` shape is the parity oracle every test below asserts against.
 *
 * MEASURED before the fix — plain / lone-`if=` / `if=`+`else`:
 *
 *   | site                                        | plain | if= | if=/else |
 *   |---------------------------------------------|-------|-----|----------|
 *   | lint-w-each-promotable.js walkForStmts       |   1   |  1  |    0     |
 *   | lint-w-map-iteration-order.js walkEachBlocks |   1   |  1  |    0     |
 *   | commands/promote.js findIterationSites       |   1   |  1  |    0     |
 *   | commands/promote.js findMatchBlockSites      |   1   |  1  |    0     |
 *
 * THE LAST ROW WAS CARRIED AS "cannot discriminate" INTO THIS DISPATCH, on the
 * grounds that an earlier probe could not make even its PLAIN case fire. That
 * was a defect in the probe, not a property of the walk: with the canonical
 * `rule=`-arm fixture (the one `promote-engine.test.js` already ships) the
 * plain case fires, and the site discriminates 1 / 1 / 0 like the rest.
 * An inspection-only label is a claim about the prober, not about the code.
 *
 * THE PROMOTE ONE IS THE WORST AND IT IS ADOPTER-FACING. `scrml promote --each`
 * returned `{"status":"no-sites"}` on source that plainly carries a promotable
 * `${for…lift}`, purely because it sat under an `if=`/`else` chain. A lone
 * `if=` promoted fine. **The tool said "nothing here" and was wrong** — and the
 * W-EACH-PROMOTABLE lint that ADVERTISES that command was blind in exactly the
 * same way, so the two agreed on the wrong answer instead of catching it.
 *
 * THE FIX routes all three through `ifChainChildNodes`
 * (compiler/src/ast-if-chain.js), the shared child-shape enumerator PR #805
 * extracted, so the lint and the tool can no longer disagree about what a
 * promotable site is.
 *
 * VALUE-asserting (R26): compiles real .scrml end-to-end so the
 * `collapseIfChains` restructure that IS the locus runs. A synthesized AST
 * would bypass it.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { promoteEachOnFile, promoteEngineOnFile } from "../../src/commands/promote.js";

// `${` literal — a JS template literal would interpolate it.
const D = "$" + "{";

function withTmp(source, fn) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-ifchain-iter-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source, "utf8");
    return fn(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function compileSource(source) {
  return withTmp(source, (file) => {
    const r = compileScrml({ inputFiles: [file], write: false });
    return {
      errors: r.errors ?? [],
      warnings: r.warnings ?? [],
      lints: r.lintDiagnostics ?? [],
    };
  });
}

// Diagnostics ride three streams (S92/S93 partition); sweep all three so a
// future re-partition cannot silently blind these gates.
const codes = (r, code) =>
  [...r.errors, ...r.warnings, ...r.lints].filter((d) => (d.code || "") === code);

// --- source shapes: identical bodies, the ONLY variable is the else sibling --

const FOR_LIFT_BODY =
  `${D}\n    for (let t of @todos) {\n        lift <li>${D}t}</li>\n    }\n}`;

const forLift = {
  plain: `<program>
<open>: boolean = true
<todos>: string[] = []
<div class="wrap">${FOR_LIFT_BODY}</div>
</program>
`,
  loneIf: `<program>
<open>: boolean = true
<todos>: string[] = []
<div class="wrap" if=@open>${FOR_LIFT_BODY}</div>
</program>
`,
  ifElse: `<program>
<open>: boolean = true
<todos>: string[] = []
<div class="wrap" if=@open>${FOR_LIFT_BODY}</div>
<div class="wrap" else><p>closed</p></div>
</program>
`,
};

const EACH_OVER_MAP =
  `  <ul>\n    <each in=@m.entries() key=@.key>\n      <li>${D}@.key}</li>\n    </each>\n  </ul>`;

const mapEach = {
  plain: `<program>
<open>: boolean = true
<m>: [string: number] = [:]
<div class="wrap">
${EACH_OVER_MAP}
</div>
</program>
`,
  loneIf: `<program>
<open>: boolean = true
<m>: [string: number] = [:]
<div class="wrap" if=@open>
${EACH_OVER_MAP}
</div>
</program>
`,
  ifElse: `<program>
<open>: boolean = true
<m>: [string: number] = [:]
<div class="wrap" if=@open>
${EACH_OVER_MAP}
</div>
<div class="wrap2" else><p>closed</p></div>
</program>
`,
};

describe("g-if-chain-iteration-lints-and-promote-blind", () => {
  // -- SITE 2 --------------------------------------------------------------
  describe("SITE 2 — W-EACH-PROMOTABLE (lint-w-each-promotable.js)", () => {
    test("fires under an if=/else chain", () => {
      expect(codes(compileSource(forLift.ifElse), "W-EACH-PROMOTABLE").length).toBe(1);
    });

    test("PARITY: if=/else matches lone-if= and plain (the oracles)", () => {
      const n = (s) => codes(compileSource(s), "W-EACH-PROMOTABLE").length;
      expect(n(forLift.plain)).toBe(1);
      expect(n(forLift.loneIf)).toBe(1);
      expect(n(forLift.ifElse)).toBe(n(forLift.loneIf));
    });
  });

  // -- SITE 3 --------------------------------------------------------------
  describe("SITE 3 — W-MAP-ITERATION-ORDER (lint-w-map-iteration-order.js)", () => {
    test("fires under an if=/else chain", () => {
      expect(codes(compileSource(mapEach.ifElse), "W-MAP-ITERATION-ORDER").length).toBe(1);
    });

    test("PARITY: if=/else matches lone-if= and plain (the oracles)", () => {
      const n = (s) => codes(compileSource(s), "W-MAP-ITERATION-ORDER").length;
      expect(n(mapEach.plain)).toBe(1);
      expect(n(mapEach.loneIf)).toBe(1);
      expect(n(mapEach.ifElse)).toBe(n(mapEach.loneIf));
    });
  });

  // -- SITE 4 --------------------------------------------------------------
  describe("SITE 4 — scrml promote --each (commands/promote.js)", () => {
    const promote = (source, opts) =>
      withTmp(source, (file, dir) => {
        const res = promoteEachOnFile(file, null, opts ?? { dryRun: true }, dir);
        return { res, rewritten: readFileSync(file, "utf8") };
      });

    test("finds the site under an if=/else chain (was status:no-sites)", () => {
      const { res } = promote(forLift.ifElse);
      expect(res.status).not.toBe("no-sites");
      expect(res.count).toBe(1);
    });

    test("PARITY: if=/else matches lone-if= and plain (the oracles)", () => {
      expect(promote(forLift.plain).res.count).toBe(1);
      expect(promote(forLift.loneIf).res.count).toBe(1);
      expect(promote(forLift.ifElse).res.count).toBe(1);
    });

    test("the rewrite it now produces is VALID scrml and keeps the else arm", () => {
      // A promotion that silently emits broken source would be worse than the
      // silence it replaces, so the rewrite is round-tripped through the
      // compiler rather than merely diffed.
      const { rewritten } = promote(forLift.ifElse, { dryRun: false });
      expect(rewritten).toContain("<each in=@todos as t>");
      expect(rewritten).toContain(`<div class="wrap" else>`);
      const r = compileSource(rewritten);
      expect(r.errors.length).toBe(0);
      // Idempotent: the promoted form is no longer a promotable site.
      expect(codes(r, "W-EACH-PROMOTABLE").length).toBe(0);
    });
  });

  // -- SITE 5 --------------------------------------------------------------
  describe("SITE 5 — scrml promote --engine (commands/promote.js)", () => {
    // A `<match>` whose arms accrue inert `rule=` attributes — the canonical
    // --engine promotion candidate (mirrors promote-engine.test.js's fixture).
    const MATCH_BLOCK = `<match for=Phase on=@status>
    <Idle rule=.Loading>
        <p>idle</p>
    </>
    <Loading rule=.Ready>
        <p>loading</p>
    </>
    <Ready>
        <p>ready</p>
    </>
</match>`;

    const matchIn = (openTag, extra) => `<program>
type Phase:enum = { Idle, Loading, Ready }

<open>: boolean = true
<status>: Phase = .Idle

${openTag}
${MATCH_BLOCK}
</div>
${extra ?? ""}</program>
`;

    const plain = matchIn(`<div class="wrap">`);
    const loneIf = matchIn(`<div class="wrap" if=@open>`);
    const ifElse = matchIn(
      `<div class="wrap" if=@open>`,
      `<div class="wrap2" else><p>closed</p></div>\n`,
    );

    const promoteEngine = (source) =>
      withTmp(source, (file, dir) =>
        promoteEngineOnFile(file, null, { dryRun: true }, dir));

    test("finds the site under an if=/else chain (was status:no-sites)", () => {
      const res = promoteEngine(ifElse);
      expect(res.status).not.toBe("no-sites");
      expect(res.count).toBe(1);
    });

    test("PARITY: if=/else matches lone-if= and plain (the oracles)", () => {
      expect(promoteEngine(plain).count).toBe(1);
      expect(promoteEngine(loneIf).count).toBe(1);
      expect(promoteEngine(ifElse).count).toBe(1);
    });
  });
});
