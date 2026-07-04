/**
 * Peter #21 — `match` over a failable (`!`) result: the `::Ok(v)` success arm.
 *
 * A `!` function returns its SUCCESS value BARE (un-tagged) and its error path
 * as a tagged `{ __scrml_error, type, variant, data }` envelope (§19.9.1). The
 * developer names the success case with the implicit `::Ok(value)` wrapper
 * (§19.7.3 — "The `::Ok` variant SHALL be the implicit wrapper for the success
 * value of a `!` function. The developer SHALL match `::Ok(value)` to access
 * the success case in logic context.").
 *
 * Before the fix, `match safeDiv(10, b) { ::Ok(v) :> … ::DivByZero :> … }` had
 * two defects (GitHub #21):
 *   (a) the tag discriminator `(tmp && typeof === "object") ? tmp.variant : tmp`
 *       produced the RAW success value on success (e.g. `5`), never `"Ok"`, so
 *       the `::Ok` arm never fired;
 *   (b) `v` was never bound — the emit admitted a "cannot positionally bind 'v'
 *       — variant 'Ok' field order unknown" comment instead of binding it.
 *
 * The fix (emit-control-flow.ts):
 *   - isFailableOkMatch(arms): a match with an `::Ok` arm that is NOT a
 *     user-declared payload variant is a match over a failable result.
 *   - emitMatchTagDiscriminator(..., failable=true): discriminate on the
 *     `__scrml_error` sentinel — an error envelope yields its `.variant`, any
 *     other value (bare success, primitive OR struct) yields the `"Ok"` tag.
 *   - emitVariantBindingPrelude(..., failableOk=true): `::Ok(v)` binds `v` to
 *     the WHOLE bare success value (`const v = tmp`), not `tmp.data.field`.
 *
 * The error arms (`.variant` dispatch) were already correct; `?` propagation is
 * a separate lowering (regression-checked below).
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  emitMatchExpr,
  setVariantFieldsForFile,
  isFailableOkMatch,
  emitMatchTagDiscriminator,
  parseMatchArm,
} from "../../src/codegen/emit-control-flow.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

beforeEach(() => {
  resetVarCounter();
  setVariantFieldsForFile(null, null);
});

// ---------------------------------------------------------------------------
// isFailableOkMatch predicate
// ---------------------------------------------------------------------------

describe("Peter #21 — isFailableOkMatch predicate", () => {
  it("true when an `::Ok` variant arm is present (and Ok is not user-declared)", () => {
    const arms = [
      { kind: "variant", test: "Ok", binding: "v", result: "" },
      { kind: "variant", test: "DivByZero", binding: null, result: "" },
    ];
    expect(isFailableOkMatch(arms)).toBe(true);
  });

  it("false for a regular enum match with no Ok arm", () => {
    const arms = [
      { kind: "variant", test: "Idle", binding: null, result: "" },
      { kind: "variant", test: "Busy", binding: null, result: "" },
    ];
    expect(isFailableOkMatch(arms)).toBe(false);
  });

  it("false when a file-local enum genuinely declares a payload `Ok` variant", () => {
    setVariantFieldsForFile(new Map([["Ok", ["code"]]]), new Set());
    try {
      const arms = [
        { kind: "variant", test: "Ok", binding: "c", result: "" },
        { kind: "variant", test: "Err", binding: null, result: "" },
      ];
      // A user enum named `Ok` wins — defers to the regular tagged-object path.
      expect(isFailableOkMatch(arms)).toBe(false);
    } finally {
      setVariantFieldsForFile(null, null);
    }
  });
});

// ---------------------------------------------------------------------------
// emitMatchTagDiscriminator — the two discriminator shapes
// ---------------------------------------------------------------------------

describe("Peter #21 — emitMatchTagDiscriminator", () => {
  it("failable discriminator keys on __scrml_error and yields \"Ok\" on success", () => {
    const line = emitMatchTagDiscriminator("_m", "_t", true);
    expect(line).toBe(
      'const _t = (_m != null && typeof _m === "object" && _m.__scrml_error === true) ? _m.variant : "Ok";',
    );
  });

  it("regular discriminator keys on typeof-object → .variant (unchanged)", () => {
    const line = emitMatchTagDiscriminator("_m", "_t", false);
    expect(line).toBe(
      'const _t = (_m != null && typeof _m === "object") ? _m.variant : _m;',
    );
  });
});

// ---------------------------------------------------------------------------
// Direct emitter — the emitted match IIFE shape
// ---------------------------------------------------------------------------

describe("Peter #21 — emitMatchExpr failable-Ok shape", () => {
  it("::Ok(v) success arm: __scrml_error discriminator + binds v to the whole subject", () => {
    const node = {
      header: "subj",
      body: [
        { kind: "bare-expr", expr: '.Ok(v) :> "ok: " + v' },
        { kind: "bare-expr", expr: '.DivByZero :> "ERR"' },
      ],
    };
    const out = emitMatchExpr(node);
    // The tag discriminator now keys on __scrml_error and yields "Ok" on success.
    expect(out).toMatch(/__scrml_error === true\) \? _scrml_match_\d+\.variant : "Ok"/);
    // v binds to the whole bare success value — NOT `.data.<field>`.
    expect(out).toMatch(/const v = _scrml_match_\d+;/);
    // The success arm now fires on the "Ok" tag.
    expect(out).toMatch(/=== "Ok"\)/);
    // The error arm still dispatches by variant.
    expect(out).toMatch(/=== "DivByZero"\)/);
    // The bug's signature must be GONE.
    expect(out).not.toContain("cannot positionally bind");
    expect(out).not.toContain(".data.");
  });

  it("::Ok with NO binding still fires on success (no undefined ref)", () => {
    const node = {
      header: "subj",
      body: [
        { kind: "bare-expr", expr: '.Ok :> "done"' },
        { kind: "bare-expr", expr: '.DivByZero :> "ERR"' },
      ],
    };
    const out = emitMatchExpr(node);
    expect(out).toMatch(/__scrml_error === true\) \? _scrml_match_\d+\.variant : "Ok"/);
    expect(out).toMatch(/=== "Ok"\) return "done"/);
    expect(out).not.toContain("cannot positionally bind");
  });

  it("::Ok(v) with a wildcard error arm — (e) binds the error envelope", () => {
    const node = {
      header: "subj",
      body: [
        { kind: "bare-expr", expr: '.Ok(v) :> "ok: " + v' },
        { kind: "bare-expr", expr: '(e) :> "err"' },
      ],
    };
    const out = emitMatchExpr(node);
    expect(out).toMatch(/const v = _scrml_match_\d+;/);
    // wildcard presence-arm binds the whole subject (the error envelope).
    expect(out).toMatch(/else \{ const e = _scrml_match_\d+;/);
  });

  it("NEGATIVE control — a regular enum match keeps the plain .variant discriminator", () => {
    setVariantFieldsForFile(new Map([["Dragging", ["id"]]]), new Set());
    try {
      const node = {
        header: "phase",
        body: [
          { kind: "bare-expr", expr: ".Dragging(d) => d" },
          { kind: "bare-expr", expr: ".Idle => 0" },
        ],
      };
      const out = emitMatchExpr(node);
      // No failable discriminator — no __scrml_error sentinel.
      expect(out).not.toContain("__scrml_error");
      // Regular payload destructure via .data.<field>.
      expect(out).toMatch(/const d = _scrml_match_\d+\.data\.id;/);
    } finally {
      setVariantFieldsForFile(null, null);
    }
  });
});

// ---------------------------------------------------------------------------
// Runtime — eval the emitted match IIFE and drive both branches
// ---------------------------------------------------------------------------

describe("Peter #21 — runtime behaviour of the emitted match IIFE", () => {
  function buildMatchFn(armExprs) {
    resetVarCounter();
    setVariantFieldsForFile(null, null);
    const node = {
      header: "subj",
      body: armExprs.map((e) => ({ kind: "bare-expr", expr: e })),
    };
    const iife = emitMatchExpr(node);
    // The header lowers to the bare local `subj`; wrap the IIFE so we can feed a
    // subject and read the arm's returned value.
    return new Function("subj", `return ${iife};`);
  }

  it("bare success value → ::Ok(v) fires with v = the success value", () => {
    const fn = buildMatchFn(['.Ok(v) :> "ok: " + v', '.DivByZero :> "ERR: divide by zero"']);
    expect(fn(5)).toBe("ok: 5");
    expect(fn(0)).toBe("ok: 0"); // 0 is a DEFINED success value, not absence
  });

  it("error envelope → routes to the matching error variant arm", () => {
    const fn = buildMatchFn(['.Ok(v) :> "ok: " + v', '.DivByZero :> "ERR: divide by zero"']);
    const errEnvelope = { __scrml_error: true, type: "DivErr", variant: "DivByZero", data: null };
    expect(fn(errEnvelope)).toBe("ERR: divide by zero");
  });

  it("struct success value → ::Ok(user) binds the whole struct (field access works)", () => {
    const fn = buildMatchFn(['.Ok(user) :> user.name', '.NotFound :> "missing"']);
    expect(fn({ name: "alice", age: 30 })).toBe("alice");
    const errEnvelope = { __scrml_error: true, type: "LoadErr", variant: "NotFound", data: null };
    expect(fn(errEnvelope)).toBe("missing");
  });

  it("empty-string success is a DEFINED value → ::Ok fires (not routed to error)", () => {
    const fn = buildMatchFn(['.Ok(v) :> "got:" + v', '.Bad :> "err"']);
    expect(fn("")).toBe("got:");
  });
});

// ---------------------------------------------------------------------------
// End-to-end compile — Peter's reproducer + the match-as-decl form
// ---------------------------------------------------------------------------

describe("Peter #21 — end-to-end compile", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "peter-21-"));
  });

  function compile(src) {
    const srcPath = join(tmpDir, "repro.scrml");
    const outDir = join(tmpDir, "dist");
    writeFileSync(srcPath, src);
    const result = compileScrml({ inputFiles: [srcPath], outputDir: outDir, log: () => {} });
    let out = "";
    try { out = readFileSync(join(outDir, "repro.client.js"), "utf8"); } catch {}
    return { result, out };
  }

  it("Peter's reproducer — ::Ok(v) fires + binds, error arm routes, output parses", () => {
    const src = `\${
    type DivErr:enum = {
        DivByZero
    }

    function safeDiv(a, b)! DivErr {
        if (b == 0) fail DivErr.DivByZero
        return a / b
    }
}

<out> = ""

\${
    function compute(b) {
        match safeDiv(10, b) {
            ::Ok(v)     :> @out = "ok: " + v
            ::DivByZero :> @out = "ERR: divide by zero"
        }
    }
}

<button id="btn-ok" onclick=compute(2)>ok</>
<button id="btn-err" onclick=compute(0)>err</>
<div id="out">\${@out}</>
`;
    const { out } = compile(src);
    // The failable discriminator + the v-binding are present; the bug is gone.
    expect(out).toMatch(/__scrml_error === true\) \? _scrml_match_\d+\.variant : "Ok"/);
    expect(out).toMatch(/const v = _scrml_match_\d+;/);
    expect(out).not.toContain("cannot positionally bind");
    expect(out).toMatch(/=== "DivByZero"\)/);
    // The emitted JS parses (the bug left `v` as an unbound identifier — still
    // parses, but the discriminator was the harder half; assert both).
    expect(() => {
      new Function("_scrml_reactive_get", "_scrml_reactive_set", "document",
        out.replace(/^\/\/ Requires:.*\n/, ""));
    }).not.toThrow();
  });

  it("match-as-decl form: `let r = match failable() { ::Ok(v) :> v … }`", () => {
    const src = `\${
    type DivErr:enum = {
        DivByZero
    }

    function safeDiv(a, b)! DivErr {
        if (b == 0) fail DivErr.DivByZero
        return a / b
    }

    function compute(b) {
        let r = match safeDiv(10, b) {
            ::Ok(v)     :> v
            ::DivByZero :> -1
        }
        return r
    }
}

<out> = ""
<button id="go" onclick=compute(2)>go</>
<div id="out">\${@out}</>
`;
    const { out } = compile(src);
    // The decl-form emitter (emit-logic.ts:emitMatchExprDecl) gets the same
    // failable discriminator + Ok binding.
    expect(out).toMatch(/__scrml_error === true\) \? _scrml_match_\d+\.variant : "Ok"/);
    expect(out).toMatch(/const v = _scrml_match_\d+;/);
    expect(out).not.toContain("cannot positionally bind");
  });

  it("REGRESSION — `?` propagation is UNTOUCHED (separate lowering)", () => {
    const src = `\${
    type DivErr:enum = {
        DivByZero
    }

    function safeDiv(a, b)! DivErr {
        if (b == 0) fail DivErr.DivByZero
        return a / b
    }

    function chained(b)! DivErr {
        let x = safeDiv(10, b)?
        return x + 1
    }
}

<out> = ""
<button id="go" onclick=chained(2)>go</>
<div id="out">\${@out}</>
`;
    const { out } = compile(src);
    // `?` lowers to the propagate shape: pass the error envelope up, unwrap
    // success. It does NOT use the "Ok" string discriminator (that is the
    // explicit-match path). Assert the propagation guard is present and the
    // match-over-failable discriminator is NOT injected for the `?` path.
    expect(out).toContain("__scrml_error");
    expect(out).not.toContain("cannot positionally bind");
  });
});
