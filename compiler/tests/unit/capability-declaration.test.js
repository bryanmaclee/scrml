// ---------------------------------------------------------------------------
// §23.5 Capability Declaration — the V1-floor security-vocab DECLARATION half
// (impl wave 2026-07-10; S232 landed the SPEC text-only).
//
// Covers:
//   - Item 1/2: `capabilities=[…]` is recognized (no W-ATTR-001) and special-
//     parsed as a capability-token LIST (no misleading fatal E-SCOPE-001).
//   - Item 3: token validation against the CLOSED v1 vocab {network, fs-read,
//     fs-write, spawn, env, db} → E-FOREIGN-CAPABILITY-UNKNOWN on an unknown token.
//   - Item 4: W-FOREIGN-UNDECLARED-CAPABILITY (Info) on a foreign construct
//     governed by an empty set; suppressible via §28 knob.
//   - Item 5: §23.5.4 closest-ancestor-wins inheritance (NO union).
//
// The pre-impl-wave bug (the regression anchor): the SPEC §23.5.2 worked example
// `capabilities=[network("api.example.com")]` HARD-FAILED with a fatal, misleading
// E-SCOPE-001 (`network` undeclared) + a W-ATTR-001 unknown-attribute warning,
// because the bracket value was parsed as a general array-expression.
// ---------------------------------------------------------------------------

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "capability-decl-"));

function compile(src, compilerSettings) {
  const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(p, src);
  const opts = { inputFiles: [p], write: false, outputDir: join(TMP, "out"), log: () => {} };
  if (compilerSettings) opts.compilerSettings = compilerSettings;
  return compileScrml(opts);
}

// Cross-stream collector — W-FOREIGN-UNDECLARED-CAPABILITY (Info) lands in
// result.warnings; E-FOREIGN-CAPABILITY-UNKNOWN (Error) lands in result.errors.
// Collect BOTH so assertions never silently pass (memory: diagnostic-stream
// partition — result.errors.filter(W-…) is a false-negative trap).
function allDiagnostics(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}
function codeCount(result, code) {
  return allDiagnostics(result).filter((d) => (d.code ?? "") === code).length;
}
function hasCode(result, code) {
  return codeCount(result, code) > 0;
}

