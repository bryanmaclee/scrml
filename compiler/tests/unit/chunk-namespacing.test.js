/**
 * chunk-namespacing — two coexisting route chunks must not clobber each other.
 *
 * Two INDEPENDENT namespaces collide, and a fix for either alone still clobbers:
 *
 *   N1 — numeric node ids. The AST node-id counter restarts at 0 per compilation
 *        unit, so two routes emit the same each_9 / _scrml_each_render_9 /
 *        <!--scrml-each:9--> / _scrml_each_renderers["each_9"].
 *   N2 — reactive cell keys. The store is keyed by the SOURCE-LEVEL cell name,
 *        so two routes that both declare <rows> share one slot. This needs NO
 *        numeric coincidence, which is why a test covering only N1 would have
 *        passed the entire time this bug existed.
 *
 * The fixtures below are deliberately built to collide on BOTH axes at once:
 * `alpha` and `beta` are the same source, so their node ids are identical and
 * their cell names are identical. Every assertion here would have passed
 * trivially on a fixture whose pages differ in node count — which is exactly how
 * `examples/23-trucking-dispatch` false-greens (its pages miss by luck).
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { compileScrml } from "../../src/api.js";
import {
  chunkNamespaceToken,
  distRelativeSourcePath,
  nsId,
  nsCell,
  stripCellNamespace,
  setChunkNamespaceState,
  resetChunkNamespaceState,
  buildChunkNamespaceState,
} from "../../src/codegen/chunk-namespace.ts";
import { namespaceCellKeys } from "../../src/codegen/cell-namespace-pass.ts";

// ---------------------------------------------------------------------------
// Fixture — two pages with IDENTICAL source under one shell.
// ---------------------------------------------------------------------------

const PAGE = `<page>
  <rows> = ["a1", "a2"]
  <h2>Title</h2>
  <ul><each in=@rows><li>\${@.}</li></each></ul>
</page>
`;

const SHELL = `<program>
  <h1>Shell</h1>
  <outlet/>
</program>
`;

/** Compile a two-page app and return the per-page html + client js. */
function compileTwoPageApp() {
  const dir = mkdtempSync(join(tmpdir(), "scrml-chunk-ns-"));
  mkdirSync(join(dir, "pages"), { recursive: true });
  writeFileSync(join(dir, "index.scrml"), SHELL);
  writeFileSync(join(dir, "pages", "alpha.scrml"), PAGE);
  writeFileSync(join(dir, "pages", "beta.scrml"), PAGE);
  const out = join(dir, "dist");
  compileScrml({
    inputFiles: [
      join(dir, "index.scrml"),
      join(dir, "pages", "alpha.scrml"),
      join(dir, "pages", "beta.scrml"),
    ],
    write: true,
    outputDir: out,
  });
  const read = (f) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8") : "");
  return {
    alpha: { html: read("alpha.html"), js: read("alpha.client.js") },
    beta: { html: read("beta.html"), js: read("beta.client.js") },
  };
}

