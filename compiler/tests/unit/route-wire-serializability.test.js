/**
 * E-ROUTE-003 (return) + E-ROUTE-004 (param) — server-fn wire-serializability
 * gate (§12.5 / §34).
 *
 * Every server-escalated function crosses the §12.3 client↔server network
 * boundary; its arguments and return value are serialized as JSON. A type that
 * is NOT JSON-serializable cannot be transmitted:
 *
 *   - a non-serializable RETURN type → E-ROUTE-003 (the SPEC §12.5.3 reject —
 *     prior to S179 it was emitted NOWHERE; this gate wires it).
 *   - a non-serializable PARAMETER type → E-ROUTE-004 (NEW S179 — the
 *     parameter-direction companion).
 *
 * Non-serializable kinds: function (`fn()`), markup/snippet, cssClass, engine/
 * machine, state. The gate recurses into struct fields / array elements / union
 * members / map values. `asIs` (and `unknown`) is the deliberate escape hatch
 * (§14.1.1) and is ALLOWED (never errored).
 *
 * Both codes are Errors → result.errors (CLI exit 1). Tests assert via a
 * CROSS-STREAM helper so a stream-partition regression (an E- code silently
 * moving into result.warnings) is caught rather than silently passing (the
 * S92 false-negative trap).
 *
 * The gate lives in the type pass (type-system.ts `checkRouteWireSerializability`,
 * wired in `processFile` after the imported-types seed) — it consumes the §12 RI
 * route map for the per-fn server classification and resolves the param/return
 * type annotations against the file's typeRegistry. SHARED fire site → covers
 * both the default BS+Acorn pipeline and the scrml-native parser.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "route-wire-serial-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

function compile(src) {
  const fp = join(TMP, `f-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(fp, src);
  return compileScrml({ inputFiles: [fp], outputDir: join(TMP, "dist"), write: false, log: () => {} });
}

// Cross-stream helper: E- codes partition to result.errors, but collect over
// BOTH streams so a partition regression (E- code landing in result.warnings)
// is caught rather than silently passing.
function diags(res, code) {
  return [...(res.errors || []), ...(res.warnings || [])].filter((d) => d.code === code);
}
const e003 = (res) => diags(res, "E-ROUTE-003");
const e004 = (res) => diags(res, "E-ROUTE-004");

// ---------------------------------------------------------------------------
// NEGATIVE — RETURN direction → E-ROUTE-003
// ---------------------------------------------------------------------------

describe("E-ROUTE-003 — non-serializable server-fn RETURN", () => {
  test("snippet return is rejected", () => {
    const res = compile(`<ul>
\${
  server function badReturn() -> snippet {
    return 1
  }
}
<li>x</li>
</ul>`);
    const hits = e003(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("badReturn");
    expect(hits[0].message).toContain("snippet");
    // Routes to errors, never warnings (hard reject).
    expect((res.warnings || []).some((e) => e.code === "E-ROUTE-003")).toBe(false);
    expect((res.errors || []).some((e) => e.code === "E-ROUTE-003")).toBe(true);
  });

  test("struct-with-a-function-field return is rejected (RECURSION, field path named)", () => {
    const res = compile(`<ul>
\${
  type Handlers:struct = { onClick: fn(), label: string }
  server function makeHandlers() -> Handlers {
    return 1
  }
}
<li>x</li>
</ul>`);
    const hits = e003(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("makeHandlers");
    // The nested field path to the non-serializable leaf is named.
    expect(hits[0].message).toContain("onClick");
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE — PARAM direction → E-ROUTE-004
// ---------------------------------------------------------------------------

describe("E-ROUTE-004 — non-serializable server-fn PARAM", () => {
  test("function-typed param is rejected", () => {
    const res = compile(`<ul>
\${
  server function badParam(cb: fn()) -> string {
    return "ok"
  }
}
<li>x</li>
</ul>`);
    const hits = e004(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("badParam");
    expect(hits[0].message).toContain("cb");
    expect(hits[0].message).toContain("function");
    expect((res.warnings || []).some((e) => e.code === "E-ROUTE-004")).toBe(false);
    expect((res.errors || []).some((e) => e.code === "E-ROUTE-004")).toBe(true);
  });

  test("snippet-typed param is rejected", () => {
    const res = compile(`<ul>
\${
  server function badSnippetParam(s: snippet) -> string {
    return "ok"
  }
}
<li>x</li>
</ul>`);
    const hits = e004(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("badSnippetParam");
    expect(hits[0].message).toContain("snippet");
  });

  test("struct-with-a-function-field param is rejected (RECURSION, field path named)", () => {
    const res = compile(`<ul>
\${
  type Handlers:struct = { onClick: fn(), label: string }
  server function register(h: Handlers) -> string {
    return "ok"
  }
}
<li>x</li>
</ul>`);
    const hits = e004(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("register");
    // The param + nested field path to the non-serializable leaf.
    expect(hits[0].message).toContain("h.onClick");
  });
});

// ---------------------------------------------------------------------------
// POSITIVE — serializable signatures fire NO E-ROUTE-003/004
// ---------------------------------------------------------------------------

describe("serializable server-fn signatures — no E-ROUTE error", () => {
  test("primitive params + struct-of-primitives return is clean", () => {
    const res = compile(`<ul>
\${
  type Item:struct = { id: int, name: string, tags: string[] }
  server function getItem(id: int, name: string) -> Item {
    return 1
  }
}
<li>x</li>
</ul>`);
    expect(e003(res).length).toBe(0);
    expect(e004(res).length).toBe(0);
  });

  test("enum param + enum return is clean", () => {
    const res = compile(`<ul>
\${
  type Status:enum = Active | Inactive
  server function flip(s: Status) -> Status {
    return s
  }
}
<li>x</li>
</ul>`);
    expect(e003(res).length).toBe(0);
    expect(e004(res).length).toBe(0);
  });

  test("array param + array return is clean", () => {
    const res = compile(`<ul>
\${
  type Item:struct = { id: int, name: string }
  server function all(items: Item[]) -> Item[] {
    return items
  }
}
<li>x</li>
</ul>`);
    expect(e003(res).length).toBe(0);
    expect(e004(res).length).toBe(0);
  });

  test("T | not return is clean", () => {
    const res = compile(`<ul>
\${
  type Item:struct = { id: int, name: string }
  server function find(id: int) -> Item | not {
    return 1
  }
}
<li>x</li>
</ul>`);
    expect(e003(res).length).toBe(0);
    expect(e004(res).length).toBe(0);
  });

  test("value-native map param + map return is clean", () => {
    const res = compile(`<ul>
\${
  type Item:struct = { id: int, name: string }
  server function build(m: [string: int]) -> [string: Item] {
    return 1
  }
}
<li>x</li>
</ul>`);
    expect(e003(res).length).toBe(0);
    expect(e004(res).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ESCAPE HATCH — asIs param/return NEVER errors
// ---------------------------------------------------------------------------

describe("asIs escape hatch preserved", () => {
  test("asIs param + asIs return fire no E-ROUTE error", () => {
    const res = compile(`<ul>
\${
  server function passthrough(x: asIs) -> asIs {
    return x
  }
}
<li>x</li>
</ul>`);
    expect(e003(res).length).toBe(0);
    expect(e004(res).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLIENT functions are NOT gated (the gate is server-only)
// ---------------------------------------------------------------------------

describe("client functions are not gated", () => {
  test("a client (non-escalated) fn with a fn-typed param does NOT fire E-ROUTE-004", () => {
    // No server escalation trigger → the function stays client-classified, so
    // nothing crosses the wire and the serializability gate does not apply.
    const res = compile(`<ul>
\${
  function localOnly(cb: fn()) -> string {
    return "ok"
  }
}
<li>x</li>
</ul>`);
    expect(e004(res).length).toBe(0);
    expect(e003(res).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SSE generators (server function*) — param gate applies, return gate skipped
// ---------------------------------------------------------------------------

describe("server function* SSE generators", () => {
  test("a fn-typed param on a generator fires E-ROUTE-004 (params query-encode onto the GET route)", () => {
    const res = compile(`<ul>
\${
  server function* feed(cb: fn()) {
    yield 1
  }
}
<li>x</li>
</ul>`);
    const hits = e004(res);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("feed");
    expect(hits[0].message).toContain("cb");
  });

  test("a generator's RETURN is NOT gated (the generator object is never serialized; yield-type deferred)", () => {
    // The yielded ELEMENT type IS what crosses the wire (§37.4 JSON.stringify),
    // but the AST exposes no resolved yield-element type without body-walk yield
    // inference — that check is DEFERRED. The generator OBJECT return must never
    // false-fire E-ROUTE-003.
    const res = compile(`<ul>
\${
  server function* counter(from: int) {
    yield from
  }
}
<li>x</li>
</ul>`);
    expect(e003(res).length).toBe(0);
    expect(e004(res).length).toBe(0);
  });

  // DEFERRED: the yielded-element-type serializability check for `server
  // function*`. The wire carries JSON.stringify'd yielded frames (§37.4), so a
  // generator that `yield`s a non-serializable value (a function, markup, …)
  // should fire E-ROUTE-003 on the yield type. The AST does not expose a
  // resolved yield-element type at the decl-site pass (it requires walking every
  // `yield <expr>` and typing it) — deferred follow-on. See progress.md.
  test.skip("DEFERRED: server function* yielding a non-serializable value fires E-ROUTE-003 on the yield type", () => {
    const res = compile(`<ul>
\${
  server function* badFeed() {
    yield buildSnippet()
  }
}
<li>x</li>
</ul>`);
    expect(e003(res).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DIAGNOSTIC-STREAM PARTITION — both codes land in result.errors
// ---------------------------------------------------------------------------

describe("diagnostic-stream partition", () => {
  test("E-ROUTE-003 and E-ROUTE-004 land in result.errors (E- prefix → fatal, CLI exit 1)", () => {
    const res = compile(`<ul>
\${
  server function badReturn() -> snippet {
    return 1
  }
  server function badParam(cb: fn()) -> string {
    return "ok"
  }
}
<li>x</li>
</ul>`);
    // Cross-stream: present in errors, absent from warnings.
    expect((res.errors || []).some((e) => e.code === "E-ROUTE-003")).toBe(true);
    expect((res.errors || []).some((e) => e.code === "E-ROUTE-004")).toBe(true);
    expect((res.warnings || []).some((e) => e.code === "E-ROUTE-003")).toBe(false);
    expect((res.warnings || []).some((e) => e.code === "E-ROUTE-004")).toBe(false);
  });
});
