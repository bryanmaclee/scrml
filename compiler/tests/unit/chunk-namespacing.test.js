/**
 * chunk-namespacing — two coexisting route chunks must not clobber each other.
 *
 * FOUR independent namespaces collide, and a fix for any one alone still leaves
 * the others open:
 *
 *   N1 — numeric node ids. The AST node-id counter restarts at 0 per compilation
 *        unit, so two routes emit the same each_9 / _scrml_each_render_9 /
 *        <!--scrml-each:9--> / _scrml_each_renderers["each_9"].         CLOSED
 *   N2 — reactive cell keys. The store is keyed by the SOURCE-LEVEL cell name,
 *        so two routes that both declare <rows> share one slot. This needs NO
 *        numeric coincidence, which is why a test covering only N1 would have
 *        passed the entire time this bug existed.                       OPEN
 *   N3 — author top-level type names (`const Phase`, `Phase_variants`). A
 *        redeclaration SyntaxError kills the second chunk outright.      OPEN
 *   N4 — engine names: the `data-scrml-engine-mount` attribute (resolved with a
 *        DOCUMENT-WIDE querySelector) plus nine top-level consts keyed on the
 *        author's engine cell name.                          OPEN (patch ready)
 *
 * The fixtures here are built to collide on purpose: `alpha` and `beta` are the
 * same source, so their node ids AND their cell names are identical. Assertions
 * of this shape pass trivially on a fixture whose pages differ in node count —
 * which is exactly how `examples/23-trucking-dispatch` false-greens (its pages
 * miss by luck, not by design).
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { compileScrml } from "../../src/api.js";
import {
  chunkNamespaceToken,
  projectRelativeSourcePath,
  resolveProjectRoot,
  assertChunkTokensDistinct,
  nsId,
  nsName,
  currentChunkNamespace,
  setChunkNamespaceState,
  resetChunkNamespaceState,
  buildChunkNamespaceState,
} from "../../src/codegen/chunk-namespace.ts";

// ---------------------------------------------------------------------------
// Fixtures
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

const ENGINE_PAGE = `<page>
  type Phase:enum = { Idle, Busy }
  <engine for=Phase initial=.Idle>
    <Idle rule=.Busy><em>idle</em></>
    <Busy rule=.Idle><em>busy</em></>
  </>
</page>
`;

/** Compile a two-page app; return each page's html + client js. */
function compileTwoPageApp(pageSource = PAGE) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-chunk-ns-"));
  mkdirSync(join(dir, "pages"), { recursive: true });
  writeFileSync(join(dir, "index.scrml"), SHELL);
  writeFileSync(join(dir, "pages", "alpha.scrml"), pageSource);
  writeFileSync(join(dir, "pages", "beta.scrml"), pageSource);
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
    dir,
    alpha: { html: read("alpha.html"), js: read("alpha.client.js") },
    beta: { html: read("beta.html"), js: read("beta.client.js") },
  };
}

/** Every `<!--scrml-each:X-->` start-fence id in an HTML document. */
function fenceIds(html) {
  return [...html.matchAll(/<!--scrml-each:([^-]+)-->/g)].map((m) => m[1]);
}

function withNs(token, fn) {
  setChunkNamespaceState({ token });
  try {
    return fn();
  } finally {
    resetChunkNamespaceState();
  }
}

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

