/**
 * §12.2 Trigger 3 — server-only stdlib import escalates the importing function
 * (S299; closes `g-trigger-3-server-only-import-does-not-escalate` HIGH +
 * `g-scrml-store-not-classified-server-only` D-6 by construction).
 *
 * SPEC §12.2:7145 — *"Developer configuration declares that a specific module or
 * function SHALL never run client-side. … importing any of them … escalates the
 * importing function."* Before S299 this trigger did not fire at all: the module
 * set was consulted only by the CPS-eligibility / async-classification predicates
 * (`hasServerCallInInit`, `controlFlowContainsServerTrigger`), never by the
 * PLACEMENT decision. Consequence, verified on `main` at S299: a `<program>`
 * calling `hashPassword` from `scrml:auth` emitted NO `.server.js`, resolved the
 * call client-side against `_scrml_stdlib.auth`, and shipped both the caller's
 * secret literal AND a real `Bun.password.hash` argon2id implementation into the
 * browser bundle — with zero diagnostics.
 *
 * THE SET IS NOT THE ASYNC SET. `ESCALATION_SERVER_ONLY_MODULES` is deliberately
 * distinct from `SERVER_ONLY_SCRML_MODULES`. The latter feeds an async fail-closed
 * backstop where OVER-inclusion is safe; escalation inverts that, so reusing it was
 * measured (S299) to server-escalate 72 corpus import sites that are correct client
 * code — `scrml:data` alone is 72 of the corpus's 116 server-only-module imports and
 * ships a real client implementation. §3 below is the regression guard for that.
 *
 * Test map:
 *   §1  POSITIVE — keyword-less fn calling a `scrml:auth` binding escalates server.
 *   §2  POSITIVE — `scrml:store` escalates (D-6, closed by construction).
 *   §3  GUARD    — `scrml:data` (client-safe) does NOT escalate. The 72-site class.
 *   §4  GUARD    — `scrml:http` (client-safe) does NOT escalate.
 *   §8  EVASION  — lambda / nested fn / bare callback / indirect alias (S299 review).
 *   §9  CRED     — `scrml:oauth` escalates via the CREDENTIAL limb, not host reach.
 *   §10 OVER-FIRE— a function-level shadow of an imported name must NOT escalate.
 *   §5  ALIASING — `import { hashPassword as hp }` escalates on the LOCAL name.
 *   §6  GUARD    — importing without calling does NOT escalate.
 *   §7  SHAPE    — the reason is `server-only-resource` carrying the module
 *                  specifier (NOT a fresh kind — §12.6 library mode gates on it).
 */

import { describe, test, expect } from "bun:test";
import { runRI, ESCALATION_SERVER_ONLY_MODULES } from "../../src/route-inference.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parseFileAST(source, filePath = "/test/t3.scrml") {
  const bs = splitBlocks(filePath, source);
  const tab = buildAST(bs);
  const ast = tab.ast;
  return {
    filePath,
    nodes: ast.nodes ?? [],
    ast,
    imports: ast.imports ?? [],
    exports: ast.exports ?? [],
    components: ast.components ?? [],
    typeDecls: ast.typeDecls ?? [],
    spans: ast.spans ?? new Map(),
  };
}

function runRIClean(fileAST) {
  // runRI returns an RIOutput; the per-function placement records live on
  // `.routeMap.functions` (keyed `{filePath}::{span.start}`).
  return runRI({ files: [fileAST], protectAnalysis: { views: new Map() } }).routeMap;
}

function routeForFn(routeMap, fnName, fileAST) {
  let target = null;
  function visit(nodes) {
    for (const n of nodes ?? []) {
      if (!n || typeof n !== "object") continue;
      if (n.kind === "function-decl" && n.name === fnName) { target = n; return; }
      if (Array.isArray(n.children)) visit(n.children);
      if (n.kind === "logic" && Array.isArray(n.body)) visit(n.body);
    }
  }
  visit(fileAST.nodes);
  if (!target) return undefined;
  return routeMap.functions.get(`${fileAST.filePath}::${target.span.start}`);
}

/** Build a one-page program that imports `binding` from `mod` and calls it. */
function programCalling(mod, binding, callExpr = `${binding}("x")`) {
  return `<program>
  <page>
    \${
        import { ${binding} } from '${mod}'
        <out> = ""

        function useIt() {
            return ${callExpr}
        }
    }
    <button onclick=useIt()>Go</button>
    <p>\${@out}</p>
  </>
</program>`;
}

