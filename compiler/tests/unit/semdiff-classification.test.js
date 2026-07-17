/**
 * #6b P0 — semantic-diff / behavioral-classification (the honest floor).
 *
 * Two layers:
 *   1. Pure-function unit tests over the classifier helpers (fingerprint / match /
 *      foreign-scan / diagnostic-diff / JS canonicalization / classify).
 *   2. Fixture-driven end-to-end tests over the two consumer walls + the Tier-0
 *      floor + the conservative floor — compiled through the REAL pipeline via the
 *      command's exported `compileVersion`, then classified.
 *
 * DD: scrml-support/docs/deep-dives/6b-semantic-diff-primitive-design-2026-07-17.md
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  fingerprintEntity,
  matchEntities,
  detectForeignRegions,
  diffDiagnostics,
  canonicalizeJs,
  canonicalizeSourceBasename,
  diffUnmodeledAxisAttrs,
  collectEmitArtifacts,
  classifySemdiff,
} from "../../src/semdiff.ts";
import { compileVersion } from "../../src/commands/semdiff.js";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "semdiff");

/** Compile a fixture pair through the real pipeline and classify. */
function classifyFixture(dir, baseFile, headFile) {
  const base = compileVersion(resolve(FIX, dir, baseFile), `${dir}/${baseFile}`);
  const head = compileVersion(resolve(FIX, dir, headFile), `${dir}/${headFile}`);
  return classifySemdiff(base, head);
}

function entityByName(cl, name) {
  return cl.entities.find((e) => e.entity === name);
}
function axisNames(entity) {
  return (entity.axes || []).map((a) => a.axis);
}

// ===========================================================================
// Layer 1 — pure helpers
// ===========================================================================

describe("detectForeignRegions (Signal 2 — foreign `_={ }=` scan)", () => {
  test("a real foreign opener → foreign-block", () => {
    expect(detectForeignRegions("const x = _={ in:{} 1 }=")).toEqual(["foreign-block"]);
    expect(detectForeignRegions("const x = _{ 1 }")).toEqual(["foreign-block"]); // level-0 opener
  });
  test("a spaced assignment `_ = {` is NOT a foreign opener", () => {
    expect(detectForeignRegions("let _ = { a: 1 }")).toEqual([]);
  });
  test("a mid-identifier underscore (`my_`) is NOT an opener", () => {
    expect(detectForeignRegions("const my_={a:1}")).toEqual([]);
  });
  test("an opener inside a string / comment is masked out", () => {
    expect(detectForeignRegions('const s = "_={ not real }="')).toEqual([]);
    expect(detectForeignRegions("// _={ also not real }=")).toEqual([]);
  });
});

describe("fingerprintEntity (Fork B/D shallow — SOURCE fingerprint)", () => {
  test("a pure entity-NAME rename is fingerprint-STABLE", () => {
    const a = fingerprintEntity("fn foo(x) { return x + 1 }", "foo");
    const b = fingerprintEntity("fn bar(x) { return x + 1 }", "bar");
    expect(a).toBe(b);
  });
  test("indentation + comment-only edits do NOT perturb the fingerprint", () => {
    // The fingerprint collapses whitespace RUNS + strips comments (it is a match
    // heuristic, not a full tokenizer — operator spacing is kept, which is fine:
    // a reformatted same-name entity still NAME-matches).
    const a = fingerprintEntity("fn foo(x) { return x + 1 }", "foo");
    const b = fingerprintEntity("fn foo(x) {\n  // add one\n    return x + 1\n}", "foo");
    expect(a).toBe(b);
  });
  test("a real body change DOES perturb the fingerprint", () => {
    const a = fingerprintEntity("fn foo(x) { return x + 1 }", "foo");
    const b = fingerprintEntity("fn foo(x) { return x + 2 }", "foo");
    expect(a).not.toBe(b);
  });
  test("a string-literal change perturbs the fingerprint (strings are kept)", () => {
    const a = fingerprintEntity('fn foo() { return "email" }', "foo");
    const b = fingerprintEntity('fn foo() { return "ssn" }', "foo");
    expect(a).not.toBe(b);
  });
});

