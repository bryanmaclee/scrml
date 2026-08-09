/**
 * g-nested-each-in-match-arm-drops-diagnostics (S316) — regression pin.
 *
 * The read-side E-STATE-UNDECLARED walk (type-system.ts checkLogicExprIdents,
 * post-CE) reaches a `<match>` arm body ONLY through the walkable
 * `armBodyChildren` wrapper's `children`. An each-bearing bare-body arm is
 * BLANKED (`children:[]`) by ast-builder's `buildMatchArmBodyChildren` to avoid
 * the S153 `collectEachBlocks(fileAST)` double-emit — but that blanking ALSO
 * dropped the read-side walk for EVERY read inside such an arm:
 *
 *   (d) headline — an undeclared `@cell` read inside an `<each>` NESTED in a
 *       `<match>` arm produced NO diagnostic, though it fires at top level, in
 *       a bare `<each>`, and in a `<match>` arm directly.
 *   (e) broader  — a DIRECT `@cell` read that merely SHARES an arm with an
 *       `<each>` sibling was ALSO dropped (the guard keys on the whole arm body
 *       text containing `<each>`, not the each subtree).
 *
 * Fix (blanking UNCHANGED — codegen/collectEachBlocks untouched): ast-builder
 * stamps the raw arm body + its absolute file coordinates on the (still-blank)
 * wrapper; the type-system re-parses it LOCALLY (throwaway ids, discarded after
 * the walk, never attached to fileAST) and runs the read-side walk with correct
 * source spans. This test pins BOTH holes on REAL compiled source, plus the
 * clean twin (a DECLARED cell in the same shape does NOT fire) and the
 * no-double-emit invariant (exactly one `<each>` render fn is emitted).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const FIXTURE_DIR = "/tmp/g-nested-each-in-match-arm-fixtures";
mkdirSync(FIXTURE_DIR, { recursive: true });

function compileSource(source, filename) {
  const filePath = join(FIXTURE_DIR, filename);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(FIXTURE_DIR, "dist"),
    write: false,
  });
  const errors = result.errors ?? [];
  const warnings = result.warnings ?? [];
  const first = [...(result.outputs ?? new Map()).values()][0];
  return {
    errors,
    warnings,
    clientJs: (first && first.clientJs) || "",
  };
}

function undeclaredFor({ errors, warnings }, cell) {
  return [...errors, ...warnings].filter(
    (d) => d.code === "E-STATE-UNDECLARED" && typeof d.message === "string" && d.message.includes("@" + cell),
  );
}

const DECLS = `\${
  type Phase:enum = { A, B }
  <items> = [1, 2]
  <phase>: Phase = Phase.A
}`;

describe("g-nested-each-in-match-arm-drops-diagnostics (S316)", () => {
  test("(d) headline — undeclared read inside an <each> NESTED in a <match> arm fires E-STATE-UNDECLARED with the real source line", () => {
    const source = `${DECLS}
<program>
  <match for=Phase on=@phase>
    <A>
      <each in=@items>
        <p>\${@nestedEachInMatchUndeclared}</p>
      </each>
    </>
    <B> <div>b</div> </>
  </match>
</program>`;
    const result = compileSource(source, "d-nested.scrml");
    const fired = undeclaredFor(result, "nestedEachInMatchUndeclared");
    expect(fired.length).toBeGreaterThanOrEqual(1);
    // Span rebasing: the read is on source line 10 (`        <p>${@nested...`).
    expect(fired[0].span && fired[0].span.line).toBe(10);
    // [0] S239 leak — the re-parse must report the REAL source file, NOT a
    // synthetic "…#match-arm-each" path (which breaks editor jump-to-location).
    expect(fired[0].span && fired[0].span.file).toContain("d-nested.scrml");
    expect(fired[0].span && fired[0].span.file).not.toContain("#match-arm-each");
  });

  test("[2] S239 leak — DEPTH-2 (each-in-match nested inside each-in-match) reports the REAL source line", () => {
    const source = `\${
  type Phase:enum = { A, B }
  type Mood:enum = { Hi, Lo }
  <items> = [1, 2]
  <rows> = [3, 4]
  <phase>: Phase = Phase.A
  <mood>: Mood = Mood.Hi
}
<program>
  <match for=Phase on=@phase>
    <A>
      <each in=@items>
        <match for=Mood on=@mood>
          <Hi>
            <each in=@rows>
              <p>\${@depth2Undeclared}</p>
            </each>
          </>
          <Lo> <div>lo</div> </>
        </match>
      </each>
    </>
    <B> <div>b</div> </>
  </match>
</program>`;
    const result = compileSource(source, "depth2.scrml");
    const fired = undeclaredFor(result, "depth2Undeclared");
    expect(fired.length).toBeGreaterThanOrEqual(1);
    // The read is on source line 16; before the depth-2 fix it mislocated
    // (body-local, ~line 5) or was off-by-one (line 15).
    expect(fired[0].span && fired[0].span.line).toBe(16);
    expect(fired[0].span && fired[0].span.file).toContain("depth2.scrml");
  });

  test("[4] S239 leak — the re-parse does NOT clobber real nodes (no spurious diagnostics on real top-level constructs)", () => {
    // The throwaway re-parse gets buildAST ids 0,1,2… that collide with real
    // top-level node ids; without id-reindexing they overwrite real nodes'
    // cached types in the shared nodeTypes memo. This fixture surrounds the
    // each-in-match-arm with heavily-typed real constructs (two matches, a fn
    // reading a state cell, typed state decls). The ONLY diagnostic must be the
    // one intended undeclared read — no spurious E-TYPE-*/E-MATCH-* on the real
    // nodes whose ids the re-parse would otherwise squat.
    const source = `\${
  type Phase:enum = { A, B }
  type Status:enum = { Todo, Done }
  <items> = [1, 2]
  <phase>: Phase = Phase.A
  <status>: Status = Status.Todo
  function label() { return @status.variant }
}
<program>
  <p>\${label()}</p>
  <match for=Status on=@status>
    <Todo> <span>todo</span> </>
    <Done> <span>done</span> </>
  </match>
  <match for=Phase on=@phase>
    <A>
      <each in=@items>
        <p>\${@readInNestedEach}</p>
      </each>
    </>
    <B> <div>b</div> </>
  </match>
</program>`;
    const result = compileSource(source, "nt-poison.scrml");
    // Exactly the intended undeclared read fires…
    expect(undeclaredFor(result, "readInNestedEach").length).toBeGreaterThanOrEqual(1);
    // …and NO real-node type/match diagnostic is spuriously produced (a clobbered
    // memo could corrupt the two real matches' or the fn's resolved types).
    const realDefects = result.errors.filter(
      (e) => e.code !== "E-STATE-UNDECLARED" &&
        (e.severity === undefined || e.severity === "error"),
    );
    expect(realDefects.map((e) => e.code)).toEqual([]);
  });

  test("(e) broader — a DIRECT read that merely SHARES a <match> arm with an <each> sibling ALSO fires", () => {
    const source = `${DECLS}
<program>
  <match for=Phase on=@phase>
    <A>
      <p>\${@directReadSharingArmWithEach}</p>
      <each in=@items>
        <span>plain</span>
      </each>
    </>
    <B> <div>b</div> </>
  </match>
</program>`;
    const result = compileSource(source, "e-directread.scrml");
    const fired = undeclaredFor(result, "directReadSharingArmWithEach");
    expect(fired.length).toBeGreaterThanOrEqual(1);
    // Span rebasing: the direct read is on source line 9.
    expect(fired[0].span && fired[0].span.line).toBe(9);
  });

  test("clean twin — a DECLARED cell read in the SAME nested-each-in-arm shape does NOT fire", () => {
    const source = `\${
  type Phase:enum = { A, B }
  <items> = [1, 2]
  <phase>: Phase = Phase.A
  <label> = "hi"
}
<program>
  <match for=Phase on=@phase>
    <A>
      <each in=@items>
        <p>\${@label}</p>
      </each>
    </>
    <B> <div>b</div> </>
  </match>
</program>`;
    const result = compileSource(source, "clean-twin.scrml");
    expect(undeclaredFor(result, "label").length).toBe(0);
  });

  test("no double-emit — a valid <each> in a <match> arm emits EXACTLY ONE each render fn", () => {
    const source = `\${
  type Phase:enum = { A, B }
  <items> = ["x", "y", "z"]
  <phase>: Phase = Phase.A
}
<program>
  <match for=Phase on=@phase>
    <A>
      <ul>
        <each in=@items as it>
          <li>\${it}</li>
        </each>
      </ul>
    </>
    <B> <div>b</div> </>
  </match>
</program>`;
    const result = compileSource(source, "render-each-in-arm.scrml");
    expect(result.errors.filter((e) => e.severity !== "warning" && e.severity !== "info").length).toBe(0);
    // Exactly one each render-fn DEFINITION (not two — no phantom each-block).
    const defs = result.clientJs.match(/function\s+_scrml_each_render_[A-Za-z0-9_]+/g) || [];
    expect(defs.length).toBe(1);
  });
});