// ---------------------------------------------------------------------------
// Item 1 + 2 — recognition + special-parse (the fail-closed-Nominal invariant)
// ---------------------------------------------------------------------------
describe("§23.5.2 recognition + special-parse — SPEC-valid declarations compile clean", () => {
  test("the SPEC worked example `capabilities=[network(\"api.example.com\")]` fires NO E-SCOPE-001 and NO W-ATTR-001", () => {
    const r = compile(`<program capabilities=[network("api.example.com")]>\n<div>hi</div>\n</>\n`);
    expect(hasCode(r, "E-SCOPE-001")).toBe(false);
    expect(hasCode(r, "W-ATTR-001")).toBe(false);
    expect(hasCode(r, "E-FOREIGN-CAPABILITY-UNKNOWN")).toBe(false);
  });

  test("explicit empty `capabilities=[]` is clean (declare-nothing, no foreign → no lint)", () => {
    const r = compile(`<program capabilities=[]>\n<div>hi</div>\n</>\n`);
    expect(hasCode(r, "E-SCOPE-001")).toBe(false);
    expect(hasCode(r, "W-ATTR-001")).toBe(false);
    expect(hasCode(r, "E-FOREIGN-CAPABILITY-UNKNOWN")).toBe(false);
    expect(hasCode(r, "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(false);
  });

  test("multi-token `[fs-read(\"/etc/x\"), spawn, db]` — hyphenated + arg-less + presence-only all parse clean", () => {
    const r = compile(`<program capabilities=[fs-read("/etc/x"), spawn, db]>\n<div>hi</div>\n</>\n`);
    expect(hasCode(r, "E-SCOPE-001")).toBe(false);
    expect(hasCode(r, "W-ATTR-001")).toBe(false);
    expect(hasCode(r, "E-FOREIGN-CAPABILITY-UNKNOWN")).toBe(false);
  });

  test("all six v1 tokens in one list compile clean", () => {
    const r = compile(
      `<program capabilities=[network("a.com"), fs-read("/etc/x"), fs-write("/var/y"), spawn("ls"), env("HOME"), db]>\n<div>hi</div>\n</>\n`,
    );
    expect(hasCode(r, "E-FOREIGN-CAPABILITY-UNKNOWN")).toBe(false);
    expect(hasCode(r, "E-SCOPE-001")).toBe(false);
  });

  test("capabilities= is consumed — its tokens do NOT leak into the emitted client JS/HTML", () => {
    const p = join(TMP, `leak-${Math.random().toString(36).slice(2)}.scrml`);
    writeFileSync(p, `<program capabilities=[network("api.example.com")]>\n<div>hi</div>\n</>\n`);
    const r = compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out"), log: () => {} });
    const out = r.outputs.get(p) ?? {};
    expect(out.clientJs ?? "").not.toContain("capabilities");
    expect(out.html ?? "").not.toContain("capabilities");
  });
});

// ---------------------------------------------------------------------------
// Item 3 — token validation against the closed v1 vocab (§23.5.3 / §23.5.7)
// ---------------------------------------------------------------------------
describe("§23.5.3/.7 E-FOREIGN-CAPABILITY-UNKNOWN — closed-vocab validation", () => {
  test("an unknown token (`teleport`) fires E-FOREIGN-CAPABILITY-UNKNOWN, NOT E-SCOPE-001", () => {
    const r = compile(`<program capabilities=[teleport]>\n<div>hi</div>\n</>\n`);
    expect(hasCode(r, "E-FOREIGN-CAPABILITY-UNKNOWN")).toBe(true);
    expect(hasCode(r, "E-SCOPE-001")).toBe(false);
    expect(hasCode(r, "W-ATTR-001")).toBe(false);
  });

  test("E-FOREIGN-CAPABILITY-UNKNOWN is a fatal Error (lands in result.errors, names the vocabulary)", () => {
    const r = compile(`<program capabilities=[teleport]>\n<div>hi</div>\n</>\n`);
    const e = (r.errors ?? []).find((d) => d.code === "E-FOREIGN-CAPABILITY-UNKNOWN");
    expect(e).toBeTruthy();
    expect(e.message).toContain("network, fs-read, fs-write, spawn, env, db");
  });

  test("one bad token among valid ones fires exactly once, for the bad token", () => {
    const r = compile(`<program capabilities=[network("a.com"), warpdrive, db]>\n<div>hi</div>\n</>\n`);
    expect(codeCount(r, "E-FOREIGN-CAPABILITY-UNKNOWN")).toBe(1);
    const e = (r.errors ?? []).find((d) => d.code === "E-FOREIGN-CAPABILITY-UNKNOWN");
    expect(e.message).toContain("`warpdrive`");
  });
});

// ---------------------------------------------------------------------------
// Item 4 — W-FOREIGN-UNDECLARED-CAPABILITY presence-nudge (§23.5.5) + §28 suppress
// ---------------------------------------------------------------------------
describe("§23.5.5 W-FOREIGN-UNDECLARED-CAPABILITY — presence-nudge lint", () => {
  const FOREIGN_UNDECLARED = `<program lang="ts">\nuse foreign:ml { predict }\n<div>hi</div>\n</>\n`;

  test("a foreign construct under an EMPTY set fires W-FOREIGN-UNDECLARED-CAPABILITY (Info)", () => {
    const r = compile(FOREIGN_UNDECLARED);
    expect(hasCode(r, "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(true);
    const w = (r.warnings ?? []).find((d) => d.code === "W-FOREIGN-UNDECLARED-CAPABILITY");
    expect(w).toBeTruthy();
    expect(w.severity).toBe("info");
  });

  test("the lint is NON-fatal — it lands in result.warnings, NOT result.errors", () => {
    const r = compile(FOREIGN_UNDECLARED);
    expect((r.errors ?? []).some((d) => d.code === "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(false);
    expect((r.warnings ?? []).some((d) => d.code === "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(true);
  });

  test("declaring a non-empty capabilities= set on the enclosing <program> SUPPRESSES the lint", () => {
    const r = compile(`<program lang="ts" capabilities=[network("api.example.com")]>\nuse foreign:ml { predict }\n<div>hi</div>\n</>\n`);
    expect(hasCode(r, "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(false);
  });

  test("§28 knob `lint.foreign-undeclared-capability = off` suppresses the lint", () => {
    const r = compile(FOREIGN_UNDECLARED, { lintForeignUndeclaredCapability: "off" });
    expect(hasCode(r, "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(false);
  });

  test("no foreign construct → no lint (presence-keyed, not declaration-keyed)", () => {
    const r = compile(`<program capabilities=[]>\n<div>hi</div>\n</>\n`);
    expect(hasCode(r, "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Item 5 — §23.5.4 closest-ancestor-wins inheritance (NO union)
// ---------------------------------------------------------------------------
describe("§23.5.4 capability inheritance — closest-ancestor-wins, no union", () => {
  test("inner foreign INHERITS the outer's non-empty set (no re-declaration) → NO lint", () => {
    const r = compile(
      `<program capabilities=[network("api.example.com")]>\n` +
      `  <program name="probe" lang="ts">\n` +
      `    use foreign:probe { run }\n` +
      `  </>\n</>\n`,
    );
    expect(hasCode(r, "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(false);
  });

  test("inner explicit `[]` REPLACES the outer set (NO union) → foreign under empty → lint FIRES", () => {
    const r = compile(
      `<program capabilities=[network("api.example.com")]>\n` +
      `  <program name="svc" lang="ts" capabilities=[]>\n` +
      `    use foreign:svc { run }\n` +
      `  </>\n</>\n`,
    );
    // If the sets unioned, the outer `network` would cover the inner foreign and
    // this would NOT fire. It fires → closest-wins-no-union is proven.
    expect(hasCode(r, "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(true);
  });

  test("inner NON-empty re-declaration covers its own foreign → NO lint", () => {
    const r = compile(
      `<program capabilities=[]>\n` +
      `  <program name="svc" lang="ts" capabilities=[fs-read("/etc/svc"), spawn]>\n` +
      `    use foreign:svc { run }\n` +
      `  </>\n</>\n`,
    );
    expect(hasCode(r, "W-FOREIGN-UNDECLARED-CAPABILITY")).toBe(false);
  });
});