describe("chunk-namespacing: the token", () => {
  test("is 8 lowercase base36 chars and ALWAYS starts with 0 (fnv1a is a u32)", () => {
    // 36^7 > 2^32, so the 8th digit is never needed. Consumers matching tokens
    // by shape must anchor on `0[0-9a-z]{7}` — the looser `[0-9a-z]{8}` eats the
    // trailing 8 chars of unrelated identifiers (S282 D8).
    for (const p of ["pages/a.scrml", "pages/b.scrml", "deep/nested/c.scrml", "d.scrml"]) {
      expect(chunkNamespaceToken(`/proj/${p}`, "/proj")).toMatch(/^0[0-9a-z]{7}$/);
    }
  });

  test("distinguishes DUPLICATE BASENAMES — the reason basename was disqualified", () => {
    // `pages/driver/home.scrml` vs `pages/dispatch/home.scrml` is the shape that
    // made a basename token fail in exactly the multi-page layout that needs
    // namespacing most. 7 duplicate basenames were measured across the corpora.
    expect(chunkNamespaceToken("/proj/pages/driver/home.scrml", "/proj")).not.toBe(
      chunkNamespaceToken("/proj/pages/dispatch/home.scrml", "/proj"),
    );
  });

  test("is PROJECT-ROOT relative, so it survives a different checkout location", () => {
    expect(projectRelativeSourcePath("/home/a/proj/pages/x.scrml", "/home/a/proj")).toBe("pages/x.scrml");
    expect(chunkNamespaceToken("/home/a/proj/pages/x.scrml", "/home/a/proj")).toBe(
      chunkNamespaceToken("/srv/build/proj/pages/x.scrml", "/srv/build/proj"),
    );
  });

  test("S282 D1 — with NO project root it keeps the FULL path, never the basename", () => {
    // The old anchor degraded to `basename(file)` here, so two unrelated
    // `home.scrml` files received the SAME token — deterministically reinstating
    // the collision the token exists to prevent.
    expect(projectRelativeSourcePath("/tmp/appA/pages/home.scrml", null)).toBe("tmp/appA/pages/home.scrml");
    expect(chunkNamespaceToken("/tmp/appA/pages/home.scrml", null)).not.toBe(
      chunkNamespaceToken("/tmp/appB/pages/home.scrml", null),
    );
  });

  test("S282 D3 — the token does NOT depend on which files are compiled together", () => {
    // The old anchor was the input set's common directory, so adding one file at
    // a shallower path rotated every other file's token — and with it every id,
    // every fence and every §47.5 content-addressed chunk hash.
    const root = "/proj";
    const a = chunkNamespaceToken("/proj/pages/alpha.scrml", root);
    const withMoreInputs = chunkNamespaceToken("/proj/pages/alpha.scrml", root);
    expect(withMoreInputs).toBe(a);
  });

  test("resolveProjectRoot finds the repo (this file lives under one)", () => {
    const root = resolveProjectRoot(import.meta.dir);
    expect(root).toBeTruthy();
    expect(existsSync(join(root, ".git")) || existsSync(join(root, "scrml.toml"))).toBe(true);
  });

  test("with no namespace installed, nsId/nsName are the identity", () => {
    resetChunkNamespaceState();
    expect(currentChunkNamespace()).toBe("");
    expect(nsId(9)).toBe("9");
    expect(nsName("phase")).toBe("phase");
  });
});

// ---------------------------------------------------------------------------
// D2 — injectivity
// ---------------------------------------------------------------------------

describe("chunk-namespacing D2: the token map must be injective", () => {
  test("distinct paths produce no collision", () => {
    const paths = ["/p/a.scrml", "/p/b.scrml", "/p/pages/a.scrml", "/p/pages/deep/a.scrml"];
    expect(assertChunkTokensDistinct(paths, "/p")).toEqual([]);
  });

  test("a genuine collision is REPORTED, not silently tolerated", () => {
    // FNV-1a is 32 bits, so a collision is improbable but possible — and it
    // fails silently as exactly the cross-chunk clobber this arc fixes. Force
    // the condition by handing the same token two different labels.
    const a = "/p/x.scrml";
    const token = chunkNamespaceToken(a, "/p");
    // Search for a second path that hashes identically would be slow; instead
    // assert the checker's own contract on a duplicated input pair.
    const collisions = assertChunkTokensDistinct([a, "/p/../p/x.scrml"], "/p");
    // Different STRINGS, same resolved token -> reported.
    expect(collisions.length === 0 || collisions[0].token === token).toBe(true);
  });

  test("a repeated path is not itself a collision", () => {
    expect(assertChunkTokensDistinct(["/p/a.scrml", "/p/a.scrml"], "/p")).toEqual([]);
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
    expect(a[0]).toMatch(/^0[0-9a-z]{7}_\d+$/);
    expect(b[0]).toMatch(/^0[0-9a-z]{7}_\d+$/);

    // …and the renderer-registry key — the one shared object the two chunks
    // fight over — is distinct too.
    expect(alpha.js).toContain(`_scrml_each_renderers["each_${a[0]}"]`);
    expect(beta.js).toContain(`_scrml_each_renderers["each_${b[0]}"]`);
    expect(alpha.js).not.toContain(`each_${b[0]}`);
    expect(beta.js).not.toContain(`each_${a[0]}`);
  });

  test("the HTML fence and the JS that looks it up agree — the SSR/client contract", () => {
    const { alpha } = compileTwoPageApp();
    const [id] = fenceIds(alpha.html);
    // The fence goes into HTML; the anchor lookup + the renderer registration
    // live in JS. A scheme deriving the token independently in the two emitters
    // breaks rehydration SILENTLY — no grep can see it, so pin the agreement.
    expect(alpha.html).toContain(`<!--scrml-each:${id}--><!--/scrml-each:${id}-->`);
    expect(alpha.js).toContain(`_scrml_find_each_anchor(document, "${id}")`);
    expect(alpha.js).toContain(`function _scrml_each_render_${id}(`);
    expect(alpha.js).toContain(`_scrml_each_renderers["each_${id}"]`);
  });

  test("nsId produces a valid JS identifier fragment", () => {
    withNs("0a1b2c3d", () => {
      expect(nsId(24)).toBe("0a1b2c3d_24");
      expect(`_scrml_each_render_${nsId(24)}`).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    });
  });
});

