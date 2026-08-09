/**
 * §6.6.19 / §12.2 Trigger 3 — E-DERIVED-SERVER-ONLY-REACH.
 *
 * A `const <name>` DERIVED cell whose RHS reaches a binding imported from an
 * `ESCALATION_SERVER_ONLY_MODULES` module is REFUSED, not escalated.
 *
 * WHY THIS EXISTS. S299 closed §12.2 Trigger 3 for the per-FUNCTION path. The
 * derived position stayed open, because §12.4's "Route inference SHALL be
 * per-function" is honoured literally by `collectFileFunctions` (it yields
 * `function-decl` nodes only) and a derived cell is a `state-decl`. Measured at
 * S331 on the shipped compiler: the reproducer compiled at **exit 0** with NO
 * `.server.js` at all, `const { hashPassword } = _scrml_stdlib.auth;` in the client
 * bundle, and **4** occurrences of `Bun.password` in the shipped runtime (a control
 * program not importing `scrml:auth` has 0).
 *
 * WHY REFUSE RATHER THAN ESCALATE. A derived cell is a SYNCHRONOUS reactive
 * recompute (§6.6 — pull on read via the dirty flag). Escalating its RHS makes the
 * recompute a network round trip, i.e. asynchronous, which the derived model has no
 * way to express. Refusing is also the reversible direction: newly-rejecting can be
 * relaxed if the language later admits server work in the derived position;
 * accepting-and-escalating is a one-way door.
 *
 * Test map:
 *   §1  POSITIVE  — direct call in a derived RHS fires the code.
 *   §2  EVASION   — lambda body, bare callback reference, `match`-arm block body,
 *                   and an unparseable (`escape-hatch`) RHS all fire. Each of these
 *                   was a measured S299 evasion of the function-path walk.
 *   §3  GUARD     — a client-safe stdlib member in a derived RHS does NOT fire.
 *   §4  GUARD     — the plain-`function` path still ESCALATES and does not fire the
 *                   derived code. This is the non-regression gate for S299.
 *   §5  GUARD     — a MUTABLE cell's initialiser is not a derived RHS and does not
 *                   fire (only `const <name>` — §6.6 shape 3 — is in scope).
 *   §6  GUARD     — importing without reaching it from the derived RHS does not fire.
 *   §7  SHADOW    — an RHS-local binding that shadows the imported name does not fire.
 *   §8  MESSAGE   — the message names the cell, the member, and the module, and
 *                   states the fix (§34 requires all four).
 */

import { describe, test, expect } from "bun:test";
import { runRI } from "../../src/route-inference.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const CODE = "E-DERIVED-SERVER-ONLY-REACH";

