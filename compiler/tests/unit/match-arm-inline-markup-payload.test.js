/**
 * match-arm-inline-markup-payload.test.js — Bug 6.5 (S87): match-arm-block
 * payload bindings must reach the codegen prelude when the arm body is a
 * `lift <markup>${binding}</markup>` expression (or any structuredBody that
 * references the binding).
 *
 * Pre-Bug-6.5 behavior:
 *   `.Failed(msg) => { lift <div>${msg}</div> }` parsed `payloadBindings: ["msg"]`
 *   on the AST node, but `emitMatchExpr` constructed `MatchArm.binding = null`
 *   when ingesting the `match-arm-block` AST shape — dropping the binding before
 *   `emitVariantBindingPrelude` could see it. The lifted markup emitted bare
 *   `String(msg ?? "")` referencing an undefined `msg` identifier.
 *
 * Post-Bug-6.5 behavior:
 *   `child.payloadBindings.join(", ")` flows into `arm.binding`, matching the
 *   text-path shape that `parseBindingList` consumes. The prelude
 *   `const msg = subject.data.<field>` lands before the lift body.
 *
 * Block-body (non-structured) and inline-arm paths were already correct
 * pre-fix — those are covered by `gauntlet-s22/payload-variants-match.test.js`.
 * This file's regression guard ensures the structured-body block path
 * (the gap closed by Bug 6.5) stays closed.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `bug-6_5-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_bug-6_5_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const allErrors = result.errors ?? [];
    const fatal = allErrors.filter(e => e.severity !== "warning");
    const clientPath = resolve(outDir, `${testName}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: allErrors, fatal, clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("Bug 6.5 — match-arm-block payload binding flows into lift-markup arm bodies", () => {
  test("single-binding lift-markup arm emits `const msg = subject.data.<field>` prelude", () => {
    // Mirror of examples/16-remote-data .Failed(msg) → { lift <p>${msg}</p> }.
    const src = `<program>
\${
  type S:enum = {
    A
    B(message: string)
  }
  <state>: S = .A
}

<div>
  \${
    match @state {
      .A => { lift <p>idle</p> }
      .B(msg) => { lift <p>\${msg}</p> }
    }
  }
</div>
</>
`;
    const { fatal, clientJs } = compileSrc(src, "single-binding");
    expect(fatal).toEqual([]);
    // Prelude must appear inside the .B arm before the lift body fires.
    expect(clientJs).toMatch(/const msg = _scrml_match_\d+\.data\.message;\s*_scrml_lift\(/);
    // Sanity: the `msg` reference still lands in the lift, parenthesized before
    // the `?? ""` guard (GITI-019: `String((msg) ?? "")`).
    expect(clientJs).toMatch(/String\(\(msg\) \?\? ""\)/); // GITI-019: source expr parenthesized before `?? ""`
  });

  test("multi-binding lift-markup arm emits one prelude line per binding", () => {
    const src = `<program>
\${
  type Pair:enum = {
    Wait
    Two(left: string, right: string)
  }
  <pair>: Pair = .Wait
}

<div>
  \${
    match @pair {
      .Wait => { lift <p>waiting</p> }
      .Two(l, r) => { lift <p>\${l}-\${r}</p> }
    }
  }
</div>
</>
`;
    const { fatal, clientJs } = compileSrc(src, "multi-binding");
    expect(fatal).toEqual([]);
    // Both bindings resolve positionally to declared field names.
    expect(clientJs).toMatch(/const l = _scrml_match_\d+\.data\.left;/);
    expect(clientJs).toMatch(/const r = _scrml_match_\d+\.data\.right;/);
    // Both must appear BEFORE the lift body in the same arm branch.
    expect(clientJs).toMatch(
      /const l = _scrml_match_\d+\.data\.left;\s*const r = _scrml_match_\d+\.data\.right;\s*_scrml_lift\(/,
    );
  });

  test("no-binding arm regression guard — `.A => { lift <p>x</p> }` emits no spurious prelude", () => {
    const src = `<program>
\${
  type S:enum = {
    A
    B(message: string)
  }
  <state>: S = .A
}

<div>
  \${
    match @state {
      .A => { lift <p>idle</p> }
      .B(msg) => { lift <p>\${msg}</p> }
    }
  }
</div>
</>
`;
    const { fatal, clientJs } = compileSrc(src, "no-binding-regression");
    expect(fatal).toEqual([]);
    // The .A arm body must NOT receive a `const _ = subject.data.*` prelude.
    // Anchor on `_scrml_tag_X === "A"` and verify no `.data.` access slips in.
    const aArmMatch = clientJs.match(/_scrml_tag_\d+ === "A"\)\s*\{[^}]*\}/);
    expect(aArmMatch).not.toBeNull();
    expect(aArmMatch[0]).not.toMatch(/_scrml_match_\d+\.data\./);
  });

  test("discard binding (`_`) on lift-markup arm emits no spurious `const _ = ...` line", () => {
    // Discards collapse to no-op in the prelude per parseBindingList +
    // emitVariantBindingPrelude; the lift body is still wired.
    const src = `<program>
\${
  type Pair:enum = {
    Wait
    Two(left: string, right: string)
  }
  <pair>: Pair = .Wait
}

<div>
  \${
    match @pair {
      .Wait => { lift <p>waiting</p> }
      .Two(l, _) => { lift <p>\${l}</p> }
    }
  }
</div>
</>
`;
    const { fatal, clientJs } = compileSrc(src, "discard-binding");
    expect(fatal).toEqual([]);
    // The kept binding is declared.
    expect(clientJs).toMatch(/const l = _scrml_match_\d+\.data\.left;/);
    // The discard slot must NOT introduce `const _ = ...`.
    expect(clientJs).not.toMatch(/const _ = _scrml_match_\d+\.data\.right;/);
  });

  test("Bug 6.5 repro shape — examples/16-remote-data .Failed(msg) pattern compiles with prelude", () => {
    // Verbatim shape lifted from examples/16-remote-data.scrml (body trimmed
    // to just the .Failed arm + minimal exhaustive context). This is the exact
    // pattern Bug 6 dispatch surfaced.
    const src = `<program>
\${
  type ContactsState:enum = {
    NotAsked
    Loading
    Ready(rows)
    Failed(message: string)
  }
  <state>: ContactsState = .NotAsked
}

<div>
  \${
    match @state {
      .NotAsked => { lift <p>idle</p> }
      .Loading => { lift <p>loading</p> }
      .Ready(rows) => { lift <p>ready</p> }
      .Failed(msg) => { lift <div><p>Failed: \${msg}</p></div> }
    }
  }
</div>
</>
`;
    const { fatal, clientJs } = compileSrc(src, "remote-data-repro");
    expect(fatal).toEqual([]);
    // The prelude must precede the lift; bare `msg` reference must be present
    // in the lifted text node — together they prove the binding flows through
    // both the codegen prelude AND the lift expression's interp.
    expect(clientJs).toMatch(/const msg = _scrml_match_\d+\.data\.message;\s*_scrml_lift\(/);
    expect(clientJs).toMatch(/String\(\(msg\) \?\? ""\)/); // GITI-019: source expr parenthesized before `?? ""`
  });
});
