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
import { bootstrapCodes, resolveSeverities, render, PROVISIONAL } from "../../../scripts/gen-bootstrap-severity.ts";

const SHV2 = join(import.meta.dir, "..");
const SPEC_TEXT = readFileSync(join(SHV2, "..", "SPEC.md"), "utf8");

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "t.scrml", src }]);
const P = (attrs, decls, main) => `<program${attrs}>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;

describe("the table is §34's, and current", () => {
  // No byte-equality check against a fresh generation here: a docs-only SPEC PR adding a §34 row
  // (same severity) for a row-less code would go red for a change that alters no answer. Byte
  // staleness is TRACKED in CI's non-blocking job (`gen-bootstrap-severity.ts --check`); this file
  // checks the SEMANTICS — every answer the compiled table gives is §34's.

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

// s469-boot-strings-1 (F/U-7) — the PROVISIONAL table (a code with no §34 row YET) can never weaken §34
// or go stale silently: each guard THROWS.
describe("the PROVISIONAL table's guards", () => {
  const spec = (rows) => ["## 34. Diagnostics", "", "| Code | Section | Trigger | Severity |", "|---|---|---|---|", ...rows, "", "## 35. Next", ""].join("\n");
  test("W-STRING-INTERP-LITERAL is provisional, a Warning, and the compiled table answers it", () => {
    expect(PROVISIONAL["W-STRING-INTERP-LITERAL"]).toBe("Warning");
    const { entries } = resolveSeverities(SPEC_TEXT, bootstrapCodes());
    expect(entries.find((e) => e.code === "W-STRING-INTERP-LITERAL")).toMatchObject({ severity: "Warning", provisional: true });
    expect(mods.severity.severityOf("W-STRING-INTERP-LITERAL")).toBe("Warning");
  });
  test("once a §34 row exists the provisional entry is stale: it throws whether the row AGREES or not", () => {
    const t = { "W-X-ONE": "Warning" };
    expect(() => resolveSeverities(spec(["| W-X-ONE | §1 | t | Warning |"]), ["W-X-ONE"], t)).toThrow("row exists");
    expect(() => resolveSeverities(spec(["| W-X-ONE | §1 | t | Info |"]), ["W-X-ONE"], t)).toThrow("row exists");
    // with the entry removed, the row decides
    expect(resolveSeverities(spec(["| W-X-ONE | §1 | t | Warning |"]), ["W-X-ONE"], {}).entries[0]).toMatchObject({ severity: "Warning" });
  });
  test("a STRUCK or non-compile §34 row for a provisional code throws (no silent fall-through to Error)", () => {
    const t = { "W-X-ONE": "Warning" };
    expect(() => resolveSeverities(spec(["| ~~W-X-ONE~~ | §1 | t | Warning |"]), ["W-X-ONE"], t)).toThrow("§34 row struck");
    expect(() => resolveSeverities(spec(["| W-X-ONE | §1 | t | Runtime |"]), ["W-X-ONE"], t)).toThrow("not a compile severity");
  });
  test("an E- code may not be downgraded by the table", () => {
    expect(() => resolveSeverities(spec([]), ["E-X-ONE"], { "E-X-ONE": "Warning" })).toThrow("may not be downgraded");
    expect(() => resolveSeverities(spec([]), ["E-X-ONE"], { "E-X-ONE": "Info" })).toThrow("may not be downgraded");
  });
  test("a provisional code the bootstrap no longer names throws (render checks the whole code set)", () => {
    expect(() => render(spec([]), ["W-OTHER"], { "W-X-GONE": "Warning" })).toThrow("no longer name it");
    expect(() => render(spec([]), ["W-X-ONE"], { "W-X-ONE": "Warning" })).not.toThrow();
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
