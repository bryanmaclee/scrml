/**
 * S457 (dispatch s457-executable-sinks-srcdoc-svg) — the one reader, as units:
 *   §1 `animationUrlTarget` — which SVG animation value attributes write a URL attribute;
 *   §2 rule 2 on animation values (`classifyInterpolatedAttrSink` with the element);
 *   §3 the runtime guard's 4th argument (`_scrml_safe_url(el, "to", v, "href")`), `values` per entry;
 *   §4 `executableDataWriteSink` + the "data" message form;
 *   §5 the emit-side helpers (`urlGuardTarget`, `wrapUrlGuard`, `quotedUrlAttrNeedsGuard`).
 */

import { describe, test, expect } from "bun:test";
import {
  animationUrlTarget,
  classifyInterpolatedAttrSink,
  executableDataWriteSink,
  interpolatedAttrSinkMessage,
  quotedAnimationValueNeedsRuntimeGuard,
} from "../../src/attr-injection-sink.ts";
import { _scrml_safe_url, _SCRML_SVG_ANIMATION_ELEMENTS } from "../../src/runtime-url-guard.js";
import { URL_GUARD_RUNTIME_SOURCE } from "../../src/runtime-template.js";
import {
  dynamicUrlAttrNeedsGuard,
  quotedUrlAttrNeedsGuard,
  urlGuardTarget,
  wrapUrlGuard,
} from "../../src/codegen/url-attr-guard.ts";

const lit = (name, value) => ({ name, value: { kind: "string-literal", value } });
const expr = (name, raw) => ({ name, value: { kind: "expr", raw } });

describe("§1 animationUrlTarget", () => {
  test("a literal attributeName naming a URL attribute → that attribute (lowercased, trimmed)", () => {
    expect(animationUrlTarget("set", "to", [lit("attributeName", "href")])).toBe("href");
    expect(animationUrlTarget("animate", "values", [lit("attributeName", " xlink:href ")])).toBe("xlink:href");
    expect(animationUrlTarget("animateTransform", "by", [lit("attributename", "HREF")])).toBe("href");
    expect(animationUrlTarget("animate", "from", [lit("attributeName", "src")])).toBe("src");
  });
  test("a computed attributeName → \"\" (fail closed)", () => {
    expect(animationUrlTarget("set", "to", [expr("attributeName", "@n")])).toBe("");
    expect(animationUrlTarget("set", "to", [{ name: "attributeName", value: { kind: "variable-ref", name: "@n" } }])).toBe("");
    expect(animationUrlTarget("set", "to", [lit("attributeName", "${@n}")])).toBe("");
  });
  test("null: a non-URL attributeName, none at all, a non-value attribute, a non-animation element", () => {
    expect(animationUrlTarget("set", "to", [lit("attributeName", "width")])).toBeNull();
    expect(animationUrlTarget("animateMotion", "values", [])).toBeNull();
    expect(animationUrlTarget("set", "to", [{ name: "attributeName", value: { kind: "absent" } }])).toBeNull();
    expect(animationUrlTarget("set", "begin", [lit("attributeName", "href")])).toBeNull();
    expect(animationUrlTarget("div", "to", [lit("attributeName", "href")])).toBeNull();
  });
  test("a duplicate attributeName is fail-closed (any URL / computed one decides)", () => {
    expect(animationUrlTarget("set", "to", [lit("attributeName", "width"), lit("attributeName", "href")])).toBe("href");
    expect(animationUrlTarget("set", "to", [lit("attributeName", "href"), expr("attributeName", "@n")])).toBe("");
    expect(animationUrlTarget("set", "to", [lit("attributeName", "width"), lit("attributeName", "x")])).toBeNull();
  });
  test("the lift attribute-string shape (`{ name, value: string }`) reads as a literal", () => {
    expect(animationUrlTarget("set", "to", [{ name: "attributeName", value: "href" }])).toBe("href");
    expect(animationUrlTarget("set", "to", [{ name: "attributeName", value: "width" }])).toBeNull();
  });
  test("the element table is the runtime file's (one table)", () => {
    for (const t of ["set", "animate", "animatetransform", "animatemotion", "animatecolor"]) {
      expect(_SCRML_SVG_ANIMATION_ELEMENTS.has(t)).toBe(true);
    }
  });
});

