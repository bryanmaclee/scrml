/**
 * §12.4 / §4.12.4 — `E-ROUTE-001` is suppressed inside a §4.12.4 INLINE WORKER
 * body, and nowhere else.
 *
 * `collectWorkerBodyFunctionIds` (`compiler/src/route-inference.ts`) keyed the
 * suppression on `hasName`, with a doc comment stating the corrected-elsewhere
 * premise verbatim: *"Worker programs are markup nodes with tag === 'program' AND
 * a non-empty name attribute. The root `<program>` has no name attribute."* Both
 * halves are wrong, and the second one made another diagnostic LIE:
 * `W-PROGRAM-TOP-LEVEL-NAME` tells the author that `name=` on the root "has no
 * effect and is ignored" while a top-level `name=` was in fact disabling
 * `E-ROUTE-001` for every function in the file.
 *
 * A diagnostic that lies is worse than no diagnostic, so these tests exist to
 * keep the warning's "inert" claim TRUE. §4.12.9's `W-PROGRAM-TOP-LEVEL-NAME`
 * justification depends on this file passing.
 *
 * These are REAL COMPILES, deliberately. The unit-level §25 coverage in
 * `route-inference.test.js` runs on a synthesised AST, and that fixture had the
 * worker `<program name=>` at the ROOT of the nodes array — a shape no parser
 * emits — which is exactly why it kept passing against a broken predicate.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "route001-suppress-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function compile(dir, src) {
  const root = join(TMP, dir);
  mkdirSync(root, { recursive: true });
  const file = join(root, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({
    inputFiles: [file],
    outputDir: join(root, "dist"),
    write: false,
    log: () => {},
  });
  // Diagnostics are split across two streams — `E-ROUTE-001` carries
  // severity "warning", so reading only `errors` reports a false negative.
  return [...(result.errors ?? []), ...(result.warnings ?? [])].map((e) => e.code);
}

/**
 * The trigger: a computed-member WRITE whose receiver is a parameter, so the
 * analyser cannot prove it is not a protected record (`localArrayBindings` only
 * covers function-body-local COW arrays). Identical body in every fixture, so
 * the only variable under test is WHERE it sits.
 */
const TRIGGER = `function lookup(row, k) {
      row[k] = 1
    }`;

const TOP_LEVEL_PLAIN = `<program>
  \${ ${TRIGGER} }
  <button>go</button>
</program>
`;

const TOP_LEVEL_NAMED = `<program name="w">
  \${ ${TRIGGER} }
  <button>go</button>
</program>
`;

const NESTED_SCOPED_DB_NAMED = `<program>
  <program name="analytics" db="sqlite://./analytics.db">
    \${ ${TRIGGER} }
  </program>
  <button>go</button>
</program>
`;

const NESTED_SCOPED_DB_ANON = `<program>
  <program db="sqlite://./analytics.db">
    \${ ${TRIGGER} }
  </program>
  <button>go</button>
</program>
`;

const NESTED_INLINE_WORKER = `<program>
  <program name="w">
    \${ ${TRIGGER} }
  </program>
  <button>go</button>
</program>
`;

describe("§12.4 — E-ROUTE-001 fires everywhere except a real §4.12.4 worker body", () => {
  test("top-level <program> — the control — fires", () => {
    expect(compile("control", TOP_LEVEL_PLAIN)).toContain("E-ROUTE-001");
  });

  test("top-level <program name=> fires — `name=` at the root really is inert now", () => {
    // Pre-fix: SILENT. `hasName` on the ROOT set `enteringWorker = true`, so the
    // entire document was treated as a worker body. This assertion is the one
    // `W-PROGRAM-TOP-LEVEL-NAME`'s "has no effect and is ignored" depends on.
    const codes = compile("top-named", TOP_LEVEL_NAMED);
    expect(codes).toContain("E-ROUTE-001");
    // Both statements about the same attribute must hold together.
    expect(codes).toContain("W-PROGRAM-TOP-LEVEL-NAME");
  });

  test("nested <program name= db=> fires — a scoped-DB context is not a worker", () => {
    // Pre-fix: SILENT, and this is the shape where it bit hardest — a §4.12.6
    // subtree compiles INTO the parent and its `?{}` reaches a real database,
    // so silencing the server-escalation analysis there is backwards.
    expect(compile("nested-db-named", NESTED_SCOPED_DB_NAMED)).toContain("E-ROUTE-001");
  });

  test("nested <program db=> (no name=) still fires — the fix narrows, it does not move", () => {
    expect(compile("nested-db-anon", NESTED_SCOPED_DB_ANON)).toContain("E-ROUTE-001");
  });

  test("a real nested §4.12.4 inline worker body stays SILENT", () => {
    // The one shape the suppression is for, and the one that must survive:
    // §4.12.1 shared-nothing isolation means a worker has no protected fields,
    // no shared reactive state and nothing to escalate to.
    expect(compile("nested-worker", NESTED_INLINE_WORKER)).not.toContain("E-ROUTE-001");
  });
});
