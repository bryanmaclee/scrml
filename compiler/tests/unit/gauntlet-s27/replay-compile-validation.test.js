/**
 * S27 — §51.14 G2 slice 2. Compile-time validation for replay() args.
 *
 * E-REPLAY-001 fires when the first argument to replay is not a
 * machine-bound reactive:
 *   - non-@-ref argument
 *   - @-ref naming an undeclared reactive
 *   - @-ref naming a declared reactive without a < engine> binding
 *
 * E-REPLAY-002 fires when the second argument is not a reactive:
 *   - non-@-ref argument
 *   - @-ref naming an undeclared reactive
 *
 * Well-formed calls produce no errors.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";

const tmpRoot = resolve(tmpdir(), "scrml-s27-replay-validation");
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
    const errs = (result.errors ?? []).filter(e => e.severity !== "warning");
    return { errors: errs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S27 §51.14 — E-REPLAY-001 (target must be engine-bound)", () => {
  test("non-machine-bound reactive → E-REPLAY-001 with 'not governed' message", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @plain = 0
  @log = []
  function bad() { replay(@plain, @log) }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const r001 = errors.filter(e => e.code === "E-REPLAY-001");
    expect(r001).toHaveLength(1);
    expect(r001[0].message).toContain("'@plain'");
    expect(r001[0].message).toContain("not governed by an <engine> declaration");
  });

  test("undeclared target → E-REPLAY-001 with 'not declared in scope' message", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function bad() { replay(@ghost, @log) }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const r001 = errors.filter(e => e.code === "E-REPLAY-001");
    expect(r001).toHaveLength(1);
    expect(r001[0].message).toContain("'@ghost'");
    expect(r001[0].message).toContain("No reactive variable named '@ghost' is declared in scope");
  });
});

describe("S27 §51.14 — E-REPLAY-002 (log must be a declared reactive)", () => {
  test("undeclared log → E-REPLAY-002 with 'not declared' message", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function bad() { replay(@order, @missingLog) }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const r002 = errors.filter(e => e.code === "E-REPLAY-002");
    expect(r002).toHaveLength(1);
    expect(r002[0].message).toContain("'@missingLog'");
    expect(r002[0].message).toContain("not a declared reactive variable");
  });
});

describe("S27 §51.14 — well-formed replay calls produce no errors", () => {
  test("two-arg replay(@target, @log) on machine-bound target + declared reactive → clean", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function good() { replay(@order, @log) }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const rErrs = errors.filter(e => (e.code ?? "").startsWith("E-REPLAY-"));
    expect(rErrs).toEqual([]);
  });

  test("three-arg replay(@target, @log, n) → clean", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function good() { replay(@order, @log, 0) }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const rErrs = errors.filter(e => (e.code ?? "").startsWith("E-REPLAY-"));
    expect(rErrs).toEqual([]);
  });

  test("replay with a synthetic (non-audit-target) log is permitted under E-REPLAY-003", () => {
    // S28: only logs that ARE some machine's audit target trigger the
    // cross-machine check. Hand-built reactive logs are user-managed and
    // pass through.
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @synthLog = []
  function rewindToFirst() { replay(@order, @synthLog) }
}
< engine name=M for=S>
  .A => .B
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const rErrs = errors.filter(e => (e.code ?? "").startsWith("E-REPLAY-"));
    expect(rErrs).toEqual([]);
  });

  test("replay with the target's OWN audit log is permitted under E-REPLAY-003", () => {
    // S28 sanity: same-machine replay (the canonical case) is unchanged.
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function rewind() { replay(@order, @log) }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const rErrs = errors.filter(e => (e.code ?? "").startsWith("E-REPLAY-"));
    expect(rErrs).toEqual([]);
  });

  test("replay against a different machine's audit log → E-REPLAY-003 (S28)", () => {
    // S28: §51.14.6 non-goal lifted. Cross-machine replay (replay a log
    // owned by machine A's `audit @log` into a target governed by machine
    // B) is now rejected at compile time because the log's variant names
    // are A's, not B's, and the resulting state is semantically nonsensical.
    const src = `<program>
\${
  type S:enum = { A, B }
  type T:enum = { X, Y }
  @one: M1 = S.A
  @two: M2 = T.X
  @logOne = []
  function cross() { replay(@two, @logOne) }
}
< engine name=M1 for=S>
  .A => .B
  audit @logOne
</>
< engine name=M2 for=T>
  .X => .Y
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const rErrs = errors.filter(e => (e.code ?? "") === "E-REPLAY-003");
    expect(rErrs).toHaveLength(1);
    expect(rErrs[0].message).toContain("Cross-machine replay rejected");
    expect(rErrs[0].message).toContain("'@two'");
    expect(rErrs[0].message).toContain("'M2'");
    expect(rErrs[0].message).toContain("'@logOne'");
    expect(rErrs[0].message).toContain("'M1'");
  });
});

describe("S27 §51.14 — multiple replay call sites validate independently", () => {
  test("one good and one bad call in the same function → only the bad one errors", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @plain = 0
  @log = []
  function mixed() {
    replay(@order, @log)
    replay(@plain, @log)
  }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors } = compile(src);
    const r001 = errors.filter(e => e.code === "E-REPLAY-001");
    expect(r001).toHaveLength(1);
    expect(r001[0].message).toContain("'@plain'");
  });
});