describe("matchEntities (Fork B — fingerprint-first, then name)", () => {
  const mk = (name, kind, fp) => ({
    id: `f::${name}`, kind, name, span: { start: 0, end: 1 }, bodySpan: { start: 0, end: 1 },
    bodyText: "", fingerprint: fp, opaque: false, opaqueReasons: [],
  });

  test("a renamed-but-body-identical entity matches by fingerprint (NOT add+remove)", () => {
    const base = [mk("foo", "function", "aaaa")];
    const head = [mk("bar", "function", "aaaa")];
    const r = matchEntities(base, head);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].matchedBy).toBe("fingerprint");
    expect(r.addedHead).toHaveLength(0);
    expect(r.removedBase).toHaveLength(0);
  });
  test("a same-name body-changed entity matches by name", () => {
    const base = [mk("Ref", "type", "aaaa")];
    const head = [mk("Ref", "type", "bbbb")];
    const r = matchEntities(base, head);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].matchedBy).toBe("name");
    expect(r.addedHead).toHaveLength(0);
  });
  test("a genuinely-new / removed entity lands in added / removed", () => {
    const base = [mk("gone", "function", "aaaa")];
    const head = [mk("fresh", "function", "bbbb")];
    const r = matchEntities(base, head);
    expect(r.matched).toHaveLength(0);
    expect(r.addedHead.map((e) => e.name)).toEqual(["fresh"]);
    expect(r.removedBase.map((e) => e.name)).toEqual(["gone"]);
  });
});

describe("diffDiagnostics (Signal 3 — set diff by code+message)", () => {
  const d = (code, message) => ({ code, message });
  test("a new-on-head diagnostic is `added`", () => {
    const base = [d("W-A", "a")];
    const head = [d("W-A", "a"), d("E-TYPE-063", "broke")];
    const r = diffDiagnostics(base, head);
    expect(r.added.map((x) => x.code)).toEqual(["E-TYPE-063"]);
    expect(r.removed).toHaveLength(0);
  });
  test("a same code+message on both sides is NOT added (tolerant of offset shift)", () => {
    const base = [{ code: "E-DG-002", message: "unused @ref", span: { start: 40, end: 44 } }];
    const head = [{ code: "E-DG-002", message: "unused @ref", span: { start: 46, end: 50 } }];
    const r = diffDiagnostics(base, head);
    expect(r.added).toHaveLength(0);
    expect(r.removed).toHaveLength(0);
  });
});

