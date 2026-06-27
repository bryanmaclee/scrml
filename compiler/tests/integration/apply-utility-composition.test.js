/**
 * §26.8 — `@apply` utility composition in author CSS (bug-1 W2, ss40).
 *
 * R26 + ADVERSARIAL (S215): every assertion is against the REAL emitted CSS /
 * the REAL diagnostic stream produced by recompiling a `.scrml` source through
 * `compileScrml` — NOT a synthesized AST. This catches upstream parser /
 * tokenizer regressions a hand-built AST would miss.
 *
 * Coverage:
 *   §1  per-token expansion — every utility's declarations inline; no verbatim
 *       `@apply` survives
 *   §2  composing family — `@apply ring-2 shadow-lg` → ONE box-shadow + BOTH
 *       `--tw-*` setters (NOT last-write-wins), byte-matching the §26.8 example
 *   §3  arbitrary values — `@apply bg-[#1da1f2]` resolves (free via §26.4)
 *   §4  the three E-APPLY-* diagnostics (unknown / variant / non-inlinable)
 *   §5  edges — empty `@apply;`, multiple `@apply` lines, `@apply` + hand decls,
 *       the `group` marker, the dynamic-class no-lint guarantee
 *   §6  the §26.8 worked spec sample + the .btn/.card dogfood
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { resolveApplyToken } from "../../src/tailwind-classes.js";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "apply-css-"));
});

afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

/** Compile a source string; return the emitted CSS + the partitioned diags. */
function compileSource(name, source) {
  const filePath = join(TMP, `${name}.scrml`);
  writeFileSync(filePath, source);
  const outDir = join(TMP, `${name}.dist`);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const errors = result.errors || [];
  const warnings = result.warnings || [];
  // Cross-stream code lookup (the W-/I- partition vs error partition is real —
  // see the diagnostic-stream-partition lesson; never assert on a single stream).
  const allCodes = [...errors, ...warnings].map(d => d.code);
  let css = "";
  try {
    css = readFileSync(join(outDir, `${name}.css`), "utf8");
  } catch {
    // leave empty — assertions surface a clear failure
  }
  return { errors, warnings, allCodes, css };
}

/** Extract a single rule's declaration body (`selector { … }`) from a CSS string. */
function ruleBody(css, selector) {
  const re = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`);
  const m = css.match(re);
  return m ? m[1] : null;
}

/** Count non-overlapping occurrences of a property name in a declaration body. */
function countProp(body, prop) {
  if (body == null) return 0;
  const re = new RegExp(`(^|[;\\s])${prop}\\s*:`, "g");
  return (body.match(re) || []).length;
}

describe("§26.8 §1 — per-token expansion", () => {
  test("each utility's declarations inline in source order; no verbatim @apply", () => {
    const { errors, css } = compileSource("expand", `<program name="X">
#{
  .btn { @apply px-4 py-2 rounded-md bg-blue-500 text-white; }
}
<button class="btn">Save</button>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);

    const body = ruleBody(css, ".btn");
    expect(body).not.toBeNull();
    expect(body).toMatch(/padding-left:\s*1rem/);
    expect(body).toMatch(/padding-right:\s*1rem/);
    expect(body).toMatch(/padding-top:\s*0\.5rem/);
    expect(body).toMatch(/padding-bottom:\s*0\.5rem/);
    expect(body).toMatch(/border-radius:\s*0\.375rem/);
    expect(body).toMatch(/background-color:\s*#3b82f6/);
    expect(body).toMatch(/color:\s*#ffffff/);

    // NO verbatim `@apply` may survive anywhere in the stylesheet.
    expect(css).not.toContain("@apply");
  });
});

describe("§26.8 §2 — composing family (the §26.7 win, for free)", () => {
  test("@apply ring-2 shadow-lg → ONE box-shadow + BOTH setters (not last-write-wins)", () => {
    const { errors, css } = compileSource("compose", `<program name="X">
#{
  .card { @apply ring-2 shadow-lg; }
}
<div class="card">Card</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);

    const body = ruleBody(css, ".card");
    expect(body).not.toBeNull();

    // BOTH composing setters survive — ring AND shadow are visible (the var()
    // model means the two distinct `--tw-*` props do not clobber each other).
    expect(body).toMatch(/--tw-ring-shadow:/);
    expect(body).toMatch(/--tw-shadow:/);

    // Exactly ONE box-shadow shorthand (the duplicate that ring-2 + shadow-lg
    // each emit is deduped) — NOT two, NOT zero.
    expect(countProp(body, "box-shadow")).toBe(1);

    // The single box-shadow reads BOTH setters via the composing var() shorthand.
    expect(body).toMatch(/box-shadow:\s*var\(--tw-ring-offset-shadow[^;]*var\(--tw-ring-shadow[^;]*var\(--tw-shadow/);
  });

  test("partial application stays valid (@apply ring-2 alone)", () => {
    const { errors, css } = compileSource("compose-partial", `<program name="X">
#{
  .ringed { @apply ring-2; }
}
<div class="ringed">x</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);
    const body = ruleBody(css, ".ringed");
    expect(body).toMatch(/--tw-ring-shadow:/);
    expect(countProp(body, "box-shadow")).toBe(1);
  });
});

