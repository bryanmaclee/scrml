/**
 * assignment-init-set-reset-inversion.test.js — g-assignment-emits-init-set-
 * inverting-reset (SPEC §6.8, HIGH).
 *
 * A top-level `@name = expr` REASSIGNMENT was emitting the decl-shaped
 * `_scrml_init_set("name", () => <rhs>)` reset thunk. Because the runtime's
 * `_scrml_init_fns[name]` is last-write-wins and `_scrml_reset` calls it, the
 * reassignment's thunk CLOBBERED the declaration's — so `reset(@name)` re-ran the
 * assignment expression (e.g. `@ticks + 1` → INCREMENT) instead of restoring the
 * declared initial. The decl-shaped init-thunk lowering must fire ONLY for a
 * genuine declaration, never for a reassignment.
 *
 * The fix keys on the AST `structuralForm` flag PLUS the file's structural-decl
 * name set: skip the init-thunk for a `structuralForm:false` plain write ONLY
 * when the cell has a `<name>` structural declaration (a true reassignment). An
 * IMPLICIT `@`-declaration — `@x = <source>` with no prior `<x>`, e.g. an SSE/
 * generator bind — is NOT in that set and correctly KEEPS its thunk.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileClient(source, suffix = "asg-init-reset") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Count `init_set("<name>"` occurrences for a cell (namespace-prefix agnostic).
const initSetCount = (js, cell) =>
  (js.match(new RegExp(`init_set\\("${cell}"`, "g")) || []).length;

// ---------------------------------------------------------------------------
// §1 — a top-level reassignment must NOT add a second init_set
// ---------------------------------------------------------------------------

const REASSIGN_SRC = `<program>
    <ticks> = 0
    \${ @ticks = @ticks + 1 }
    <button onclick=reset(@ticks)>R</button>
    <p>\${@ticks}</p>
</program>
`;

describe("§6.8 assignment-init-set §1 — top-level reassignment does not clobber the reset thunk", () => {
  test("exactly ONE init_set for the cell — the declaration's () => 0", () => {
    const { clientJs, errors } = compileClient(REASSIGN_SRC);
    expect(errors).toEqual([]);
    expect(initSetCount(clientJs, "ticks")).toBe(1);
    // The surviving thunk is the DECLARED initial (restores 0), not the increment.
    expect(clientJs).toMatch(/init_set\("ticks", \(\) => 0\)/);
    // The reassignment's actual module-init write is still emitted (behaviour kept).
    expect(clientJs).toMatch(/reactive_set\("ticks", _scrml_cs_reactive_get\("ticks"\) \+ 1\)/);
  });
});

// ---------------------------------------------------------------------------
// §2 — a plain declaration (no reassignment) still gets its init-thunk
// ---------------------------------------------------------------------------

const DECL_ONLY_SRC = `<program>
    <count> = 7
    <button onclick=reset(@count)>R</button>
    <p>\${@count}</p>
</program>
`;

describe("§6.8 assignment-init-set §2 — a declaration keeps its reset init-thunk", () => {
  test("the decl emits exactly one init_set with its declared initial", () => {
    const { clientJs } = compileClient(DECL_ONLY_SRC);
    expect(initSetCount(clientJs, "count")).toBe(1);
    expect(clientJs).toMatch(/init_set\("count", \(\) => 7\)/);
  });
});

// ---------------------------------------------------------------------------
// §3 — an IMPLICIT @-declaration (no <name>) keeps its init-thunk (regression
// guard: the fix must NOT over-skip an SSE/generator bind)
// ---------------------------------------------------------------------------

const IMPLICIT_SSE_SRC = `<program>
\${
  server function* ticks() {
    let i = 0
    while (i < 3) {
      yield i
      i = i + 1
    }
  }
  @latest = ticks()
}
<div><p>\${@latest}</></div>
</program>
`;

describe("§6.8 assignment-init-set §3 — implicit @-declaration keeps its thunk", () => {
  test("an SSE bind `@latest = ticks()` (no <latest> decl) still emits an init_set", () => {
    const { clientJs } = compileClient(IMPLICIT_SSE_SRC);
    expect(initSetCount(clientJs, "latest")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4 — compound: both decls keep their thunk, neither reassignment clobbers
// (the fix keys per-node, so `@counter.ticks` and top-level `@ticks` do not
// collide on a flat name set)
// ---------------------------------------------------------------------------

const COMPOUND_SRC = `<program>
    <counter> = { ticks: 0, label: "x" }
    <ticks> = 5
    \${ @counter.ticks = @counter.ticks + 1 }
    \${ @ticks = @ticks + 1 }
    <p>\${@ticks} \${@counter.ticks}</p>
</program>
`;

describe("§6.8 assignment-init-set §4 — compound child + same-named top-level cell", () => {
  test("both decls keep one init_set; no spurious init_set for either reassignment", () => {
    const { clientJs } = compileClient(COMPOUND_SRC);
    expect(initSetCount(clientJs, "counter")).toBe(1);
    expect(initSetCount(clientJs, "ticks")).toBe(1);
    expect(clientJs).not.toContain('init_set("counter.ticks"');
  });
});

// ---------------------------------------------------------------------------
// §5 — a reassignment nested in a TOP-LEVEL control-flow body (if/for/while)
// must also skip (S239 F1: a control-flow body is not a function body — its
// sidecars fire, so the module-level structural-decl fallback must reach it).
// ---------------------------------------------------------------------------

const IF_BODY_SRC = `<program>
    <ticks> = 0
    \${ if (true) { @ticks = @ticks + 1 } }
    <p>\${@ticks}</p>
</program>
`;

const FOR_BODY_SRC = `<program>
    <ticks> = 0
    \${ for (const i of [1]) { @ticks = @ticks + 1 } }
    <p>\${@ticks}</p>
</program>
`;

describe("§6.8 assignment-init-set §5 — reassignment inside a top-level control-flow body", () => {
  test("an `if`-body reassignment does not add a second init_set", () => {
    const { clientJs } = compileClient(IF_BODY_SRC);
    expect(initSetCount(clientJs, "ticks")).toBe(1);
    expect(clientJs).toMatch(/init_set\("ticks", \(\) => 0\)/);
  });

  test("a `for`-body reassignment does not add a second init_set", () => {
    const { clientJs } = compileClient(FOR_BODY_SRC);
    expect(initSetCount(clientJs, "ticks")).toBe(1);
    expect(clientJs).toMatch(/init_set\("ticks", \(\) => 0\)/);
  });
});