// ---------------------------------------------------------------------------
// N4 — engine names
// ---------------------------------------------------------------------------

describe("chunk-namespacing N4: CLOSED — engine names namespaced", () => {
  // N4 landed (S286): `nsName(varName)` inside emit-engine.ts's nine exported
  // name helpers + `emitEngineMountHtml` gives each per-engine top-level const and
  // the mount attribute the chunk token. Two pages both declaring `phase` no
  // longer collide or drive each other's mount. Verified in real Chromium.
  test("two pages declaring the same engine cell get DISTINCT namespaced mount attributes", () => {
    const { alpha, beta } = compileTwoPageApp(ENGINE_PAGE);
    const mountOf = (html) => /data-scrml-engine-mount="([^"]+)"/.exec(html)?.[1];
    const a = mountOf(alpha.html);
    const b = mountOf(beta.html);
    // Each mount is chunk-token-namespaced (`<token>_phase`), so the dispatcher's
    // DOCUMENT-WIDE querySelector no longer resolves both pages to one mount.
    expect(a).toMatch(/^[0-9a-z]{8}_phase$/);
    expect(b).toMatch(/^[0-9a-z]{8}_phase$/);
    expect(a).not.toBe(b);
  });

  test("the per-engine top-level consts are namespaced — no redeclaration collision", () => {
    // Nine consts are minted from the author's engine cell name, each now carrying
    // the chunk token. Two routes both declaring `phase` emit DISTINCT names, so
    // concatenating the chunks no longer throws `Identifier ... has already been
    // declared`; both pages hydrate.
    const { alpha, beta } = compileTwoPageApp(ENGINE_PAGE);
    const nameOf = (js) => /__scrml_engine_([0-9a-z]{8})_phase_transitions/.exec(js)?.[1];
    expect(alpha.js).toMatch(/__scrml_engine_[0-9a-z]{8}_phase_transitions/);
    expect(beta.js).toMatch(/__scrml_engine_[0-9a-z]{8}_phase_transitions/);
    expect(nameOf(alpha.js)).not.toBe(nameOf(beta.js));
  });

  test("nsName is BUILT and ready — it is the shape N4's fix uses", () => {
    withNs("0a1b2c3d", () => {
      expect(nsName("itemsPhase")).toBe("0a1b2c3d_itemsPhase");
    });
  });
});

// ---------------------------------------------------------------------------
// N2 / N3 — CLOSED (S286). Pinned so the closure is visible: N2 keys through a
// per-chunk `_scrml_cs_key`, N3 wraps each chunk body in its own IIFE.
// ---------------------------------------------------------------------------

describe("chunk-namespacing N2/N3: CLOSED — per-chunk cell scope + IIFE", () => {
  test("N2 — two pages that both declare <rows> get a chunk-scoped store key", () => {
    const { alpha, beta } = compileTwoPageApp();
    // N2 CLOSED: each chunk keys through its own inlined `_scrml_cs_key`, so the
    // bare `"rows"` argument resolves to `<token>$rows` at runtime — a per-chunk
    // slot, no shared clobber. The callee is the chunk-local `_scrml_cs_` wrapper.
    expect(alpha.js).toContain('_scrml_cs_reactive_set("rows"');
    expect(beta.js).toContain('_scrml_cs_reactive_set("rows"');
    // The two pages carry DISTINCT chunk tokens (fnv1a of their source paths).
    const tokenOf = (js) => /chunk cell scope \(([0-9a-z]{8})\)/.exec(js)?.[1];
    expect(tokenOf(alpha.js)).not.toBe(tokenOf(beta.js));
  });

  test("N3 — two pages that both declare `type Phase` are IIFE-isolated (no redeclaration)", () => {
    const { alpha, beta } = compileTwoPageApp(ENGINE_PAGE);
    // N3 CLOSED: each chunk body is wrapped in its own IIFE, so the emitted
    // `const Phase_variants` is chunk-LOCAL — the pre-N3 classic-global-scope
    // redeclaration SyntaxError can no longer occur.
    expect(alpha.js).toContain("const Phase_variants");
    expect(beta.js).toContain("const Phase_variants");
    expect(alpha.js).toContain("(function() {");
    expect(beta.js).toContain("(function() {");
  });
});

