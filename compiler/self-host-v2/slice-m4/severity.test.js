// severity.test.js — s451-boot-diag-severity: every bootstrap diagnostic carries
// its §34 SEVERITY, derived from its code by ONE generated table.
//
// §34 (S451): "A code whose Severity column reads **Error** fails the compile,
// and a compile that reports one SHALL NOT produce a runnable artifact (§2.2.1).
// **Warning** and **Info** codes do not fail the compile."
//
// The table is compiler/self-host-v2/severity.scrml, GENERATED from SPEC §34 by
// scripts/gen-bootstrap-severity.ts (the §34 rows parsed by scripts/s34-catalog.ts,
// the parser the §34 census uses). ast.scrml `newDiag` is the one Diag
// constructor and reads it, so no call site states a severity.

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadM2, frontEnd } from "./harness.js";
import { render, bootstrapCodes, resolveSeverities, SEVERITY_FILE } from "../../../scripts/gen-bootstrap-severity.ts";

const SHV2 = join(import.meta.dir, "..");
const SPEC_TEXT = readFileSync(join(SHV2, "..", "SPEC.md"), "utf8");

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const P = (attrs, decls, main) => `<program${attrs}>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;

describe("the table is §34's, and current", () => {
  test("severity.scrml is exactly what the generator renders from SPEC.md + the bootstrap sources", () => {
    // Stale → run `bun scripts/gen-bootstrap-severity.ts`.
    expect(readFileSync(SEVERITY_FILE, "utf8")).toBe(render(SPEC_TEXT, bootstrapCodes()));
  });

  test("the COMPILED table answers §34's severity for every code the bootstrap names; no row → Error (fail closed)", () => {
    const codes = bootstrapCodes();
    const { entries, gaps } = resolveSeverities(SPEC_TEXT, codes);
    expect(entries.length + gaps.length).toBe(codes.length);
    for (const e of entries) expect([e.code, mods.severity.severityOf(e.code)]).toEqual([e.code, e.severity]);
    for (const g of gaps) expect([g.code, mods.severity.severityOf(g.code)]).toEqual([g.code, "Error"]);
    expect(mods.severity.severityOf("E-NO-SUCH-CODE-ANYWHERE")).toBe("Error");
    expect(mods.severity.severityOf("W-NO-SUCH-CODE-ANYWHERE")).toBe("Error");
  });

  test("the prefix is not the severity: §34 rows that disagree with their prefix resolve by the row", () => {
    const { entries } = resolveSeverities(SPEC_TEXT, ["E-DG-002", "W-MATCH-ARROW-LEGACY", "W-LIFECYCLE-010", "I-FORM-SUBMIT-GATED"]);
    expect(Object.fromEntries(entries.map((e) => [e.code, e.severity]))).toEqual({
      "E-DG-002": "Warning", "W-MATCH-ARROW-LEGACY": "Info", "W-LIFECYCLE-010": "Warning", "I-FORM-SUBMIT-GATED": "Info",
    });
  });

  test("no call site builds a Diag: the only `severity:` / `message:` struct fields are ast.scrml's Diag + newDiag", () => {
    for (const f of readdirSync(SHV2).filter((n) => n.endsWith(".scrml") && n !== "ast.scrml" && n !== "severity.scrml")) {
      const code = readFileSync(join(SHV2, f), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      expect([f, /\b(message|severity):\s/.test(code)]).toEqual([f, false]);
    }
  });
});

describe("every diagnostic carries its §34 severity", () => {
  test("Error: E-SCOPE-001", () => {
    const r = run(P(``, `    let <n:int=0/>\n    function go() { @n = nope + 1 }`, `        <button onclick=go()>go</button>`));
    expect(r.diags.map((d) => [d.code, d.severity])).toEqual([["E-SCOPE-001", "Error"]]);
  });

  test("Error: a parse diagnostic (no §34 row → fail closed)", () => {
    const r = run(P(``, `    let <n:int=0/>\n    function go() { @n = (1 + }`, `        <p>\${@n}</p>`));
    expect(r.diags.length).toBeGreaterThan(0);
    expect(r.diags.every((d) => d.severity === "Error")).toBe(true);
  });

  test("Warning: W-ATTR-001, W-STORY-ON-TOP-LEVEL, W-LIFECYCLE-010 — and each still lowers (no Error)", () => {
    for (const [attrs, decls, want] of [
      [` foo="x"`, `    let <n:int=0/>`, "W-ATTR-001"],
      [` story="s"`, `    let <n:int=0/>`, "W-STORY-ON-TOP-LEVEL"],
      [``, `    let <n:int=0/>\n    <effect deps=[@n]/>`, "W-LIFECYCLE-010"],
    ]) {
      const r = run(P(attrs, decls, `        <p>\${@n}</p>`));
      expect(r.diags.map((d) => [d.code, d.severity])).toEqual([[want, "Warning"]]);
      expect(r.core == null).toBe(false);
    }
  });
});
