/**
 * S24 gauntlet — §51.11 `audit @varName` clause (§2b G).
 *
 * Opt-in audit/replay support: attaching `audit @log` to a machine body
 * appends `{from, to, at}` entries to @log on every successful transition.
 * Rejected transitions do not produce audit entries. Duplicate clauses and
 * undeclared targets fire E-ENGINE-019.
 *
 * Tests exercise:
 *   - parser: audit clause attaches to the machine registry entry
 *   - codegen: transition guard emits the audit-push after state commit
 *   - validation: undeclared target + duplicate clause both fire E-ENGINE-019
 *   - runtime-ish: generated JS shape matches the spec (we don't execute
 *     the runtime here — that's covered by happy-dom E2E in a follow-up)
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s24-audit-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientJs = existsSync(resolve(outDir, `${testName}.client.js`))
      ? readFileSync(resolve(outDir, `${testName}.client.js`), "utf8")
      : "";
    return {
      errors: result.errors ?? [],
      m019: (result.errors ?? []).filter(e => e.code === "E-ENGINE-019"),
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S24 §51.11 — audit clause parses + compiles cleanly", () => {
  test("audit clause on an enum machine → no errors, audit-push emitted", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  @auditLog = []
  function step() { @order = S.B }
}
< machine name=M for=S>
  .A => .B
  .B => .C
  audit @auditLog
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("§51.11 audit log push");
    // §51.11.4 (S27) — entry shape includes rule + label fields, and
    // entries are Object.freeze'd per the spec's frozen-object guarantee.
    expect(clientJs).toContain('_scrml_reactive_set("auditLog", (_scrml_reactive_get("auditLog") || []).concat([Object.freeze({ from: __prev, to: __next, at: Date.now(), rule: __matchedKey, label: __auditLabel })]))');
  });

  test("machine without audit clause → no audit push emitted (opt-in)", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  function step() { @order = S.B }
}
< machine name=M for=S>
  .A => .B
</>
<p>x</>
</program>
`;
    const { clientJs } = compileSrc(src);
    expect(clientJs).not.toContain("§51.11 audit log push");
  });
});

describe("S24 §51.11 — E-ENGINE-019 validation", () => {
  test("audit clause pointing at undeclared reactive → E-ENGINE-019", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
}
< machine name=M for=S>
  .A => .B
  audit @undeclaredAuditTarget
</>
<p>x</>
</program>
`;
    const { m019 } = compileSrc(src);
    expect(m019.length).toBeGreaterThanOrEqual(1);
    expect(m019[0].message).toContain("undeclaredAuditTarget");
  });

  test("two audit clauses in one machine body → E-ENGINE-019", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @first = []
  @second = []
}
< machine name=M for=S>
  .A => .B
  audit @first
  audit @second
</>
<p>x</>
</program>
`;
    const { m019 } = compileSrc(src);
    expect(m019.length).toBeGreaterThanOrEqual(1);
    expect(m019[0].message).toContain("more than one");
  });

  test("declared audit target → no E-ENGINE-019", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
}
< machine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { m019 } = compileSrc(src);
    expect(m019).toEqual([]);
  });
});

describe("S24 §51.11 — transition guard + audit ordering in generated JS", () => {
  test("audit push follows state commit in generated JS", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function step() { @order = S.B }
}
< machine name=M for=S>
  .A => .B given (true)
  audit @log
</>
<p>x</>
</program>
`;
    const { clientJs } = compileSrc(src);
    // Ordering: reactive_set("order"...) → audit log push. The effect-block
    // ordering sub-invariant is covered indirectly by emit-machines.ts unit
    // tests; here we only verify commit-before-audit since effect emission
    // for non-guarded rules has a pre-existing edge case orthogonal to
    // §51.11.
    const commitIdx = clientJs.indexOf('_scrml_reactive_set("order", __next)');
    const auditIdx = clientJs.indexOf("§51.11 audit log push");
    expect(commitIdx).toBeGreaterThan(0);
    expect(auditIdx).toBeGreaterThan(commitIdx);
  });
});
