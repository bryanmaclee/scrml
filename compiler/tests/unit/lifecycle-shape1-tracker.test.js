/**
 * B-prereq (S134) — Shape 1 per-access lifecycle tracker tests
 *
 * Closes Bug 19 HIGH (known-gaps §1). SPEC §14.12.3 + §14.12.10 normatively
 * specify per-access lifecycle tracking on Shape 1 plain reactive cells
 * (`<state>: (A to B) = init`-style decls). Pre-S134 impl covered only
 * struct-field (Landing 1) and fn-return (S131 HU-2) loci; Shape 1 cells
 * went unchecked. This test suite verifies the new Sub-Pass 2.a + 2.b
 * coverage.
 *
 * Two sub-cases under test:
 *   - Sub-Pass 2.a: `<u>: User = { ... }` where User carries a lifecycle
 *     field (`passwordHash: (not to string)`). Read of `@u.passwordHash`
 *     before assignment fires E-TYPE-001. Reuses the existing struct-field
 *     walker (`checkLifecycleFieldAccess`); the addition is the collector
 *     recognizing state-decl AST nodes as binding sources.
 *
 *   - Sub-Pass 2.b: `<state>: (not to User) = not` where the CELL TYPE
 *     itself is lifecycle-annotated. Read of `@state.field` before write/
 *     discrimination fires E-TYPE-001. Reuses the existing fn-return
 *     walker (`checkLifecycleBindingAccess`) via additive params for
 *     initial state seed + diagnostic source-label override.
 *
 * Tests use direct AST construction (mirrors the existing
 * `type-system-lifecycle*.test.js` pattern) to bypass parser tokenization
 * quirks around lifecycle annotation whitespace. End-to-end pipeline
 * verification of the V5-strict source form is at
 * `compiler/tests/integration/lifecycle-landing-2-pipeline.test.js`.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  TSError,
  buildTypeRegistry,
  buildLifecycleRegistry,
  checkLifecycleFieldAccess,
  checkLifecycleBindingAccess,
} from "../../src/type-system.js";

// ---------------------------------------------------------------------------
// Direct-AST helpers — mirror the existing lifecycle test fixtures
// ---------------------------------------------------------------------------

function span(start = 0, file = "/test/shape1.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

function makeTypeDecl(name, typeKind, raw, id = 1) {
  return { id, kind: "type-decl", name, typeKind, raw, span: span(0) };
}

function bareExpr(text) {
  return { kind: "bare-expr", value: text, expr: text, span: span(0) };
}

function reactiveNestedAssign(target, path, value) {
  return {
    kind: "reactive-nested-assign",
    target,
    path,
    value,
    span: span(0),
  };
}

/**
 * Build a state-decl re-assignment node (the parser's wire form for
 * `@cell = expr` reassignment per ast-builder.js ~5128). For test purposes
 * we set `structuralForm: false` to signal "this is a write, not a decl."
 */
function stateReassign(name, init) {
  return {
    kind: "state-decl",
    name,
    init,
    structuralForm: false,
    span: span(0),
  };
}

function ifStmt(condition, consequent, alternate = []) {
  return {
    kind: "if-stmt",
    condition,
    consequent,
    alternate,
    span: span(0),
  };
}

function givenGuard(variables, body) {
  return { kind: "given-guard", variables, body, span: span(0) };
}

function returnStmt() {
  return { kind: "return-stmt", expr: "", span: span(0) };
}

// ---------------------------------------------------------------------------
// Sub-Pass 2.b — Cell-value-typed Shape 1 presence-progression `(not to T)`
// ---------------------------------------------------------------------------