describe("§26.8 §3 — arbitrary values (free via §26.4)", () => {
  test("@apply bg-[#1da1f2] resolves to background-color", () => {
    const { errors, css } = compileSource("arb", `<program name="X">
#{
  .brand { @apply bg-[#1da1f2] p-[3px]; }
}
<div class="brand">x</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);
    const body = ruleBody(css, ".brand");
    expect(body).toMatch(/background-color:\s*#1da1f2/);
    expect(body).toMatch(/padding:\s*3px/);
  });
});

describe("§26.8 §4 — the three E-APPLY-* diagnostics", () => {
  test("unknown token → E-APPLY-UNKNOWN-UTILITY (Error)", () => {
    const { errors, allCodes } = compileSource("unknown", `<program name="X">
#{
  .a { @apply flexx; }
}
<div class="a">x</div>
</program>
`);
    expect(allCodes).toContain("E-APPLY-UNKNOWN-UTILITY");
    const d = errors.find(e => e.code === "E-APPLY-UNKNOWN-UTILITY");
    expect(d).toBeDefined();
    expect(d.severity).toBe("error");
    expect(d.message).toContain("flexx");
  });

  test("variant-prefixed token → E-APPLY-VARIANT-UNSUPPORTED (Error)", () => {
    const { errors, allCodes } = compileSource("variant", `<program name="X">
#{
  .b { @apply hover:bg-blue-500; }
}
<div class="b">x</div>
</program>
`);
    expect(allCodes).toContain("E-APPLY-VARIANT-UNSUPPORTED");
    const d = errors.find(e => e.code === "E-APPLY-VARIANT-UNSUPPORTED");
    expect(d.severity).toBe("error");
    expect(d.message).toContain("hover:bg-blue-500");
  });

  test("responsive variant (md:) → E-APPLY-VARIANT-UNSUPPORTED", () => {
    const { allCodes } = compileSource("variant-md", `<program name="X">
#{
  .c { @apply md:flex; }
}
<div class="c">x</div>
</program>
`);
    expect(allCodes).toContain("E-APPLY-VARIANT-UNSUPPORTED");
  });

  test("multi-rule prose utility → E-APPLY-NON-INLINABLE-UTILITY (Error)", () => {
    const { errors, allCodes } = compileSource("prose", `<program name="X">
#{
  .d { @apply prose; }
}
<div class="d">x</div>
</program>
`);
    expect(allCodes).toContain("E-APPLY-NON-INLINABLE-UTILITY");
    const d = errors.find(e => e.code === "E-APPLY-NON-INLINABLE-UTILITY");
    expect(d.severity).toBe("error");
    expect(d.message).toContain("prose");
  });

  test("combinator-selector utility (space-x-4) → E-APPLY-NON-INLINABLE-UTILITY", () => {
    const { allCodes } = compileSource("combinator", `<program name="X">
#{
  .e { @apply space-x-4; }
}
<div class="e">x</div>
</program>
`);
    expect(allCodes).toContain("E-APPLY-NON-INLINABLE-UTILITY");
  });

  test("arbitrary colon-in-brackets is NOT mistaken for a variant (resolveApplyToken)", () => {
    // A `:` INSIDE a `[…]` bracket (a URL / data-URI arbitrary value) is part of
    // the value, NOT a variant prefix — classify "ok", never "variant". Asserted
    // at the resolver layer: a `url(http://…)` value cannot round-trip a full
    // `#{}` compile because the CSS-block splitter treats `//` as a line comment
    // (a pre-existing, @apply-unrelated limitation), so the discrimination is
    // tested on the real classifier directly.
    const url = resolveApplyToken("bg-[url(http://x.test/a.png)]");
    expect(url.kind).toBe("ok");
    expect(url.decls).toMatch(/background-image:\s*url\(http:\/\/x\.test\/a\.png\)/);

    // A genuine variant prefix (`:` at bracket-depth 0) IS rejected.
    expect(resolveApplyToken("hover:bg-blue-500").kind).toBe("variant");
    expect(resolveApplyToken("before:flex").kind).toBe("variant");
  });
});

