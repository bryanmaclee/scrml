/**
 * g-subparse-span-not-rebased — a diagnostic fired from inside a sub-parsed
 * subtree (a `<match>` arm body, an `<each>` body) must report the REAL source
 * line, not ~L1.
 *
 * The defect (S277, PA-reproduced): ast-builder re-slices a `<match>` arm body
 * (`armBodyChildren`) and an `<each>` body (`bodyChildren`) and re-runs
 * `splitBlocks` + `buildAST` on the substring. `buildAST` takes no base-offset,
 * so every node in the result carried `span.start/end` measured from byte 0 of
 * the body substring and `line/col` that were body-local. Any diagnostic
 * anchored to such a node (`E-STATE-UNDECLARED`, `E-OUTLET-AND-MAIN`, …) then
 * pointed at ~L1 — the exact friction an error catalog exists to remove for an
 * adopter debugging a match-heavy file.
 *
 * The durable fix rebases the sub-parsed subtree's spans to FILE coordinates in
 * ast-builder (`_rebaseSubparseSpans`), which repairs every diagnostic in those
 * positions at once. This suite pins the line for BOTH broken paths, keeps the
 * top-level path as a control, and guards that valid match/each programs still
 * compile clean (the rebase is inert on well-formed source).
 *
 * The expected line is DERIVED from the source (the line carrying the marker),
 * so the assertion cannot silently drift if the fixture is reformatted.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "g-subparse-span-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], write: false, log: () => {} });
  const errors = (result.errors || []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  return { errors };
}

// The 1-based source line carrying `marker` (a substring on exactly one line).
function lineOf(source, marker) {
  const idx = source.split("\n").findIndex((l) => l.includes(marker));
  return idx + 1; // findIndex is 0-based; source lines are 1-based
}

function undeclaredAt(errors, marker, source) {
  const diag = errors.find((e) => e.code === "E-STATE-UNDECLARED");
  expect(diag, `E-STATE-UNDECLARED expected for ${marker}`).toBeDefined();
  return diag?.span?.line;
}

describe("g-subparse-span-not-rebased — diagnostics inside sub-parsed bodies report the real line", () => {
  test("CONTROL — a bare undeclared read at the top level reports its real line", () => {
    const src = `<div>
    \${@nopeTop}
</div>`;
    const { errors } = compileSource("top", src);
    expect(undeclaredAt(errors, "@nopeTop", src)).toBe(lineOf(src, "@nopeTop"));
  });

  test("a `<match>` bare-body arm — undeclared read reports the ARM line, not L1", () => {
    const src = `<div>
    \${
        type Phase:enum = { Idle, Loading, Ready, Failed }
        <phase>: Phase = .Idle
    }
    <match for=Phase on=@phase>
        <Idle>
            <p>\${@nopeInArm}</p>
        </>
        <_>
            <p>fallback</p>
        </>
    </match>
</div>`;
    const { errors } = compileSource("match-arm", src);
    const expected = lineOf(src, "@nopeInArm");
    expect(expected).toBeGreaterThan(1); // the fixture really does sit deep
    expect(undeclaredAt(errors, "@nopeInArm", src)).toBe(expected);
  });

  test("an `<each>` body — undeclared read reports the BODY line, not L1", () => {
    const src = `<div>
    \${
        type Item:struct = { id: number, name: string }
        <items>: Item[] = []
    }
    <each in=@items key=@.id as item>
        <p>\${@nopeInEach}</p>
    </each>
</div>`;
    const { errors } = compileSource("each-body", src);
    const expected = lineOf(src, "@nopeInEach");
    expect(expected).toBeGreaterThan(1);
    expect(undeclaredAt(errors, "@nopeInEach", src)).toBe(expected);
  });

  test("NON-REGRESSION — a valid match + each program compiles clean (rebase is inert on well-formed source)", () => {
    const src = `<div>
    \${
        type Phase:enum = { Idle, Ready }
        type Item:struct = { id: number }
        <phase>: Phase = .Idle
        <items>: Item[] = []
    }
    <match for=Phase on=@phase>
        <Idle>
            <p>\${@phase}</p>
        </>
        <_>
            <p>ready</p>
        </>
    </match>
    <each in=@items key=@.id as item>
        <p>\${@.id}</p>
    </each>
</div>`;
    const { errors } = compileSource("valid", src);
    expect(errors.filter((e) => e.code === "E-STATE-UNDECLARED")).toEqual([]);
  });
});