describe("§B-Prereq.2b — cell-value-typed presence-progression `(not to T)`", () => {
  // The Sub-Pass 2.b walker takes the same FnReturnLifecycleSpec carrier as
  // the fn-return tracker. For direct-AST tests we construct the bindings
  // map by hand (matches existing fn-return test pattern at
  // type-system-lifecycle-landing-2-5.test.js).

  function userPresenceBinding() {
    return new Map([
      ["state", {
        kind: "presence",
        preType: { kind: "not" },
        postType: { kind: "struct", name: "User" },
        preVariantName: "",
        postVariantName: "",
      }],
    ]);
  }

  test("Test 1 — pre-transition read fires E-TYPE-001 with Shape-1 source label", () => {
    // <state>: (not to User) = not
    // @state.name           // E-TYPE-001
    const body = [bareExpr("@state.name")];
    const errors = [];
    checkLifecycleBindingAccess(
      body, userPresenceBinding(), errors, span(),
      /* initialStates */ undefined,
      /* bindingSourceLabel */ "on a Shape 1 reactive cell",
    );
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(1);
    const fire = errors.find(e => e.code === "E-TYPE-001");
    expect(fire.message).toMatch(/state/);
    expect(fire.message).toMatch(/on a Shape 1 reactive cell/);
    expect(fire.message).toMatch(/pre-transition/);
  });

  test("Test 2 — write `@state = newUser` then read passes (transition recognized)", () => {
    // <state>: (not to User) = not
    // @state = newUser
    // @state.name                                  // OK
    const body = [
      stateReassign("state", "newUser"),
      bareExpr("@state.name"),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, userPresenceBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
  });

  test("Test 3 — given-discrimination promotes inside body", () => {
    // given @state => {
    //   @state.name                                // OK — discrim = transition
    // }
    const body = [
      givenGuard(["state"], [bareExpr("@state.name")]),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, userPresenceBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
  });

  test("Test 4 — `if (@state is not) return` early-return promotes outer", () => {
    // if (@state is not) { return }
    // @state.name                                  // OK
    const body = [
      ifStmt("state is not", [returnStmt()]),
      bareExpr("@state.name"),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, userPresenceBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
  });

  test("Test 5 — read after re-assignment to `not` re-fires", () => {
    // @state = newUser  -> post
    // @state.name        -> OK
    // @state = not       -> pre  (reset)
    // @state.name        -> fires E-TYPE-001
    const body = [
      stateReassign("state", "newUser"),
      bareExpr("@state.name"),
      stateReassign("state", "not"),
      bareExpr("@state.name"),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, userPresenceBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(1);
  });

  test("Test 6 — multiple pre-transition reads each fire", () => {
    const body = [
      bareExpr("@state.name"),
      bareExpr("@state.id"),
      bareExpr("@state.email"),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, userPresenceBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(3);
  });

  test("Test 7 — initial state seed: cell whose init satisfies post-type starts post", () => {
    // <state>: (not to User) = someExistingUser    // init satisfies post-type
    // @state.name                                  // OK — starts post
    const body = [bareExpr("@state.name")];
    const errors = [];
    checkLifecycleBindingAccess(
      body, userPresenceBinding(), errors, span(),
      /* initialStates */ new Map([["state", "post"]]),
      "on a Shape 1 reactive cell",
    );
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
  });

  test("Test 8 — non-lifecycle cell unaffected (no false positive)", () => {
    // Empty bindings map → walker is a no-op
    const body = [bareExpr("@count.toString()"), bareExpr("@count + 1")];
    const errors = [];
    checkLifecycleBindingAccess(body, new Map(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-Pass 2.b — Cell-value-typed Shape 1 variant-progression `(.A to .B)`
// ---------------------------------------------------------------------------

describe("§B-Prereq.2b — cell-value-typed variant-progression `(.A to .B)`", () => {
  function phaseVariantBinding() {
    return new Map([
      ["phase", {
        kind: "variant",
        preType: { kind: "enum", name: "Article", variants: [] },
        postType: { kind: "enum", name: "Article", variants: [] },
        preVariantName: "Draft",
        postVariantName: "Published",
      }],
    ]);
  }

  test("Test 9 — read post-shape field without discrimination fires E-TYPE-001", () => {
    // <phase>: (.Draft to .Published) = .Draft
    // @phase.publishedAt                          // E-TYPE-001 (no discrimination at all)
    const body = [bareExpr("@phase.publishedAt")];
    const errors = [];
    checkLifecycleBindingAccess(body, phaseVariantBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(1);
  });

  test("Test 10 — discriminated source-variant without transition() fires VARIANT-NOT-TRANSITIONED", () => {
    // if (@phase is .Draft) {
    //   @phase.publishedAt                        // E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED
    // }
    const body = [
      ifStmt("phase is .Draft", [bareExpr("@phase.publishedAt")]),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, phaseVariantBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED").length).toBe(1);
    const fire = errors.find(e => e.code === "E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED");
    expect(fire.message).toMatch(/phase/);
    expect(fire.message).toMatch(/on a Shape 1 reactive cell/);
    expect(fire.message).toMatch(/transition\(phase\)/);
  });

  test("Test 11 — discriminated + transition() passes", () => {
    // if (@phase is .Draft) {
    //   transition(phase)
    //   @phase.publishedAt                        // OK
    // }
    const body = [
      ifStmt("phase is .Draft", [
        bareExpr("transition(phase)"),
        bareExpr("@phase.publishedAt"),
      ]),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, phaseVariantBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
    expect(errors.filter(e => e.code === "E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED").length).toBe(0);
  });

  test("Test 12 — write `@phase = .Published` then read passes (initIsPost write)", () => {
    // @phase = .Published    -> post
    // @phase.publishedAt     -> OK
    const body = [
      stateReassign("phase", ".Published"),
      bareExpr("@phase.publishedAt"),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, phaseVariantBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
    expect(errors.filter(e => e.code === "E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-Pass 2.a — Struct-typed Shape 1 (lifecycle on struct field)
// ---------------------------------------------------------------------------

describe("§B-Prereq.2a — struct-typed Shape 1 (lifecycle on struct field)", () => {
  test("Test 13 — pre-transition read on @u.passwordHash fires E-TYPE-001", () => {
    // type User:struct = { passwordHash: (not to string) }
    // <u>: User = { passwordHash: not }
    // @u.passwordHash                              // E-TYPE-001
    const decls = [
      makeTypeDecl("User", "struct", "{ passwordHash: (not to string) }"),
    ];
    const errors = [];
    const typeRegistry = buildTypeRegistry(decls, errors, span());
    const lifecycle = buildLifecycleRegistry(decls, typeRegistry);

    const body = [bareExpr("@u.passwordHash")];
    const structInstances = new Map([["u", "User"]]);

    checkLifecycleFieldAccess(body, structInstances, lifecycle, errors, span());

    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(1);
    const fire = errors.find(e => e.code === "E-TYPE-001");
    expect(fire.message).toMatch(/passwordHash/);
    expect(fire.message).toMatch(/User/);
  });

  test("Test 14 — write @u.passwordHash via reactive-nested-assign transitions field", () => {
    // type User:struct = { passwordHash: (not to string) }
    // <u>: User = { passwordHash: not }
    // @u.passwordHash = "hash"                     // structural write
    // @u.passwordHash                              // OK
    const decls = [
      makeTypeDecl("User", "struct", "{ passwordHash: (not to string) }"),
    ];
    const errors = [];
    const typeRegistry = buildTypeRegistry(decls, errors, span());
    const lifecycle = buildLifecycleRegistry(decls, typeRegistry);

    const body = [
      reactiveNestedAssign("u", ["passwordHash"], "\"hash\""),
      bareExpr("@u.passwordHash"),
    ];
    const structInstances = new Map([["u", "User"]]);
    checkLifecycleFieldAccess(body, structInstances, lifecycle, errors, span());

    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
  });

  test("Test 15 — non-lifecycle struct field access remains unaffected", () => {
    // type User:struct = { passwordHash: (not to string) }
    // <u>: User
    // @u.id                                        // not a lifecycle field — no fire
    const decls = [
      makeTypeDecl("User", "struct", "{ id: number, passwordHash: (not to string) }"),
    ];
    const errors = [];
    const typeRegistry = buildTypeRegistry(decls, errors, span());
    const lifecycle = buildLifecycleRegistry(decls, typeRegistry);

    const body = [bareExpr("@u.id"), bareExpr("@u.id + 1")];
    const structInstances = new Map([["u", "User"]]);
    checkLifecycleFieldAccess(body, structInstances, lifecycle, errors, span());

    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
  });

  test("Test 16 — multi-lifecycle-field struct: each field tracked independently", () => {
    // type User:struct = {
    //   passwordHash: (not to string),
    //   verifiedAt: (not to number)
    // }
    // <u>: User = { passwordHash: not, verifiedAt: not }
    // @u.passwordHash = "hash"                     // transition passwordHash
    // @u.passwordHash                              // OK
    // @u.verifiedAt                                // FIRES (still pre)
    const decls = [
      makeTypeDecl("User", "struct",
        "{ passwordHash: (not to string), verifiedAt: (not to number) }"),
    ];
    const errors = [];
    const typeRegistry = buildTypeRegistry(decls, errors, span());
    const lifecycle = buildLifecycleRegistry(decls, typeRegistry);

    const body = [
      reactiveNestedAssign("u", ["passwordHash"], "\"hash\""),
      bareExpr("@u.passwordHash"),
      bareExpr("@u.verifiedAt"),
    ];
    const structInstances = new Map([["u", "User"]]);
    checkLifecycleFieldAccess(body, structInstances, lifecycle, errors, span());

    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(1);
    const fire = errors.find(e => e.code === "E-TYPE-001");
    expect(fire.message).toMatch(/verifiedAt/);
  });

  test("Test 17 — text-driven u.field = expr write still recognized (no regression on existing path)", () => {
    // The text-driven detector for u.field = expr (the let-decl fn-body path)
    // must continue to work after Sub-Pass 2.a's reactive-nested-assign
    // addition. Use a bare-expr with the LHS pattern.
    const decls = [
      makeTypeDecl("User", "struct", "{ passwordHash: (not to string) }"),
    ];
    const errors = [];
    const typeRegistry = buildTypeRegistry(decls, errors, span());
    const lifecycle = buildLifecycleRegistry(decls, typeRegistry);

    const body = [
      bareExpr("u.passwordHash = hash(pwd)"),
      bareExpr("send(u.passwordHash)"),
    ];
    const structInstances = new Map([["u", "User"]]);
    checkLifecycleFieldAccess(body, structInstances, lifecycle, errors, span());

    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Block-transparent visibility (logic-block hoisting)
// ---------------------------------------------------------------------------

describe("§B-Prereq.2b — block-transparent visibility (logic-block recursion)", () => {
  function userPresenceBinding() {
    return new Map([
      ["state", {
        kind: "presence",
        preType: { kind: "not" },
        postType: { kind: "struct", name: "User" },
        preVariantName: "",
        postVariantName: "",
      }],
    ]);
  }

  test("Test 18 — write in one logic-block visible to subsequent sibling block", () => {
    // ${ @state = newUser }           // sibling logic block 1
    // ${ @state.name }                // sibling logic block 2 — OK
    const body = [
      { kind: "logic", body: [stateReassign("state", "newUser")], span: span(0) },
      { kind: "logic", body: [bareExpr("@state.name")], span: span(0) },
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, userPresenceBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(0);
  });

  test("Test 19 — branch state (if-stmt) does NOT leak outward", () => {
    // if (cond) { @state = newUser; @state.name }   // OK inside
    // @state.name                                   // FIRES — outer state unchanged
    const body = [
      ifStmt("cond", [
        stateReassign("state", "newUser"),
        bareExpr("@state.name"),
      ]),
      bareExpr("@state.name"),
    ];
    const errors = [];
    checkLifecycleBindingAccess(body, userPresenceBinding(), errors, span(),
      undefined, "on a Shape 1 reactive cell");
    // Exactly 1 fire: the outer read after the if-stmt. Inner read is inside
    // a transitioned scope.
    expect(errors.filter(e => e.code === "E-TYPE-001").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end pipeline verification (via compileScrml)
// ---------------------------------------------------------------------------

describe("§B-Prereq end-to-end — via compileScrml", () => {
  let TMP;
  function setup() {
    if (!TMP) TMP = mkdtempSync(join(tmpdir(), "b-prereq-"));
    return TMP;
  }

  function compileSource(name, source) {
    const dir = setup();
    const filePath = join(dir, `${name}.scrml`);
    writeFileSync(filePath, source);
    const result = compileScrml({
      inputFiles: [filePath],
      outputDir: join(dir, `${name}.dist`),
      write: false,
      log: () => {},
    });
    return {
      errors: result.errors || [],
      warnings: result.warnings || [],
    };
  }

  test("Test 20 — Reproducer 1: cell-value-typed presence fires E-TYPE-001", () => {
    const src = `type User:struct = {
    id: number,
    name: string
}

<state>: (not to User) = not

\${
    @state.name
}`;
    const result = compileSource("repro1", src);
    const fires = result.errors.filter(e => e.code === "E-TYPE-001");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toMatch(/state/);
    expect(fires[0].message).toMatch(/Shape 1 reactive cell/);
  });

  test("Test 21 — Reproducer 3: struct-typed Shape 1 fires E-TYPE-001 on field", () => {
    const src = `type User:struct = {
    id: number,
    email: string,
    passwordHash: (not to string)
}

<u>: User = { id: 1, email: "a@b.com", passwordHash: not }

\${
    @u.passwordHash
}`;
    const result = compileSource("repro3", src);
    const fires = result.errors.filter(e => e.code === "E-TYPE-001");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toMatch(/passwordHash/);
    expect(fires[0].message).toMatch(/User/);
  });

  test("Test 22 — Write-then-read passes (no false positive)", () => {
    const src = `type User:struct = {
    id: number,
    name: string
}

<state>: (not to User) = not

\${
    @state = { id: 1, name: "Alice" }
}
\${
    @state.name
}`;
    const result = compileSource("repro4", src);
    const fires = result.errors.filter(e => e.code === "E-TYPE-001");
    expect(fires.length).toBe(0);
  });

  test("Test 23 — Engine-cell carve-out still fires (no regression from B-prereq tracker)", () => {
    const src = `<program>

type Phase:enum = { Idle, Done }

<engine for=Phase initial=.Idle>
  <Idle rule=.Done></>
  <Done></>
</>

<phase>: (not to string) = not

</program>`;
    const result = compileSource("repro5", src);
    const carveOut = result.errors.filter(
      e => e.code === "E-TYPE-LIFECYCLE-ON-ENGINE-CELL");
    expect(carveOut.length).toBeGreaterThanOrEqual(1);
  });

  test("Test 24 — Non-engine Shape 1 with lifecycle DOES fire B-prereq tracker on pre-read", () => {
    // Same shape as Test 23 but without the engine — should fire B-prereq
    // tracker (NOT carve-out) on the pre-transition read.
    const src = `<program>

\${
  type Holder:struct = { val: (not to string) }
  <h>: Holder = { val: not }
  @h.val
}

</program>`;
    const result = compileSource("repro-non-engine-struct", src);
    const fires = result.errors.filter(e => e.code === "E-TYPE-001");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toMatch(/val/);
    expect(fires[0].message).toMatch(/Holder/);
    // Should NOT fire the carve-out
    const carveOut = result.errors.filter(
      e => e.code === "E-TYPE-LIFECYCLE-ON-ENGINE-CELL");
    expect(carveOut.length).toBe(0);
  });

  test("Test 25 — Pre-existing fn-body path preserved (let-decl with lifecycle in fn)", () => {
    // Sub-Pass 2.a's state-decl extension must NOT break the fn-body let-decl
    // path that already fires today.
    const src = `type User:struct = {
    name: string,
    passwordHash: (not to string)
}

fn doStuff() {
    let u: User = <User name="alice">
    print(u.passwordHash)
}`;
    const result = compileSource("repro-existing-fn-body", src);
    const fires = result.errors.filter(e => e.code === "E-TYPE-001");
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toMatch(/passwordHash/);
  });
});
