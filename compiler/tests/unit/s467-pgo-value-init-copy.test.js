// S467 r9 — the runtime-chunk presence walkers (compute-pgo-flags.ts) do not descend into
// an export's parsed-init COPY (`valueInitExpr`, attached for the async-colouring
// classifier). A server-only value export (`export const SAME = {a:1} == {a:1}` read only
// by a server function) must not ship the `equality` runtime chunk to the page; a value
// export the CLIENT reads still gets it, from the emitted `_scrml_structural_eq(` call.
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { computePGOFlags } from "../../src/compute-pgo-flags.ts";

const MODELS = "${\n  export const SAME_SHAPE = { a: 1 } == { a: 1 }\n}\n";

function build(files, entry) {
  const dir = resolve(tmpdir(), `scrml-s467-pgo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  for (const [name, src] of Object.entries(files)) writeFileSync(resolve(dir, name), src);
  try {
    const result = compileScrml({ inputFiles: [resolve(dir, entry)], write: true, outputDir: outDir, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => !/^[WIL]-/.test(e.code ?? "") && e.severity !== "warning" && e.severity !== "info");
    const out = {};
    for (const f of readdirSync(outDir)) out[f] = readFileSync(resolve(outDir, f), "utf8");
    return { errors, out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const runtimeOf = (out) => Object.entries(out).find(([f]) => /^scrml-runtime\..*\.js$/.test(f))?.[1] ?? "";
const EQ_DEF = "function _scrml_structural_eq(";

describe("S467 r9 — presence walkers skip the export init copy", () => {
  test("the walker does not see `==` inside valueInitExpr", () => {
    const exportNode = {
      kind: "export-decl", exportKind: "const", exportedName: "X",
      valueInitExpr: { kind: "binary", op: "==", left: { kind: "lit" }, right: { kind: "lit" } },
    };
    expect(computePGOFlags([exportNode]).hasEqualityExpr).toBe(false);
  });

  test("a server-only value export does not ship the equality chunk to the page", () => {
    const page = `<program>
  <v> = 0
  \${
    import { SAME_SHAPE } from './models.scrml'
  }
  server function check() { return SAME_SHAPE ? 1 : 0 }
  function go() { @v = check() }
<div>
  <button onclick=go()>go</button>
  <p>\${@v}</p>
</div>
</program>
`;
    const { errors, out } = build({ "models.scrml": MODELS, "page.scrml": page }, "page.scrml");
    expect(errors).toEqual([]);
    expect(out["models.server.js"]).toContain(EQ_DEF);
    expect(runtimeOf(out)).not.toContain(EQ_DEF);
  });

  test("a value export the client reads still gets the equality chunk", () => {
    const page = `<program>
  \${
    import { SAME_SHAPE } from './models.scrml'
  }
  <v> = 0
  function go() { @v = SAME_SHAPE ? 1 : 2 }
<div>
  <button onclick=go()>go</button>
  <p>\${@v}</p>
</div>
</program>
`;
    const { errors, out } = build({ "models.scrml": MODELS, "page.scrml": page }, "page.scrml");
    expect(errors).toEqual([]);
    expect(out["models.client.js"]).toContain("_scrml_structural_eq(");
    expect(runtimeOf(out)).toContain(EQ_DEF);
  });
});
