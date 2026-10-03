/**
 * UVB-W1 — pipeline integration tests
 *
 * Verifies that VP-1, VP-2, VP-3 are correctly wired into the api.js
 * pipeline at Stage 3.3, and that diagnostics flow through to the
 * `errors` and `warnings` arrays returned by `compileScrml()`.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

function withTempFile(name, contents) {
  const dir = join(tmpdir(), `uvb-w1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, name);
  writeFileSync(filePath, contents, "utf8");
  return { dir, filePath };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe("UVB-W1 pipeline integration", () => {
  // S449 ruling item 4 (§52.13.2): an auth= value outside the three literals on a
  // <page> is the error E-AUTH-ATTR-INVALID (was W-ATTR-002).
  test("VP-1: <page auth=\"role:dispatcher\"> surfaces E-AUTH-ATTR-INVALID in errors[]", () => {
    const { dir, filePath } = withTempFile("page.scrml", `<page route="/x" auth="role:dispatcher">
<div>x</div>
</page>`);
    try {
      const r = compileScrml({ inputFiles: [filePath], outputDir: join(dir, "out"), write: false });
      expect(r.errors.some((e) => e.code === "E-AUTH-ATTR-INVALID")).toBe(true);
      expect(r.warnings.some((w) => w.code === "E-AUTH-ATTR-INVALID")).toBe(false);
      expect(r.warnings.some((w) => w.code === "W-ATTR-002")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  test("VP-1: <channel auth=\"role:dispatcher\"> still surfaces W-ATTR-002 in warnings[]", () => {
    const { dir, filePath } = withTempFile("chan.scrml", `<program>
<channel name="x" auth="role:dispatcher">
</>
</program>`);
    try {
      const r = compileScrml({ inputFiles: [filePath], outputDir: join(dir, "out"), write: false });
      expect(r.warnings.some((w) => w.code === "W-ATTR-002")).toBe(true);
      expect(r.errors.some((e) => e.code === "W-ATTR-002")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  test("VP-2: unresolved component surfaces E-COMPONENT-035 in errors[]", () => {
    const { dir, filePath } = withTempFile("missing.scrml", `<program>
<MissingComp/>
</program>`);
    try {
      const r = compileScrml({ inputFiles: [filePath], outputDir: join(dir, "out"), write: false });
      expect(r.errors.some((e) => e.code === "E-COMPONENT-035")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("VP-3: <channel name=\"x-${id}\"> surfaces E-CHANNEL-007 in errors[]", () => {
    const { dir, filePath } = withTempFile("channel.scrml", `<program>
\${ let id = 7 }
<channel name="driver-\${id}">
</>
</program>`);
    try {
      const r = compileScrml({ inputFiles: [filePath], outputDir: join(dir, "out"), write: false });
      expect(r.errors.some((e) => e.code === "E-CHANNEL-007")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("clean program: zero VP errors and zero VP warnings", () => {
    const { dir, filePath } = withTempFile("clean.scrml", `<program auth="optional">
<div>hello</div>
</program>`);
    try {
      const r = compileScrml({ inputFiles: [filePath], outputDir: join(dir, "out"), write: false });
      expect(r.errors.filter((e) => ["E-COMPONENT-035", "E-CHANNEL-007"].includes(e.code))).toHaveLength(0);
      expect(r.warnings.filter((w) => ["W-ATTR-001", "W-ATTR-002"].includes(w.code))).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });
});
