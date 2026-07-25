/**
 * S27 — Match-arm expression-only form on a single line.
 *
 * Pre-S27 splitMatchArms in type-system.ts split arms only on LINE
 * boundaries (each line starting with `.`, `else`, or `not` began a new
 * arm). A match body with multiple arms on the same line —
 *   `match x { .A => 1 .B => 2 .C => 3 }`
 * — collected all three arms into one text blob, and only the first
 * variant reached the exhaustiveness checker. Users got
 * E-TYPE-020 "missing variants" errors on perfectly well-formed code.
 *
 * Fixed in S27 by replacing the line-only splitter with a char-level
 * scanner that tracks paren/brace depth, string literals, and comments,
 * and recognizes arm-header starts inline on the same line.
 *
 * Also tightens collectExpr in ast-builder.js as a defensive second
 * layer: any `.IDENT =>` / `::IDENT =>` / `else =>` / `_ =>` / `not …=>`
 * pattern at depth 0 ends the current expression. Safe because those
 * shapes have no other meaning in scrml at depth 0.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";
import { foldChunkNamespacing } from "../../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-s27-match-arm-expr");
let tmpCounter = 0;

function compile(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: outDir,
    });
    return { errors: (result.errors ?? []).filter(e => e.severity !== "warning") };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S27 — single-line match with expression-only arms", () => {
  test("unit-variant enum: all arms on one line compile exhaustively", () => {
    const src = `<program>
\${
  type Dir:enum = { N, S, E, W }
  @dir: Dir = Dir.N
  let r: string = match @dir { .N => "up" .S => "down" .E => "right" .W => "left" }
}
<p>\${r}</>
</program>
`;
    const { errors } = compile(src);
    expect(errors.filter(e => e.code === "E-TYPE-020")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("non-exhaustive single-line match still reports the missing variant", () => {
    // Regression guard: the fix makes arms visible, so the checker must
    // NOW correctly report missing variants (not hide them under a single
    // blob). Previously this test wouldn't have been meaningful because
    // only the first arm was seen.
    const src = `<program>
\${
  type Dir:enum = { N, S, E, W }
  @dir: Dir = Dir.N
  let r: string = match @dir { .N => "up" .S => "down" }
}
<p>\${r}</>
</program>
`;
    const { errors } = compile(src);
    const e020 = errors.filter(e => e.code === "E-TYPE-020");
    expect(e020).toHaveLength(1);
    expect(e020[0].message).toContain("Missing variants");
    expect(e020[0].message).toContain("E");
    expect(e020[0].message).toContain("W");
  });

  test("single-line match with payload-binding arms compiles", () => {
    const src = `<program>
\${
  type Shape:enum = { Circle(r: number), Square(s: number), Point }
  @shape: Shape = Shape.Point
  let area: number = match @shape { .Circle(r) => r * r * 3.14 .Square(s) => s * s .Point => 0 }
}
<p>\${area}</>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("single-line match with `else` wildcard", () => {
    const src = `<program>
\${
  type Dir:enum = { N, S, E, W }
  @dir: Dir = Dir.N
  let r: string = match @dir { .N => "up" else => "other" }
}
<p>\${r}</>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("arm bodies with string literals containing `.` do not confuse the splitter", () => {
    // Arm body string `".foo"` contains `.f` which should NOT trigger a
    // split boundary. The char-scanner tracks strings and skips matches
    // inside them.
    const src = `<program>
\${
  type D:enum = { A, B }
  @d: D = D.A
  let r: string = match @d { .A => ".alpha" .B => "..beta" }
}
<p>\${r}</>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("arm body containing a function call with parens doesn't mis-split", () => {
    // A pattern like `.A => fn(arg)` has `(` which increments depth. The
    // next arm's `.` must still be recognized after the matching `)`.
    const src = `<program>
\${
  type D:enum = { A, B }
  @d: D = D.A
  function fn(n: number): number { return n * 2 }
  let r: number = match @d { .A => fn(1) .B => fn(2) }
}
<p>\${r}</>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("multi-line form continues to work (regression guard for the pre-existing behavior)", () => {
    const src = `<program>
\${
  type Dir:enum = { N, S, E, W }
  @dir: Dir = Dir.N
  let r: string = match @dir {
    .N => "up"
    .S => "down"
    .E => "right"
    .W => "left"
  }
}
<p>\${r}</>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });

  test("mixed block-body + expression-only arms compile", () => {
    const src = `<program>
\${
  type Sev:enum = { Ok, Warn, Err }
  @s: Sev = Sev.Ok
  let label: string = match @s {
    .Ok => "fine"
    .Warn => { lift "be careful" }
    .Err => "broken"
  }
}
<p>\${label}</>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });
});

describe("S27 — match-arm split interior content sanity", () => {
  test("arm with comment between variant and arrow", () => {
    const src = `<program>
\${
  type D:enum = { A, B }
  @d: D = D.A
  let r: string = match @d {
    .A /* alpha */ => "a"
    .B => "b"
  }
}
<p>\${r}</>
</program>
`;
    const { errors } = compile(src);
    expect(errors).toEqual([]);
  });
});
