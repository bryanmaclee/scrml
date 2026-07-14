/**
 * S24 gauntlet — §2c match subject type narrowing (local-let + function-param).
 *
 * Prior to S24 the match subject lost its type annotation in two positions:
 *   1. Local `let p: Type = ...` inside a function body (AST builder path at
 *      ast-builder.js:1669 did not extract the `: Type` annotation; the init
 *      field received the raw string `": Type = ..."` and initExpr became a
 *      ParseError escape-hatch).
 *   2. Function parameters with type annotations (`function eat(p: Type)`) —
 *      type-system.ts bound every param as `asIs`, discarding the declared
 *      annotation even though the AST carried it.
 *
 * Both paths resulted in E-TYPE-025 on an otherwise-valid match. File-scope
 * `let` and typed reactives always worked, which is why the bug stayed
 * invisible until realistic enum-heavy code (Mario, tutorial §2.4) hit it.
 *
 * Fix: (1) ast-builder.js let-decl / const-decl parser now calls
 * collectTypeAnnotation between name and `=`; (2) type-system.ts function-decl
 * case resolves each param's typeAnnotation via resolveTypeExpr before
 * binding into the function scope.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s24-narrow-${++tmpCounter}`) {
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
      typeErrors: (result.errors ?? []).filter(e => e.code?.startsWith("E-TYPE")),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S24 §2c — match subject narrowing from local let annotation", () => {
  test("let p: Enum = param inside function body narrows match subject", () => {
    const src = `<program>
\${
  type PowerUp:enum = { Mushroom(n: number), Flower(n: number) }
  function eat(powerUp) {
    let p: PowerUp = powerUp
    match p {
      .Mushroom(n) => console.log("mushroom", n)
      .Flower(n) => console.log("flower", n)
    }
  }
}
</program>
`;
    const { typeErrors } = compileSrc(src);
    expect(typeErrors.some(e => e.code === "E-TYPE-025")).toBe(false);
  });

  test("const p: Enum = ... inside function body narrows match subject", () => {
    const src = `<program>
\${
  type Result:enum = { Ok(value: number), Err(msg: string) }
  function handle(raw) {
    const p: Result = raw
    match p {
      .Ok(v) => console.log("ok", v)
      .Err(m) => console.log("err", m)
    }
  }
}
</program>
`;
    const { typeErrors } = compileSrc(src);
    expect(typeErrors.some(e => e.code === "E-TYPE-025")).toBe(false);
  });
});

describe("S24 §2c — match subject narrowing from function param annotation", () => {
  test("function param with Enum annotation narrows match subject", () => {
    const src = `<program>
\${
  type PowerUp:enum = { Mushroom(n: number), Flower(n: number) }
  function eat(powerUp: PowerUp) {
    match powerUp {
      .Mushroom(n) => console.log("mushroom", n)
      .Flower(n) => console.log("flower", n)
    }
  }
}
</program>
`;
    const { typeErrors } = compileSrc(src);
    expect(typeErrors.some(e => e.code === "E-TYPE-025")).toBe(false);
  });

  test("function param + local let combo — both annotations respected", () => {
    const src = `<program>
\${
  type PowerUp:enum = { Mushroom(n: number), Flower(n: number) }
  function dispatch(raw: PowerUp) {
    let p: PowerUp = raw
    match p {
      .Mushroom(n) => console.log("m", n)
      .Flower(n) => console.log("f", n)
    }
    match raw {
      .Mushroom(n) => console.log("raw m", n)
      .Flower(n) => console.log("raw f", n)
    }
  }
}
</program>
`;
    const { typeErrors } = compileSrc(src);
    expect(typeErrors.some(e => e.code === "E-TYPE-025")).toBe(false);
  });
});

describe("S24 §2c — negative paths still fire E-TYPE-025", () => {
  test("unannotated param + match still errors (no inference on bare params)", () => {
    const src = `<program>
\${
  type PowerUp:enum = { Mushroom(n: number), Flower(n: number) }
  function eat(powerUp) {
    match powerUp {
      .Mushroom(n) => console.log("mushroom", n)
      .Flower(n) => console.log("flower", n)
    }
  }
}
</program>
`;
    const { typeErrors } = compileSrc(src);
    expect(typeErrors.some(e => e.code === "E-TYPE-025")).toBe(true);
  });

  test("let without annotation, initialized from asIs param, still errors", () => {
    const src = `<program>
\${
  type PowerUp:enum = { Mushroom(n: number), Flower(n: number) }
  function eat(powerUp) {
    let p = powerUp
    match p {
      .Mushroom(n) => console.log("m", n)
      .Flower(n) => console.log("f", n)
    }
  }
}
</program>
`;
    const { typeErrors } = compileSrc(src);
    expect(typeErrors.some(e => e.code === "E-TYPE-025")).toBe(true);
  });
});
