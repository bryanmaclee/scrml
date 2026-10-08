/**
 * S457 ruling (a) — SPEC §5.2 rule 3: the RUNTIME URL-attribute scheme guard.
 *
 * `compiler/src/runtime-url-guard.js` is the ONE source of the URL scheme reader and the safe-scheme
 * sets: the compile-time rule (attr-injection-sink.ts) imports it, the client runtime inlines it
 * verbatim (chunk 'urlguard'), the server inlines it for first-paint rows. These tests exercise the
 * module itself (§1), the copy that actually ships in the runtime (§2), the element scoping (§3) and
 * the codegen-side decision helpers (§4).
 */

import { describe, test, expect } from "bun:test";
import {
  _scrml_safe_url,
  _scrml_url_value_admitted,
  _scrml_read_url_scheme,
  _scrml_is_url_attr,
  _SCRML_SAFE_URL_SCHEMES,
} from "../../src/runtime-url-guard.js";
import { SAFE_LITERAL_URL_SCHEMES, URL_VALUED_ATTRS, readLiteralUrlScheme } from "../../src/attr-injection-sink.ts";
import { SCRML_RUNTIME, URL_GUARD_RUNTIME_SOURCE } from "../../src/runtime-template.js";
import { RUNTIME_CHUNKS } from "../../src/codegen/runtime-chunks.ts";
import {
  dynamicUrlAttrNeedsGuard,
  quotedUrlAttrNeedsGuard,
  wrapUrlGuard,
} from "../../src/codegen/url-attr-guard.ts";

/** Call the guard with console.error captured; returns { out, logs }. */
function guard(name, value, el = null) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => { logs.push(a.map(String).join(" ")); };
  try {
    return { out: _scrml_safe_url(el, name, value), logs };
  } finally {
    console.error = orig;
  }
}

describe("§1 _scrml_safe_url — blocked values", () => {
  const BLOCKED = [
    ["href", "javascript:alert(1)"],
    ["href", "JaVaScRiPt:alert(1)"],
    ["href", "java\tscript:alert(1)"],
    ["href", "java\nscr\ript:alert(1)"],
    ["href", "   javascript:alert(1)"],
    ["href", "\u0001\u0002 javascript:alert(1)"],
    ["href", "vbscript:msgbox(1)"],
    ["src", "data:text/html,<script>alert(1)</script>"],
    ["href", "data:image/png;base64,AAAA"], // a raster image is admitted on IMAGE sources only
    ["src", "data:image/svg+xml,<svg onload=alert(1)>"],
    ["href", "blob:https://x/1"],
    ["action", "javascript:go()"],
    ["formaction", "javascript:go()"],
    ["xlink:href", "javascript:go()"],
    ["HREF", "javascript:go()"],
  ];
  for (const [name, value] of BLOCKED) {
    test(`${name}=${JSON.stringify(value)} → about:blank + one report`, () => {
      const { out, logs } = guard(name, value);
      expect(out).toBe("about:blank");
      expect(logs.length).toBe(1);
      // The report names the attribute, never the value (it may carry sensitive data).
      expect(logs[0]).toContain(`${name}=`);
      expect(logs[0]).not.toContain(value.trim().slice(0, 12));
    });
  }

  test("the report names the element when one is given", () => {
    const { logs } = guard("href", "javascript:x", { tagName: "A" });
    expect(logs[0]).toContain("<a> href=");
  });
});

describe("§1 _scrml_safe_url — admitted values are returned as setAttribute would write them", () => {
  const ADMITTED = [
    ["href", "/x"], ["href", "?q=1"], ["href", "#h"], ["href", "//host/p"], ["href", "users/7"],
    ["href", "http://x"], ["href", "HTTPS://x/y"], ["href", "ftp://h/f"], ["href", "mailto:a@b.c"],
    ["href", "tel:+1"], ["href", "sms:+1"], ["href", ""], ["href", "a b:c"], ["href", "1abc:x"],
    ["href", "java\\script:x"], ["href", "&#106;avascript:x"], // runtime: `\`/`&` are just characters
    ["src", "data:image/png;base64,AAAA"], ["src", "DATA:IMAGE/JPEG;base64,AA"],
    ["poster", "data:image/webp,AA"], ["srcset", "data:image/png;base64,AA,BB 1x, /b.png 2x"],
  ];
  for (const [name, value] of ADMITTED) {
    test(`${name}=${JSON.stringify(value)} admitted`, () => {
      const { out, logs } = guard(name, value);
      expect(out).toBe(value);
      expect(logs.length).toBe(0);
    });
  }

  test("a non-string value is stringified first (what setAttribute does)", () => {
    expect(guard("href", 42).out).toBe("42");
    expect(guard("href", { toString: () => "/o" }).out).toBe("/o");
    expect(guard("href", { toString: () => "javascript:x" }).out).toBe("about:blank");
  });
});

describe("§1 srcset / list attributes — every candidate is checked", () => {
  test("one bad entry blocks the whole value", () => {
    expect(guard("srcset", "/a.png 1x, javascript:alert(1) 2x").out).toBe("about:blank");
    expect(guard("srcset", "/a.png 1x,javascript:alert(1)").out).toBe("about:blank");
    expect(guard("imagesrcset", "/a.png 100w, data:text/html,x 200w").out).toBe("about:blank");
  });
  test("descriptors are not URLs; parenthesised commas do not split", () => {
    expect(guard("srcset", "/a.png 1x, /b.png 2x").out).toBe("/a.png 1x, /b.png 2x");
    expect(_scrml_url_value_admitted("srcset", "/a.png (x,javascript:1) 1x")).toBe(true);
  });
  test("ping is a space-separated list", () => {
    expect(guard("ping", "/p1 /p2").out).toBe("/p1 /p2");
    expect(guard("ping", "/p1 javascript:x").out).toBe("about:blank");
  });
});

