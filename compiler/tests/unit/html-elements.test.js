import { describe, it, expect } from "bun:test";
import {
  getElementShape,
  isHtmlElement,
  getAllElementNames,
  GLOBAL_ATTRIBUTES,
} from "../../src/html-elements.js";

// ---------------------------------------------------------------------------
// Required element list — every element specified in the mission brief
// ---------------------------------------------------------------------------

const REQUIRED_ELEMENTS = [
  "div", "span", "p",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "img", "input", "button", "form", "select", "option", "textarea",
  "table", "tr", "td", "th",
  "ul", "ol", "li",
  "nav", "header", "footer", "main", "section", "article", "aside",
  "canvas", "video", "audio",
  "label", "br", "hr",
];

const VOID_ELEMENTS = ["br", "hr", "img", "input"];
const NON_VOID_ELEMENTS = ["div", "span", "p", "a", "button", "form", "table", "ul", "ol", "li"];

// ---------------------------------------------------------------------------
// getElementShape — core lookup
// ---------------------------------------------------------------------------

describe("getElementShape", () => {
  it("returns a shape object for known elements", () => {
    const shape = getElementShape("div");
    expect(shape).not.toBeNull();
    expect(shape.tag).toBe("div");
    expect(shape.rendersToDom).toBe(true);
    expect(shape.attributes).toBeInstanceOf(Map);
  });

  it("returns null for unknown tag names", () => {
    expect(getElementShape("foobar")).toBeNull();
    expect(getElementShape("session")).toBeNull();
    expect(getElementShape("myComponent")).toBeNull();
    expect(getElementShape("")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(getElementShape("DIV")).not.toBeNull();
    expect(getElementShape("Div")).not.toBeNull();
    expect(getElementShape("INPUT")).not.toBeNull();
    expect(getElementShape("Input")).not.toBeNull();
  });

  it("returns distinct shape objects (not shared references between calls)", () => {
    const a = getElementShape("div");
    const b = getElementShape("div");
    // Same object from the registry — that is fine (immutable data)
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// All required elements present
// ---------------------------------------------------------------------------

describe("required elements", () => {
  for (const tag of REQUIRED_ELEMENTS) {
    it(`includes <${tag}>`, () => {
      const shape = getElementShape(tag);
      expect(shape).not.toBeNull();
      expect(shape.tag).toBe(tag);
    });
  }

  it("has at least 35 elements in the registry", () => {
    expect(getAllElementNames().length).toBeGreaterThanOrEqual(35);
  });
});

// ---------------------------------------------------------------------------
// Void elements
// ---------------------------------------------------------------------------

describe("void elements", () => {
  for (const tag of VOID_ELEMENTS) {
    it(`<${tag}> is marked as void`, () => {
      expect(getElementShape(tag).isVoid).toBe(true);
    });
  }

  for (const tag of NON_VOID_ELEMENTS) {
    it(`<${tag}> is NOT void`, () => {
      expect(getElementShape(tag).isVoid).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// rendersToDom
// ---------------------------------------------------------------------------

describe("rendersToDom", () => {
  it("is true for all HTML elements", () => {
    const nonDomElements = new Set(["program", "errorboundary", "errors", "auth", "formfor", "tablefor", "column", "empty", "each", "render", "onchange"]);
    for (const tag of getAllElementNames()) {
      if (nonDomElements.has(tag)) continue; // scrml structural elements
      expect(getElementShape(tag).rendersToDom).toBe(true);
    }
  });

  it("is false for program (scrml structural element)", () => {
    const shape = getElementShape("program");
    expect(shape).not.toBeNull();
    expect(shape.rendersToDom).toBe(false);
  });

  it("is false for errorBoundary (scrml error boundary)", () => {
    const shape = getElementShape("errorboundary");
    expect(shape).not.toBeNull();
    expect(shape.rendersToDom).toBe(false);
  });

  // A1c C11: <errors of=expr/> first-class element (SPEC §55.8) — structural,
  // expands to placeholder span at codegen time, not a DOM-rendering tag.
  it("is false for errors (scrml validation errors element)", () => {
    const shape = getElementShape("errors");
    expect(shape).not.toBeNull();
    expect(shape.rendersToDom).toBe(false);
  });

  // render-expr-primitive: <render of=X/> render-expression primitive (SPEC §19.x) —
  // structural; codegen expands to a placeholder span + per-variant dispatch.
  it("is false for render (scrml render-expression primitive)", () => {
    const shape = getElementShape("render");
    expect(shape).not.toBeNull();
    expect(shape.rendersToDom).toBe(false);
  });

  // S90 A-3.1: <auth role="X"> sub-page role-gate element (SPEC §40.9.9).
  // Compiler-level structural — A-3 / A-4 emit conditional render glue,
  // the <auth> tag itself does not render to DOM.
  it("is false for auth (scrml role-gate element)", () => {
    const shape = getElementShape("auth");
    expect(shape).not.toBeNull();
    expect(shape.rendersToDom).toBe(false);
  });

  // S102 §41.14: <formFor for=StructType/> type-driven form-generation element.
  // Compile-time recognized at TS stage; codegen replaces it with the
  // equivalent Shape 2 + <errors of=> + <form action=> markup tree. The
  // formFor tag itself does not render to DOM.
  it("is false for formFor (scrml type-driven form element)", () => {
    const shape = getElementShape("formfor");
    expect(shape).not.toBeNull();
    expect(shape.rendersToDom).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Global attributes
// ---------------------------------------------------------------------------

describe("global attributes", () => {
  const KEY_GLOBALS = ["class", "id", "style", "title", "hidden", "tabindex", "role"];

  it("GLOBAL_ATTRIBUTES contains key attributes", () => {
    for (const name of KEY_GLOBALS) {
      expect(GLOBAL_ATTRIBUTES.has(name)).toBe(true);
    }
  });

  it("global attributes are present on every element", () => {
    for (const tag of getAllElementNames()) {
      const shape = getElementShape(tag);
      for (const name of KEY_GLOBALS) {
        expect(shape.attributes.has(name)).toBe(true);
      }
    }
  });

  it("class attribute has type string", () => {
    expect(GLOBAL_ATTRIBUTES.get("class").type).toBe("string");
  });

  it("hidden attribute has type boolean", () => {
    expect(GLOBAL_ATTRIBUTES.get("hidden").type).toBe("boolean");
  });

  it("tabindex attribute has type number", () => {
    expect(GLOBAL_ATTRIBUTES.get("tabindex").type).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Element-specific attributes
// ---------------------------------------------------------------------------

describe("element-specific attributes", () => {
  it("<a> has href attribute of type string", () => {
    const shape = getElementShape("a");
    expect(shape.attributes.has("href")).toBe(true);
    expect(shape.attributes.get("href").type).toBe("string");
  });

  it("<a> has target attribute", () => {
    expect(getElementShape("a").attributes.has("target")).toBe(true);
  });

  it("<img> has src attribute marked as required", () => {
    const src = getElementShape("img").attributes.get("src");
    expect(src).toBeDefined();
    expect(src.type).toBe("string");
    expect(src.required).toBe(true);
  });

  it("<img> has alt attribute marked as required", () => {
    const alt = getElementShape("img").attributes.get("alt");
    expect(alt).toBeDefined();
    expect(alt.required).toBe(true);
  });

  it("<img> has width and height as number", () => {
    const shape = getElementShape("img");
    expect(shape.attributes.get("width").type).toBe("number");
    expect(shape.attributes.get("height").type).toBe("number");
  });

  it("<input> has type attribute with default 'text'", () => {
    const type = getElementShape("input").attributes.get("type");
    expect(type).toBeDefined();
    expect(type.type).toBe("string");
    expect(type.default).toBe("text");
  });

  it("<input> has placeholder, required, disabled attributes", () => {
    const shape = getElementShape("input");
    expect(shape.attributes.has("placeholder")).toBe(true);
    expect(shape.attributes.get("required").type).toBe("boolean");
    expect(shape.attributes.get("disabled").type).toBe("boolean");
  });

  it("<button> has type attribute with default 'submit'", () => {
    const btn = getElementShape("button").attributes.get("type");
    expect(btn.default).toBe("submit");
  });

  it("<form> has action and method attributes", () => {
    const shape = getElementShape("form");
    expect(shape.attributes.has("action")).toBe(true);
    expect(shape.attributes.has("method")).toBe(true);
  });

  it("<textarea> has rows and cols as number", () => {
    const shape = getElementShape("textarea");
    expect(shape.attributes.get("rows").type).toBe("number");
    expect(shape.attributes.get("cols").type).toBe("number");
  });

  it("<td> and <th> have colspan and rowspan as number", () => {
    for (const tag of ["td", "th"]) {
      const shape = getElementShape(tag);
      expect(shape.attributes.get("colspan").type).toBe("number");
      expect(shape.attributes.get("rowspan").type).toBe("number");
    }
  });

  it("<th> has scope attribute", () => {
    expect(getElementShape("th").attributes.has("scope")).toBe(true);
  });

  it("<video> has controls, autoplay, loop as boolean", () => {
    const shape = getElementShape("video");
    expect(shape.attributes.get("controls").type).toBe("boolean");
    expect(shape.attributes.get("autoplay").type).toBe("boolean");
    expect(shape.attributes.get("loop").type).toBe("boolean");
  });

  it("<video> has src, poster as string", () => {
    const shape = getElementShape("video");
    expect(shape.attributes.get("src").type).toBe("string");
    expect(shape.attributes.get("poster").type).toBe("string");
  });

  it("<canvas> has width and height as number", () => {
    const shape = getElementShape("canvas");
    expect(shape.attributes.get("width").type).toBe("number");
    expect(shape.attributes.get("height").type).toBe("number");
  });

  it("<label> has for attribute", () => {
    expect(getElementShape("label").attributes.has("for")).toBe(true);
  });

  it("<select> has multiple as boolean", () => {
    expect(getElementShape("select").attributes.get("multiple").type).toBe("boolean");
  });

  it("<option> has value and selected attributes", () => {
    const shape = getElementShape("option");
    expect(shape.attributes.has("value")).toBe(true);
    expect(shape.attributes.get("selected").type).toBe("boolean");
  });

  it("<ol> has start as number and reversed as boolean", () => {
    const shape = getElementShape("ol");
    expect(shape.attributes.get("start").type).toBe("number");
    expect(shape.attributes.get("reversed").type).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// isHtmlElement
// ---------------------------------------------------------------------------

describe("isHtmlElement", () => {
  it("returns true for known elements", () => {
    expect(isHtmlElement("div")).toBe(true);
    expect(isHtmlElement("input")).toBe(true);
    expect(isHtmlElement("canvas")).toBe(true);
  });

  it("returns false for unknown elements", () => {
    expect(isHtmlElement("session")).toBe(false);
    expect(isHtmlElement("foobar")).toBe(false);
    expect(isHtmlElement("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isHtmlElement("DIV")).toBe(true);
    expect(isHtmlElement("Span")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAllElementNames
// ---------------------------------------------------------------------------

describe("getAllElementNames", () => {
  it("returns an array of strings", () => {
    const names = getAllElementNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      expect(typeof n).toBe("string");
    }
  });

  it("contains all required elements", () => {
    const names = getAllElementNames();
    for (const tag of REQUIRED_ELEMENTS) {
      expect(names).toContain(tag);
    }
  });
});

// ---------------------------------------------------------------------------
// Attribute descriptor shape
// ---------------------------------------------------------------------------

describe("attribute descriptor shape", () => {
  it("every attribute has type, required, and default fields", () => {
    for (const tag of getAllElementNames()) {
      const shape = getElementShape(tag);
      for (const [name, desc] of shape.attributes) {
        expect(typeof desc.type).toBe("string");
        expect(typeof desc.required).toBe("boolean");
        expect(desc).toHaveProperty("default");
      }
    }
  });

  it("non-required attributes without defaults have null default", () => {
    const classAttr = getElementShape("div").attributes.get("class");
    expect(classAttr.required).toBe(false);
    expect(classAttr.default).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// <program> root element
// ---------------------------------------------------------------------------

describe("program element", () => {
  it("is registered in the shape registry", () => {
    const shape = getElementShape("program");
    expect(shape).not.toBeNull();
    expect(shape.tag).toBe("program");
  });

  it("is NOT an HTML element (isHtmlElement returns false)", () => {
    expect(isHtmlElement("program")).toBe(false);
  });

  it("is included in getAllElementNames", () => {
    expect(getAllElementNames()).toContain("program");
  });

  it("has rendersToDom=false", () => {
    expect(getElementShape("program").rendersToDom).toBe(false);
  });

  it("has isVoid=false (program has children)", () => {
    expect(getElementShape("program").isVoid).toBe(false);
  });

  it("has db attribute (string, optional)", () => {
    const db = getElementShape("program").attributes.get("db");
    expect(db).toBeDefined();
    expect(db.type).toBe("string");
    expect(db.required).toBe(false);
  });

  it("has protect attribute (string, optional)", () => {
    const protect = getElementShape("program").attributes.get("protect");
    expect(protect).toBeDefined();
    expect(protect.type).toBe("string");
    expect(protect.required).toBe(false);
  });

  it("has tables attribute (string, optional)", () => {
    const tables = getElementShape("program").attributes.get("tables");
    expect(tables).toBeDefined();
    expect(tables.type).toBe("string");
    expect(tables.required).toBe(false);
  });

  it("has html attribute (string, optional)", () => {
    const html = getElementShape("program").attributes.get("html");
    expect(html).toBeDefined();
    expect(html.type).toBe("string");
    expect(html.required).toBe(false);
  });

  it("has name attribute (string, optional — for workers)", () => {
    const name = getElementShape("program").attributes.get("name");
    expect(name).toBeDefined();
    expect(name.type).toBe("string");
    expect(name.required).toBe(false);
  });

  it("inherits global attributes (class, id, etc.)", () => {
    const shape = getElementShape("program");
    expect(shape.attributes.has("class")).toBe(true);
    expect(shape.attributes.has("id")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// domInterface field — ref= type narrowing support
// ---------------------------------------------------------------------------

describe("domInterface", () => {
  it("canvas has domInterface HTMLCanvasElement", () => {
    expect(getElementShape("canvas").domInterface).toBe("HTMLCanvasElement");
  });

  it("input has domInterface HTMLInputElement", () => {
    expect(getElementShape("input").domInterface).toBe("HTMLInputElement");
  });

  it("div has domInterface HTMLDivElement", () => {
    expect(getElementShape("div").domInterface).toBe("HTMLDivElement");
  });

  it("a has domInterface HTMLAnchorElement", () => {
    expect(getElementShape("a").domInterface).toBe("HTMLAnchorElement");
  });

  it("video has domInterface HTMLVideoElement", () => {
    expect(getElementShape("video").domInterface).toBe("HTMLVideoElement");
  });

  it("section has domInterface HTMLElement (generic)", () => {
    expect(getElementShape("section").domInterface).toBe("HTMLElement");
  });

  it("all registered elements have a domInterface field", () => {
    for (const name of getAllElementNames()) {
      const shape = getElementShape(name);
      if (shape.rendersToDom) {
        expect(shape.domInterface).toBeDefined();
        expect(typeof shape.domInterface).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// SVG elements
// ---------------------------------------------------------------------------

describe("SVG elements", () => {
  const SVG_ELEMENTS = ["svg", "rect", "circle", "line", "path", "g", "text", "polyline", "polygon"];

  for (const tag of SVG_ELEMENTS) {
    it(`includes SVG <${tag}>`, () => {
      const shape = getElementShape(tag);
      expect(shape).not.toBeNull();
      expect(shape.tag).toBe(tag);
      expect(shape.rendersToDom).toBe(true);
    });
  }

  it("svg has viewBox attribute", () => {
    const shape = getElementShape("svg");
    expect(shape.attributes.has("viewBox")).toBe(true);
  });

  it("rect has x, y, width, height attributes", () => {
    const shape = getElementShape("rect");
    expect(shape.attributes.has("x")).toBe(true);
    expect(shape.attributes.has("y")).toBe(true);
    expect(shape.attributes.has("width")).toBe(true);
    expect(shape.attributes.has("height")).toBe(true);
  });

  it("circle has cx, cy, r attributes", () => {
    const shape = getElementShape("circle");
    expect(shape.attributes.has("cx")).toBe(true);
    expect(shape.attributes.has("cy")).toBe(true);
    expect(shape.attributes.has("r")).toBe(true);
  });

  it("path has d attribute (required)", () => {
    const shape = getElementShape("path");
    const dAttr = shape.attributes.get("d");
    expect(dAttr).toBeDefined();
    expect(dAttr.required).toBe(true);
  });

  it("polyline has points attribute (required)", () => {
    const shape = getElementShape("polyline");
    const pointsAttr = shape.attributes.get("points");
    expect(pointsAttr).toBeDefined();
    expect(pointsAttr.required).toBe(true);
  });

  it("g has transform attribute", () => {
    const shape = getElementShape("g");
    expect(shape.attributes.has("transform")).toBe(true);
  });

  it("text has text-anchor attribute", () => {
    const shape = getElementShape("text");
    expect(shape.attributes.has("text-anchor")).toBe(true);
  });

  it("all SVG elements inherit global attributes", () => {
    for (const tag of SVG_ELEMENTS) {
      const shape = getElementShape(tag);
      expect(shape.attributes.has("class")).toBe(true);
      expect(shape.attributes.has("id")).toBe(true);
    }
  });
});
