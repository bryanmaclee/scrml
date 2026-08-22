/**
 * §4.12.6 — the NAMED scoped-DB context is a real scope, not a decoration.
 *
 * §4.12.3's table spells the row `Scoped DB context | name= (optional), db=`.
 * `name=` is OPTIONAL there — not absent — so `<program name="analytics" db="…">`
 * is exactly as legal as the anonymous spelling.
 *
 * `annotateDbScopes` gated on `dbAttr && !nameAttr`, so the NAMED form got no
 * `_dbScope` annotation at all: no `?{}` re-scoping, no §44.2 driver resolution.
 * The differential on `E-SQL-005` (emitted from inside that very branch):
 *
 *   <program db="mongodb://localhost/analytics">                 -> E-SQL-005
 *   <program name="analytics" db="mongodb://localhost/analytics"> -> silent, exit 0
 *
 * PRE-EXISTING, so not a regression — but round 2 changed what it MEANT. Before
 * round 2 the named form was VISIBLY broken: it was spliced out as a bogus worker
 * and its markup vanished, so an author noticed immediately. Round 2 fixed
 * `emit-html` so its markup renders, admitted a `<channel>` inside it, and added a
 * conformance case plus normative SPEC text — which moved the shape to SILENTLY
 * WRONG: it renders, compiles clean, and queries the PARENT's database, with a
 * ratified case standing behind it.
 *
 * The gate now keys on the shared `classifyNestedProgram`, so it cannot drift from
 * the extraction decision: a `db=` co-occurring with `mode=` or `route=` classifies
 * as THAT context and is refused, never silently treated as a scoped DB.
 *
 * Mirror site NOT fixed (self-host is deferred per pa.md):
 * `compiler/self-host/cg-parts/section-assembly.js:1968`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "scoped-db-named-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function build(dir, src) {
  const root = join(TMP, dir);
  mkdirSync(root, { recursive: true });
  const file = join(root, "app.scrml");
  writeFileSync(file, src);
  const outDir = join(root, "dist");
  const result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {} });
  const listed = existsSync(outDir) ? readdirSync(outDir) : [];
  const read = (n) => (existsSync(join(outDir, n)) ? readFileSync(join(outDir, n), "utf8") : null);
  return {
    outDir,
    files: listed,
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    serverJs: read("app.server.js"),
    // Hash-safe: under `contentHashAssets` the bundle is
    // `<base>.<name>.worker.<hash>.js`, and a bare `.endsWith(".worker.js")`
    // would find ZERO and pass every worker assertion vacuously.
    workerFilesOnDisk: listed.filter((f) => /\.worker(\.[a-z0-9]+)?\.js$/.test(f)).sort(),
  };
}

const codesOf = (o) => [...o.errors, ...o.warnings].map((e) => e.code);

/** `mongodb://` is not a SQL driver — §44.2 refuses it with E-SQL-005. */
const UNSUPPORTED_DRIVER = (nameAttr) => `<program>
  <program ${nameAttr}db="mongodb://localhost/analytics">
    <span>scoped</span>
  </program>
  <button>go</button>
</program>
`;

/** A supported driver, so the build is green and the two spellings are comparable. */
const SUPPORTED_DRIVER = (nameAttr) => `<program db="sqlite://./main.db">
  <program ${nameAttr}db="postgres://localhost/analytics">
    \${
      server function loadHits() {
        <rows> = ?{ SELECT id FROM hits }
        return @rows
      }
    }
  </program>
  <button>go</button>
</program>
`;

describe("§4.12.6 — `name=` is OPTIONAL on the scoped-DB row, so the named form is scoped too", () => {
  test("§44.2 driver resolution reaches the NAMED form (E-SQL-005 fires)", () => {
    const named = build("named-bad-driver", UNSUPPORTED_DRIVER(`name="analytics" `));
    // Pre-fix: silent, exit 0. The named form never entered the branch that
    // calls `resolveDbDriver`, so an unsupported connection string sailed
    // through and the subtree quietly queried the PARENT's database.
    expect(codesOf(named)).toContain("E-SQL-005");
  });

  test("the anonymous form still fires it — the fix widens the gate, it does not move it", () => {
    const anon = build("anon-bad-driver", UNSUPPORTED_DRIVER(""));
    expect(codesOf(anon)).toContain("E-SQL-005");
  });

  test("named and anonymous produce the SAME server output for the same scope", () => {
    const named = build("named-ok", SUPPORTED_DRIVER(`name="analytics" `));
    const anon = build("anon-ok", SUPPORTED_DRIVER(""));

    expect(named.errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toEqual([]);
    // The load-bearing assertion: `name=` is a REFERENCE handle, so adding one
    // must not change a single byte of what the scope emits.
    expect(named.serverJs).toEqual(anon.serverJs);
  });

  test("a NAMED scoped-DB context is still not extracted as a worker", () => {
    const named = build("named-not-worker", SUPPORTED_DRIVER(`name="analytics" `));
    // §4.12.3's classifier is exclusive and `db=` outranks bare `name=`. This is
    // the round-2 guarantee; widening the annotation gate must not disturb it.
    expect(named.workerFilesOnDisk).toEqual([]);
    expect(named.serverJs ?? "").not.toContain("new Worker(");
  });
});