describe("canonicalizeJs (Signal 1 — whitespace/comment/ASI-safe emit identity)", () => {
  const NO = new Map();
  test("whitespace + comment differences canonicalize equal", () => {
    const a = canonicalizeJs("function f(x){return x+1}", NO);
    const b = canonicalizeJs("function f(x) {\n  // c\n  return x + 1\n}", NO);
    expect(a).toBe(b);
  });
  test("a rename map folds a top-level entity rename to equality", () => {
    const a = canonicalizeJs("function helper(x){return x+1}\nhelper(2)", new Map([["helper", "M0"]]));
    const b = canonicalizeJs("function incr(x){return x+1}\nincr(2)", new Map([["incr", "M0"]]));
    expect(a).toBe(b);
  });
  test("a property access is NOT renamed (sound — applying {log→M0} leaves `obj.log` untouched)", () => {
    const withRename = canonicalizeJs("obj.log(x)", new Map([["log", "M0"]]));
    const noRename = canonicalizeJs("obj.log(x)", NO);
    expect(withRename).toBe(noRename); // the rename map does not touch the property `.log`
  });
  test("a string literal is NOT renamed (sound)", () => {
    const a = canonicalizeJs('f("email")', NO);
    const b = canonicalizeJs('f("ssn")', NO);
    expect(a).not.toBe(b);
  });
  test("a real behavioral change (`.log`→`.error`) does NOT canonicalize equal", () => {
    const a = canonicalizeJs("console.log(x)", NO);
    const b = canonicalizeJs("console.error(x)", NO);
    expect(a).not.toBe(b);
  });

  // D1 — an EXPORTED declaration id is NEVER folded by the rename map (Fork D):
  // `export function getUser` vs `export function fetchUser` must stay DIFFERENT
  // even when the map would map both to a canonical name. (Pre-fix the map folded
  // them — the isFixedNameChild `ExportSpecifier` guard was dead code for scrml's
  // real `export function NAME` emit.)
  test("an exported declaration NAME is NOT folded by the rename map (D1)", () => {
    const map = new Map([["getUser", "M0"], ["fetchUser", "M0"]]);
    const a = canonicalizeJs("export function getUser(id){return id+1}", map);
    const b = canonicalizeJs("export function fetchUser(id){return id+1}", map);
    expect(a).not.toBe(b);
  });
  test("a NON-exported declaration rename still folds to equality (D1 no regression)", () => {
    const a = canonicalizeJs("function getUser(id){return id+1}", new Map([["getUser", "M0"]]));
    const b = canonicalizeJs("function fetchUser(id){return id+1}", new Map([["fetchUser", "M0"]]));
    expect(a).toBe(b);
  });
  test("an exported name is fixed at REFERENCE sites too, not just the decl (D1)", () => {
    const map = new Map([["getUser", "M0"], ["fetchUser", "M0"]]);
    const a = canonicalizeJs("export function getUser(){} getUser()", map);
    const b = canonicalizeJs("export function fetchUser(){} fetchUser()", map);
    expect(a).not.toBe(b);
  });
});

describe("canonicalizeSourceBasename (D2 — neutralize the source-stem in emit)", () => {
  test("filename-derived shapes are neutralized to a placeholder", () => {
    const a = canonicalizeSourceBasename(
      '<title>alpha</title><script src="alpha.client.js"></script>',
      "alpha",
    );
    const b = canonicalizeSourceBasename(
      '<title>beta</title><script src="beta.client.js"></script>',
      "beta",
    );
    expect(a).toBe(b);
  });
  test("the SSR html loader + route path are neutralized", () => {
    const a = canonicalizeSourceBasename('new URL("./alpha.html", import.meta.url); path: "/alpha"', "alpha");
    const b = canonicalizeSourceBasename('new URL("./beta.html", import.meta.url); path: "/beta"', "beta");
    expect(a).toBe(b);
  });
  test("a user CONTENT literal equal to the basename is NOT neutralized (surgical)", () => {
    // `reveal("alpha")` is a behavioral value — it must survive, so a genuine
    // change to it still reads behavioral even when it coincides with a rename.
    const a = canonicalizeSourceBasename('reveal("alpha")', "alpha");
    const b = canonicalizeSourceBasename('reveal("beta")', "beta");
    expect(a).not.toBe(b);
    expect(a).toContain('reveal("alpha")');
  });
  test("N1 — a BARE `<stem>.<ext>` content literal is NOT neutralized (only anchored sites)", () => {
    // `return "alpha.js"` carries no filename-derived CONTEXT (no src=/href=, no
    // `./`, no sourceMappingURL=), so it must survive — else a genuine content
    // change that happens to match the filename reads a false-cosmetic.
    for (const ext of ["js", "html", "css", "map", "client.js"]) {
      const a = canonicalizeSourceBasename(`return "alpha.${ext}"`, "alpha");
      const b = canonicalizeSourceBasename(`return "beta.${ext}"`, "beta");
      expect(a).not.toBe(b);
      expect(a).toContain(`"alpha.${ext}"`);
    }
  });
  test("N1 — an ANCHORED filename reference IS still neutralized (no D2 regression)", () => {
    // `src="stem.client.js"` and `"./stem.html"` (the SSR loader) are genuine
    // filename-derived sites — they MUST fold so a byte-identical app still reads
    // cosmetic under a rename.
    expect(canonicalizeSourceBasename('<script src="alpha.client.js">', "alpha"))
      .toBe(canonicalizeSourceBasename('<script src="beta.client.js">', "beta"));
    expect(canonicalizeSourceBasename('new URL("./alpha.html", import.meta.url)', "alpha"))
      .toBe(canonicalizeSourceBasename('new URL("./beta.html", import.meta.url)', "beta"));
  });
});

