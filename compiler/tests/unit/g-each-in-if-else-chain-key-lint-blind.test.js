/**
 * g-each-in-if-else-chain-key-lint-blind.test.js
 *
 * Fix-round defect 2 on the `g-each-in-if-else-chain-emits-zero-renderers` PR.
 *
 * THE BUG. The PR taught six walks to descend a §17.1.1 `if-chain`'s
 * `branches[].element` + `elseBranch`. `lint-w-each-key.js`'s `walkEachBlocks`
 * has the SAME blind spot and did not get the descent, so a keyless `<each>`
 * under an `if=`/`else` chain produced NO diagnostic at all:
 *
 *   | shape        | before the PR                       | after the PR (pre this fix) |
 *   |--------------|-------------------------------------|-----------------------------|
 *   | plain        | E-DG-002 + W-EACH-KEY-001           | same                        |
 *   | lone `if=`   | W-EACH-KEY-001                      | same                        |
 *   | `if=`/`else` | 2x FALSE E-DG-002, 0 render fns     | NOTHING — 4 render fns      |
 *
 * (Both columns measured by execution against 76f97a59 and the PR branch.)
 *
 * WHY IT GOT WORSE, not merely stayed missing. Before the PR the guarded
 * `<each>` emitted ZERO renderers, so the absent key lint was inert — the list
 * rendered empty and the adopter had a louder problem. After the PR it compiles
 * to a REAL `_scrml_reconcile_list` keyed by INDEX identity, which reuses the
 * wrong DOM node on reorder and on delete-from-the-middle. That is exactly the
 * failure W-EACH-KEY-001 exists to warn about, and the adopter was told nothing.
 *
 * THE FIX reuses the SAME descent, via a shared child-shape enumerator
 * (`ifChainChildNodes`, compiler/src/ast-if-chain.js) that the PR's six walks now
 * also call. One fact, one home — the copy count goes 7 -> 1.
 *
 * VALUE-asserting (R26): compiles real .scrml end-to-end so the `collapseIfChains`
 * restructure that is the actual locus is exercised; a synthesized AST would
 * bypass it.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-keylint-chain-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...r.outputs.values()][0] ?? {};
    return {
      clientJs: out.clientJs ?? "",
      errors: r.errors ?? [],
      warnings: r.warnings ?? [],
      lints: r.lintDiagnostics ?? [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// W-EACH-KEY-001 rides the lint channel; sweep warnings too so a future
// stream re-partition cannot silently blind this gate (S92/S93 lesson).
const keyLints = (r) =>
  [...r.warnings, ...r.lints].filter((d) => (d.code || "") === "W-EACH-KEY-001");

const PRELUDE = `type Todo:struct = { id: string, name: string }
<open>: boolean = true
<todos>: Todo[] = []`;
const P = (body) => `<program>\n${PRELUDE}\n${body}\n</program>\n`;

// No `key=` — the shape W-EACH-KEY-001 exists to flag.
const KEYLESS_EACH = `<ul><each in=@todos><li>\${@.name}</li></each></ul>`;

describe("g-each-in-if-else-chain-key-lint-blind", () => {
  test("keyless <each> under an if=/else chain fires W-EACH-KEY-001", () => {
    const r = compileSource(P(`<div if=@open>\n  ${KEYLESS_EACH}\n</div>\n<div else><p>closed</p></div>`));
    expect(r.errors.length).toBe(0);
    expect(keyLints(r).length).toBe(1);
  });

  test("PARITY: the if=/else count matches the lone-if= and plain counts", () => {
    const plain = compileSource(P(KEYLESS_EACH));
    const loneIf = compileSource(P(`<div if=@open>\n  ${KEYLESS_EACH}\n</div>`));
    const ifElse = compileSource(P(`<div if=@open>\n  ${KEYLESS_EACH}\n</div>\n<div else><p>closed</p></div>`));
    expect(keyLints(plain).length).toBe(1);
    expect(keyLints(loneIf).length).toBe(1);
    expect(keyLints(ifElse).length).toBe(1);
  });

  test("the ELSE branch's own keyless <each> is linted too", () => {
    const r = compileSource(
      P(`<div if=@open><p>open</p></div>\n<div else>\n  ${KEYLESS_EACH}\n</div>`),
    );
    expect(r.errors.length).toBe(0);
    expect(keyLints(r).length).toBe(1);
  });

  test("an else-if= middle branch is descended too", () => {
    const r = compileSource(
      P(`<div if=@open><p>open</p></div>\n<div else-if=@open>\n  ${KEYLESS_EACH}\n</div>\n<div else><p>x</p></div>`),
    );
    expect(r.errors.length).toBe(0);
    expect(keyLints(r).length).toBe(1);
  });

  test("every branch of the chain is reached — three keyless eaches, three lints", () => {
    const r = compileSource(
      P(
        `<div if=@open>\n  ${KEYLESS_EACH}\n</div>\n` +
          `<div else-if=@open>\n  ${KEYLESS_EACH}\n</div>\n` +
          `<div else>\n  ${KEYLESS_EACH}\n</div>`,
      ),
    );
    expect(r.errors.length).toBe(0);
    expect(keyLints(r).length).toBe(3);
  });

  test("NO FALSE POSITIVE: an explicit key= under an if=/else chain stays silent", () => {
    const r = compileSource(
      P(
        `<div if=@open>\n  <ul><each in=@todos key=@.id><li>\${@.name}</li></each></ul>\n</div>\n` +
          `<div else><p>closed</p></div>`,
      ),
    );
    expect(r.errors.length).toBe(0);
    expect(keyLints(r).length).toBe(0);
  });

  test("NO FALSE POSITIVE: the __index__ positional sentinel still suppresses", () => {
    const r = compileSource(
      P(
        `<div if=@open>\n  <ul><each in=@todos key=__index__><li>\${@.name}</li></each></ul>\n</div>\n` +
          `<div else><p>closed</p></div>`,
      ),
    );
    expect(r.errors.length).toBe(0);
    expect(keyLints(r).length).toBe(0);
  });

  test("the guarded <each> really does compile to a keyed reconcile (why the lint matters)", () => {
    const r = compileSource(P(`<div if=@open>\n  ${KEYLESS_EACH}\n</div>\n<div else><p>closed</p></div>`));
    // This is the PR's core fix — asserted here so the lint's premise stays true:
    // the list is NOT inert, it reconciles, and without a key it reconciles by index.
    expect(r.clientJs).toContain("_scrml_reconcile_list");
    expect((r.clientJs.match(/_scrml_each_render_/g) || []).length).toBeGreaterThan(0);
  });
});
