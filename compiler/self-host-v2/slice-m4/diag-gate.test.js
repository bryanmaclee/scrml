// diag-gate.test.js — s451: the bootstrap's DIAGNOSTICS GATE.
//
// Before s451 `lower` returned a Core for every analysis, errors or not, and
// the printer emitted a runnable artifact from it — the shape of
// g-bootstrap-defer-scope-001-and-runs-anyway (`defer` was reported as an
// undeclared name, E-SCOPE-001, and the printed program then ran the deferred
// statements in place). The gate is ONE check at the front end → back end
// hand-off (lower.scrml `hasError`): a diagnostic of §34 severity Error (from
// analysis or the parser) lowers to NO Core — and the printer only takes a Core,
// so there is nothing to print. It is not a per-code list: every error closes it.
// s451-boot-diag-severity: the test is the Diag's SEVERITY (severity.scrml, the
// table generated from §34), not the `E-` prefix — §34: "A code whose Severity
// column reads **Error** fails the compile, and a compile that reports one SHALL
// NOT produce a runnable artifact (§2.2.1). **Warning** and **Info** codes do not
// fail the compile." So Warning / Info diagnostics do not close it.

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const P = (decls, main) => `<program>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const printable = (r) => mods.print.printProgram(r.core, "t.client.js", "scrml-runtime.js").js;

describe("an error lowers to no Core — nothing to print", () => {
  test("E-SCOPE-001 (an analysis error): no Core", () => {
    const r = run(P(`    let <n:int=0/>\n    function go() { @n = nope + 1 }`, `        <button onclick=go()>go</button>`));
    expect(r.diags.map((d) => d.code)).toEqual(["E-SCOPE-001"]);
    expect(r.core == null).toBe(true);
  });

  test("a parse error: no Core", () => {
    const r = run(P(`    let <n:int=0/>\n    function go() { @n = (1 + }`, `        <p>\${@n}</p>`));
    expect(r.diags.length).toBeGreaterThan(0);
    expect(r.diags.every((d) => d.severity === "Error")).toBe(true);
    expect(r.core == null).toBe(true);
  });

  test("E-BOOTSTRAP-UNSUPPORTED (a refusal): no Core", () => {
    const r = run(P(`    let <n:int=0/>`, `        <request id="u" url="/x"/>`));
    expect(r.diags.map((d) => d.code)).toEqual(["E-BOOTSTRAP-UNSUPPORTED"]);
    expect(r.core == null).toBe(true);
  });

  test("an error alongside a warning: still no Core", () => {
    const r = run(P(`    let <n:int=0/>\n    <effect deps=[@n]/>\n    function go() { @n = nope }`, `        <p>\${@n}</p>`));
    expect(r.diags.map((d) => d.code).sort()).toEqual(["E-SCOPE-001", "W-LIFECYCLE-010"]);
    expect(r.core == null).toBe(true);
  });
});

describe("twins — non-fatal notes do not close the gate", () => {
  test("a clean program lowers and prints", () => {
    const r = run(P(`    let <n:int=0/>\n    function go() { @n = @n + 1 }`, `        <button onclick=go()>go</button>\n        <p>\${@n}</p>`));
    expect(r.diags).toEqual([]);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    expect(printable(r)).toContain("function go(");
  });

  test("a W- warning only (W-LIFECYCLE-010): the program still lowers and prints", () => {
    const r = run(P(`    let <n:int=0/>\n    <effect deps=[@n]/>`, `        <p>\${@n}</p>`));
    expect(r.diags.map((d) => d.code)).toEqual(["W-LIFECYCLE-010"]);
    expect(r.core == null).toBe(false);
    expect(mods.check.checkCore(r.core)).toEqual([]);
    expect(printable(r).length).toBeGreaterThan(0);
  });
});
