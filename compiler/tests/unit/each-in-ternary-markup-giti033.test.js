/**
 * each-in-ternary-markup-giti033.test.js — GITI-033 (S240).
 *
 * An `<each>` nested inside a ternary-markup consequent
 * (`${ cond ? <ul><each in=src>…</each></ul> : "" }`) — where the each iterates
 * a module/const/`@cell`/match-arm-payload source (NO enclosing `for`-loop) —
 * must lower its body the SAME way the identical each does OUTSIDE the ternary.
 *
 * Pre-fix (base 364def58) the `tryEmitNestedLiftEach` gate (emit-lift.js) bailed
 * on a null enclosing `scopeVar`, so the each fell through to LITERAL `<each>`
 * element emission and its `${@.}` body leaked the raw sigil:
 *   `createTextNode(String((@.) ?? ""))` → E-CODEGEN-INVALID-LOGIC.
 * Sibling of Bug 72 (S158) — SPEC §17.7.3 makes `@.` legal in any markup
 * context; E-SYNTAX-064 correctly does NOT fire. Pure codegen-lowering gap.
 *
 * Coverage — the 5 dispatch preconditions:
 *   §1  null-safety / bare `${@.}` string list  (compiles clean, node --check).
 *   §2  per-item ATTRIBUTE interpolation `class="tag tag-${@.kind}"`   (highest risk).
 *   §2b per-item TEXT-body interpolation `${@.field}` → live text node (runtime-half).
 *   §3  reactive `@cell` source → `_scrml_reactive_get` inside `_scrml_effect`.
 *   §4  match-arm payload binding (`<Loaded(d)>` → `<each in=d.conflicts>`) — giti's real shape.
 *   §4b outer `<each in=x as d>` nesting — inner `@.` = INNER item, not outer `d` (§17.7.3).
 *   §5  `<empty>` sub-element renders on an empty collection.
 *   §6  NEGATIVE no-regression: a ternary consequent with NO nested each is unaffected.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";

function compile(source, suffix = "giti033") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  let clientJs = "";
  const clientPath = resolve(outDir, `${name}.client.js`);
  if (existsSync(clientPath)) clientJs = readFileSync(clientPath, "utf8");
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    clientJs,
    clientPath,
    tmpDir,
  };
}

const codes = (errors) => errors.map((e) => e.code);
const cleanup = (tmpDir) => { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); };
const DOLLAR = "$"; // for `${...}` inside JS template-literal sources

// ---------------------------------------------------------------------------
// §1 — bare `${@.}` string list; null enclosing scope; sigil-free + valid JS
// ---------------------------------------------------------------------------

describe("giti033 §1 — bare ${@.} each in a <main>-direct ternary (null scope)", () => {
  const src = `<program>
  const strs = ["a", "b"]
  const show = true
  <main>
    ${DOLLAR}{ show ? <ul>
        <each in=strs>
          <li>${DOLLAR}{@.}</li>
        </each>
      </ul> : "" }
  </main>
</program>`;

  test("no E-CODEGEN-INVALID-LOGIC; ZERO raw @. sigils; node --check passes", () => {
    const r = compile(src, "giti033-s1");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      expect(r.clientJs.length).toBeGreaterThan(0);
      // No raw sigil leaked, and no `${...}` shipped as LITERAL text.
      expect(r.clientJs).not.toMatch(/\(@\s*\.\)/);
      expect(r.clientJs).not.toContain("@ .");
      expect(r.clientJs).not.toMatch(/createTextNode\("\$\{/);
      // The each was LOWERED (reconcile list), not rendered as a literal <each>.
      expect(r.clientJs).toContain("_scrml_reconcile_list");
      // The body `${@.}` lowered to the inner iter var (live text node).
      expect(r.clientJs).toContain(".textContent = String(_scrml_each_item)");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — per-item ATTRIBUTE interpolation `class="tag tag-${@.kind}"` (highest risk)
// §2b — per-item TEXT-body interpolation `${@.field}` → live text node
// ---------------------------------------------------------------------------

describe("giti033 §2 — per-item attribute + text interpolation in a ternary each", () => {
  const src = `<program>
  const rows = [{ kind: "add", path: "x" }]
  const show = true
  <main>
    ${DOLLAR}{ show ? <ul>
        <each in=rows key=@.path>
          <li><span class="tag tag-${DOLLAR}{@.kind}">${DOLLAR}{@.kind}</span> ${DOLLAR}{@.path}</li>
        </each>
      </ul> : "" }
  </main>
</program>`;

  test("§2 attribute `tag-${@.kind}` lowers to the iter binding (not leaked)", () => {
    const r = compile(src, "giti033-s2");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      // Attribute interpolation → setAttribute with a template literal on the iter var.
      expect(r.clientJs).toContain("`tag tag-${_scrml_each_item.kind}`");
      // Must NOT leak the raw sigil into the attribute.
      expect(r.clientJs).not.toContain("tag-${@");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });

  test("§2b text body `${@.kind}` / `${@.path}` lower to LIVE text nodes (not literal `${...}`)", () => {
    const r = compile(src, "giti033-s2b");
    try {
      // The interpolations render the VALUE, not the literal `${...}` framing.
      expect(r.clientJs).toContain(".textContent = String(_scrml_each_item.kind)");
      expect(r.clientJs).toContain(".textContent = String(_scrml_each_item.path)");
      // Regression guard: the pre-fix bug shipped `createTextNode("${_scrml_each_item.kind}")`.
      expect(r.clientJs).not.toMatch(/createTextNode\("\$\{/);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §3 — reactive `@cell` source → _scrml_reactive_get inside _scrml_effect
// ---------------------------------------------------------------------------

describe("giti033 §3 — reactive @cell source inside a ternary each", () => {
  const src = `<program>
  <items>: string[] = ["a", "b"]
  const show = true
  <main>
    ${DOLLAR}{ show ? <ul>
        <each in=@items>
          <li>${DOLLAR}{@.}</li>
        </each>
      </ul> : "" }
  </main>
</program>`;

  test("the @cell source lowers to _scrml_reactive_get + subscribes via _scrml_effect", () => {
    const r = compile(src, "giti033-s3");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      // The source `@items` lowers to a reactive read (re-renders on update).
      expect(r.clientJs).toContain('_scrml_reactive_get("items")');
      // Wrapped in an effect so the subscription is live.
      expect(r.clientJs).toContain("_scrml_effect(");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §4 — MATCH-ARM payload binding (giti status.scrml / land.scrml real shape)
// ---------------------------------------------------------------------------

describe("giti033 §4 — ternary each in a <match> arm binding a payload var", () => {
  const src = `<program>
  type FileEntry:struct = { kind: string, path: string }
  type DiffData:struct = { conflicts: string[], publicFiles: FileEntry[] }
  type Phase:enum = { Loading, Loaded(d: DiffData), Failed(err: string) }
  <status>: Phase = .Loading
  <main>
    <match for=Phase on=@status>
      <Loading>Loading…</Loading>
      <Failed(err)>Error: ${DOLLAR}{err}</Failed>
      <Loaded(d)>
        ${DOLLAR}{ d.conflicts.length > 0 ? <ul>
            <each in=d.conflicts>
              <li><span class="tag tag-conflict">conflict</span> ${DOLLAR}{@.}</li>
            </each>
          </ul> : "" }
        ${DOLLAR}{ d.publicFiles.length > 0 ? <ul>
            <each in=d.publicFiles key=@.path>
              <li><span class="tag tag-${DOLLAR}{@.kind}">${DOLLAR}{@.kind}</span> ${DOLLAR}{@.path}</li>
            </each>
          </ul> : "" }
      </Loaded>
    </match>
  </main>
</program>`;

  test("inner source resolves against the arm payload `d`; inner @. = inner item; node --check", () => {
    const r = compile(src, "giti033-s4");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      // The each source resolves the match-arm payload field in the arm closure.
      expect(r.clientJs).toContain("d.conflicts");
      expect(r.clientJs).toContain("d.publicFiles");
      // The inner `@.` binds to the INNER each item, not the payload `d`.
      expect(r.clientJs).toContain(".textContent = String(_scrml_each_item)");
      expect(r.clientJs).toContain(".textContent = String(_scrml_each_item.kind)");
      expect(r.clientJs).toContain("`tag tag-${_scrml_each_item.kind}`");
      // No sigil / literal-`${}` leak.
      expect(r.clientJs).not.toMatch(/\(@\s*\.\)/);
      expect(r.clientJs).not.toMatch(/createTextNode\("\$\{/);
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §4b — ternary each nested inside an OUTER `<each in=x as d>` — innermost @.
// ---------------------------------------------------------------------------

describe("giti033 §4b — inner @. is the INNER item when nested in an outer <each> (§17.7.3)", () => {
  const src = `<program>
  const groups = [{ files: ["a", "b"], show: true }]
  <main>
    <each in=groups as d>
      <div>
        ${DOLLAR}{ d.show ? <ul>
            <each in=d.files>
              <li>${DOLLAR}{@.}</li>
            </each>
          </ul> : "" }
      </div>
    </each>
  </main>
</program>`;

  test("inner ${@.} lowers to the inner iter var, NOT the outer `as` alias `d`", () => {
    const r = compile(src, "giti033-s4b");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      // The inner text reads the inner item (§17.7.3 innermost-scope wins).
      expect(r.clientJs).toContain(".textContent = String(_scrml_each_item)");
      // Regression guard: pre-fix the outer per-item markup-value over-rewrite
      // clobbered the inner `${@.}` to the outer alias → `String(d)`.
      expect(r.clientJs).not.toContain(".textContent = String(d)");
      // The inner source still resolves against the outer alias `d`.
      expect(r.clientJs).toContain("d.files");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §5 — `<empty>` sub-element inside a ternary each renders on empty collection
// ---------------------------------------------------------------------------

describe("giti033 §5 — <empty> sub-element in a ternary each", () => {
  const src = `<program>
  const rows = []
  const show = true
  <main>
    ${DOLLAR}{ show ? <ul>
        <each in=rows>
          <li>${DOLLAR}{@.}</li>
          <empty><li>none</li></empty>
        </each>
      </ul> : "" }
  </main>
</program>`;

  test("the empty branch is emitted and gated on a zero-length collection", () => {
    const r = compile(src, "giti033-s5");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      expect(r.clientJs).toContain("none");
      // The empty-branch guard on an empty collection.
      expect(r.clientJs).toMatch(/\.length === 0/);
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §6 — NEGATIVE no-regression: a ternary consequent with NO nested each
// ---------------------------------------------------------------------------

describe("giti033 §6 — ternary consequent with no nested each is unaffected", () => {
  const src = `<program>
  const show = true
  const label = "hi"
  <main>
    ${DOLLAR}{ show ? <span>${DOLLAR}{label}</span> : "" }
  </main>
</program>`;

  test("plain markup-value ternary still compiles clean + node --check", () => {
    const r = compile(src, "giti033-s6");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      expect(r.clientJs).not.toContain("_scrml_reconcile_list");
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});

// ---------------------------------------------------------------------------
// §7 — REVIEW #1: string-literal (incl. an UNMATCHED brace) inside a `${…}`
//   TEXT-body interpolation of a ternary-nested each. Pre-fix, the markup-value
//   re-tokenizer dropped the string delimiters (`"add"`→`add`) and a quoted
//   `"}"`/`"{"` became a STRUCTURAL brace that truncated the interpolation →
//   E-CODEGEN-INVALID-LOGIC. The fix pre-splits the TEXT `${…}` as a logic child
//   (interior preserved verbatim) so string literals survive.
// ---------------------------------------------------------------------------

describe("giti033 §7 — string literal with braces inside a ${…} text-body interpolation", () => {
  const mk = (interp) => `<program>
  const rows = [{ kind: "add", path: "x", name: "n" }]
  const show = true
  <main>
    ${DOLLAR}{ show ? <ul>
        <each in=rows>
          <li>${DOLLAR}{ ${interp} }</li>
        </each>
      </ul> : "" }
  </main>
</program>`;

  test("unmatched close-brace in a string literal (`\"}\"`) compiles clean + preserves quotes", () => {
    const r = compile(mk(`@.kind == "add" ? "}" : @.path`), "giti033-s7-close");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      // Quotes survive: the string literal `"add"` and `"}"` are intact (not
      // dropped to bare idents / structural braces).
      expect(r.clientJs).toContain(`_scrml_each_item.kind == "add"`);
      expect(r.clientJs).toContain(`? "}" :`);
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });

  test("unmatched open-brace in a string literal (`\"{\"`) compiles clean", () => {
    const r = compile(mk(`"{" + @.name`), "giti033-s7-open");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      expect(r.clientJs).toContain(`"{" + _scrml_each_item.name`);
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });

  test("balanced braces in a string literal (`\"{loading}\"`) still work (positive)", () => {
    const r = compile(mk(`@.name == "n" ? "{loading}" : @.name`), "giti033-s7-balanced");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      expect(r.clientJs).toContain(`"{loading}"`);
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });

  test("plain string literals (no braces) preserve their quotes (latent quote-loss fixed)", () => {
    const r = compile(mk(`@.kind == "add" ? @.path : "none"`), "giti033-s7-plain");
    try {
      expect(codes(r.errors)).not.toContain("E-CODEGEN-INVALID-LOGIC");
      // Regression guard: pre-fix this emitted `== add ? ... : none` (bare idents).
      expect(r.clientJs).toContain(`_scrml_each_item.kind == "add"`);
      expect(r.clientJs).toContain(`: "none"`);
      expect(r.clientJs).not.toMatch(/kind == add\b/);
      execFileSync("node", ["--check", r.clientPath]);
    } finally {
      cleanup(r.tmpDir);
    }
  });
});
