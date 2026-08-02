// §6.7.2 / §6.7.3 — cleanup() argument-shape and scope diagnostics (S310, W1 of the §34
// catalog-truthfulness arc). E-LIFECYCLE-001/002/004 were CATALOGUED with normative SHALLs and had
// no emitter; cleanup() itself was fully wired (keyword -> parse -> _scrml_register_cleanup), so
// only the validation was missing.
//
// The false-positive guards are the load-bearing half: this is a NEWLY-REJECTING change, so the
// legitimate shapes adopters write must stay clean.
import { test, expect, describe } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "cleanup-diag-"));
let n = 0;
const codes = (src) => {
  const fp = join(TMP, `c${++n}.scrml`);
  writeFileSync(fp, src);
  const r = compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  return [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code);
};
const inScope = (body) => `<program>\n  <div>\n    \${\n${body}\n    }\n  </div>\n</program>\n`;

describe("cleanup() argument shape", () => {
  test("E-LIFECYCLE-002 — a CALL expression fires (the eager-invoke footgun)", () => {
    const c = codes(inScope(`      function closeConnection() { return 1 }\n      cleanup(closeConnection())`));
    expect(c).toContain("E-LIFECYCLE-002");
    expect(c).not.toContain("E-LIFECYCLE-004");
  });

  test("E-LIFECYCLE-004 — a literal fires", () => {
    expect(codes(inScope(`      cleanup(42)`))).toContain("E-LIFECYCLE-004");
  });

  test("E-LIFECYCLE-004 — zero arguments fires", () => {
    expect(codes(inScope(`      cleanup()`))).toContain("E-LIFECYCLE-004");
  });
});

describe("cleanup() scope", () => {
  test("E-LIFECYCLE-001 — file-level cleanup fires, with a VALID argument", () => {
    // the argument is a legal function reference, isolating this to the scope rule
    const src = `\${\n  function teardown() { return 1 }\n  cleanup(teardown)\n}\n<program>\n  <div>ok</div>\n</program>\n`;
    const c = codes(src);
    expect(c).toContain("E-LIFECYCLE-001");
    expect(c).not.toContain("E-LIFECYCLE-002");
    expect(c).not.toContain("E-LIFECYCLE-004");
  });
});

describe("FALSE-POSITIVE GUARDS — the legitimate forms stay clean", () => {
  test("arrow expression is accepted", () => {
    const c = codes(inScope(`      function teardown() { return 1 }\n      cleanup(() => { teardown() })`));
    expect(c.filter((x) => x.startsWith("E-LIFECYCLE-"))).toEqual([]);
  });

  test("bare function reference is accepted", () => {
    const c = codes(inScope(`      function teardown() { return 1 }\n      cleanup(teardown)`));
    expect(c.filter((x) => x.startsWith("E-LIFECYCLE-"))).toEqual([]);
  });

  test("a member-expression callback is accepted (conservative: could be a function)", () => {
    const c = codes(inScope(`      cleanup(handlers.teardown)`));
    expect(c.filter((x) => x.startsWith("E-LIFECYCLE-"))).toEqual([]);
  });
});
