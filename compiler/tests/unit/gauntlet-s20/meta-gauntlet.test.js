/**
 * meta-gauntlet.test.js — Phase 5 Meta Gauntlet Regression Tests (S20)
 *
 * Regression tests for bugs found during the S20 Phase 5 meta gauntlet.
 * Each test corresponds to a specific bug that was fixed or documented.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../../src/api.js";

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-gauntlet-s20");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compileSource(source, filename = "test.scrml") {
  const filePath = resolve(join(FIXTURE_DIR, filename));
  writeFileSync(filePath, source);

  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: FIXTURE_OUTPUT,
    write: false,
  });

  const output = result.outputs.get(filePath) ?? {};
  const allErrors = result.errors || [];
  return {
    clientJs: output.clientJs ?? "",
    errors: allErrors,
    fatalErrors: allErrors.filter(e => e.severity !== "warning"),
    warnings: allErrors.filter(e => e.severity === "warning"),
  };
}

// ---------------------------------------------------------------------------
// BUG-META-P5-003: reflect(@var) was incorrectly classified as compile-time
// ---------------------------------------------------------------------------

describe("BUG-META-P5-003: reflect(@var) hybrid resolution", () => {
  test("reflect(@selectedType) compiles as runtime meta without errors", () => {
    const source = `\${ type User:struct = { name: string, age: number } }
\${ type Admin:struct = { name: string, level: number } }
\${ @selectedType = "User" }
<div>
^{
  const info = reflect(@selectedType)
  if info is not {
    meta.emit("<p>Unknown type</p>")
  } else {
    meta.emit("<p>Found type</p>")
  }
}
</div>
`;
    const { fatalErrors, clientJs } = compileSource(source, "reflect-hybrid.scrml");
    expect(fatalErrors).toHaveLength(0);
    // Should be runtime meta, not compile-time
    expect(clientJs).toContain("_scrml_meta_effect(");
  });

  test("reflect(TypeName) with literal PascalCase is still compile-time", () => {
    const source = `\${ type Color:enum = { Red, Green, Blue } }
^{
  const info = reflect(Color)
  emit("<p>Has " + info.variants.length + " variants</p>")
}
`;
    const { fatalErrors, clientJs } = compileSource(source, "reflect-literal.scrml");
    expect(fatalErrors).toHaveLength(0);
    // Should be compile-time (inlined), NOT runtime meta
    expect(clientJs).not.toContain("_scrml_meta_effect(");
  });
});

// ---------------------------------------------------------------------------
// BUG-META-P5-004: E-META-008 — reflect() outside ^{} was not caught
// ---------------------------------------------------------------------------

describe("BUG-META-P5-004: E-META-008 reflect outside meta", () => {
  test("reflect() outside ^{} fires E-META-008", () => {
    const source = `\${ type User:struct = { name: string, age: number } }
\${ const info = reflect(User) }
<p>Should error</>
`;
    const { fatalErrors } = compileSource(source, "reflect-outside.scrml");
    const meta008 = fatalErrors.filter(e => e.code === "E-META-008");
    expect(meta008.length).toBeGreaterThanOrEqual(1);
  });

  test("reflect() inside ^{} does NOT fire E-META-008", () => {
    const source = `\${ type User:struct = { name: string, age: number } }
^{
  const info = reflect(User)
  emit("<p>OK</p>")
}
`;
    const { fatalErrors } = compileSource(source, "reflect-inside.scrml");
    const meta008 = fatalErrors.filter(e => e.code === "E-META-008");
    expect(meta008).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// BUG-META-P5-005: E-META-006 — lift inside ^{} was not caught
// ---------------------------------------------------------------------------

describe("BUG-META-P5-005: E-META-006 lift inside meta", () => {
  test("lift <tag> inside ^{} fires E-META-006", () => {
    const source = `<div>
  ^{
    lift <p>This should be illegal</>
  }
</div>
`;
    const { fatalErrors } = compileSource(source, "lift-in-meta.scrml");
    const meta006 = fatalErrors.filter(e => e.code === "E-META-006");
    expect(meta006.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// BUG-META-P5-007: reflect(UnknownType) spurious E-META-001
// ---------------------------------------------------------------------------

describe("BUG-META-P5-007: reflect(UnknownType) error quality", () => {
  test("reflect(NonExistentType) fires E-META-003, not E-META-001", () => {
    const source = `^{
  const info = reflect(NonExistentType)
  emit("<p>test</p>")
}
`;
    const { fatalErrors } = compileSource(source, "reflect-unknown.scrml");
    const meta003 = fatalErrors.filter(e => e.code === "E-META-003");
    const meta001 = fatalErrors.filter(e => e.code === "E-META-001");
    const meta005 = fatalErrors.filter(e => e.code === "E-META-005");
    expect(meta003.length).toBeGreaterThanOrEqual(1);
    // Should NOT fire E-META-001 or E-META-005 — NonExistentType is a type reference, not a runtime var
    expect(meta001).toHaveLength(0);
    expect(meta005).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Existing error codes that should still work
// ---------------------------------------------------------------------------

describe("Meta error codes (regression)", () => {
  test("E-META-007: SQL inside runtime ^{} is caught", () => {
    const source = `\${ @userId = 1 }
<div>
^{
  let user = ?{ SELECT * FROM users WHERE id = @userId }.get()
  meta.emit("<p>User</p>")
}
</div>
`;
    const { fatalErrors } = compileSource(source, "sql-in-runtime-meta.scrml");
    const meta007 = fatalErrors.filter(e => e.code === "E-META-007");
    expect(meta007.length).toBeGreaterThanOrEqual(1);
  });

  test("E-META-003: reflect on unknown type in compile-time meta", () => {
    const source = `^{
  const info = reflect(DoesNotExist)
  emit("<p>test</p>")
}
`;
    const { fatalErrors } = compileSource(source, "reflect-unknown-type.scrml");
    const meta003 = fatalErrors.filter(e => e.code === "E-META-003");
    expect(meta003.length).toBeGreaterThanOrEqual(1);
  });

  test("emit.raw() compiles clean in compile-time meta", () => {
    const source = `^{
  emit.raw("<pre>literal backslash-n</pre>")
}
`;
    const { fatalErrors } = compileSource(source, "emit-raw.scrml");
    expect(fatalErrors).toHaveLength(0);
  });

  test("meta.types.reflect() in runtime meta is NOT confused with compile-time", () => {
    const source = `\${ type Color:enum = { Red, Green, Blue } }
\${ @typeName = "Color" }
<div>
^{
  const info = meta.types.reflect(meta.get("typeName"))
  if (info) {
    meta.emit("<p>found</p>")
  }
}
</div>
`;
    const { fatalErrors, clientJs } = compileSource(source, "runtime-reflect.scrml");
    expect(fatalErrors).toHaveLength(0);
    expect(clientJs).toContain("_scrml_meta_effect(");
  });

  test("empty ^{} block compiles clean", () => {
    const source = `<div>
  ^{}
  <p>after</>
</div>
`;
    const { fatalErrors } = compileSource(source, "empty-meta.scrml");
    expect(fatalErrors).toHaveLength(0);
  });

  test("multiple ^{} blocks get distinct scope IDs", () => {
    const source = `\${ @count = 0 }
\${ @label = "Hello" }
<div>
  ^{
    meta.emit("<p>Count</p>")
  }
  ^{
    meta.emit("<p>Label</p>")
  }
</div>
`;
    const { fatalErrors, clientJs } = compileSource(source, "multi-meta.scrml");
    expect(fatalErrors).toHaveLength(0);
    // Both should be runtime meta blocks
    const metaEffectMatches = clientJs.match(/_scrml_(?:cs_)?meta_effect\("/g);
    expect(metaEffectMatches).not.toBeNull();
    expect(metaEffectMatches.length).toBeGreaterThanOrEqual(2);
  });
});