describe("§2 rule 2 on animation values", () => {
  const href = { tag: "set", attrs: [lit("attributeName", "href")] };
  const computed = { tag: "set", attrs: [expr("attributeName", "@n")] };
  test("an unsafe literal scheme before `${` is refused", () => {
    expect(classifyInterpolatedAttrSink("to", "javascript:${x}", href)).toEqual({ kind: "url-scheme", scheme: "javascript" });
    expect(classifyInterpolatedAttrSink("from", "data:text/html,${x}", href)).toEqual({ kind: "url-scheme", scheme: "data" });
    expect(classifyInterpolatedAttrSink("to", "vbscript:${x}", computed)).toEqual({ kind: "url-scheme", scheme: "vbscript" });
    expect(classifyInterpolatedAttrSink("to", "java\\tscript:${x}", href)?.kind).toBe("url-unprovable");
  });
  test("`values`: every entry that interpolates is judged on its own literal prefix", () => {
    const anim = { tag: "animate", attrs: [lit("attributeName", "href")] };
    expect(classifyInterpolatedAttrSink("values", "/a;javascript:${x}", anim)).toEqual({ kind: "url-scheme", scheme: "javascript" });
    expect(classifyInterpolatedAttrSink("values", "${a};/b;javascript:${x}", anim)).toEqual({ kind: "url-scheme", scheme: "javascript" });
    // `&#106;` holds a `;`, so SMIL (and this reader) split there: entry `s:${x}` commits to scheme `s:`.
    expect(classifyInterpolatedAttrSink("values", "/a;&#106;s:${x}", anim)).toEqual({ kind: "url-scheme", scheme: "s" });
    expect(classifyInterpolatedAttrSink("values", "/a;java&x:${x}", anim)?.kind).toBe("url-unprovable");
    // A `;` inside an interpolation does not split an entry.
    expect(classifyInterpolatedAttrSink("values", "${a ? 'x;y' : 'z'}javascript:${x}", anim)).toBeNull();
    expect(classifyInterpolatedAttrSink("values", "/a;https://h/${x};${y}", anim)).toBeNull();
  });
  test("admitted literal prefixes, and a non-URL animation, are not refused", () => {
    expect(classifyInterpolatedAttrSink("to", "https://x/${x}", href)).toBeNull();
    expect(classifyInterpolatedAttrSink("to", "/p/${x}", href)).toBeNull();
    expect(classifyInterpolatedAttrSink("to", "javascript:${x}", { tag: "set", attrs: [lit("attributeName", "width")] })).toBeNull();
    // Without the element, `to` is not a URL attribute (S456 behaviour).
    expect(classifyInterpolatedAttrSink("to", "javascript:${x}")).toBeNull();
  });
  test("raster data:image is admitted only when the animated attribute is an image source", () => {
    const src = { tag: "set", attrs: [lit("attributeName", "src")] };
    expect(classifyInterpolatedAttrSink("to", "data:image/png;base64,${b}", src)).toBeNull();
    expect(classifyInterpolatedAttrSink("to", "data:image/png;base64,${b}", href)).toEqual({ kind: "url-scheme", scheme: "data" });
    expect(classifyInterpolatedAttrSink("to", "data:image/png;base64,${b}", computed)).toEqual({ kind: "url-scheme", scheme: "data" });
  });
  test("runtime-guard need for a quoted animation value", () => {
    expect(quotedAnimationValueNeedsRuntimeGuard("to", "${u}")).toBe(true);
    expect(quotedAnimationValueNeedsRuntimeGuard("to", "/p/${u}")).toBe(false);
    expect(quotedAnimationValueNeedsRuntimeGuard("values", "/p/${u}")).toBe(true);
    expect(quotedAnimationValueNeedsRuntimeGuard("values", "/a;/b")).toBe(false);
  });
});

