/**
 * g-component-prop-substitution-skips-when-worker-handler-bodies
 *
 * A prop referenced inside a parent-side worker handler
 * (`when message from <#w> (m) { ... }` / `when error from <#w> (e) { ... }`)
 * declared INSIDE a component leaked as a bare, UNSUBSTITUTED identifier into
 * the emitted worker `.onmessage` / `.onerror` body → ReferenceError / wrong
 * value at runtime.
 *
 * Root: these handlers carry the AST kinds "when-worker-message" /
 * "when-worker-error" (ast-builder). Those kinds are NOT members of the
 * `LogicStatement` discriminated union, so `substitutePropsInLogicStmt`
 * (component-expander) had no `case` for them — they fell through to `default`
 * and were returned UNCHANGED. Codegen emits their body from `bodyRaw`
 * (emit-logic `when-worker-*`), so the raw prop reference shipped verbatim.
 *
 * Fix: substitute prop refs in the handler's raw `bodyRaw` string via
 * `rewriteIdentsInRawExpr` (leading-identifier discipline — `label`→caller
 * value, `x.label` / `mylabel` / string-literal contents untouched), with the
 * handler binding (`m` / `e`) shadowing a same-named prop.
 *
 * Test strategy — two layers:
 *   §A CE-layer (robust, BITING): parse + runCEFile, then inspect the
 *      substituted `bodyRaw` on the expanded worker-handler nodes. This is the
 *      authoritative merge-blocker: it checks the substitution itself, free of
 *      the codegen path's (separate, pre-existing) multi-statement
 *      worker-handler-in-component reconstruction fragility.
 *   §B integration (end-to-end emit): compile a fixture whose body reliably
 *      lowers, and assert the emitted `.onmessage` / `.onerror` carry the
 *      substituted caller value and parse as valid JS.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCEFile } from "../../src/component-expander.js";
import { unwrapChunkScope } from "../helpers/chunk-scope.js";

// The internal worker the parent-side handlers listen to.
const WORKER = `<program name="w">\${ when message(d) { send(d) } }</program>`;

// ---------------------------------------------------------------------------
// §A CE-layer substitution (the biting merge-blocker)
// ---------------------------------------------------------------------------

function collectByKind(root, kind) {
  const out = [];
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node.kind === kind) out.push(node);
    for (const k of Object.keys(node)) {
      if (k === "span") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(root);
  return out;
}

function expandCE(src) {
  const bsOut = splitBlocks("t.scrml", src);
  const tabOut = buildAST(bsOut);
  const ce = runCEFile(tabOut);
  const nodes = ce.ast?.nodes ?? [];
  return {
    ce,
    msg: collectByKind(nodes, "when-worker-message"),
    err: collectByKind(nodes, "when-worker-error"),
    ceErrors: (ce.errors ?? []).filter((e) => (e.code || "").startsWith("E-")),
  };
}

describe("g-component-prop-substitution-skips-when-worker-handler-bodies (CE layer)", () => {
  // A component with a typed `label: string` prop, an internal worker, and BOTH
  // a message and an error handler that reference the prop. The message
  // handler's second statement mixes, in ONE expression: the prop (`label`), a
  // longer identifier (`mylabel`), a member-access tail (`m.label`), and a
  // string literal (`"label"`). The first statement writes the binding (`m`).
  // The backtick template (`hi ${@a}`) routes the component body through the
  // live re-parse path so the worker handlers parse.
  const src =
    `<program>\n` +
    `  \${ const Box = <div props={ label: string }>\n` +
    `    ${WORKER}\n` +
    `    \${ <a> = ""\n` +
    `      <b> = ""\n` +
    `      <t> = \`hi \${@a}\`\n` +
    `      when message from <#w> (m) {\n` +
    `        @a = m\n` +
    `        @b = label + mylabel + m.label + "label"\n` +
    `      }\n` +
    `      when error from <#w> (e) {\n` +
    `        @a = label\n` +
    `      } }\n` +
    `    <p>\${@a}</p>\n` +
    `  </> }\n` +
    `  <Box label="hello"/>\n` +
    `</program>\n`;

  test("§A1 no CE errors — the component expands", () => {
    const { ceErrors } = expandCE(src);
    expect(ceErrors).toHaveLength(0);
  });

  test("§A2 message handler: the prop is substituted with the caller value", () => {
    const { msg } = expandCE(src);
    expect(msg).toHaveLength(1);
    const raw = msg[0].bodyRaw;
    // BITING: pre-fix the RHS opened with the bare, unbound `label`. Post-fix it
    // opens with the caller value.
    expect(raw).toContain(`@b = "hello"`);
    // The bare prop reference must be gone from the write RHS opener.
    expect(raw).not.toMatch(/@b\s*=\s*label\b/);
  });

  test("§A3 message handler: leading-identifier discipline holds", () => {
    const { msg } = expandCE(src);
    const raw = msg[0].bodyRaw;
    // Binding `m` NOT rewritten.
    expect(raw).toMatch(/@a\s*=\s*m\b/);
    // Longer identifier `mylabel` NOT rewritten (no substring match).
    expect(raw).toContain("mylabel");
    expect(raw).not.toContain(`"hello"label`);
    // Member-access tail `.label` preserved on the binding (not substituted).
    expect(raw).toMatch(/m\s*\.\s*label\b/);
    // String-literal content `"label"` untouched.
    expect(raw).toContain(`"label"`);
  });

  test("§A4 error handler: the prop IS substituted (binding `e` does not shadow it)", () => {
    const { err } = expandCE(src);
    expect(err).toHaveLength(1);
    // BITING: pre-fix `@a = label`.
    expect(err[0].bodyRaw).toContain(`@a = "hello"`);
    expect(err[0].bodyRaw).not.toMatch(/@a\s*=\s*label\b/);
  });

  test("§A5 a handler binding named like the prop SHADOWS it (not substituted)", () => {
    // The error handler binding is named `label` — it must shadow the prop, so
    // `@a = label` reads the event binding, NOT the caller value.
    const src2 =
      `<program>\n` +
      `  \${ const Box = <div props={ label: string }>\n` +
      `    ${WORKER}\n` +
      `    \${ <a> = ""\n` +
      `      <t> = \`hi \${@a}\`\n` +
      `      when error from <#w> (label) {\n` +
      `        @a = label\n` +
      `      } }\n` +
      `    <p>\${@a}</p>\n` +
      `  </> }\n` +
      `  <Box label="hello"/>\n` +
      `</program>\n`;
    const { err, ceErrors } = expandCE(src2);
    expect(ceErrors).toHaveLength(0);
    expect(err).toHaveLength(1);
    expect(err[0].bodyRaw).toContain(`@a = label`);
    expect(err[0].bodyRaw).not.toContain(`"hello"`);
  });
});

// ---------------------------------------------------------------------------
// §B end-to-end emit — the substituted value reaches valid emitted JS
// ---------------------------------------------------------------------------

const tmpRoot = resolve(tmpdir(), "scrml-g-component-prop-worker-handler");

function compileToClient(src) {
  const tmpDir = resolve(tmpRoot, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientJs = readFileSync(resolve(outDir, "app.client.js"), "utf-8");
    return { clientJs: unwrapChunkScope(clientJs), errors: result.errors ?? [] };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// The PARENT-side worker handler (`const <binding> = event.data`), not the
// worker's own internal `when message(d)` listener.
function parentOnmessageBody(clientJs) {
  const m = clientJs.match(/onmessage\s*=\s*function\(event\)\s*\{([\s\S]*?)\};/);
  return m ? m[1] : "";
}
function onerrorBody(clientJs) {
  const m = clientJs.match(/onerror\s*=\s*function\([^)]*\)\s*\{([\s\S]*?)\};/);
  return m ? m[1] : "";
}

describe("g-component-prop-substitution-skips-when-worker-handler-bodies (emit)", () => {
  // A shape that reliably lowers to valid JS (2-statement handlers). Covers the
  // message AND error handler end-to-end.
  const src =
    `<program>\n` +
    `  \${ const Box = <div props={ label: string }>\n` +
    `    ${WORKER}\n` +
    `    \${ <a> = ""\n` +
    `      <b> = ""\n` +
    `      <tag> = \`hi \${label}\`\n` +
    `      when message from <#w> (m) {\n` +
    `        @a = m\n` +
    `        @b = label\n` +
    `      }\n` +
    `      when error from <#w> (e) {\n` +
    `        @a = e\n` +
    `        @b = label\n` +
    `      } }\n` +
    `    <p>\${@a}-\${@b}-\${@tag}</p>\n` +
    `  </> }\n` +
    `  <Box label="hello"/>\n` +
    `</program>\n`;

  test("§B1 compiles with no codegen error", () => {
    const { errors } = compileToClient(src);
    expect(errors.filter((e) => e.severity === "error" || (e.code || "").startsWith("E-"))).toHaveLength(0);
  });

  test("§B2 the emitted message handler substitutes the prop", () => {
    const { clientJs } = compileToClient(src);
    const body = parentOnmessageBody(clientJs);
    // BITING: pre-fix the RHS was the bare, unbound `label`.
    expect(body).toContain(`"hello"`);
    expect(body).not.toMatch(/,\s*label\s*\)/);
  });

  test("§B3 the emitted error handler substitutes the prop", () => {
    const { clientJs } = compileToClient(src);
    const body = onerrorBody(clientJs);
    expect(body).toContain(`"hello"`);
    expect(body).not.toMatch(/,\s*label\s*\)/);
  });

  test("§B4 the emitted handler bodies are valid JS", () => {
    const { clientJs } = compileToClient(src);
    // Parse-check: a SyntaxError would throw here. Identifiers may be unbound
    // (that is a runtime concern) — we only assert the body PARSES.
    expect(() => new Function("event", parentOnmessageBody(clientJs))).not.toThrow();
    expect(() => new Function("e", onerrorBody(clientJs))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §C converge: the SAME leak in every OTHER `when …` handler kind that codegen
// emits from `bodyRaw` — `when-effect` (emit-logic), the worker SELF-handler
// `when message(d)` (emit-worker), and a prop referenced only inside a `${…}`
// template interpolation. One shared substitution path now covers them all.
// ---------------------------------------------------------------------------

describe("g-component-prop-substitution-skips-when-worker-handler-bodies (sibling handler kinds)", () => {
  // §C1 when-effect: `when @dep changes { @out = label }` emits from bodyRaw.
  test("§C1 when-effect body substitutes the prop", () => {
    const src =
      `<program>\n` +
      `  \${ const Box = <div props={ label: string }>\n` +
      `    \${ <dep> = 0\n` +
      `      <out> = ""\n` +
      `      <t> = \`hi \${@out}\`\n` +
      `      when @dep changes {\n` +
      `        @out = label\n` +
      `      } }\n` +
      `    <button onclick={ @dep = @dep + 1 }>go</button>\n` +
      `    <p>\${@out}</p>\n` +
      `  </> }\n` +
      `  <Box label="hello"/>\n` +
      `</program>\n`;
    const { ce, ceErrors } = expandCE(src);
    expect(ceErrors).toHaveLength(0);
    const eff = collectByKind(ce.ast?.nodes ?? [], "when-effect");
    expect(eff).toHaveLength(1);
    // BITING: pre-fix `@out = label` (bare, unbound).
    expect(eff[0].bodyRaw).toContain(`@out = "hello"`);
    expect(eff[0].bodyRaw).not.toMatch(/@out\s*=\s*label\b/);
  });

  // §C2 worker SELF-handler: `when message(d) { send(label) }` inside the
  // component's `<program name="w">` emits its bodyRaw into a SEPARATE worker
  // bundle/thread scope (generateWorkerJs) — NOT the component scope. This pass
  // DELIBERATELY does not substitute props there: a non-literal prop would emit
  // parent state the worker cannot resolve, and a worker-local decl could be
  // clobbered. Correct worker-scope substitution is its own arc, filed as
  // g-component-prop-worker-self-handler-substitution-needs-worker-scope-awareness.
  test("§C2 worker self-handler body is NOT prop-substituted (deferred, worker scope)", () => {
    const src =
      `<program>\n` +
      `  \${ const Box = <div props={ label: string }>\n` +
      `    <program name="w">\${ when message(d) { send(label) } }</program>\n` +
      `    \${ <out> = ""\n` +
      `      <t> = \`hi \${@out}\`\n` +
      `      when message from <#w> (m) { @out = m } }\n` +
      `    <p>\${@out}</p>\n` +
      `  </> }\n` +
      `  <Box label="hello"/>\n` +
      `</program>\n`;
    const { ce, ceErrors } = expandCE(src);
    expect(ceErrors).toHaveLength(0);
    // The SELF-handler is kind "when-message" (no workerName); the parent handler
    // (`@out = m`) is "when-worker-message".
    const self = collectByKind(ce.ast?.nodes ?? [], "when-message");
    expect(self).toHaveLength(1);
    // The prop stays a bare ref in worker scope (deferred); it is NOT baked in.
    expect(self[0].bodyRaw).toMatch(/\blabel\b/);
    expect(self[0].bodyRaw).not.toContain(`"hello"`);
  });

  // §C3 template blind spot: a prop referenced ONLY inside a `${…}` template
  // interpolation in the handler body.
  test("§C3 a prop inside a ${...} template interpolation is substituted", () => {
    const src =
      `<program>\n` +
      `  \${ const Box = <div props={ label: string }>\n` +
      `    ${WORKER}\n` +
      `    \${ <out> = ""\n` +
      `      <t> = \`hi \${@out}\`\n` +
      `      when message from <#w> (m) {\n` +
      `        @out = m\n` +
      `        send(\`done: \${label}\`)\n` +
      `      } }\n` +
      `    <p>\${@out}</p>\n` +
      `  </> }\n` +
      `  <Box label="hello"/>\n` +
      `</program>\n`;
    const { ce, ceErrors } = expandCE(src);
    expect(ceErrors).toHaveLength(0);
    const msg = collectByKind(ce.ast?.nodes ?? [], "when-worker-message");
    expect(msg).toHaveLength(1);
    // BITING: pre-fix `${label}` shipped verbatim (rewriteIdentsInRawExpr skipped
    // the whole template). Post-fix the interpolation carries the caller value.
    expect(msg[0].bodyRaw).toContain(`\${"hello"}`);
    expect(msg[0].bodyRaw).not.toContain(`\${label}`);
  });

  // §C4 default-binding shadow (regression guard). A prop named `data` with an
  // OMITTED handler binding must NOT be substituted into the handler body — the
  // implicit parameter is named `data` (ast-builder default, matching codegen's
  // `node.binding ?? "data"`). NOTE: this passes on the pre-fix source too — the
  // ast-builder already defaults `binding` to "data", so the existing shadow
  // covers it; this guards the behavior + the WHEN_HANDLER_DEFAULT_BINDING
  // symmetry against future drift.
  test("§C4 a prop named `data` with an omitted binding is NOT clobbered", () => {
    const src =
      `<program>\n` +
      `  \${ const Box = <div props={ data: string }>\n` +
      `    ${WORKER}\n` +
      `    \${ <out> = ""\n` +
      `      <t> = \`hi \${@out}\`\n` +
      `      when message from <#w> { @out = data } }\n` +
      `    <p>\${@out}</p>\n` +
      `  </> }\n` +
      `  <Box data="hello"/>\n` +
      `</program>\n`;
    const { ce, ceErrors } = expandCE(src);
    expect(ceErrors).toHaveLength(0);
    const msg = collectByKind(ce.ast?.nodes ?? [], "when-worker-message");
    expect(msg).toHaveLength(1);
    // `data` stays the handler parameter read, NOT the caller value.
    expect(msg[0].bodyRaw).toMatch(/@out\s*=\s*data\b/);
    expect(msg[0].bodyRaw).not.toContain(`"hello"`);
  });
});
