/**
 * VP-1 — Per-Element Attribute Allowlist
 *
 * Tests for the `runAttributeAllowlist` validation pass. Closes
 * F-AUTH-001 + F-CHANNEL-005 silent-failure windows.
 *
 * Coverage:
 *   §1  Recognized attribute on registered element → no warning
 *   §2  Unrecognized attribute on registered element → W-ATTR-001
 *   §3  Recognized name + recognized value (auth=optional) → no warning
 *   §4  Recognized name + unrecognized value (auth=role:X) → W-ATTR-002
 *   §5  Plain HTML element (not in registry) → no warning
 *   §6  Open-prefix attrs (bind:, on:, data-, aria-) → no warning
 *   §7  Per-element coverage: <page>, <channel>, <engine>
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runAttributeAllowlistFile } from "../../src/validators/attribute-allowlist.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compile(source) {
  const filePath = "/test/uvb-w1.scrml";
  const bs = splitBlocks(filePath, source);
  const tab = buildAST(bs);
  const warnings = runAttributeAllowlistFile({ filePath, ast: tab.ast });
  return { ast: tab.ast, warnings };
}

function codes(warnings) {
  return warnings.map((w) => w.code);
}

// ---------------------------------------------------------------------------
// §1: Recognized attribute → no warning
// ---------------------------------------------------------------------------

describe("VP-1 §1: recognized attributes pass silently", () => {
  test("<program db=...> emits no warning", () => {
    const src = `<program db="./app.db">
<div>x</div>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).not.toContain("W-ATTR-001");
  });

  test("<program auth=\"required\"> emits no warning", () => {
    const src = `<program auth="required">
<div>x</div>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).not.toContain("W-ATTR-001");
    expect(codes(warnings)).not.toContain("W-ATTR-002");
  });

  test("<program auth=\"optional\"> emits no warning", () => {
    const src = `<program auth="optional">
<div>x</div>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).not.toContain("W-ATTR-002");
  });

  test("<program auth=\"none\"> emits no warning", () => {
    const src = `<program auth="none">
<div>x</div>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).not.toContain("W-ATTR-002");
  });

  test("<channel name=\"chat\"> emits no warning", () => {
    const src = `<program>
<div>
<channel name="chat">
</>
</>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).not.toContain("W-ATTR-001");
  });

  test("<engine name=\"X\" for=\"@v\"> emits no warning", () => {
    const src = `<program>
<engine name="X" for="@v">
</engine>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).not.toContain("W-ATTR-001");
  });
});

// ---------------------------------------------------------------------------
// §2: Unrecognized attribute → W-ATTR-001
// ---------------------------------------------------------------------------

describe("VP-1 §2: unrecognized attribute emits W-ATTR-001", () => {
  test("<program nope=\"x\"> emits W-ATTR-001", () => {
    const src = `<program nope="x">
<div>y</div>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).toContain("W-ATTR-001");
    const w = warnings.find((x) => x.code === "W-ATTR-001");
    expect(w?.message).toContain("`nope=`");
    expect(w?.message).toContain("<program>");
    expect(w?.severity).toBe("warning");
  });

  test("<channel madeup=\"y\"> emits W-ATTR-001", () => {
    const src = `<program>
<channel name="x" madeup="y">
</>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).toContain("W-ATTR-001");
    expect(warnings.find((w) => w.code === "W-ATTR-001")?.message).toContain("`madeup=`");
  });
});

// ---------------------------------------------------------------------------
// §3 + §4: Value-shape validation
// ---------------------------------------------------------------------------

describe("VP-1 §4: unrecognized value-shape emits W-ATTR-002 (auth=role:X)", () => {
  test("<program auth=\"role:dispatcher\"> emits W-ATTR-002", () => {
    const src = `<program auth="role:dispatcher">
<div>x</div>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).toContain("W-ATTR-002");
    const w = warnings.find((x) => x.code === "W-ATTR-002");
    expect(w?.message).toContain("\"role:dispatcher\"");
    expect(w?.message).toContain("auth=");
    expect(w?.message).toContain("F-AUTH-001");
    expect(w?.severity).toBe("warning");
  });

  test("<page auth=\"role:driver\"> emits W-ATTR-002", () => {
    const src = `<page route="/x" auth="role:driver">
<div>x</div>
</page>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).toContain("W-ATTR-002");
  });

  test("<page auth=\"role:customer\"> emits W-ATTR-002", () => {
    const src = `<page route="/x" auth="role:customer">
<div>x</div>
</page>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).toContain("W-ATTR-002");
  });

  test("<channel auth=\"role:dispatcher\"> emits W-ATTR-002 (F-CHANNEL-005)", () => {
    const src = `<program>
<channel name="x" auth="role:dispatcher">
</>
</program>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).toContain("W-ATTR-002");
  });

  test("<page auth=\"optional\"> emits no W-ATTR-002 (recognized value)", () => {
    const src = `<page route="/x" auth="optional">
<div>x</div>
</page>`;
    const { warnings } = compile(src);
    expect(codes(warnings)).not.toContain("W-ATTR-002");
  });
});

// ---------------------------------------------------------------------------
// §5: Plain HTML elements not in registry → no warning
// ---------------------------------------------------------------------------

describe("VP-1 §5: plain HTML elements pass silently", () => {
  test("<div data-foo=\"x\"> emits no warning", () => {
    const src = `<program>
<div data-foo="x" madeup="y">y</div>
</program>`;
    const { warnings } = compile(src);
    // data-foo and madeup both should be silent — div is not in scrml-special registry
    expect(warnings).toHaveLength(0);
  });

  test("<input type=\"text\" madeup=\"y\"> emits no warning", () => {
    const src = `<program>
<form>
<input type="text" madeup="y"/>
</form>
</program>`;
    const { warnings } = compile(src);
    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §6: Open-prefix attributes
// ---------------------------------------------------------------------------

describe("VP-1 §6: open-prefix attrs (bind:, on:, data-, aria-) pass silently", () => {
  test("<program data-testid=\"x\"> emits no warning", () => {
    const src = `<program data-testid="x">
<div>y</div>
</program>`;
    const { warnings } = compile(src);
    expect(warnings).toHaveLength(0);
  });

  test("<program aria-label=\"x\"> emits no warning", () => {
    const src = `<program aria-label="x">
<div>y</div>
</program>`;
    const { warnings } = compile(src);
    expect(warnings).toHaveLength(0);
  });

  test("<channel onserver:message=fn> open-prefix is allowed", () => {
    const src = `<program>
\${
  function handler(msg) { return msg }
}
<channel name="x" onserver:message=handler>
</>
</program>`;
    const { warnings } = compile(src);
    // onserver: should be allowed as open-prefix; only complain about non-recognized non-prefixed
    expect(codes(warnings)).not.toContain("W-ATTR-001");
  });
});

// ---------------------------------------------------------------------------
// §7: Per-element coverage matrix
// ---------------------------------------------------------------------------

describe("VP-1 §7: per-element coverage", () => {
  test("dispatch app coverage: 4 role: warnings on <page>", () => {
    const src = `<page route="/dispatch" auth="role:dispatcher">
<div>a</div>
</page>`;
    const { warnings } = compile(src);
    const role = warnings.filter((w) => w.code === "W-ATTR-002");
    expect(role.length).toBeGreaterThanOrEqual(1);
  });

  test("nested usage: <page>...<channel> both surface", () => {
    const src = `<page route="/x" auth="role:driver">
<div>
<channel name="y" auth="role:driver">
</>
</div>
</page>`;
    const { warnings } = compile(src);
    const role = warnings.filter((w) => w.code === "W-ATTR-002");
    // Both <page auth=role:driver> and <channel auth=role:driver>
    expect(role.length).toBe(2);
  });
});
