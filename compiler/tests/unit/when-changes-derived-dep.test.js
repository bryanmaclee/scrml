/**
 * §6.7.4 EC-1 — E-LIFECYCLE-007 (derived half): a `when` dep-list entry that
 * names a `const <name>` derived cell is a compile error.
 *
 * "Derived variables are not `@variables` in the sense of mutable state; they
 * have no 'change event' independent of the underlying `@variables` they depend
 * on. To react to a derived value change, list the underlying `@variables` in the
 * dep-list and read the derived value inside the body." (SPEC §6.7.4 EC-1)
 *
 * Since the dep-list became a per-dep `_scrml_reactive_subscribe` (544e35c3) a
 * derived dep is never written, so without this error the body silently never
 * fires (it used to fire through `_scrml_effect` auto-tracking). The remedy
 * the SPEC prescribes — list the upstream cells, read the derived value in the
 * body — is exercised at runtime in
 * tests/browser/when-changes-dep-list.browser.test.js.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function codes(src) {
  const TMP = mkdtempSync(join(tmpdir(), "when-derived-"));
  try {
    const abs = join(TMP, "w.scrml");
    writeFileSync(abs, src);
    const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
    return (result.errors || [])
      .filter((e) => e && (e.severity ?? "error") === "error")
      .map((e) => e.code);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
  }
}

describe("§6.7.4 EC-1 — E-LIFECYCLE-007 on a derived dep", () => {
  test("single derived dep", () => {
    expect(codes(`<program>
  <p> = 1
  <log> = ""
  const <d> = @p * 2
  when @d changes { @log = @log + @d }
  <p>\${@log}</p>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("a derived entry in a multi-dep list (one error per derived entry)", () => {
    expect(codes(`<program>
  <p> = 1
  <q> = 1
  <log> = ""
  const <d> = @p * 2
  const <e> = @d + @q
  when (@q, @d, @e, @d) changes { @log = @log + @e }
  <p>\${@log}</p>
</program>
`)).toEqual(["E-LIFECYCLE-007", "E-LIFECYCLE-007"]);
  });

  test("transitive derived (A → B → C) is rejected at every level", () => {
    expect(codes(`<program>
  <a> = 1
  <log> = ""
  const <b> = @a + 1
  const <c> = @b * 2
  when @c changes { @log = @log + @c }
  <p>\${@log}</p>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("derived over a deep path of a mutable cell", () => {
    expect(codes(`<program>
  <o> = { x: 1 }
  <log> = ""
  const <d> = @o.x * 2
  when @d changes { @log = @log + @d }
  <p>\${@log}</p>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("inside a \${ } logic block too", () => {
    expect(codes(`<program>
  <p> = 1
  <log> = ""
  const <d> = @p * 2
  \${
    when @d changes { @log = @log + @d }
  }
  <p>\${@log}</p>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("the SPEC remedy — list the upstream cells, read the derived in the body — is clean", () => {
    expect(codes(`<program>
  <p> = 1
  <log> = ""
  const <d> = @p * 2
  when @p changes { @log = @log + @d }
  <p>\${@log}</p>
</program>
`)).toEqual([]);
  });

  test("a mutable cell dep is clean", () => {
    expect(codes(`<program>
  <p> = 1
  <log> = ""
  when @p changes { @log = @log + @p }
  <p>\${@log}</p>
</program>
`)).toEqual([]);
  });
});