describe("diffUnmodeledAxisAttrs (D3 — the confidentiality honest-floor signal)", () => {
  const p = (v) => [{ attr: "protect", value: v }];
  test("a narrowed `protect=` list yields an I-SEMDIFF-UNMODELED-AXIS signal", () => {
    const sig = diffUnmodeledAxisAttrs(p("email, password_hash"), p("password_hash"));
    expect(sig).toHaveLength(1);
    expect(sig[0].code).toBe("I-SEMDIFF-UNMODELED-AXIS");
    expect(sig[0].severity).toBe("info");
  });
  test("an unchanged `protect=` list (order/spacing only) yields NO signal", () => {
    const sig = diffUnmodeledAxisAttrs(p("email, password_hash"), p("password_hash,email"));
    expect(sig).toHaveLength(0);
  });
  test("no `protect=` on either side yields NO signal", () => {
    expect(diffUnmodeledAxisAttrs([], [])).toHaveLength(0);
    expect(diffUnmodeledAxisAttrs(undefined, undefined)).toHaveLength(0);
  });
});

describe("classifySemdiff (synthetic — constraint §0(2))", () => {
  const ent = (name, fp, opaque) => ({
    id: `f::${name}`, kind: "function", name, span: { start: 0, end: 10 },
    bodySpan: { start: 0, end: 10 }, bodyText: "", fingerprint: fp,
    opaque, opaqueReasons: opaque ? ["foreign-block"] : [],
  });
  const ver = (label, entities, artifacts, failed = false) => ({
    label, entities, diagnostics: [], emitArtifacts: artifacts, failedToCompile: failed,
  });

  test("an opaque entity is forced Tier-2 even when the emit is byte-IDENTICAL", () => {
    const art = [{ kind: "libraryJs", content: "export function f(){}" }];
    const base = ver("base", [ent("f", "aaaa", true)], art);
    const head = ver("head", [ent("f", "aaaa", true)], art);
    const cl = classifySemdiff(base, head);
    const e = entityByName(cl, "f");
    expect(e.tier).toBe("2");
    expect(e.opaque).toBe(true);
    expect(axisNames(e)).toContain("opaque");
  });

  test("a non-opaque unchanged entity with identical emit → Tier-0", () => {
    const art = [{ kind: "libraryJs", content: "export function f(){}" }];
    const base = ver("base", [ent("f", "aaaa", false)], art);
    const head = ver("head", [ent("f", "aaaa", false)], art);
    const cl = classifySemdiff(base, head);
    expect(entityByName(cl, "f").tier).toBe("0");
  });

  test("either version failing to compile → exit 2 (fail-closed)", () => {
    const art = [{ kind: "libraryJs", content: "export function f(){}" }];
    const base = ver("base", [ent("f", "aaaa", false)], art);
    const head = ver("head", [ent("f", "aaaa", false)], art, /*failed*/ true);
    expect(classifySemdiff(base, head).exitCode).toBe(2);
  });

  // D4 — the synthesized top-level verdict + the 0/1/2 exit convention.
  test("a pure no-op → verdict cosmetic + exit 0", () => {
    const art = [{ kind: "libraryJs", content: "export function f(){}" }];
    const cl = classifySemdiff(
      ver("base", [ent("f", "aaaa", false)], art),
      ver("head", [ent("f", "aaaa", false)], art),
    );
    expect(cl.verdict).toBe("cosmetic");
    expect(cl.exitCode).toBe(0);
  });

  test("a behavioral (opaque) entity → verdict behavioral + exit 1", () => {
    const art = [{ kind: "libraryJs", content: "export function f(){}" }];
    const cl = classifySemdiff(
      ver("base", [ent("f", "aaaa", true)], art),
      ver("head", [ent("f", "aaaa", true)], art),
    );
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
  });

  test("a route/entity ADD (all matched entities Tier-0, but unmatched.added) → behavioral + exit 1", () => {
    // The exact D4 trap: a naive `entities.every(Tier-0)` misreads an ADD as
    // cosmetic — it lands ONLY in unmatched.added. The verdict ANDs the whole
    // picture, so the consumer keying on `verdict` cannot be fooled.
    const art = [{ kind: "libraryJs", content: "export function f(){}" }];
    const cl = classifySemdiff(
      ver("base", [ent("f", "aaaa", false)], art),
      ver("head", [ent("f", "aaaa", false), ent("g", "bbbb", false)], art),
    );
    // The one matched entity IS Tier-0 …
    expect(entityByName(cl, "f").tier).toBe("0");
    // … but the add makes the whole change behavioral.
    expect(cl.unmatched.added).toEqual(["g"]);
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
  });

  // N2 (S239 re-review) — the whole-output emit-identity is the FLOOR of the
  // verdict. ZERO matched entities + a differing compiled output (a pure-markup
  // edit) must NOT read cosmetic — else a visible change ships as "safe".
  test("N2 — zero matched entities + differing output → behavioral + exit 1 + breadcrumb", () => {
    const cl = classifySemdiff(
      ver("base", [], [{ kind: "html", content: "<p>hello</p>" }]),
      ver("head", [], [{ kind: "html", content: "<p>goodbye</p>" }]),
    );
    expect(cl.entities).toHaveLength(0);
    expect(cl.unmatched.added).toHaveLength(0);
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
    expect(cl.signals.map((s) => s.code)).toContain("I-SEMDIFF-EMIT-CHANGED");
  });
  test("N2 — zero entities + IDENTICAL output → cosmetic (no false breadcrumb)", () => {
    const cl = classifySemdiff(
      ver("base", [], [{ kind: "html", content: "<p>hello</p>" }]),
      ver("head", [], [{ kind: "html", content: "<p>hello</p>" }]),
    );
    expect(cl.verdict).toBe("cosmetic");
    expect(cl.exitCode).toBe(0);
    expect(cl.signals).toHaveLength(0);
  });
});

