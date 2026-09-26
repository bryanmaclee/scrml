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

  // The dep is resolved the way the emitted `_scrml_reactive_subscribe(dep, h)`
  // resolves it at runtime — one flat cell store keyed by the bare name — not by
  // lexical scope, so every declaration locus is covered.
  test("derived in a nested `${ }` inside markup", () => {
    expect(codes(`<program>
  <p> = 1
  <c> = 0
  when @d changes { @c = @c + 1 }
  <div>\${ const <d> = @p * 2 }</div>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("derived in an if= region", () => {
    expect(codes(`<program>
  <p> = 1
  <c> = 0
  when @d changes { @c = @c + 1 }
  <div if=@p>\${ const <d> = @p * 2 }</div>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("derived in one `${ }`, when in another", () => {
    expect(codes(`<program>
  <p> = 1
  <c> = 0
  \${ const <d> = @p * 2 }
  \${ when @d changes { @c = @c + 1 } }
  <p>\${@c}</p>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("derived in a component body (inlined by CE — same runtime key)", () => {
    expect(codes(`<program>
  <c> = 0
  const Card = <div>\${ const <d> = @c * 2 }<span>\${@d}</span></div>
  \${ when @d changes { @c = @c + 1 } }
  <Card/>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("a non-derived `const <k> = 5` is read-only too (not a mutable @variable)", () => {
    expect(codes(`<program>
  <c> = 0
  const <k> = 5
  when @k changes { @c = @c + 1 }
  <p>\${@c}</p>
</program>
`)).toEqual(["E-LIFECYCLE-007"]);
  });

  test("NO false positive: a mutable @d in one `${ }` and a same-named derived elsewhere", () => {
    // Its writes do fire the effect. (The pair is already E-DERIVED-WRITE on the
    // write; E-LIFECYCLE-007 must not pile on.)
    expect(codes(`<program>
  <c> = 0
  \${ <d> = 1 }
  <div>\${ const <d> = 5 }</div>
  \${ when @d changes { @c = @c + 1 } }
  <button onclick=\${@d = @d + 1}>b</button>
</program>
`)).not.toContain("E-LIFECYCLE-007");
  });

  test("NO false positive: a mutable @e alongside an unrelated derived", () => {
    expect(codes(`<program>
  <e> = 0
  <c> = 0
  <div>\${ const <d> = @e * 2 }</div>
  \${ when @e changes { @c = @c + 1 } }
  <p>\${@d}</p>
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
