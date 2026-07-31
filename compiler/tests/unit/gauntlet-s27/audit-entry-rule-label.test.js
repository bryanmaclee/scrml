/**
 * S27 gauntlet — §51.11.4 audit entry shape extension (§2b G, slice 1).
 *
 * Extends the audit entry shape from {from, to, at} to
 * {from, to, at, rule, label}. `rule` is the canonical transition-table
 * key the runtime resolved to (with wildcards preserved); `label` is the
 * identifier from a labeled guard on the matched rule, else null.
 *
 * Tests exercise:
 *   - transition table gains `label: "..."` on labeled-guard rules
 *   - transition guard emits __matchedKey + __auditLabel as sibling locals
 *   - runtime: exact-rule transition → rule: "From:To", label: null
 *   - runtime: wildcard-rule transition → rule: "*:To" / "From:*" / "*:*"
 *   - runtime: labeled-guard rule → label: "foo"
 *   - runtime: multiple transitions accumulate entries in order
 *
 * All runtime assertions execute the emitted client.js in a Node vm to
 * avoid coupling to happy-dom. Scheduling this file under /tmp (not the
 * test dir) keeps bun test from re-globbing the compiler output.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../../src/api.js";
import { SCRML_RUNTIME } from "../../../src/runtime-template.js";
import { extractUserFns } from "../../helpers/extract-user-fns.js";
import { unwrapChunkScope } from "../../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-s27-audit-shape");
let tmpCounter = 0;

function compileSrc(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientJsPath = resolve(outDir, "app.client.js");
    const clientJs = existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "";
    return {
      errors: result.errors ?? [],
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Instantiate the emitted client.js alongside the real scrml runtime in a
 * fresh Function() scope. Executes the user-defined function(s) in source
 * order, then returns the reactive state for inspection.
 *
 * `userFnCount` is the number of user functions to invoke (in declaration
 * order). Function names are mangled to `_scrml_<name>_<counter>` per
 * var-counter.ts; we detect them via regex on the compiled output rather
 * than hard-coding the mangled form.
 *
 * DOM shims: the runtime probes for `document`/`window` during
 * DOMContentLoaded wiring; minimal no-op stubs are provided.
 */
function runClientAndInvoke(clientJs, userFnCount) {
  // User functions are emitted top-level as `function _scrml_<safe>_<N>()`.
  // Compiler-internal helpers (projections, derived) share the prefix but
  // with known infixes — exclude them explicitly.
  const userFns = extractUserFns(clientJs);
  const toInvoke = userFns.slice(0, userFnCount);
  const callList = toInvoke.map(n => `${n}();`).join("\n");
  // The runtime CSS injector and DOMContentLoaded wiring both gate on
  // `typeof document === "undefined"`. Leaving document unset lets them
  // skip cleanly; the only runtime paths we exercise are reactive
  // set/get and the machine transition guard IIFE, which don't touch
  // the DOM.
  const shims = `
    var requestAnimationFrame = function() {};
    var cancelAnimationFrame = function() {};
  `;
  const fnBody =
    shims + "\n" +
    SCRML_RUNTIME + "\n" +
    // The chunk is wrapped in its own scope; this harness invokes the chunk's
    // user fns by name and reads _scrml_state by bare key, so unwrap it.
    unwrapChunkScope(clientJs) + "\n" +
    callList + "\n" +
    "return { state: _scrml_state, userFns: " + JSON.stringify(toInvoke) + " };";
  // eslint-disable-next-line no-new-func
  const runner = new Function(fnBody);
  return runner();
}

describe("S27 §51.11.4 — transition table embeds labels", () => {
  test("labeled guarded rule → table entry carries label field", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  const @gate: boolean = true
  @log = []
  function step() { @order = S.B }
}
< engine name=M for=S>
  .A => .B given (@gate) [gateway]
  .B => .C
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Labeled rule carries `label:` in the table entry alongside guard:true
    expect(clientJs).toContain('"A:B": { guard: true, label: "gateway" }');
    // Unlabeled rule unchanged
    expect(clientJs).toContain('"B:C": true');
  });

  test("unlabeled guarded rule → table entry unchanged", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  const @gate: boolean = true
  @log = []
  function step() { @order = S.B }
}
< engine name=M for=S>
  .A => .B given (@gate)
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain('"A:B": { guard: true }');
    // The table entry must NOT carry a label field. (The audit-push block
    // still names __auditLabel; scope the assertion to the table literal.)
    // Extract via indexOf instead of regex — entries contain `{}` which
    // breaks naive `[^}]*` scoping.
    const startIdx = unwrapChunkScope(clientJs).indexOf("const __scrml_transitions_M = {");
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = unwrapChunkScope(clientJs).indexOf("\n};", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const tableLiteral = unwrapChunkScope(clientJs).slice(startIdx, endIdx);
    expect(tableLiteral).not.toContain("label:");
  });
});