// ===========================================================================
// Layer 2 — the two consumer walls + the Tier-0 floor + the conservative floor
// ===========================================================================

describe("Tier-0 floor — reformat / comment / bound-name alpha-rename → Tier-0", () => {
  test("a pure reformat → every matched entity Tier-0, exit 0", () => {
    const cl = classifyFixture("tier0", "base.scrml", "reformat.scrml");
    expect(cl.exitCode).toBe(0);
    expect(cl.entities.length).toBeGreaterThan(0);
    for (const e of cl.entities) expect(e.tier).toBe("0");
  });

  test("a comment-only edit → every matched entity Tier-0, exit 0", () => {
    const cl = classifyFixture("tier0", "base.scrml", "comment.scrml");
    expect(cl.exitCode).toBe(0);
    for (const e of cl.entities) expect(e.tier).toBe("0");
  });

  test("a bound-name alpha-rename → Tier-0, and the rename resolves via fingerprint", () => {
    const cl = classifyFixture("tier0", "base.scrml", "rename.scrml");
    expect(cl.exitCode).toBe(0);
    // No entity read as add/remove — the rename was resolved, not add+remove.
    expect(cl.unmatched.added).toHaveLength(0);
    expect(cl.unmatched.removed).toHaveLength(0);
    for (const e of cl.entities) expect(e.tier).toBe("0");
    const incr = entityByName(cl, "incr");
    expect(incr).toBeTruthy();
    expect(incr.matchedBy).toBe("fingerprint");
  });
});