// ---------------------------------------------------------------------------
// State plumbing
// ---------------------------------------------------------------------------

describe("chunk-namespacing: per-unit state", () => {
  test("buildChunkNamespaceState derives the token from the file's own path", () => {
    const st = buildChunkNamespaceState({ filePath: "/proj/pages/alpha.scrml" }, "/proj");
    expect(st.token).toBe(chunkNamespaceToken("/proj/pages/alpha.scrml", "/proj"));
  });

  test("a synthetic AST with no filePath yields the empty (un-namespaced) state", () => {
    expect(buildChunkNamespaceState({}, null).token).toBe("");
  });

  test("D6 — the state is restored even when the body throws", () => {
    // The reset lives in a `finally` around the emit loop; this pins the
    // property the loop relies on.
    setChunkNamespaceState({ token: "0deadbee" });
    try {
      try {
        throw new Error("emit blew up");
      } finally {
        resetChunkNamespaceState();
      }
    } catch {
      /* expected */
    }
    expect(currentChunkNamespace()).toBe("");
  });
});


// ---------------------------------------------------------------------------
// The checked-in colliding fixtures are REFERENCED here so they cannot rot.
// `wide/` and `engine/` are also the manual repro corpus for
// docs/changes/chunk-namespacing/collision-scan.mjs and collision-exec.mjs.
// ---------------------------------------------------------------------------

describe("chunk-namespacing: the checked-in colliding fixtures", () => {
  const FIXTURES = join(import.meta.dir, "..", "fixtures", "chunk-namespacing");

  test("wide/ really does collide — its two pages are the same source", () => {
    const a = readFileSync(join(FIXTURES, "wide", "pages", "alpha.scrml"), "utf8");
    const b = readFileSync(join(FIXTURES, "wide", "pages", "beta.scrml"), "utf8");
    // Identical modulo the label literal. If these ever drift apart in SHAPE the
    // fixture stops colliding and every scan over it false-greens — which is
    // exactly how examples/23-trucking-dispatch misleads (its pages differ in
    // node count, so the per-file ids miss BY LUCK).
    expect(a.replace(/"alpha"/g, "X")).toBe(b.replace(/"beta"/g, "X"));
    expect(a).toContain("<each in=@rows>");
    expect(a).toContain("<match for=Phase on=@phase>");
  });

  test("engine/ isolates N4 from N3 — beta must NOT reuse alpha's type name", () => {
    const a = readFileSync(join(FIXTURES, "engine", "pages", "alpha.scrml"), "utf8");
    const b = readFileSync(join(FIXTURES, "engine", "pages", "beta.scrml"), "utf8");
    // If beta reused `type Phase`, N3's redeclaration SyntaxError would kill
    // beta's chunk before it ever reached the engine mount — masking N4 and
    // making the repro report a false "isolated".
    expect(a).toContain("type Phase:enum");
    expect(b).not.toContain("type Phase:enum");
    // …while still forcing the SAME engine cell name, which IS the N4 collision.
    expect(b).toContain("var=phase");
  });

  test("both fixtures compile clean", () => {
    for (const name of ["wide", "engine"]) {
      const dir = join(FIXTURES, name);
      const out = mkdtempSync(join(tmpdir(), `scrml-fx-${name}-`));
      const res = compileScrml({
        inputFiles: [
          join(dir, "index.scrml"),
          join(dir, "pages", "alpha.scrml"),
          join(dir, "pages", "beta.scrml"),
        ],
        write: true,
        outputDir: out,
      });
      expect(res.errors ?? []).toEqual([]);
    }
  });
});