function parseFileAST(source, filePath = "/test/derived-reach.scrml") {
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

function runRIOn(source) {
  const fileAST = parseFileAST(source);
  const out = runRI({ files: [fileAST], protectAnalysis: { views: new Map() } });
  return { out, fileAST };
}

function errorsWithCode(out, code) {
  return (out.errors ?? []).filter((e) => e && e.code === code);
}

/** A `<program>` importing `binding` from `mod` and using it in a DERIVED RHS. */
function programDeriving(mod, binding, rhs) {
  return `<program>
\${
    import { ${binding} } from '${mod}'
}

<pw> = "secret"

const <computed> = ${rhs}

<div>\${@computed}</div>

</program>`;
}

function isServerEscalated(route) {
  return route !== undefined && Array.isArray(route.escalationReasons)
    && route.escalationReasons.length > 0;
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

// ---------------------------------------------------------------------------
// §1 — POSITIVE
// ---------------------------------------------------------------------------

describe(`${CODE} §1 — a derived RHS reaching a server-only member is refused`, () => {
  test("direct call in the derived RHS fires the code as an error", () => {
    const { out } = runRIOn(programDeriving("scrml:auth", "hashPassword", "hashPassword(@pw)"));
    const hits = errorsWithCode(out, CODE);
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe("error");
  });

  test("a submodule import (`scrml:auth/jwt`) fires identically", () => {
    const { out } = runRIOn(programDeriving("scrml:auth/jwt", "signJwt", "signJwt(@pw)"));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("the CREDENTIAL limb (`scrml:oauth`, zero host reach) fires too", () => {
    const { out } = runRIOn(programDeriving("scrml:oauth", "exchangeCode", "exchangeCode(@pw)"));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §2 — EVASION: each of these evaded the function-path walk before S299
// ---------------------------------------------------------------------------

describe(`${CODE} §2 — indirect reaches are not an escape hatch`, () => {
  test("inside a lambda body", () => {
    const { out } = runRIOn(
      programDeriving("scrml:auth", "hashPassword", "[@pw].map(p => hashPassword(p))"),
    );
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("as a bare callback REFERENCE, never called in the RHS", () => {
    const { out } = runRIOn(
      programDeriving("scrml:auth", "hashPassword", "[@pw].map(hashPassword)"),
    );
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("inside a `match`-arm BLOCK body (the S331 reproducer shape)", () => {
    const source = `<program>

type Phase:enum = { Idle, Busy }
<phase>: Phase = .Idle
<pw> = "secret"

\${ import { hashPassword } from 'scrml:auth' }

const <derivedServerCall> = match @phase {
    .Idle :> { const h = hashPassword(@pw); h }
    .Busy :> "busy"
}

<div>\${@derivedServerCall}</div>

</program>`;
    const { out } = runRIOn(source);
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("inside an RHS that does not structurally parse (an `escape-hatch`)", () => {
    const { out } = runRIOn(
      programDeriving("scrml:auth", "hashPassword", 'if @pw { hashPassword(@pw) } else { "x" }'),
    );
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §3 — GUARD: a client-safe module in a derived RHS is untouched
// ---------------------------------------------------------------------------

describe(`${CODE} §3 — client-safe stdlib members still compile in a derived RHS`, () => {
  test("`scrml:data` (the 72-site class) does NOT fire", () => {
    const { out } = runRIOn(programDeriving("scrml:data", "sortBy", "sortBy([], 'k')"));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("`scrml:http` does NOT fire (fetch is browser-native)", () => {
    const { out } = runRIOn(programDeriving("scrml:http", "get", "get('/x')"));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §4 — GUARD (non-regression): the plain-`function` path still ESCALATES
// ---------------------------------------------------------------------------

describe(`${CODE} §4 — the S299 function path is unchanged`, () => {
  const source = `<program>

<pw> = "secret"
<out> = ""

\${ import { hashPassword } from 'scrml:auth' }

\${ function computeServerCall(pw) {
    return hashPassword(pw)
} }

<div onclick={ @out = computeServerCall(@pw) }>\${@out}</div>

</program>`;

  test("the function still server-escalates", () => {
    const { out, fileAST } = runRIOn(source);
    const route = routeForFn(out.routeMap, "computeServerCall", fileAST);
    expect(isServerEscalated(route)).toBe(true);
  });

  test("and the derived code does NOT fire on it (no derived cell involved)", () => {
    const { out } = runRIOn(source);
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §5 — SCOPE PIN: this code covers the `const <name>` derived RHS and nothing
//      else. READ THE WARNING BELOW BEFORE TREATING THIS AS A SAFETY ASSERTION.
// ---------------------------------------------------------------------------

describe(`${CODE} §5 — scope is the derived RHS (adjacent positions are NOT closed)`, () => {
  /**
   * !! THIS IS A SCOPE PIN, NOT A SAFETY CLAIM. !!
   *
   * A MUTABLE cell initialiser reaching the same server-only member LEAKS TODAY,
   * measured at S331 exactly as the derived case was:
   *
   *     <hashed> = hashPassword(@pw)
   *
   * compiles at exit 0, emits NO `.server.js`, binds
   * `const { hashPassword } = _scrml_stdlib.auth;` in the client bundle, and puts
   * **4** occurrences of `Bun.password` in the shipped runtime. A bare markup
   * interpolation (`<div>${hashPassword(@pw)}</div>`) leaks identically.
   *
   * Both are the SAME defect class in adjacent positions and are deliberately NOT
   * closed here: the S331 brief scoped this dispatch to the derived RHS, and the
   * refusal rationale does not transfer unexamined (a derived recompute is
   * synchronous and so CANNOT be escalated; a one-shot initialiser might legitimately
   * be escalatable, which is an operator question, not this fix's to answer).
   *
   * So this test asserts only that the DERIVED code is derived-scoped. It does NOT
   * assert that the mutable-initialiser shape is safe — it is not. If the sibling
   * position is closed later, this expectation is expected to change, and the
   * replacement should assert the sibling's own code, never `0` again.
   *
   * Filed: `g-cell-initialiser-and-markup-interp-server-only-reach-do-not-escalate`.
   */
  test("`<cell> = hashPassword(...)` does not fire the DERIVED code (sibling leak still open)", () => {
    const source = `<program>

\${ import { hashPassword } from 'scrml:auth' }

<pw> = "secret"
<hashed> = hashPassword(@pw)

<div>\${@hashed}</div>

</program>`;
    const { out } = runRIOn(source);
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §6 — GUARD: import without reach
// ---------------------------------------------------------------------------

describe(`${CODE} §6 — importing without reaching it from the derived RHS`, () => {
  test("a derived cell that never names the import does NOT fire", () => {
    const source = `<program>

\${ import { hashPassword } from 'scrml:auth' }

<items> = []
const <count> = @items.length

<div>\${@count}</div>

</program>`;
    const { out } = runRIOn(source);
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("a STRING LITERAL naming the import is not a reference", () => {
    const source = `<program>

\${ import { hashPassword } from 'scrml:auth' }

<flag> = false
const <label> = "call hashPassword on the server"

<div>\${@label}</div>

</program>`;
    const { out } = runRIOn(source);
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §7 — SHADOW: an RHS-local binding of the same name is not the import
// ---------------------------------------------------------------------------

describe(`${CODE} §7 — RHS-local shadowing`, () => {
  test("a `const` local shadowing the imported name does NOT fire", () => {
    const source = `<program>

type Phase:enum = { Idle, Busy }
<phase>: Phase = .Idle

\${ import { hashPassword } from 'scrml:auth' }

const <shadowed> = match @phase {
    .Idle :> { const hashPassword = (x) => x; hashPassword("local") }
    .Busy :> "busy"
}

<div>\${@shadowed}</div>

</program>`;
    const { out } = runRIOn(source);
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §8 — MESSAGE: §34 requires the cell, the member, the module, and the fix
// ---------------------------------------------------------------------------

describe(`${CODE} §8 — message content`, () => {
  test("names the derived cell, the member, the module, and the fix", () => {
    const { out } = runRIOn(programDeriving("scrml:auth", "hashPassword", "hashPassword(@pw)"));
    const msg = errorsWithCode(out, CODE)[0].message;
    expect(msg).toContain("<computed>");        // the derived cell
    expect(msg).toContain("hashPassword");      // the offending member
    expect(msg).toContain("scrml:auth");        // the module
    expect(msg).toContain("`function`");        // the fix — move it into a function
    expect(msg).toContain("plain reactive cell");
    expect(msg).toContain("§6.6.19");
    expect(msg).toContain("§12.2");
  });

  /**
   * THE PERVERSE-PATH CLAUSE — this is a SECURITY assertion, not a wording preference.
   *
   * The single-keystroke edit `const <h> = hashPassword(@pw)` -> `<h> = hashPassword(@pw)`
   * makes this error stop and silently RESTORES the leak: measured, the mutable-initialiser
   * form compiles at exit 0 with 4 occurrences of `Bun.password` in the shipped runtime
   * (§5's scope pin above). An adopter skimming for the smallest edit that clears the red
   * text will find exactly that one.
   *
   * A security diagnostic whose fastest workaround reopens the vulnerability is worse on
   * that axis than no diagnostic, because it manufactures traffic into the hole. The message
   * must therefore refuse the workaround EXPLICITLY, and that clause must not be able to
   * regress out silently — hence this test.
   *
   * When the sibling position is closed (`g-cell-initialiser-and-markup-interp-server-only-
   * reach-do-not-escalate`), this clause becomes stale and SHOULD be rewritten to point at
   * the sibling's own code — it must not simply be deleted.
   */
  test("REFUSES the perverse path: says deleting `const` is not a fix", () => {
    const { out } = runRIOn(programDeriving("scrml:auth", "hashPassword", "hashPassword(@pw)"));
    const msg = errorsWithCode(out, CODE)[0].message;
    expect(msg).toContain("Do NOT just delete `const`");
    expect(msg).toContain("NOT yet diagnosed");
    expect(msg).toContain("restores the leak");
  });
});