describe("flogence wall (opaque) — change INSIDE a foreign `_={ }=` block", () => {
  test("the change at constant footprint classifies Tier-2 opaque, NOT cosmetic", () => {
    const cl = classifyFixture("flogence-opaque", "base.scrml", "head.scrml");
    const disp = entityByName(cl, "dispatchOne");
    expect(disp).toBeTruthy();
    expect(disp.tier).toBe("2");
    expect(disp.opaque).toBe(true);
    expect(axisNames(disp)).toContain("opaque");
    expect(disp.axes.find((a) => a.axis === "opaque").detail.reasons).toContain("foreign-block");
    // The whole diff never reads Tier-0 (the B1 false-negative is closed).
    expect(cl.entities.every((e) => e.tier !== "0")).toBe(true);
  });
});

describe("giti wall (rename↔use) — enum variant rename with a dangling `.Sha` use", () => {
  test("the enum matches (not add+remove), the use-break surfaces, exit 2", () => {
    const cl = classifyFixture("giti-rename-use", "base.scrml", "head.scrml");
    // Fail-closed — head fails to compile (E-TYPE-063 is fatal).
    expect(cl.exitCode).toBe(2);
    // The rename is RESOLVED — the enum `Ref` is matched, not add+remove.
    expect(cl.unmatched.added).toHaveLength(0);
    expect(cl.unmatched.removed).toHaveLength(0);
    const ref = entityByName(cl, "Ref");
    expect(ref).toBeTruthy();
    expect(ref.kind).toBe("type");
    expect(ref.tier).toBe("2");
    // The use-break (E-TYPE-063) is attributed to the enum entity.
    expect(axisNames(ref)).toContain("use-site");
    const useAxis = ref.axes.find((a) => a.axis === "use-site");
    expect(useAxis.detail.codes).toContain("E-TYPE-063");
    // …and surfaced at the top level for a consumer that keys on the raw signal.
    expect(cl.diagnostics.added.map((d) => d.code)).toContain("E-TYPE-063");
  });
});

describe("conservative floor — NO path lets an opaque change read as Tier-0/1", () => {
  test("an entity with an UNCHANGED foreign block (byte-identical emit) is STILL Tier-2 opaque", () => {
    const cl = classifyFixture("opaque-unchanged", "base.scrml", "head.scrml");
    const disp = entityByName(cl, "dispatchOne");
    expect(disp).toBeTruthy();
    // Nothing changed, emit is byte-identical — but §0(2) forbids Tier-0/1 for an
    // unmodeled region. It must be Tier-2 opaque, never Tier-0.
    expect(disp.tier).toBe("2");
    expect(disp.opaque).toBe(true);
    expect(disp.tier).not.toBe("0");
    expect(disp.tier).not.toBe("1");
  });
});

// ===========================================================================
// S239 held-branch defects — D1-D4 regression fixtures (fail pre-fix / pass post)
// ===========================================================================

describe("D1 — an EXPORTED rename is BEHAVIORAL, never a false-cosmetic Tier-0", () => {
  test("`export fn getUser`→`fetchUser` (identical body) → Tier-2, verdict behavioral, exit 1", () => {
    const cl = classifyFixture("export-rename", "base.scrml", "head.scrml");
    // The rename is RESOLVED (matched by fingerprint, not add+remove) — but the
    // EXPORT makes it behavioral (breaks any cross-file `import { getUser }`).
    expect(cl.unmatched.added).toHaveLength(0);
    expect(cl.unmatched.removed).toHaveLength(0);
    const fetchUser = entityByName(cl, "fetchUser");
    expect(fetchUser).toBeTruthy();
    expect(fetchUser.matchedBy).toBe("fingerprint");
    expect(fetchUser.tier).toBe("2"); // NOT "0" — the pre-fix false-cosmetic
    const src = fetchUser.axes.find((a) => a.axis === "source");
    expect(src).toBeTruthy();
    expect(src.detail.reason).toBe("exported-name-changed");
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
  });
});

