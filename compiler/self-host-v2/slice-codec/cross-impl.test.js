// cross-impl.test.js — the bootstrap's §57 codec against impl#1's ACTUAL wire
// runtime. impl#1 compiles a program with a `T | not` server fn and a pure-`T`
// one; the test takes impl#1's emitted helpers (`_scrml_wire_encode` from the
// server artifact, `_scrml_wire_decode` from the client runtime), pins the
// emitted call shapes that use them, and checks both directions:
//   impl#1-encoded → bootstrap-decoded, and bootstrap-encoded → impl#1-decoded,
// equal values for every SHARED shape; the shapes where impl#1 diverges from
// §57 are pinned as divergences (so a fix on either side is noticed).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileScrml } from "../../src/api.js";
import { loadCodec, descriptor } from "./harness.js";
import { frontEnd } from "../slice-m2/lowered.js";
import { decodeText, encodeText } from "./runtime/codec.js";

// ---- impl#1 side -------------------------------------------------------------
const APP = `<program>
type Pt:struct = { x: int, label: string, on: boolean }
type Color:enum = { Red, Green, Blue }

server function maybePt(id: int) -> Pt | not {
    if (id == 0) return not
    return { x: id, label: "p", on: true }
}
server function onePt(id: int) -> Pt {
    return { x: id, label: "p", on: true }
}
server function echo(n: int | not) -> int | not {
    return n
}
let a = maybePt(1)
let b = onePt(1)
let c = echo(not)
<p>\${a}</p>
</program>
`;

const dir = mkdtempSync(join(tmpdir(), "uc-cross-impl-"));
writeFileSync(join(dir, "app.scrml"), APP);
const out = join(dir, "out");
const compiled = compileScrml({ inputFiles: [join(dir, "app.scrml")], outputDir: out, write: true, log: () => {} });
const files = readdirSync(out);
const serverJs = readFileSync(join(out, "app.server.js"), "utf8");
const clientJs = readFileSync(join(out, "app.client.js"), "utf8");
const runtimeJs = readFileSync(join(out, files.find((f) => /^scrml-runtime.*\.js$/.test(f))), "utf8");

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`impl#1 emitted no ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
const i1encode = new Function(extractFn(serverJs, "_scrml_wire_encode") + "; return _scrml_wire_encode;")();
const i1decode = new Function(extractFn(runtimeJs, "_scrml_wire_decode") + "; return _scrml_wire_decode;")();

// impl#1's egress / ingress, exactly as the emitted code composes them (pinned below).
const I1 = {
  serverMaybe: (v) => JSON.stringify(i1encode(v)), //  `JSON.stringify(_scrml_wire_encode(_scrml_result))`
  serverPlain: (v) => JSON.stringify(v ?? null), //     `JSON.stringify(_scrml_result ?? null)`
  clientMaybe: (text) => i1decode(JSON.parse(text)), // `_scrml_wire_decode(await _scrml_resp.json())`
  clientPlain: (text) => JSON.parse(text), //           `await _scrml_resp.json()`
};

// ---- bootstrap side ----------------------------------------------------------
const { mods } = loadCodec();
const SRC = `<program>
    type Pt:struct = { x: int, label: string, on: boolean }
    type Color:enum = { Red, Green, Blue }
    type Pair:struct = { p: Pt | not, c: Color | not }
    <let n:int=0/>
    <main><p>\${@n}</p></main>