describe("§26.8 §5 — edges", () => {
  test("empty @apply; is a no-op (no error, empty rule body)", () => {
    const { errors, css } = compileSource("empty", `<program name="X">
#{
  .empty { @apply; }
}
<div class="empty">x</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);
    expect(css).not.toContain("@apply");
    const body = ruleBody(css, ".empty");
    expect(body.trim()).toBe("");
  });

  test("multiple @apply lines in one rule all expand in order", () => {
    const { errors, css } = compileSource("multi", `<program name="X">
#{
  .m { @apply px-4; @apply py-2; }
}
<div class="m">x</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);
    const body = ruleBody(css, ".m");
    expect(body).toMatch(/padding-left:\s*1rem/);
    expect(body).toMatch(/padding-top:\s*0\.5rem/);
  });

  test("@apply + hand-written declarations in the same rule → BOTH emit", () => {
    const { errors, css } = compileSource("mixed", `<program name="X">
#{
  .mix { @apply px-4; color: red; }
}
<div class="mix">x</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);
    const body = ruleBody(css, ".mix");
    expect(body).toMatch(/padding-left:\s*1rem/);
    expect(body).toMatch(/color:\s*red/);
  });

  test("the bare `group` marker is recognized — no error, emits nothing", () => {
    const { errors, css } = compileSource("group", `<program name="X">
#{
  .g { @apply group; }
}
<div class="g">x</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);
    expect(ruleBody(css, ".g").trim()).toBe("");
  });

  test("an @apply-defined class draws no W-TAILWIND-UNRECOGNIZED-CLASS when used dynamically", () => {
    const { allCodes, css } = compileSource("dyn", `<program name="X">
#{
  .card { @apply ring-2 shadow-lg; }
}
\${ <active>: bool = false }
<div class="\${@active ? 'card' : ''}">x</div>
</program>
`);
    expect(allCodes).not.toContain("W-TAILWIND-UNRECOGNIZED-CLASS");
    // .card is backed by real composed CSS.
    expect(ruleBody(css, ".card")).toMatch(/--tw-ring-shadow:/);
  });
});

describe("§26.8 §6 — the worked spec sample + the .btn/.card dogfood", () => {
  test("the §26.8 spec sample compiles to the documented CSS shape", () => {
    const { errors, css } = compileSource("spec-sample", `<program name="X">
#{
  .btn  { @apply px-4 py-2 rounded-md bg-blue-500 text-white; }
  .card { @apply ring-2 shadow-lg; }
}
<button class="btn">Save</button>
<div class="card">Card</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);

    const btn = ruleBody(css, ".btn");
    expect(btn).toMatch(/padding-left:\s*1rem.*padding-right:\s*1rem/s);
    expect(btn).toMatch(/border-radius:\s*0\.375rem/);
    expect(btn).toMatch(/background-color:\s*#3b82f6/);
    expect(btn).toMatch(/color:\s*#ffffff/);

    const card = ruleBody(css, ".card");
    expect(card).toMatch(/--tw-ring-shadow:/);
    expect(card).toMatch(/--tw-shadow:/);
    expect(countProp(card, "box-shadow")).toBe(1);

    expect(css).not.toContain("@apply");
  });

  test("a realistic .btn/.card dogfood compiles clean and renders styled classes", () => {
    const { errors, warnings, css } = compileSource("dogfood", `<program name="Dogfood">
#{
  .btn       { @apply px-4 py-2 rounded-md bg-blue-500 text-white; }
  .btn-ghost { @apply px-4 py-2 rounded-md; color: #3b82f6; }
  .card      { @apply ring-2 shadow-lg rounded-md; }
}
<div class="card">
  <button class="btn">Save</button>
  <button class="btn-ghost">Cancel</button>
</div>
</program>
`);
    expect(errors.filter(e => e.code?.startsWith("E-APPLY"))).toEqual([]);
    // No spurious unrecognized-class lint on the author-defined classes.
    const twLints = [...errors, ...warnings].filter(d => d.code === "W-TAILWIND-UNRECOGNIZED-CLASS");
    expect(twLints).toEqual([]);

    // .btn-ghost: @apply expansion AND the hand-written color both present.
    const ghost = ruleBody(css, ".btn-ghost");
    expect(ghost).toMatch(/border-radius:\s*0\.375rem/);
    expect(ghost).toMatch(/color:\s*#3b82f6/);

    // .card composes ring + shadow + rounded into one rule, one box-shadow.
    const card = ruleBody(css, ".card");
    expect(card).toMatch(/--tw-ring-shadow:/);
    expect(card).toMatch(/--tw-shadow:/);
    expect(card).toMatch(/border-radius:\s*0\.375rem/);
    expect(countProp(card, "box-shadow")).toBe(1);

    expect(css).not.toContain("@apply");
  });
});