describe("S27 §51.11.4 — transition guard emits matched-key + audit-label", () => {
  test("guard IIFE declares __matchedKey via fallback chain", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function step() { @order = S.B }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    expect(clientJs).toContain("var __matchedKey = (__scrml_transitions_M[__key] != null) ? __key");
    expect(clientJs).toContain('(__scrml_transitions_M["*:" + __nextVariant] != null) ? ("*:" + __nextVariant)');
    expect(clientJs).toContain('(__scrml_transitions_M[__prevVariant + ":*"] != null) ? (__prevVariant + ":*")');
    expect(clientJs).toContain('(__scrml_transitions_M["*:*"] != null) ? "*:*"');
    expect(clientJs).toContain("var __rule = __matchedKey != null ? __scrml_transitions_M[__matchedKey] : null;");
  });

  test("audit push extracts label from matched rule or null", () => {
    const src = `<program>
\${
  type S:enum = { A, B }
  @order: M = S.A
  @log = []
  function step() { @order = S.B }
}
< engine name=M for=S>
  .A => .B
  audit @log
</>
<p>x</>
</program>
`;
    const { clientJs } = compileSrc(src);
    expect(clientJs).toContain('var __auditLabel = (__rule != null && typeof __rule === "object" && __rule.label != null) ? __rule.label : null;');
    expect(clientJs).toContain("rule: __matchedKey, label: __auditLabel");
  });
});

describe("S27 §51.11.4 — runtime entry shape", () => {
  test("exact rule match → rule: 'From:To', label: null", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  @log = []
  function step() { @order = S.B }
}
< engine name=M for=S>
  .A => .B
  .B => .C
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const { state } = runClientAndInvoke(clientJs, 1);
    expect(state.log).toHaveLength(1);
    expect(state.log[0].rule).toBe("A:B");
    expect(state.log[0].label).toBeNull();
    // Unit variants emit as bare strings (§51.3.2 / emitEnumVariantObjects),
    // so `from` / `to` in the entry are plain strings, not {variant,data}
    // objects. S27 bug fix #6 (unit-variant lookup) ensures the table
    // still resolves `"A:B"` correctly for bare strings.
    expect(state.log[0].from).toBe("A");
    expect(state.log[0].to).toBe("B");
    expect(typeof state.log[0].at).toBe("number");
  });

  test("wildcard target rule (*:X) → rule: '*:X'", () => {
    const src = `<program>
\${
  type S:enum = { Idle, Running, Failed }
  @order: M = S.Idle
  @log = []
  function fail() { @order = S.Failed }
}
< engine name=M for=S>
  .Idle => .Running
  * => .Failed
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const { state } = runClientAndInvoke(clientJs, 1);
    expect(state.log[0].rule).toBe("*:Failed");
    expect(state.log[0].label).toBeNull();
  });

  test("wildcard source rule (X:*) → rule: 'X:*'", () => {
    const src = `<program>
\${
  type S:enum = { Start, Anywhere, Special }
  @order: M = S.Start
  @log = []
  function anywhere() { @order = S.Anywhere }
  function special() { @order = S.Special }
}
< engine name=M for=S>
  .Start => .Special
  .Start => *
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // Invoke `anywhere()` only (the first of two user functions declared).
    const { state } = runClientAndInvoke(clientJs, 1);
    // Exact rule Start:Special is declared, so Start:Anywhere must fall
    // back to the wildcard-target rule Start:*.
    expect(state.log[0].rule).toBe("Start:*");
  });

  test("full wildcard rule (*:*) → rule: '*:*'", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C }
  @order: M = S.A
  @log = []
  function anyJump() { @order = S.C }
}
< engine name=M for=S>
  .A => .B
  * => *
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const { state } = runClientAndInvoke(clientJs, 1);
    // A:C isn't declared; *:B isn't declared either; A:* isn't declared;
    // must fall back to *:*.
    expect(state.log[0].rule).toBe("*:*");
  });

  test("labeled guard on exact rule → label captured on that transition", () => {
    // Literal guard (`true`) so we don't have to wire a reactive through
    // the runtime — the guard still fires and the label on the matched
    // rule is still what the audit entry records.
    const src = `<program>
\${
  type S:enum = { Draft, Submitted, Archived }
  @order: M = S.Draft
  @log = []
  function submit() { @order = S.Submitted }
  function archive() { @order = S.Archived }
}
< engine name=M for=S>
  .Draft => .Submitted given (true) [readiness]
  .Submitted => .Archived
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    // submit() fires first, then archive() — two user functions, invoked
    // in declaration order.
    const { state } = runClientAndInvoke(clientJs, 2);
    expect(state.log).toHaveLength(2);
    expect(state.log[0].rule).toBe("Draft:Submitted");
    expect(state.log[0].label).toBe("readiness");
    expect(state.log[1].rule).toBe("Submitted:Archived");
    expect(state.log[1].label).toBeNull();
  });

  test("multiple transitions accumulate entries in order", () => {
    const src = `<program>
\${
  type S:enum = { A, B, C, D }
  @order: M = S.A
  @log = []
  function next() {
    @order = S.B
    @order = S.C
    @order = S.D
  }
}
< engine name=M for=S>
  .A => .B
  .B => .C
  .C => .D
  audit @log
</>
<p>x</>
</program>
`;
    const { errors, clientJs } = compileSrc(src);
    expect(errors.filter(e => e.severity !== "warning")).toEqual([]);
    const { state } = runClientAndInvoke(clientJs, 1);
    expect(state.log).toHaveLength(3);
    expect(state.log.map(e => e.rule)).toEqual(["A:B", "B:C", "C:D"]);
    // All entries have null label (no guards)
    expect(state.log.every(e => e.label === null)).toBe(true);
    // Monotonic timestamps
    expect(state.log[0].at).toBeLessThanOrEqual(state.log[1].at);
    expect(state.log[1].at).toBeLessThanOrEqual(state.log[2].at);
  });
});