describe("D2 — a source-basename difference does NOT bake into the verdict", () => {
  test("byte-identical app, different basenames (alpha vs beta) → Tier-0 cosmetic, exit 0", () => {
    const cl = classifyFixture("basename", "alpha.scrml", "beta.scrml");
    expect(cl.entities.length).toBeGreaterThan(0);
    for (const e of cl.entities) expect(e.tier).toBe("0");
    expect(cl.verdict).toBe("cosmetic");
    expect(cl.exitCode).toBe(0);
  });

  // N1 (S239 re-review) — the D2 basename fix must NOT over-neutralize a genuine
  // content literal that coincides with the filename stem. `return "alpha.js"`
  // (alpha.scrml) vs `return "beta.js"` (beta.scrml) is a REAL output difference
  // and must read BEHAVIORAL, not cosmetic.
  test("N1 — a content literal `\"<stem>.js\"` that changes with the file → BEHAVIORAL, exit 1", () => {
    const cl = classifyFixture("basename-collision", "alpha.scrml", "beta.scrml");
    const asset = entityByName(cl, "assetUrl");
    expect(asset).toBeTruthy();
    expect(asset.tier).toBe("2"); // NOT "0" — the emit genuinely differs
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
  });
  test("N1 (.html variant) — `\"<stem>.html\"` content change → BEHAVIORAL, exit 1", () => {
    const cl = classifyFixture("basename-collision-html", "alpha.scrml", "beta.scrml");
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
  });
});

describe("D3 — an unmodeled-axis (`protect=`) change is never a SILENT Tier-0", () => {
  test("`protect=` narrowing with no local SELECT → carries the unmodeled-axis signal", () => {
    const cl = classifyFixture("protect-narrow", "base.scrml", "head.scrml");
    // The signal breadcrumb is present (the whole point — not a bare silent Tier-0).
    const sig = cl.signals.find((s) => s.code === "I-SEMDIFF-UNMODELED-AXIS");
    expect(sig).toBeTruthy();
    expect(sig.message).toContain("protect");
    // §0(2) — unmodeled = never SILENTLY cosmetic; the verdict is behavioral even
    // though the per-entity emit is byte-identical (the honest floor).
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
  });
});

describe("D4 — the consumer contract (verdict + exit) distinguishes cosmetic vs behavioral", () => {
  test("a route/entity ADD → verdict behavioral + exit 1 (lands only in unmatched.added)", () => {
    const cl = classifyFixture("entity-add", "base.scrml", "head.scrml");
    expect(cl.unmatched.added).toContain("added");
    // Every MATCHED entity is Tier-0 (here: none matched) — a naive check misreads
    // this as cosmetic; the synthesized verdict does not.
    for (const e of cl.entities) expect(e.tier).toBe("0");
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
  });

  test("the export-rename (behavioral, both compile) exits 1 — distinct from a compile-fail exit 2", () => {
    const cl = classifyFixture("export-rename", "base.scrml", "head.scrml");
    expect(cl.exitCode).toBe(1);
    expect(cl.verdict).toBe("behavioral");
  });

  // N2 (S239 re-review) — a pure-MARKUP change (no named entities) must read
  // behavioral: the html output genuinely differs, so a consumer keying on the
  // verdict cannot auto-approve a visible content change as "safe".
  test("a pure-markup change (`<p>hello</p>`→`<p>goodbye</p>`) → behavioral, exit 1", () => {
    const cl = classifyFixture("markup-change", "base.scrml", "head.scrml");
    expect(cl.entities).toHaveLength(0);
    expect(cl.verdict).toBe("behavioral");
    expect(cl.exitCode).toBe(1);
    expect(cl.signals.map((s) => s.code)).toContain("I-SEMDIFF-EMIT-CHANGED");
  });
});
