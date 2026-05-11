/**
 * Phase A10 follow-on (S81) — engine state-child body type-system body-walk
 * re-enablement + payload-binding scope injection.
 *
 * Per S78 hand-off §"Phase A10 deferred items" + hand-off-80 priority #1:
 * the type-system walker's `engine-decl` case was an early-return (returned
 * `tAsIs()` without descending into `bodyChildren`) until S81. The gate
 * documented at that case was "wait for the codegen structural-element
 * filter so `<onTimeout after=10s>` doesn't fire false E-SCOPE-001 on
 * `after=10s` unquoted attribute resolution." That filter shipped at S78
 * Phase A10 (`STATE_CHILD_STRUCTURAL_TAGS` in `codegen/emit-variant-guard.ts`);
 * S81 closes both deferrals together.
 *
 * What this enables:
 *   1. Typo / undeclared-identifier safety net inside engine state-child
 *      bodies — `${mssg}` (typo of `msg`) now fires E-SCOPE-001 instead of
 *      passing silently through to runtime.
 *   2. Payload-binding scope injection — `<Error msg>` introduces `msg` as
 *      a local in the arm body sub-scope so `${msg}` resolves cleanly.
 *      Pattern mirrors B20's `match-arm-block` payload-binding injection
 *      at `type-system.ts:5102-5125`.
 *   3. Structural-element body walk skip — `<onTimeout>`, `<onTransition>`,
 *      `<onIdle>`, nested `<engine>`, `<machine>` inside an arm body are
 *      filtered before TS descends, preserving their engine-grammar attrs
 *      from general-markup attribute resolution.
 *
 * Coverage:
 *   §1 Payload binding resolves inside body interpolation (positive).
 *   §2 Multi-binding `<Pair a b>` body — both bindings resolve.
 *   §3 Payload binding is arm-local — not visible in sibling arms.
 *   §4 Typo in arm body fires E-SCOPE-001 (negative, primary value-add).
 *   §5 Undeclared identifier in arm body fires E-SCOPE-001.
 *   §6 Structural-element children (`<onTimeout>`) inside arm body don't
 *      fire false E-SCOPE-001 on their grammar-specific attrs.
 *   §7 Top-level cells / functions visible inside arm body (regression
 *      anchor — body-walk doesn't sever outer-scope resolution).
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import { runTS } from "../../src/type-system.ts";

function runUpToTS(source, filePath = "/test/engine-body.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast, errors: tabErrors } = buildAST(bs);
  const fileAST = { filePath, ...ast };
  const symResult = runSYM({ filePath, ast });
  const tsResult = runTS({ files: [fileAST] });
  const allErrors = [
    ...(tabErrors ?? []),
    ...(symResult.errors ?? []),
    ...(tsResult.errors ?? []),
  ].filter((e) => e && e.severity !== "warning");
  return { ast, errors: allErrors };
}

// ---------------------------------------------------------------------------
// §1: payload binding resolves inside body interpolation
// ---------------------------------------------------------------------------

describe("§1 (S81): payload binding `<Error msg>` resolves inside `${msg}` body interp", () => {
  test("no E-SCOPE-001 on payload-binding reference", () => {
    const source = `<program>
\${
  type Phase:enum = {
    Idle,
    Error(detail: string)
  }
  function load() {}
}

<engine for=Phase initial=.Idle>
  <Idle rule=.Idle>
    <button onclick=load()>Load</button>
  </>
  <Error msg rule=.Idle>
    <div>\${msg}</div>
  </>
</>
</program>`;
    const { errors } = runUpToTS(source);
    const scopeErrs = errors.filter(
      (e) => e.code === "E-SCOPE-001" && /\bmsg\b/.test(e.message ?? ""),
    );
    expect(scopeErrs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2: multi-binding `<Pair a b>` — both bindings resolve
// ---------------------------------------------------------------------------

describe("§2 (S81): multi-binding state-child body — all payload names resolve", () => {
  test("`<Pair a b>` body with `${a + b}` — both bound", () => {
    const source = `<program>
\${
  type Shape:enum = {
    Empty,
    Pair(a: int, b: int)
  }
  function load() {}
}

<engine for=Shape initial=.Empty>
  <Empty rule=.Empty>
    <button onclick=load()>Load</button>
  </>
  <Pair a b rule=.Empty>
    <span>\${a + b}</span>
  </>
</>
</program>`;
    const { errors } = runUpToTS(source);
    const scopeErrs = errors.filter(
      (e) => e.code === "E-SCOPE-001" && /\b(a|b)\b/.test(e.message ?? ""),
    );
    expect(scopeErrs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3: payload binding is arm-local
// ---------------------------------------------------------------------------

describe("§3 (S81): payload binding is arm-local — not visible in sibling arm", () => {
  test("`msg` declared in `<Error msg>` body is NOT visible in `<Idle>` body", () => {
    const source = `<program>
\${
  type Phase:enum = {
    Idle,
    Error(msg: string)
  }
  function load() {}
}

<engine for=Phase initial=.Idle>
  <Idle rule=.Idle>
    <div>\${msg}</div>
  </>
  <Error msg rule=.Idle>
    <div>\${msg}</div>
  </>
</>
</program>`;
    const { errors } = runUpToTS(source);
    // `msg` in the `<Idle>` arm body has no binding → E-SCOPE-001 fires.
    // `msg` in the `<Error msg>` arm body has a binding → does NOT fire.
    const scopeErrs = errors.filter(
      (e) => e.code === "E-SCOPE-001" && /\bmsg\b/.test(e.message ?? ""),
    );
    expect(scopeErrs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4: typo in arm body fires E-SCOPE-001 (the primary value-add of S81)
// ---------------------------------------------------------------------------

describe("§4 (S81): typo in arm body fires E-SCOPE-001", () => {
  test("`<Error msg>` body with `${mssg}` typo → E-SCOPE-001", () => {
    const source = `<program>
\${
  type Phase:enum = {
    Idle,
    Error(msg: string)
  }
  function load() {}
}

<engine for=Phase initial=.Idle>
  <Idle rule=.Idle>
    <button onclick=load()>Load</button>
  </>
  <Error msg rule=.Idle>
    <div>\${mssg}</div>
  </>
</>
</program>`;
    const { errors } = runUpToTS(source);
    const typoErrs = errors.filter(
      (e) => e.code === "E-SCOPE-001" && /\bmssg\b/.test(e.message ?? ""),
    );
    expect(typoErrs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §5: undeclared identifier in arm body fires E-SCOPE-001
// ---------------------------------------------------------------------------

describe("§5 (S81): undeclared identifier in arm body fires E-SCOPE-001", () => {
  test("`<Idle>` body with `${undeclaredVar}` → E-SCOPE-001", () => {
    const source = `<program>
\${
  type Phase:enum = {
    Idle,
    Done
  }
}

<engine for=Phase initial=.Idle>
  <Idle rule=.Done>
    <div>\${undeclaredVar}</div>
  </>
  <Done>
    Done.
  </>
</>
</program>`;
    const { errors } = runUpToTS(source);
    const errs = errors.filter(
      (e) => e.code === "E-SCOPE-001" && /\bundeclaredVar\b/.test(e.message ?? ""),
    );
    expect(errs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §6: structural-element children don't fire false E-SCOPE-001 on their
//     engine-grammar attrs (e.g., `after=10s` unquoted-token form)
// ---------------------------------------------------------------------------

describe("§6 (S81): structural-element children inside arm body are filtered", () => {
  test("`<Loading><onTimeout after=10s to=.Done/>...</>` — no false E-SCOPE-001 on `10s`", () => {
    const source = `<program>
\${
  type Phase:enum = {
    Idle,
    Loading,
    Done
  }
  function load() {}
}

<engine for=Phase initial=.Idle>
  <Idle rule=.Loading>
    <button onclick=load()>Load</button>
  </>
  <Loading rule=.Done>
    <onTimeout after=10s to=.Done/>
    Loading...
  </>
  <Done>
    Done.
  </>
</>
</program>`;
    const { errors } = runUpToTS(source);
    // `after=10s` is engine-grammar; structural-element filter must keep
    // TS from descending into `<onTimeout>`'s attrs.
    const falsePositives = errors.filter(
      (e) => e.code === "E-SCOPE-001" && /\b10s\b/.test(e.message ?? ""),
    );
    expect(falsePositives.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §7: outer-scope identifiers visible inside arm body (regression anchor)
// ---------------------------------------------------------------------------

describe("§7 (S81): outer-scope identifiers resolve inside arm body (regression anchor)", () => {
  test("function `load()` declared at top level resolves inside `<Idle>` arm body", () => {
    const source = `<program>
\${
  type Phase:enum = {
    Idle,
    Done
  }
  function load() {}
}

<engine for=Phase initial=.Idle>
  <Idle rule=.Done>
    <button onclick=load()>Load</button>
  </>
  <Done>Done.</>
</>
</program>`;
    const { errors } = runUpToTS(source);
    // The pre-S81 behavior already handled this via the symbol-table
    // body-walk; this test guards that the new TS body-walk doesn't
    // break outer-scope resolution.
    const errs = errors.filter(
      (e) => e.code === "E-SCOPE-001" && /\bload\b/.test(e.message ?? ""),
    );
    expect(errs.length).toBe(0);
  });
});