describe("§2 one reader — the shipped runtime IS runtime-url-guard.js", () => {
  test("the compile-time sets are the module's sets (same objects)", () => {
    expect(SAFE_LITERAL_URL_SCHEMES).toBe(_SCRML_SAFE_URL_SCHEMES);
    expect([..._SCRML_SAFE_URL_SCHEMES].sort()).toEqual(["ftp", "http", "https", "mailto", "sms", "tel"]);
    expect(URL_VALUED_ATTRS.has("href")).toBe(true);
  });

  test("the compile-time literal reader and the runtime reader are one function (escape mode differs)", () => {
    expect(readLiteralUrlScheme("java\\x")).toEqual(_scrml_read_url_scheme("java\\x", true));
    expect(_scrml_read_url_scheme("java\\x:", false)).toEqual({ kind: "relative" });
    expect(_scrml_read_url_scheme("JAVA\tSCRIPT:x", false)).toEqual({ kind: "scheme", scheme: "javascript", rest: "x" });
  });

  test("the 'urlguard' chunk carries the module source verbatim (export stripped)", () => {
    expect(URL_GUARD_RUNTIME_SOURCE).toContain("function _scrml_safe_url(el, name, value)");
    expect(URL_GUARD_RUNTIME_SOURCE).not.toMatch(/^export /m);
    expect(SCRML_RUNTIME).toContain(URL_GUARD_RUNTIME_SOURCE);
    expect(RUNTIME_CHUNKS.urlguard).toContain("function _scrml_safe_url(");
    expect(RUNTIME_CHUNKS.urlguard).toContain("function _scrml_read_url_scheme(");
  });

  test("the chunk text, evaluated as a classic script, behaves like the module", () => {
    const logs = [];
    const fn = new Function("console", `${RUNTIME_CHUNKS.urlguard}\nreturn _scrml_safe_url;`)({
      error: (...a) => logs.push(a.join(" ")),
    });
    expect(fn(null, "href", "/ok")).toBe("/ok");
    expect(fn(null, "href", " JaVa\tScRiPt:alert(1)")).toBe("about:blank");
    expect(logs.length).toBe(1);
  });
});

describe("§3 element scoping (HTML attribute index)", () => {
  test("names the HTML standard scopes to elements apply only there", () => {
    expect(_scrml_is_url_attr("object", "data")).toBe(true);
    expect(_scrml_is_url_attr("div", "data")).toBe(false);
    expect(_scrml_is_url_attr("LineChart", "data")).toBe(false); // an unexpanded component tag
    expect(_scrml_is_url_attr("my-widget", "data")).toBe(false);
    expect(_scrml_is_url_attr("form", "action")).toBe(true);
    expect(_scrml_is_url_attr("my-form", "action")).toBe(false);
    expect(_scrml_is_url_attr("blockquote", "cite")).toBe(true);
    expect(_scrml_is_url_attr("span", "cite")).toBe(false);
    for (const n of ["icon", "profile", "background"]) expect(_scrml_is_url_attr("div", n)).toBe(false);
    expect(_scrml_is_url_attr("BODY", "background")).toBe(true);
  });
  test("href / src / xlink:href are URLs on every element; an unknown tag fails closed", () => {
    for (const t of ["a", "div", "use", "image", "Link", "x-y"]) {
      expect(_scrml_is_url_attr(t, "href")).toBe(true);
      expect(_scrml_is_url_attr(t, "src")).toBe(true);
    }
    expect(_scrml_is_url_attr("", "data")).toBe(true);
    expect(_scrml_is_url_attr("a", "title")).toBe(false);
  });
});

describe("§4 codegen decisions", () => {
  test("quoted: guard only when the literal prefix commits to no scheme", () => {
    expect(quotedUrlAttrNeedsGuard("a", "href", "${u}")).toBe(true);
    expect(quotedUrlAttrNeedsGuard("a", "href", "java${u}")).toBe(true);
    expect(quotedUrlAttrNeedsGuard("a", "href", "  ${u}")).toBe(true);
    expect(quotedUrlAttrNeedsGuard("a", "href", "/u/${u}")).toBe(false);
    expect(quotedUrlAttrNeedsGuard("a", "href", "?q=${u}")).toBe(false);
    expect(quotedUrlAttrNeedsGuard("a", "href", "https://x/${u}")).toBe(false);
    expect(quotedUrlAttrNeedsGuard("a", "href", "mailto:${u}")).toBe(false);
    expect(quotedUrlAttrNeedsGuard("a", "href", "/static")).toBe(false);
    expect(quotedUrlAttrNeedsGuard("a", "title", "${u}")).toBe(false);
    expect(quotedUrlAttrNeedsGuard("div", "data", "${u}")).toBe(false);
    expect(quotedUrlAttrNeedsGuard("object", "data", "${u}")).toBe(true);
  });
  test("dynamic: guard every URL attribute on its element", () => {
    expect(dynamicUrlAttrNeedsGuard("a", "href")).toBe(true);
    expect(dynamicUrlAttrNeedsGuard("a", "title")).toBe(false);
    expect(dynamicUrlAttrNeedsGuard("div", "data")).toBe(false);
  });
  test("the wrapped expression is readable", () => {
    expect(wrapUrlGuard("el", "href", "String(x)")).toBe('_scrml_safe_url(el, "href", String(x))');
  });
});