describe("§3 the runtime guard with an animation target", () => {
  function run(name, value, target) {
    const logs = [];
    const orig = console.error;
    console.error = (...a) => logs.push(a.join(" "));
    try {
      return { out: _scrml_safe_url({ tagName: "SET" }, name, value, target), logs };
    } finally { console.error = orig; }
  }
  test("`to` animating href: javascript: blocked, safe admitted, report names the animated attribute", () => {
    const bad = run("to", "javascript:alert(1)", "href");
    expect(bad.out).toBe("about:blank");
    expect(bad.logs.length).toBe(1);
    expect(bad.logs[0]).toContain("<set> to= value animating href=");
    expect(bad.logs[0]).not.toContain("alert(1)");
    expect(run("to", "/x", "href").out).toBe("/x");
    expect(run("to", "https://h/", "href").out).toBe("https://h/");
  });
  test("`values`: one bad entry blocks the whole list", () => {
    expect(run("values", "/a; /b ;https://c/", "href").out).toBe("/a; /b ;https://c/");
    expect(run("values", "/a; JaVa\tScRiPt:alert(1)", "href").out).toBe("about:blank");
  });
  test("target \"\" (computed attributeName): data:image is not admitted; the report says so", () => {
    const r = run("to", "data:image/png;base64,AAAA", "");
    expect(r.out).toBe("about:blank");
    expect(r.logs[0]).toContain("a URL attribute named at runtime");
    expect(run("to", "data:image/png;base64,AAAA", "src").out).toBe("data:image/png;base64,AAAA");
  });
  test("3-argument calls keep the S457 behaviour (no target)", () => {
    expect(run("href", "javascript:x").out).toBe("about:blank");
    expect(run("href", "/ok").out).toBe("/ok");
  });
  test("the shipped runtime source carries the 4-argument guard", () => {
    expect(URL_GUARD_RUNTIME_SOURCE).toContain("function _scrml_safe_url(el, name, value, target)");
    expect(URL_GUARD_RUNTIME_SOURCE).toContain("const _SCRML_SVG_ANIMATION_VALUE_ATTRS");
  });
});

describe("§4 executableDataWriteSink + the data message", () => {
  test("srcdoc (any case) and every on… name; nothing else", () => {
    expect(executableDataWriteSink("srcdoc")).toEqual({ kind: "srcdoc" });
    expect(executableDataWriteSink("SRCDOC")).toEqual({ kind: "srcdoc" });
    expect(executableDataWriteSink("ONCLICK")).toEqual({ kind: "event-handler" });
    expect(executableDataWriteSink("on:click")).toEqual({ kind: "event-handler" });
    expect(executableDataWriteSink("online")).toBeNull();
    expect(executableDataWriteSink("href")).toBeNull();
    expect(executableDataWriteSink("to")).toBeNull();
  });
  test("the data-form message names the wired lowercase spelling", () => {
    const m = interpolatedAttrSinkMessage({ kind: "event-handler" }, "on:Click", "button", "", "data");
    expect(m).toContain("`onclick=f(x)`");
    expect(m).toContain("event-handler TEXT");
    const s = interpolatedAttrSinkMessage({ kind: "srcdoc" }, "srcdoc", "iframe", "", "data");
    expect(s).toContain("takes its value from data");
    expect(s).toContain("static string only");
  });
});

describe("§5 emit-side helpers", () => {
  const attrs = [lit("attributeName", "href")];
  test("urlGuardTarget / dynamicUrlAttrNeedsGuard / quotedUrlAttrNeedsGuard", () => {
    expect(urlGuardTarget("set", "to", attrs)).toBe("href");
    expect(urlGuardTarget("a", "href", attrs)).toBeNull();
    expect(dynamicUrlAttrNeedsGuard("set", "to", attrs)).toBe(true);
    expect(dynamicUrlAttrNeedsGuard("set", "to", [lit("attributeName", "width")])).toBe(false);
    expect(dynamicUrlAttrNeedsGuard("set", "to")).toBe(false);
    expect(quotedUrlAttrNeedsGuard("set", "to", "${u}", attrs)).toBe(true);
    expect(quotedUrlAttrNeedsGuard("set", "to", "/p/${u}", attrs)).toBe(false);
  });
  test("wrapUrlGuard adds the target only when given", () => {
    expect(wrapUrlGuard("el", "href", "v")).toBe('_scrml_safe_url(el, "href", v)');
    expect(wrapUrlGuard("el", "to", "v", "href")).toBe('_scrml_safe_url(el, "to", v, "href")');
    expect(wrapUrlGuard("el", "to", "v", "")).toBe('_scrml_safe_url(el, "to", v, "")');
    expect(wrapUrlGuard("el", "href", "v", null)).toBe('_scrml_safe_url(el, "href", v)');
  });
});
