// s34-catalog.test.js — the §34 row parser (scripts/s34-catalog.ts) reads the Severity COLUMN the
// table header names, never "the last non-empty cell" (s451-boot-diag-severity review nit): with an
// empty Severity cell that rule read the trigger text, so a trigger beginning "Warning…" became a
// Warning — fail-OPEN for the bootstrap's generated severity table, whose no-severity answer is Error.

import { describe, test, expect } from "bun:test";
import { parseS34Rows, compileSeverityOf, severityCell } from "../../../scripts/s34-catalog.ts";

const spec = (...rows) => [
  "## 34. Error Codes",
  "",
  "| Code | Section | Trigger | Severity |",
  "|---|---|---|---|",
  ...rows,
  "",
  "## 35. Next",
];
const one = (row) => parseS34Rows(spec(row))[0];

describe("§34 Severity column", () => {
  test("an ordinary row reads its Severity cell", () => {
    expect(one("| E-A-001 | §1 | something | Error |").severity).toBe("Error");
    expect(compileSeverityOf(one("| W-A-002 | §1 | something | Info |"))).toBe("Info");
  });

  test("an EMPTY Severity cell is empty — not the trigger text — and states no compile severity", () => {
    for (const row of ["| W-A-003 | §1 | Warning when the thing happens |  |", "| W-A-003 | §1 | Info about it | |"]) {
      const r = one(row);
      expect(r.severity).toBe("");
      expect(compileSeverityOf(r)).toBe(null);
    }
  });

  test("a row with no trailing pipe still reads the Severity column", () => {
    expect(one("| E-A-004 | §1 | something | Error").severity).toBe("Error");
  });

  test("a `|` inside the trigger text: the Severity column is indexed from the end", () => {
    expect(one("| E-A-005 | §1 | a `T | not` union | Warning |").severity).toBe("Warning");
  });

  test("a qualified cell reads by its leading word; Runtime / struck state none", () => {
    expect(compileSeverityOf(one("| E-A-006 | §1 | x | Error (reserved) |"))).toBe("Error");
    expect(compileSeverityOf(one("| E-A-007 | §1 | x | Runtime |"))).toBe(null);
    expect(compileSeverityOf(one("| ~~E-A-008~~ | §1 | retired | Error |"))).toBe(null);
  });

  test("a table with no Severity column, or a row outside any table header, has no severity", () => {
    expect(severityCell("| E-A-009 | §1 | x |", ["Code", "Section", "Trigger"])).toBe("");
    expect(severityCell("| E-A-009 | §1 | x | Error |", null)).toBe("");
  });
});