</program>`;
const core = frontEnd(mods, [{ path: "x.scrml", src: SRC }]).core;
const sym = (n) => core.types.find((t) => t.data.sym.hint === n).data.sym;
const Named = (n) => ({ variant: "Named", data: { sym: sym(n) } });
const Maybe = (inner) => ({ variant: "Maybe", data: { inner } });
const Seq = (elem) => ({ variant: "Seq", data: { elem, grants: { length: "Free", at: [], shrink: [], positionsWritable: false } } });
const tb = (ty) => descriptor(mods, core, ty).table;

const pt = (x) => ({ x, label: "p" + x, on: x % 2 === 0 });

describe("impl#1 emitted wire shapes (pinned)", () => {
  test("impl#1 compiles the probe program", () => {
    expect((compiled.errors ?? []).filter((e) => e && e.code)).toEqual([]);
  });
  test("server: T | not returns go through _scrml_wire_encode; pure T through `?? null`", () => {
    expect(serverJs).toContain("JSON.stringify(_scrml_wire_encode(_scrml_result))");
    expect(serverJs).toContain("JSON.stringify(_scrml_result ?? null)");
  });
  test("client: the T | not stub decodes through _scrml_wire_decode; the pure-T stub does not", () => {
    expect(clientJs).toContain("_scrml_wire_decode(await _scrml_resp.json())");
    expect(clientJs).toContain("const _scrml_body_json = await _scrml_resp.json();");
  });
});

describe("shared shapes — impl#1-encoded values decode identically in the bootstrap", () => {
  const cases = [
    ["Pt | not, present", Maybe(Named("Pt")), pt(4), "maybe"],
    ["Pt | not, absent", Maybe(Named("Pt")), null, "maybe"],
    ["int | not, absent", Maybe("Int"), null, "maybe"],
    ["int | not, 0", Maybe("Int"), 0, "maybe"],
    ["string | not, empty", Maybe("Str"), "", "maybe"],
    ["Pt", Named("Pt"), pt(7), "plain"],
    ["Pt[]", Seq(Named("Pt")), [pt(1), pt(2)], "plain"],
    ["Color", Named("Color"), "Blue", "plain"],
    ["Color | not, absent", Maybe(Named("Color")), null, "maybe"],
    ["number", "Num", 3.25, "plain"],
    ["boolean", "Bool", false, "plain"],
  ];
  for (const [name, ty, v, route] of cases) {
    test(name, () => {
      const text = route === "maybe" ? I1.serverMaybe(v) : I1.serverPlain(v);
      expect(decodeText(tb(ty), text)).toEqual({ ok: true, value: v });
      // and the bytes agree: the bootstrap encodes the same text
      expect(encodeText(tb(ty), v)).toEqual({ ok: true, text });
    });
  }
});

describe("shared shapes — bootstrap-encoded values decode identically in impl#1", () => {
  const cases = [
    ["Pt | not, present", Maybe(Named("Pt")), pt(4), "maybe"],
    ["Pt | not, absent", Maybe(Named("Pt")), null, "maybe"],
    ["int | not, absent", Maybe("Int"), null, "maybe"],
    ["Pt[]", Seq(Named("Pt")), [pt(1), pt(2)], "plain"],
    ["Color", Named("Color"), "Green", "plain"],
    ["string", "Str", "x", "plain"],
  ];
  for (const [name, ty, v, route] of cases) {
    test(name, () => {
      const e = encodeText(tb(ty), v);
      expect(e.ok).toBe(true);
      const got = route === "maybe" ? I1.clientMaybe(e.text) : I1.clientPlain(e.text);
      expect(got).toEqual(v);
    });
  }
});

describe("DIVERGENCES — impl#1 vs §57 (pinned; see progress.md)", () => {
  test("D1: impl#1 envelopes only a server fn's TOP-LEVEL return; a nested `T | not` goes out as raw null", () => {
    // impl#1 can only express this through a struct value carrying null; its encoder leaves it alone.
    const v = { p: null, c: "Red" };
    expect(I1.serverMaybe(v)).toBe('{"p":null,"c":"Red"}');
    // the bootstrap's v0.x dual-decoder still reads it (raw null admitted, §57.4) …
    expect(decodeText(tb(Maybe(Named("Pair"))), I1.serverMaybe(v))).toEqual({ ok: true, value: v });
    // … but §57.5's canonical-only decoder (v1.0) will not
    expect(decodeText(tb(Maybe(Named("Pair"))), I1.serverMaybe(v), { canonicalOnly: true }).ok).toBe(false);
    // the bootstrap envelopes the nested absence
    expect(encodeText(tb(Named("Pair")), v).text).toBe('{"p":{"__scrml_absent":true},"c":"Red"}');
  });

  test("D2: impl#1's decoder leaves a NESTED envelope in place (not lowered to not)", () => {
    const e = encodeText(tb(Seq(Maybe(Named("Pt")))), [null, pt(2)]);
    expect(I1.clientPlain(e.text)).toEqual([{ __scrml_absent: true }, pt(2)]);
  });

  test("D3: impl#1's decoder accepts an envelope with EXTRA keys as absence (§57.2 says exactly one property)", () => {
    expect(I1.clientMaybe('{"__scrml_absent":true,"x":1}')).toBeNull();
    expect(decodeText(tb(Maybe(Named("Pt"))), '{"__scrml_absent":true,"x":1}').ok).toBe(false);
  });

  test("D4: impl#1's decoder passes a malformed payload through unchanged (§57.4: treat as malformed)", () => {
    expect(I1.clientMaybe('"not a Pt"')).toBe("not a Pt");
    expect(decodeText(tb(Maybe(Named("Pt"))), '"not a Pt"').error.kind).toBe("malformed");
  });

  test("D5: impl#1 serializes server-fn ARGUMENTS with plain JSON.stringify (no envelope for a `T | not` argument)", () => {
    // `echo(n: int | not)`: the argument is stringified raw, so `echo(not)` sends `{"n":null}`.
    expect(clientJs).toMatch(/const _scrml_body = JSON\.stringify\(\{\s*"n": n,\s*\}\);/);
    expect(clientJs).not.toContain("_scrml_wire_encode");
  });
});