function isServerEscalated(route) {
  return route !== undefined && Array.isArray(route.escalationReasons)
    && route.escalationReasons.length > 0;
}

// ---------------------------------------------------------------------------
// §1 — POSITIVE: scrml:auth escalates without the `server` keyword
// ---------------------------------------------------------------------------

describe("Trigger 3 §1 — server-only stdlib import escalates", () => {
  test("keyword-less fn calling a `scrml:auth` binding escalates to server", () => {
    const fileAST = parseFileAST(programCalling("scrml:auth", "hashPassword"));
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    expect(isServerEscalated(route)).toBe(true);
  });

  test("a submodule import (`scrml:auth/jwt`) escalates identically", () => {
    const fileAST = parseFileAST(programCalling("scrml:auth/jwt", "signJwt"));
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    expect(isServerEscalated(route)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — POSITIVE: D-6, closed by construction
// ---------------------------------------------------------------------------

describe("Trigger 3 §2 — scrml:store escalates (D-6)", () => {
  test("`scrml:store` is in the escalation set", () => {
    expect(ESCALATION_SERVER_ONLY_MODULES.has("scrml:store")).toBe(true);
  });

  test("a fn calling `createStore` escalates, so `bun:sqlite` cannot reach client", () => {
    const fileAST = parseFileAST(programCalling("scrml:store", "createStore"));
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    expect(isServerEscalated(route)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3 — GUARD: scrml:data must NOT escalate (the 72-site class)
// ---------------------------------------------------------------------------

describe("Trigger 3 §3 — scrml:data stays CLIENT", () => {
  test("`scrml:data` is NOT in the escalation set", () => {
    expect(ESCALATION_SERVER_ONLY_MODULES.has("scrml:data")).toBe(false);
  });

  test("a fn calling `sortBy` does NOT escalate", () => {
    const fileAST = parseFileAST(programCalling("scrml:data", "sortBy", "sortBy([], 'k')"));
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    expect(isServerEscalated(route)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §4 — GUARD: the other two client-safe removals
// ---------------------------------------------------------------------------

describe("Trigger 3 §4 — http stays CLIENT", () => {
  test("`scrml:http` does NOT escalate (fetch is browser-native)", () => {
    expect(ESCALATION_SERVER_ONLY_MODULES.has("scrml:http")).toBe(false);
    const fileAST = parseFileAST(programCalling("scrml:http", "get", "get('/x')"));
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    expect(isServerEscalated(route)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §5 — ALIASING: the binding map keys on the LOCAL name
// ---------------------------------------------------------------------------

describe("Trigger 3 §5 — `as` aliasing", () => {
  test("`import { hashPassword as hp }` + `hp()` escalates", () => {
    const source = `<program>
  <page>
    \${
        import { hashPassword as hp } from 'scrml:auth'
        function useIt() {
            return hp("x")
        }
    }
    <button onclick=useIt()>Go</button>
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    // Keying on the AST's `names` (the IMPORTED name) instead of
    // `specifiers[].local` would MISS this — a silent client leak.
    expect(isServerEscalated(route)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §6 — GUARD: import without use does not escalate
// ---------------------------------------------------------------------------

describe("Trigger 3 §6 — import alone is not a trigger", () => {
  test("importing `scrml:auth` but never calling it leaves the fn client", () => {
    const source = `<program>
  <page>
    \${
        import { hashPassword } from 'scrml:auth'
        <n> = 0
        function useIt() {
            return 1 + 1
        }
    }
    <button onclick=useIt()>Go</button>
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    expect(isServerEscalated(route)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §8 — EVASION: the four shapes the S299 adversarial review proved leaked
//
// The first cut of this trigger matched CALLS in `callees`, which is built by
// `forEachCallInExprNode` — and that walker returns at `case "lambda"` and cannot
// see into a block-body closure at all. Each shape below compiled exit 0 with NO
// `.server.js`, the secret in the client bundle and a real `Bun.password.hash`
// argon2id implementation in the browser runtime. These are regression pins on a
// confidentiality boundary: a failure here is a secret shipped to a browser.
// ---------------------------------------------------------------------------

describe("Trigger 3 §8 — evasion shapes (S299 adversarial review)", () => {
  function escalatesFor(bodyStmts, mod = "scrml:auth", binding = "hashPassword") {
    const source = `<program>
  <page>
    \${
        import { ${binding} } from '${mod}'
        <out> = ""
        function useIt() {
${bodyStmts}
        }
    }
    <button onclick=useIt()>Go</button>
    <p>\${@out}</p>
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    return isServerEscalated(route);
  }

  test("a call inside a LAMBDA body escalates (`.map(p => hashPassword(p))`)", () => {
    expect(escalatesFor(`            let all = ["P"].map(p => hashPassword(p))
            return all[0]`)).toBe(true);
  });

  test("a call inside a NESTED function declaration escalates", () => {
    expect(escalatesFor(`            function inner(p) { return hashPassword(p) }
            return inner("P")`)).toBe(true);
  });

  test("a BARE callback reference escalates (no call node at all)", () => {
    expect(escalatesFor(`            return ["P"].map(hashPassword)`)).toBe(true);
  });

  test("an INDIRECT alias of a sync binding escalates (`let f = join`)", () => {
    expect(escalatesFor(`            let f = join
            return f("a", "b")`, "scrml:path", "join")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §9 — scrml:oauth is server-only by the CREDENTIAL limb, not host reach
//
// oauth has ZERO Bun./process./node: reaches and was wrongly cleared as
// client-safe by a host-reach-only criterion. It transmits `client_secret` in the
// token-exchange body and its own module header reads "SERVER-SIDE ONLY".
// ---------------------------------------------------------------------------

describe("Trigger 3 §9 — scrml:oauth (credential limb)", () => {
  test("`scrml:oauth` IS in the escalation set", () => {
    expect(ESCALATION_SERVER_ONLY_MODULES.has("scrml:oauth")).toBe(true);
  });

  test("a fn building a github config with a client secret escalates", () => {
    const fileAST = parseFileAST(
      programCalling("scrml:oauth", "githubConfig", 'githubConfig("id", "SECRET", "/cb")'),
    );
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    expect(isServerEscalated(route)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §10 — OVER-FIRE guard: a function-level shadow of an imported name
//
// The binding map is file-scoped. A parameter or body-local named after an
// import cannot refer to that import anywhere in the function, so it must NOT
// escalate. Before the fix this relocated the function to the server and its
// fetch stub JSON-serialized a callback argument, silently dropping it.
//
// NB `FunctionDeclNode.params` is TYPED `string[]` but the builder emits
// `[{name}]`; the first cut of the shadow check compared against objects and
// silently never matched. This test is what catches that regression.
// ---------------------------------------------------------------------------

describe("Trigger 3 §10 — shadowing must not over-fire", () => {
  test("a PARAMETER shadowing an imported name does not escalate its function", () => {
    const source = `<program>
  <page>
    \${
        import { hashPassword } from 'scrml:auth'
        <out> = ""
        function applyIt(hashPassword, v) {
            return hashPassword(v)
        }
        function realUse(p) {
            return hashPassword(p)
        }
    }
    <button onclick=applyIt()>Go</button>
    <p>\${@out}</p>
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const routeMap = runRIClean(fileAST);
    // shadowed → client
    expect(isServerEscalated(routeForFn(routeMap, "applyIt", fileAST))).toBe(false);
    // genuine use in the same file → still escalates
    expect(isServerEscalated(routeForFn(routeMap, "realUse", fileAST))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §7 — SHAPE: reason kind is `server-only-resource` carrying the module
// ---------------------------------------------------------------------------

describe("Trigger 3 §7 — reason shape", () => {
  test("reason is `server-only-resource` with the module as resourceType", () => {
    const fileAST = parseFileAST(programCalling("scrml:auth", "hashPassword"));
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    const hit = (route?.escalationReasons ?? []).find(
      (r) => r.kind === "server-only-resource" && r.resourceType === "scrml:auth",
    );
    // NOT a fresh reason kind: `emit-server.ts isBodyOnlyEscalation` (§12.6
    // library mode) gates on EVERY reason being `server-only-resource`, and its
    // docstring names this exact shape. A new kind would fail that `.every()`
    // and silently re-attach an HTTP wrapper §12.6 says to drop.
    expect(hit).toBeDefined();
  });

  test("one reason per MODULE, not per call site", () => {
    const source = `<program>
  <page>
    \${
        import { hashPassword, verifyPassword } from 'scrml:auth'
        function useIt() {
            hashPassword("a")
            return verifyPassword("b", "c")
        }
    }
    <button onclick=useIt()>Go</button>
  </>
</program>`;
    const fileAST = parseFileAST(source);
    const route = routeForFn(runRIClean(fileAST), "useIt", fileAST);
    const authReasons = (route?.escalationReasons ?? []).filter(
      (r) => r.kind === "server-only-resource" && r.resourceType === "scrml:auth",
    );
    expect(authReasons.length).toBe(1);
  });
});
