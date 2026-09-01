/**
 * g-if-chain-branch-decl-invisible-to-ts.test.js
 *
 * THE BUG (HIGH — conformance restoration, both directions).
 *
 * `collapseIfChains` (ast-builder.js) rewrites an `if=`/`else-if=`/`else` chain
 * that HAS an else arm into `{kind:"if-chain", branches:[{condition, element}],
 * elseBranch}`. Neither field is reachable by a walk that recurses ARRAY fields
 * whose entries carry a `.kind`: `branches` holds `{condition, element}`
 * RECORDS (no `kind`) and `elseBranch` is a single object, not an array.
 *
 * `type-system.ts`'s `visitNode` had no `case "if-chain"`, so the node fell to
 * `default` — which does exactly that array-of-kinded-nodes recursion. **The
 * whole chain subtree was UNVISITED**, and that is two defects, not one:
 *
 *   | shape        | decl-in-branch, read outside | undeclared read IN branch |
 *   |--------------|------------------------------|---------------------------|
 *   | plain        | n/a                          | E-STATE-UNDECLARED        |
 *   | lone `if=`   | clean (correct)              | E-STATE-UNDECLARED        |
 *   | `if=`/`else` | FALSE E-STATE-UNDECLARED     | NOTHING (emits a live get)|
 *
 * (Both columns measured by execution against 8a677477 and this branch.)
 *
 * The false positive REJECTS A LEGAL PROGRAM. SPEC §6.1.1 declares the
 * structural `<name>` form and the §6.1.2 Read bullet says a read is legal when
 * "a structural `<varname>` declaration (§6.1.1) … SHALL be in scope". The
 * declaration IS in scope; the compiler could not see it. So this is
 * conformance restoration, not a language change.
 *
 * The false negative is the same hole read from the other side: the read
 * compiled clean and emitted `_scrml_cs_reactive_get("nope")` into client.js.
 *
 * `symbol-table.ts` PASS 1 carried the identical blind spot in its own
 * container list (`children`/`body`/`consequent`/`alternate`/`arms[].body`/
 * `engine-decl.bodyChildren`), and it is separately observable: a `<m>`
 * declared inside a branch was never registered, so a colliding `let m`
 * elsewhere in the file lost its `E-NAME-COLLIDES-STATE`.
 *
 * A lone `if=` is never collapsed, which is why "add a `<div else>` sibling" is
 * the ONE-VARIABLE discriminator for every member of this class, and why the
 * lone-`if=` shape is the parity oracle each test below asserts against.
 *
 * THE FIX routes both walks through `ifChainChildNodes`
 * (compiler/src/ast-if-chain.js) — the shared child-shape enumerator PR #805
 * extracted — rather than hand-rolling a seventh and eighth copy of the fact.
 *
 * VALUE-asserting (R26): compiles real .scrml end-to-end, so the
 * `collapseIfChains` restructure that is the actual locus is exercised. A
 * synthesized AST would bypass it entirely.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-ifchain-ts-"));
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

// Diagnostics ride three streams (S92/S93 partition); sweep all of them so a
// future re-partition cannot silently blind these gates.
const codes = (r, code) =>
  [...r.errors, ...r.warnings, ...r.lints].filter((d) => (d.code || "") === code);

const P = (body) => `<program>\n<open>: boolean = true\n${body}\n</program>\n`;

// The declaration under test, in a `${…}` logic island inside the branch body.
const DECL_BRANCH = `<div if=@open>\${ <m>: [string: number] = [:] }</div>`;
const ELSE_ARM = `<div else><p>closed</p></div>`;
const OUTER_READ = `<p>\${@m.size}</p>`;

describe("g-if-chain-branch-decl-invisible-to-ts", () => {
  test("a <m> declared inside an if=/else branch is in scope for a later read", () => {
    const r = compileSource(P(`${DECL_BRANCH}\n${ELSE_ARM}\n${OUTER_READ}`));
    expect(codes(r, "E-STATE-UNDECLARED").length).toBe(0);
    expect(r.errors.length).toBe(0);
  });

  test("PARITY: the if=/else shape matches the lone-if= shape (the oracle)", () => {
    const loneIf = compileSource(P(`${DECL_BRANCH}\n${OUTER_READ}`));
    const ifElse = compileSource(P(`${DECL_BRANCH}\n${ELSE_ARM}\n${OUTER_READ}`));
    // The lone `if=` is never collapsed by `collapseIfChains`, so it is the
    // shape whose behaviour was always correct. The only variable between the
    // two sources is the `<div else>` sibling.
    expect(loneIf.errors.length).toBe(0);
    expect(codes(ifElse, "E-STATE-UNDECLARED").length)
      .toBe(codes(loneIf, "E-STATE-UNDECLARED").length);
  });

  test("the FALSE-NEGATIVE side: an undeclared read INSIDE a branch still fires", () => {
    const BAD = `<div if=@open><p>\${@nope}</p></div>`;
    const loneIf = compileSource(P(BAD));
    const ifElse = compileSource(P(`${BAD}\n${ELSE_ARM}`));
    // Pre-fix the chain subtree was unvisited, so the `if=`/`else` shape fired
    // NOTHING and shipped a live `_scrml_cs_reactive_get("nope")` anyway.
    expect(codes(loneIf, "E-STATE-UNDECLARED").length).toBe(1);
    expect(codes(ifElse, "E-STATE-UNDECLARED").length).toBe(1);
  });

  // The CHAIN PREDICATE surface. Pinned because the original scope comment on
  // the `case "if-chain"` arm claimed this was still an open gap, and it is
  // not — the predicate is an ATTRIBUTE on `branches[].element`, so visiting
  // the branch body routes it through the markup case's `n.attrs` loop.
  // `branches[].condition` is a redundant second copy, not the only path.
  // This entire commit's corpus migration (8 new E-SCOPE-001 across 6 files)
  // is attribute-position on chain members; ZERO came from a branch body. If
  // someone later "closes the condition gap", these must stay at exactly 1 —
  // a second visit would DOUBLE-report every chain predicate.
  test("a chain predicate reading an undeclared cell is scope-checked", () => {
    const bad = `<div if=@open><p>a</p></div>
<div else-if=@typocell><p>b</p></div>
<div else><p>c</p></div>`;
    const r = compileSource(P(bad));
    expect(codes(r, "E-SCOPE-001").length).toBe(1);
  });

  test("NO DOUBLE-REPORT: each chain predicate is reported exactly once", () => {
    const twoBad = `<div if=@typoOne><p>a</p></div>
<div else-if=@typoTwo><p>b</p></div>
<div else><p>c</p></div>`;
    const r = compileSource(P(twoBad));
    expect(codes(r, "E-SCOPE-001").length).toBe(2);
  });

  test("symbol-table PASS 1 registers the branch decl (E-NAME-COLLIDES-STATE)", () => {
    // A `let m` local colliding with the branch-declared `<m>` cell. PASS 2
    // reaches the function body either way; what changed is whether PASS 1 had
    // REGISTERED `<m>` for it to collide with.
    const FN = "${\n  fn touch() {\n    let m = 2\n    log(m)\n  }\n}";
    const DECL = `<div if=@open>\${ <m> = 1 }</div>`;
    const loneIf = compileSource(P(`${DECL}\n${FN}\n<p>\${@m}</p>`));
    const ifElse = compileSource(P(`${DECL}\n${ELSE_ARM}\n${FN}\n<p>\${@m}</p>`));
    expect(codes(loneIf, "E-NAME-COLLIDES-STATE").length).toBe(1);
    expect(codes(ifElse, "E-NAME-COLLIDES-STATE").length).toBe(1);
  });
});
