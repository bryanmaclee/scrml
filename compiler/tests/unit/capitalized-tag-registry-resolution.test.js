/**
 * Regression pin for `g-capitalized-unknown-tag-neither-normalized-nor-rejected`
 * (Stage 3.055 TC — `compiler/src/tag-canonicalizer.ts`).
 *
 * SPEC §4.3: "The compiler resolves `<identifier>` against the unified
 * state-type registry (§15.X) at NR (Stage 3.05). Casing is irrelevant to
 * resolution; convention is PascalCase for components and lowercase for HTML
 * elements / built-in scrml lifecycle types."
 * SPEC §4.2: "Classification is by the registry, never by whitespace."
 *
 * The pre-fix defect: the block splitter classifies component-vs-element by
 * capitalization ALONE, so an UNREGISTERED capitalized tag that spells a known
 * HTML element was neither normalized to that element nor rejected —
 * `<Button>click</>` compiled with `errors: []` and reached the document as a
 * literal `<Button>` tag, bypassing attribute validation and the content model
 * and "working" only because an HTML parser is ASCII-case-insensitive. Its
 * sibling `<Widget/>` — equally unresolved, but not spelling any element — was
 * correctly rejected with E-COMPONENT-035.
 *
 * The three arms below ARE the fix's contract, and the middle one is the load-
 * bearing one: it proves TC keys on NR's REGISTRY verdict and not on a name
 * list. A registered `Button` component must still beat the HTML `button`
 * element, because registration — never capitalization — is what makes a tag a
 * component.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { canonicalElementName } from "../../src/html-elements.js";
import { runTC } from "../../src/tag-canonicalizer.ts";

function compile(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-captag-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${name}.html`);
    const html = existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "";
    return { codes: (result.errors ?? []).map((e) => e.code), html };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** The `<body>` content, with the emitted `<script>` tags trimmed off. */
function bodyOf(html) {
  const inner = html.split("<body>")[1] ?? "";
  return inner.split("<script")[0].trim();
}

describe("a capitalized tag resolves by the registry, not by its casing", () => {
  test("ARM 1 — an UNREGISTERED `<Button>` is the HTML `button` element", () => {
    const { codes, html } = compile(
      "<program>\n    <Button>click</>\n</>\n",
      "unregistered",
    );
    expect(codes).toEqual([]);
    // The defect: this used to be the verbatim `<Button>click</Button>`.
    expect(bodyOf(html)).toBe("<button>click</button>");
    expect(html).not.toContain("<Button");
  });

  test("ARM 1 — the capitalized spelling compiles IDENTICALLY to the lowercase one", () => {
    const cap = compile("<program>\n    <Button>click</>\n</>\n", "cap");
    const low = compile("<program>\n    <button>click</>\n</>\n", "low");
    expect(bodyOf(cap.html)).toBe(bodyOf(low.html));
    expect(cap.codes).toEqual(low.codes);
  });

  test("ARM 1 — the normalized element goes through ELEMENT validation", () => {
    // `bind:value` is not a valid bind on `<button>`. Pre-fix the tag stayed
    // `Button` all the way to the document, so nothing ever validated it AS a
    // button; the point of normalizing is that element rules now apply.
    const cap = compile(
      '<name> = "x"\n\n<program>\n    <Button bind:value=@name>click</>\n</>\n',
      "cap-attr",
    );
    const low = compile(
      '<name> = "x"\n\n<program>\n    <button bind:value=@name>click</>\n</>\n',
      "low-attr",
    );
    expect(cap.codes).toContain("E-ATTR-011");
    expect(cap.codes).toEqual(low.codes);
    expect(bodyOf(cap.html)).toBe(bodyOf(low.html));
  });

  test("ARM 2 — a REGISTERED `Button` component still beats the HTML element", () => {
    const { codes, html } = compile(
      'const Button = <div class="cmp">c</>\n\n<program>\n    <Button/>\n</>\n',
      "registered",
    );
    expect(codes).toEqual([]);
    // Expanded as the component, NOT normalized to `<button>`.
    expect(html).toContain('data-scrml="Button"');
    expect(html).toContain('class="cmp"');
    expect(bodyOf(html)).not.toContain("<button");
  });

  test("ARM 2 — a registered `Button` whose BODY is a `<button>` still expands as the component", () => {
    // The adversarial variant of the arm above: the component's own root tag is
    // the very element its name collides with, so "did TC rewrite it?" cannot be
    // read off the tag alone. The `data-scrml` marker + the component's own
    // attributes and content are what prove CE expanded it.
    const { codes, html } = compile(
      'const Button = <button class="cmp" type="submit">go</>\n\n<program>\n    <Button/>\n</>\n',
      "registered-button-body",
    );
    expect(codes).toEqual([]);
    expect(bodyOf(html)).toBe(
      '<button data-scrml="Button" class="cmp" type="submit">go </button>',
    );
  });

  test("ARM 3 — an unresolved `<Widget/>` is still REJECTED with E-COMPONENT-035", () => {
    const { codes } = compile("<program>\n    <Widget/>\n</>\n", "unresolved");
    expect(codes).toContain("E-COMPONENT-035");
  });
});

