/**
 * each-sigil-outside-each-bug70.test.js — Bug 70 (S157).
 *
 * `@.` is the `<each>`-only contextual iteration sigil (SPEC §17.7.3 / §3.4):
 * inside an `<each>` body it names "the current iteration value" (`@.field` is
 * a field of the current item). Used OUTSIDE any `<each>` body scope it has no
 * referent and SHALL fire `E-SYNTAX-064`.
 *
 * Before the fix the diagnostic was QUEUED/unwired: `@.` outside `<each>` either
 *   - leaked raw into codegen -> the confusing `E-CODEGEN-INVALID-LOGIC` ("the
 *     compiler could not lower this construct to valid output ... please report it"),
 *     for handler-call args / interpolations in a Tier-0 `${for...lift}`, or
 *   - fell through to a misleading `E-SCOPE-001` on the base `@` token, for a
 *     bare `@.field` attribute value.
 *
 * The fix wires E-SYNTAX-064 at the two reachable `@.`-outside-each loci:
 *   (1) bare `@.field` attribute value  -> visitAttr else-fire
 *   (2) Tier-0 lift-embedded markup     -> lift-expr `@.`-subtree scan (covers
 *       both the handler-call arg `onclick=ping(@.id)` and the interpolation
 *       `lift <li>${@.name}</li>` — the lift-embedded markup is otherwise never
 *       walked by the TS visitor).
 * The emitted-JS parse gate is suppressed when a prior fatal error exists, so a
 * misuse already diagnosed by E-SYNTAX-064 no longer ALSO accuses codegen of a
 * defect via E-CODEGEN-INVALID-LOGIC.
 *
 * Coverage:
 *   §1 — bare `@.field` attr-value outside each -> E-SYNTAX-064 (no E-SCOPE-001)
 *   §2 — Tier-0 for-lift handler-call arg `ping(@.id)` -> E-SYNTAX-064, and
 *        E-CODEGEN-INVALID-LOGIC NO LONGER fires
 *   §3 — Tier-0 for-lift interpolation `${@.name}` -> E-SYNTAX-064
 *   §4 — `@.` INSIDE an `<each>` body (attr + handler + interp) compiles CLEAN
 *   §5 — a Tier-0 lift CONTAINING a nested `<each>` using `@.` does NOT
 *        false-fire E-SYNTAX-064 (nested-each `@.` is legal)
 *   §6 — §34 catalog row for E-SYNTAX-064 exists
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToDiagnostics(source, suffix = "bug70") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    return { errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codes = (errors) => errors.map((e) => e.code);
const msgsFor = (errors, code) =>
  errors.filter((e) => e.code === code).map((e) => e.message);

// ---------------------------------------------------------------------------
// §1 — bare `@.field` attribute value OUTSIDE each -> E-SYNTAX-064
// ---------------------------------------------------------------------------

describe("bug70 §1 — bare @.field attr-value outside each -> E-SYNTAX-064", () => {
  const src = `<program>
${"$"}{
    type Item:struct = { id: int, name: string, done: bool }
    <items>: Item[] = []
}
<li class:done=@.done>hello</li>
</program>`;

  test("E-SYNTAX-064 fires naming the sigil; misleading E-SCOPE-001 on base @ is gone", () => {
    const { errors } = compileToDiagnostics(src, "bug70-attr");
    expect(codes(errors)).toContain("E-SYNTAX-064");
    expect(codes(errors)).not.toContain("E-SCOPE-001");
    const m = msgsFor(errors, "E-SYNTAX-064").join("\n");
    expect(m).toContain("`@.`");
    expect(m).toContain("@.done");
    expect(m).toContain("<each>");
    expect(m).toContain("§17.7.3");
  });
});

// ---------------------------------------------------------------------------
// §2 — Tier-0 for-lift handler-call arg ping(@.id) -> E-SYNTAX-064;
//      E-CODEGEN-INVALID-LOGIC NO LONGER fires.
// ---------------------------------------------------------------------------

describe("bug70 §2 — Tier-0 for-lift handler-arg ping(@.id) -> E-SYNTAX-064 (not E-CODEGEN-INVALID-LOGIC)", () => {
  const src = `<program>
${"$"}{
    type Item:struct = { id: int, name: string }
    <items>: Item[] = []
    function ping(x) { x }
}
<ul>${"$"}{ for (it of @items) { lift <li onclick=ping(@.id)>${"$"}{it.name}</li> } }</ul>
</program>`;

  test("E-SYNTAX-064 fires for the @.id sigil", () => {
    const { errors } = compileToDiagnostics(src, "bug70-handler");
    expect(codes(errors)).toContain("E-SYNTAX-064");
    const m = msgsFor(errors, "E-SYNTAX-064").join("\n");
    expect(m).toContain("@.id");
  });

  test("E-CODEGEN-INVALID-LOGIC NO LONGER fires for the same source", () => {
    const { errors } = compileToDiagnostics(src, "bug70-handler-codegen");
    expect(codes(errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });
});

// ---------------------------------------------------------------------------
// §3 — Tier-0 for-lift interpolation ${@.name} -> E-SYNTAX-064
// ---------------------------------------------------------------------------

describe("bug70 §3 — Tier-0 for-lift interpolation ${@.name} -> E-SYNTAX-064", () => {
  const src = `<program>
${"$"}{
    type Item:struct = { id: int, name: string }
    <items>: Item[] = []
}
<ul>${"$"}{ for (it of @items) { lift <li>${"$"}{@.name}</li> } }</ul>
</program>`;

  test("E-SYNTAX-064 fires for the @.name interpolation; no E-CODEGEN-INVALID-LOGIC", () => {
    const { errors } = compileToDiagnostics(src, "bug70-interp");
    expect(codes(errors)).toContain("E-SYNTAX-064");
    expect(codes(errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
    const m = msgsFor(errors, "E-SYNTAX-064").join("\n");
    expect(m).toContain("@.name");
  });
});

// ---------------------------------------------------------------------------
// §4 — `@.` INSIDE an <each> body compiles CLEAN (no false positive)
// ---------------------------------------------------------------------------

describe("bug70 §4 — @. inside <each> body compiles clean", () => {
  const src = `<program>
${"$"}{
    type Item:struct = { id: int, name: string, done: bool }
    <items>: Item[] = []
    function ping(x) { x }
}
<ul><each in=@items><li title=@.name class:done=@.done onclick=ping(@.id)>${"$"}{@.name}</li></each></ul>
</program>`;

  test("no E-SYNTAX-064 and no E-CODEGEN-INVALID-LOGIC — @. is in scope inside each", () => {
    const { errors } = compileToDiagnostics(src, "bug70-in-each");
    expect(codes(errors)).not.toContain("E-SYNTAX-064");
    expect(codes(errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
  });
});

// ---------------------------------------------------------------------------
// §5 — a Tier-0 lift CONTAINING a nested <each> using @. does NOT false-fire.
// The nested-each `@.` is LEGAL (it resolves to the inner each's iteration
// value), so the lift-expr subtree scan must STOP at the nested-each boundary.
// (Codegen of nested-each-in-for-lift is a SEPARATE pre-existing gap, so we
// assert only the absence of a FALSE E-SYNTAX-064 here, not a clean compile.)
// ---------------------------------------------------------------------------

describe("bug70 §5 — nested <each> inside a Tier-0 lift does not false-fire E-SYNTAX-064", () => {
  const src = `<program>
${"$"}{
    type Row:struct = { id: int, cells: string[] }
    <rows>: Row[] = []
}
<table>${"$"}{ for (row of @rows) { lift <tr><each in=row.cells><td>${"$"}{@.}</td></each></tr> } }</table>
</program>`;

  test("the legitimate nested-each @. does NOT surface a false E-SYNTAX-064", () => {
    const { errors } = compileToDiagnostics(src, "bug70-nested-each");
    expect(codes(errors)).not.toContain("E-SYNTAX-064");
  });
});

// ---------------------------------------------------------------------------
// §6 — §34 catalog row for E-SYNTAX-064 exists (impl/spec parity)
// ---------------------------------------------------------------------------

describe("bug70 §6 — §34 catalog row for E-SYNTAX-064 exists", () => {
  test("SPEC.md has an E-SYNTAX-064 row in the §34 error catalog", async () => {
    const spec = await Bun.file("compiler/SPEC.md").text();
    const rowMatch = spec.split("\n").find((l) => /\|\s*E-SYNTAX-064\s*\|/.test(l) && /\|\s*Error\s*\|/.test(l));
    expect(rowMatch).toBeTruthy();
    expect(rowMatch).toContain("§17.7.3");
    expect(rowMatch).toContain("<each>");
  });
});