/** Every `<!--scrml-each:X-->` start-fence id in an HTML document. */
function fenceIds(html) {
  return [...html.matchAll(/<!--scrml-each:([^-]+)-->/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// The token itself
// ---------------------------------------------------------------------------

describe("chunk-namespacing: the token", () => {
  test("is an 8-char lowercase base36 hash of the dist-relative SOURCE PATH", () => {
    const t = chunkNamespaceToken("/proj/pages/home.scrml", "/proj");
    expect(t).toMatch(/^[0-9a-z]{8}$/);
    // path-identity, not content: same path always the same token
    expect(chunkNamespaceToken("/proj/pages/home.scrml", "/proj")).toBe(t);
  });

  test("distinguishes DUPLICATE BASENAMES — the reason basename was disqualified", () => {
    // Measured across the corpora: 7 duplicate basenames. `pages/driver/home.scrml`
    // and `pages/dispatch/home.scrml` are the shape that made a basename token
    // fail in exactly the multi-page layout that needs namespacing most.
    const driver = chunkNamespaceToken("/proj/pages/driver/home.scrml", "/proj");
    const dispatch = chunkNamespaceToken("/proj/pages/dispatch/home.scrml", "/proj");
    expect(driver).not.toBe(dispatch);
  });

  test("is SOURCE-TREE relative, so it does not depend on where the repo is checked out", () => {
    expect(distRelativeSourcePath("/home/a/proj/pages/x.scrml", "/home/a/proj")).toBe("pages/x.scrml");
    expect(distRelativeSourcePath("/srv/build/proj/pages/x.scrml", "/srv/build/proj")).toBe("pages/x.scrml");
    expect(chunkNamespaceToken("/home/a/proj/pages/x.scrml", "/home/a/proj")).toBe(
      chunkNamespaceToken("/srv/build/proj/pages/x.scrml", "/srv/build/proj"),
    );
  });

  test("with no namespace installed, nsId/nsCell are the identity (synthetic-AST emit)", () => {
    resetChunkNamespaceState();
    expect(nsId(9)).toBe("9");
    expect(nsCell("rows")).toBe("rows");
  });
});

// ---------------------------------------------------------------------------
// N1 — node-id-derived tokens
// ---------------------------------------------------------------------------

describe("chunk-namespacing N1: node-id-derived tokens do not collide", () => {
  test("two pages with IDENTICAL source get DIFFERENT each ids in HTML and JS", () => {
    const { alpha, beta } = compileTwoPageApp();

    const a = fenceIds(alpha.html);
    const b = fenceIds(beta.html);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    // Identical source ⇒ identical raw node ids. ONLY the namespace separates them.
    expect(a[0]).not.toBe(b[0]);
    expect(a[0]).toMatch(/^[0-9a-z]{8}_\d+$/);
    expect(b[0]).toMatch(/^[0-9a-z]{8}_\d+$/);

    // …and the renderer-registry key, the one shared object the two chunks fight
    // over, is distinct too.
    expect(alpha.js).toContain(`_scrml_each_renderers["each_${a[0]}"]`);
    expect(beta.js).toContain(`_scrml_each_renderers["each_${b[0]}"]`);
    expect(alpha.js).not.toContain(`each_${b[0]}`);
    expect(beta.js).not.toContain(`each_${a[0]}`);
  });

  test("the HTML fence and the JS that looks it up agree — the SSR/client contract", () => {
    const { alpha } = compileTwoPageApp();
    const [id] = fenceIds(alpha.html);
    // The fence is emitted into HTML; the anchor lookup + the renderer
    // registration live in JS. A scheme deriving the token independently in the
    // two emitters breaks rehydration SILENTLY — no grep can see it, so pin it.
    expect(alpha.html).toContain(`<!--scrml-each:${id}--><!--/scrml-each:${id}-->`);
    expect(alpha.js).toContain(`_scrml_find_each_anchor(document, "${id}")`);
    expect(alpha.js).toContain(`function _scrml_each_render_${id}(`);
    expect(alpha.js).toContain(`_scrml_each_renderers["each_${id}"]`);
  });

  test("nsId produces a valid JS identifier fragment", () => {
    setChunkNamespaceState({ token: "0a1b2c3d", cellOwners: new Map() });
    try {
      expect(nsId(24)).toBe("0a1b2c3d_24");
      expect(`_scrml_each_render_${nsId(24)}`).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    } finally {
      resetChunkNamespaceState();
    }
  });
});

// ---------------------------------------------------------------------------
// N2 — reactive cell keys
//
// Driven through `namespaceCellKeys` directly: the pass is built and proven but
// held out of the emit path pending a ruling on the landing shape (see
// codegen/index.ts and docs/changes/chunk-namespacing/progress.md). These tests
// pin the MECHANISM so the ruling is about landing, not about correctness.
// ---------------------------------------------------------------------------

describe("chunk-namespacing N2: reactive cell keys", () => {
  function withNs(token, cellOwners, fn) {
    setChunkNamespaceState({ token, cellOwners: cellOwners ?? new Map() });
    try {
      return fn();
    } finally {
      resetChunkNamespaceState();
    }
  }

  test("two chunks that both declare <rows> get DIFFERENT store keys", () => {
    const chunk = `_scrml_reactive_set("rows", [1]);\n_scrml_reactive_get("rows");\n`;
    const a = withNs("0a1b2c3d", null, () => namespaceCellKeys(chunk));
    const b = withNs("0e4f5a6b", null, () => namespaceCellKeys(chunk));
    expect(a).toContain('_scrml_reactive_set("0a1b2c3d$rows"');
    expect(b).toContain('_scrml_reactive_set("0e4f5a6b$rows"');
    expect(a).not.toBe(b);
  });

  test("DOTTED §6.3.2 compound keys namespace their ROOT only", () => {
    // The runtime's dotted delegation splits on `.`; the separator is `$`
    // precisely so it cannot perturb that split.
    expect(withNs("0a1b2c3d", null, () => nsCell("form.name.isValid"))).toBe("0a1b2c3d$form.name.isValid");
  });

  test("an IMPORTED cell keys under the EXPORTER's token (§51.0.A singleton)", () => {
    // A cross-file imported engine is the SAME instance across every importing
    // file — the mechanism is one shared store slot. Namespacing by the CONSUMING
    // file would fork it and break the invariant outright.
    const owners = new Map([["appPhase", "0dddeeee$appPhase"]]);
    expect(withNs("0a1b2c3d", owners, () => nsCell("appPhase"))).toBe("0dddeeee$appPhase");
    expect(withNs("0a1b2c3d", owners, () => nsCell("localCell"))).toBe("0a1b2c3d$localCell");
  });

  test("the pass rewrites CALLS but never comments or author string data", () => {
    const chunk = [
      '// _scrml_reactive_get("rows") — the accessor, documented',
      'const doc = "see _scrml_reactive_get(\\"rows\\") for details";',
      '_scrml_reactive_get("rows");',
    ].join("\n");
    const out = withNs("0a1b2c3d", null, () => namespaceCellKeys(chunk));
    expect(out).toContain('// _scrml_reactive_get("rows") — the accessor, documented');
    expect(out).toContain('see _scrml_reactive_get(\\"rows\\") for details');
    expect(out).toContain('_scrml_reactive_get("0a1b2c3d$rows");');
  });

  test("is IDEMPOTENT — an already-namespaced key is left alone", () => {
    const once = withNs("0a1b2c3d", null, () => namespaceCellKeys('_scrml_reactive_get("rows");'));
    const twice = withNs("0a1b2c3d", null, () => namespaceCellKeys(once));
    expect(twice).toBe(once);
  });

  test("_scrml_derived_subscribe namespaces BOTH arguments — both are cell keys", () => {
    const out = withNs("0a1b2c3d", null, () =>
      namespaceCellKeys('_scrml_derived_subscribe("total", "price");'));
    expect(out).toBe('_scrml_derived_subscribe("0a1b2c3d$total", "0a1b2c3d$price");');
  });

  test("the SSR seed keys namespace too — the client feeds them to _scrml_reactive_set", () => {
    const out = withNs("0a1b2c3d", null, () =>
      namespaceCellKeys('_scrml_ssr_state["accounts"] = rows;\nvar _scrml_shell_cells = { "count": true };'));
    expect(out).toContain('_scrml_ssr_state["0a1b2c3d$accounts"]');
    expect(out).toContain('{ "0a1b2c3d$count": true }');
  });

  test("preserves formatting and comments byte-for-byte outside the rewritten keys", () => {
    const chunk = 'function f() {\n  // keep me\n  return _scrml_reactive_get("rows");\n}\n';
    const out = withNs("0a1b2c3d", null, () => namespaceCellKeys(chunk));
    expect(out).toBe('function f() {\n  // keep me\n  return _scrml_reactive_get("0a1b2c3d$rows");\n}\n');
  });

  test("stripCellNamespace recovers the author-facing name for diagnostics", () => {
    expect(stripCellNamespace("0a1b2c3d$rows")).toBe("rows");
    expect(stripCellNamespace("rows")).toBe("rows");
    // not a token (wrong length) → untouched
    expect(stripCellNamespace("abc$rows")).toBe("abc$rows");
  });

  test("with no namespace installed the pass is a no-op", () => {
    resetChunkNamespaceState();
    const chunk = '_scrml_reactive_get("rows");';
    expect(namespaceCellKeys(chunk)).toBe(chunk);
  });
});

// ---------------------------------------------------------------------------
// State plumbing
// ---------------------------------------------------------------------------

describe("chunk-namespacing: per-unit state", () => {
  test("buildChunkNamespaceState derives the token from the file's own path", () => {
    const st = buildChunkNamespaceState({ filePath: "/proj/pages/alpha.scrml" }, "/proj", null);
    expect(st.token).toBe(chunkNamespaceToken("/proj/pages/alpha.scrml", "/proj"));
    expect(st.cellOwners.size).toBe(0);
  });

  test("a synthetic AST with no filePath yields the empty (un-namespaced) state", () => {
    const st = buildChunkNamespaceState({}, null, null);
    expect(st.token).toBe("");
  });
});