describe("canonicalElementName — the spelling half of the rule", () => {
  test("recovers the canonical spelling case-insensitively", () => {
    expect(canonicalElementName("Button")).toBe("button");
    expect(canonicalElementName("MAIN")).toBe("main");
    expect(canonicalElementName("DiV")).toBe("div");
  });

  test("recovers SVG's camelCase canonical spelling", () => {
    expect(canonicalElementName("fegaussianblur")).toBe("feGaussianBlur");
    expect(canonicalElementName("FeGaussianBlur")).toBe("feGaussianBlur");
    expect(canonicalElementName("LINEARGRADIENT")).toBe("linearGradient");
  });

  test("HTML wins every cross-namespace name collision", () => {
    // `a`, `script`, `style`, `title`, `font` and `image` exist in BOTH the HTML
    // and SVG sets; outside an `<svg>` integration point HTML is the answer.
    expect(canonicalElementName("A")).toBe("a");
    expect(canonicalElementName("Script")).toBe("script");
    expect(canonicalElementName("Title")).toBe("title");
  });

  test("is null for a name that spells no element", () => {
    expect(canonicalElementName("Widget")).toBeNull();
    expect(canonicalElementName("UserCard")).toBeNull();
    expect(canonicalElementName("")).toBeNull();
  });

  test("never produces a scrml structural tag name", () => {
    // `program` / `each` / `errors` live in the curated REGISTRY that
    // `isKnownElementName` accepts, but they are NOT markup elements and must
    // never be synthesised as a canonical spelling.
    expect(canonicalElementName("Program")).toBeNull();
    expect(canonicalElementName("Each")).toBeNull();
    expect(canonicalElementName("Errors")).toBeNull();
    expect(canonicalElementName("Outlet")).toBeNull();
  });

  test("custom elements are canonical by construction; a capitalized one is not one", () => {
    expect(canonicalElementName("my-widget")).toBe("my-widget");
    expect(canonicalElementName("My-Widget")).toBeNull();
  });
});

describe("runTC keys on NR's stamp, never on the tag's spelling", () => {
  const markup = (tag, resolvedKind) => ({
    kind: "markup",
    tag,
    resolvedKind,
    isComponent: /^[A-Z]/.test(tag),
    children: [],
  });

  test("rewrites only a node NR resolved to html-builtin", () => {
    const node = markup("Button", "html-builtin");
    const { rewrites } = runTC("t.scrml", { nodes: [node] });
    expect(node.tag).toBe("button");
    expect(node.isComponent).toBe(false);
    expect(rewrites).toEqual([{ from: "Button", to: "button", line: null, col: null }]);
  });

  test("leaves a user-component stamp alone even when the name spells an element", () => {
    const node = markup("Header", "user-component");
    const { rewrites } = runTC("t.scrml", { nodes: [node] });
    expect(node.tag).toBe("Header");
    expect(node.isComponent).toBe(true);
    expect(rewrites).toEqual([]);
  });

  test("leaves a user-state-type and a lifecycle stamp alone", () => {
    const st = markup("Form", "user-state-type");
    const lc = markup("Table", "scrml-lifecycle");
    runTC("t.scrml", { nodes: [st, lc] });
    expect(st.tag).toBe("Form");
    expect(lc.tag).toBe("Table");
  });

  test("leaves an unresolved node alone so VP-2 can still reject it", () => {
    const node = markup("Widget", "unknown");
    const spellsAnElement = markup("Nav", "unknown");
    runTC("t.scrml", { nodes: [node, spellsAnElement] });
    expect(node.tag).toBe("Widget");
    expect(spellsAnElement.tag).toBe("Nav");
  });

  test("leaves an UNSTAMPED node alone (NR never visited it — no verdict to act on)", () => {
    const node = { kind: "markup", tag: "Button", isComponent: true, children: [] };
    runTC("t.scrml", { nodes: [node] });
    expect(node.tag).toBe("Button");
  });

  test("reaches markup nested arbitrarily deep", () => {
    const deep = markup("Button", "html-builtin");
    const ast = { nodes: [{ kind: "markup", tag: "div", resolvedKind: "html-builtin", children: [{ kind: "lift-expr", expr: { node: deep } }] }] };
    const { rewrites } = runTC("t.scrml", ast);
    expect(deep.tag).toBe("button");
    expect(rewrites).toHaveLength(1);
  });

  test("is idempotent — a second run rewrites nothing", () => {
    const node = markup("Button", "html-builtin");
    runTC("t.scrml", { nodes: [node] });
    const second = runTC("t.scrml", { nodes: [node] });
    expect(second.rewrites).toEqual([]);
    expect(node.tag).toBe("button");
  });
});
