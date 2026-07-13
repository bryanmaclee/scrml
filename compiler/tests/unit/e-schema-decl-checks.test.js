/**
 * `<schema>` declaration validation — E-SCHEMA-001 / E-SCHEMA-002 /
 * W-SCHEMA-001 (wire-sql-schema-static-checks-2026-07-13).
 *
 * These three static diagnostics are catalogued in SPEC §39.12 but had zero
 * emit sites in `compiler/src` before this change. They are wired in
 * `gauntlet-phase1-checks.js` (`checkSchemaDeclarations`, Check 5) at the GCP1
 * stage (post-TAB structural pre-pass), mirroring the existing E-SCHEMA-003
 * placement walker.
 *
 * SPEC authority:
 *   - E-SCHEMA-001 — §39.3: a `<schema>` is valid only inside a file whose
 *                    `<program>` root has a `db=` attribute.
 *   - E-SCHEMA-002 — §39.3: a file SHALL NOT contain more than one `<schema>`.
 *   - W-SCHEMA-001 — §39.5.1: a table declaration with no `primary key`
 *                    column (Warning; routes to result.warnings).
 *
 * NOTE: E-SCHEMA-006 (references target) is NOT wired — §39.5.5 permits a
 * `references` target to be a table in the EXISTING database schema when it is
 * not being re-created, so a within-block-only static check false-positives on
 * a valid incremental-migration schema. It re-scopes to the real-DB adapter
 * work where live-DB context is available.
 *
 * NOTE: E-SCHEMA-004 (unrecognized column type, §39.4) is deliberately NOT
 * wired — strict §39.4 enforcement fires on the pervasive corpus convention of
 * JS-style schema types (`string`/`number`/`int`) and requires a separate
 * corpus migration. All schema fixtures below use only §39.4-legal types
 * (`integer`/`text`) so they stay forward-compatible with a future E-SCHEMA-004.
 */

import { describe, test, expect } from "bun:test";
import { join } from "path";
import { writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP_COUNTER = 0;

function compileFromString(source, testName) {
  const TMP = mkdtempSync(join(tmpdir(), `e-schema-decl-${testName}-${++TMP_COUNTER}-`));
  const filePath = join(TMP, `${testName}.scrml`);
  writeFileSync(filePath, source);
  try {
    return compileScrml({
      inputFiles: [filePath],
      write: false,
      outputDir: join(TMP, "out"),
      log: () => {},
    });
  } finally {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  }
}

/** Codes across BOTH diagnostic streams (W-/I- codes land in warnings). */
function allCodes(result) {
  return [...(result.errors || []), ...(result.warnings || [])].map((e) => e.code);
}

describe("E-SCHEMA-001 — <schema> requires <program db=> anchor (§39.3)", () => {
  test("fires when the enclosing <program> root has no db= attribute", () => {
    const src = `<program>
  <schema>
    users { id: integer primary key
      email: text not null }
  </>
</program>`;
    const codes = allCodes(compileFromString(src, "001-nodb"));
    expect(codes).toContain("E-SCHEMA-001");
  });

  test("does NOT fire when <program db=> is present (canonical §39.2 shape)", () => {
    const src = `<program db="./app.db">
  <schema>
    users { id: integer primary key
      email: text not null }
  </>
</program>`;
    const codes = allCodes(compileFromString(src, "001-control"));
    expect(codes).not.toContain("E-SCHEMA-001");
  });

  test("does NOT double-report on a standalone (no-<program>) schema — that stays E-SCHEMA-003", () => {
    const src = `<schema>
  users { id: integer primary key }
</>`;
    const codes = allCodes(compileFromString(src, "001-standalone"));
    // Placement (E-SCHEMA-003) owns the no-<program> case; E-SCHEMA-001 is scoped
    // to a present-but-db-less <program>.
    expect(codes).not.toContain("E-SCHEMA-001");
    expect(codes).toContain("E-SCHEMA-003");
  });
});

describe("E-SCHEMA-002 — at most one <schema> block per file (§39.3)", () => {
  test("fires on the second <schema> block in the same file", () => {
    const src = `<program db="./app.db">
  <schema>
    users { id: integer primary key }
  </>
  <schema>
    posts { id: integer primary key }
  </>
</program>`;
    const codes = allCodes(compileFromString(src, "002-dup"));
    expect(codes).toContain("E-SCHEMA-002");
    // Fired exactly once (on the 2nd block), not per-block.
    expect(codes.filter((c) => c === "E-SCHEMA-002")).toHaveLength(1);
  });

  test("does NOT fire on a single <schema> block", () => {
    const src = `<program db="./app.db">
  <schema>
    users { id: integer primary key
      email: text not null }
  </>
</program>`;
    const codes = allCodes(compileFromString(src, "002-single"));
    expect(codes).not.toContain("E-SCHEMA-002");
  });
});

describe("W-SCHEMA-001 — table has no primary key (§39.5.1)", () => {
  test("fires (as a warning) on a table with no primary key column", () => {
    const src = `<program db="./app.db">
  <schema>
    logs { message: text not null
      created_at: timestamp }
  </>
</program>`;
    const result = compileFromString(src, "w001-nopk");
    const warnCodes = (result.warnings || []).map((e) => e.code);
    const errCodes = (result.errors || []).map((e) => e.code);
    // Routes to the warnings stream, never the fatal errors stream.
    expect(warnCodes).toContain("W-SCHEMA-001");
    expect(errCodes).not.toContain("W-SCHEMA-001");
  });

  test("does NOT fire on a table that declares a primary key", () => {
    const src = `<program db="./app.db">
  <schema>
    logs { id: integer primary key
      message: text not null }
  </>
</program>`;
    const codes = allCodes(compileFromString(src, "w001-haspk"));
    expect(codes).not.toContain("W-SCHEMA-001");
  });
});
