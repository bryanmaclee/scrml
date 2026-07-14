/**
 * S24 gauntlet — §2f in-enum `transitions {}` whitespace leak.
 *
 * When a user wrote `.Pending => . Processing` (with a stray space between
 * the dot and variant name) inside an in-enum `transitions {}` block,
 * normalizeRef in the enum-body parser stripped the `.` via slice(1) but
 * did not trim the leading space. The lookup fired E-ENGINE-004 citing
 * "unknown variant ' Processing'" — a valid variant name wrapped in a
 * bad whitespace envelope.
 *
 * Fix: normalizeRef now `.trim()`s after the prefix strip for `.`, `::`,
 * and the no-prefix fallback.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s24-2f-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return {
      errors: result.errors ?? [],
      m004: (result.errors ?? []).filter(e => e.code === "E-ENGINE-004"),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S24 §2f — in-enum transitions variant-ref whitespace trim", () => {
  test("`. Pending` (space after dot) resolves to .Pending, no E-ENGINE-004", () => {
    const src = `<program>
\${
  type OrderStatus:enum = {
    Pending,
    Processing,
    Shipped
    transitions {
      .Pending => . Processing
      . Processing => .Shipped
    }
  }
}
<p>x</>
</program>
`;
    const { m004 } = compileSrc(src);
    expect(m004).toEqual([]);
  });

  test("double-colon prefix with space (`:: Pending`) also trims", () => {
    const src = `<program>
\${
  type S:enum = {
    A,
    B
    transitions {
      ::A => :: B
    }
  }
}
<p>x</>
</program>
`;
    const { m004 } = compileSrc(src);
    expect(m004).toEqual([]);
  });

  test("genuinely unknown variant still fires E-ENGINE-004", () => {
    const src = `<program>
\${
  type S:enum = {
    A,
    B
    transitions {
      .A => .NotAVariant
    }
  }
}
<p>x</>
</program>
`;
    const { m004 } = compileSrc(src);
    expect(m004.length).toBeGreaterThanOrEqual(1);
    expect(m004[0].message).toContain("NotAVariant");
  });
});
