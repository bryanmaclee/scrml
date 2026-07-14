/**
 * §54.4 Match Exhaustiveness — End-to-End (S32 Phase 3d + 3e)
 *
 * Verifies the full pipeline lights up: user writes `match sub { < Draft> => ... }`,
 * the compiler tokenizes + splits + builds AST, resolves `let sub: Submission`
 * to the registered StateType, extracts substate arm patterns from the
 * html-fragment arm content, and fires E-TYPE-020 for missing substates.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileWhole(source, testName = `sub-match-e2e-${++tmpCounter}`) {
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
      warnings: result.warnings ?? [],
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("§54.4 substate match exhaustiveness — end-to-end", () => {
  test("missing substate arm fires E-TYPE-020 with the missing name", () => {
    const src = `< Submission id(string)>
    < Draft body(string)></>
    < Validated body(string)></>
    < Submitted body(string)></>
</>
\${
    let sub: Submission = < Draft></>
    let label = match sub {
        < Draft> => "a"
        < Validated> => "b"
    }
}`;
    const { errors } = compileWhole(src);
    const missing = errors.find(e => e.code === "E-TYPE-020");
    expect(missing).toBeDefined();
    expect(missing.message).toContain("Submitted");
    expect(missing.message).toContain("Submission");
  });

  test("exhaustive substate match — no E-TYPE-020", () => {
    const src = `< Submission id(string)>
    < Draft body(string)></>
    < Validated body(string)></>
</>
\${
    let sub: Submission = < Draft></>
    let label = match sub {
        < Draft> => "a"
        < Validated> => "b"
    }
}`;
    const { errors } = compileWhole(src);
    expect(errors.some(e => e.code === "E-TYPE-020")).toBe(false);
  });

  test("reactive-typed subject @sub: Submission resolves + checks", () => {
    const src = `< Submission id(string)>
    < Draft body(string)></>
    < Validated body(string)></>
    < Submitted body(string)></>
</>
\${
    @sub: Submission = < Draft></>
    let label = match @sub {
        < Draft> => "a"
    }
}`;
    const { errors } = compileWhole(src);
    const missing = errors.find(e => e.code === "E-TYPE-020");
    expect(missing).toBeDefined();
    expect(missing.message).toContain("Validated");
    expect(missing.message).toContain("Submitted");
  });

  test("wildcard `_` covers missing substates", () => {
    const src = `< Submission id(string)>
    < Draft body(string)></>
    < Validated body(string)></>
    < Submitted body(string)></>
</>
\${
    let sub: Submission = < Draft></>
    let label = match sub {
        < Draft> => "a"
        _ => "other"
    }
}`;
    const { errors } = compileWhole(src);
    expect(errors.some(e => e.code === "E-TYPE-020")).toBe(false);
  });
});

describe("§54.2 Phase 3d — type-annotation resolution to StateType (inspect registry)", () => {
  test("substates register under parent with correct parentState + substates set", async () => {
    const { splitBlocks } = await import("../../src/block-splitter.js");
    const { buildAST } = await import("../../src/ast-builder.js");
    const { runTS } = await import("../../src/type-system.js");

    const src = `< Flow id(string)>
    < Alpha label(string)></>
    < Beta count(number)></>
</>
\${
    let sub: Flow = < Alpha></>
    let _ = sub
}`;
    const bs = splitBlocks("/t.scrml", src);
    const { ast } = buildAST(bs);
    const { stateTypeRegistry } = runTS({ files: [ast] });

    const flow = stateTypeRegistry.get("Flow");
    expect(flow).toBeDefined();
    expect(flow.substates).toBeDefined();
    expect(flow.substates.has("Alpha")).toBe(true);
    expect(flow.substates.has("Beta")).toBe(true);

    const alpha = stateTypeRegistry.get("Alpha");
    expect(alpha.parentState).toBe("Flow");
  });
});
