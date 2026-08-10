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
 *   §9  POSITION  — the SAME cell in eleven different POSITIONS in the tree. Added
 *                   S337; see the block comment above §9 for why §1-§8 shipped a leak.
 *   §10 WALK      — the collector's structural walk: termination on a cycle, no
 *                   double-count on a shared subtree, and the skip-list is honoured.
 */

import { describe, test, expect } from "bun:test";
import { runRI, collectDerivedCellDecls } from "../../src/route-inference.js";
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

// ---------------------------------------------------------------------------
// §9 — POSITION: the axis §1-§8 never varied, and the reason a green suite
//      shipped a live confidentiality leak.
// ---------------------------------------------------------------------------

/**
 * WHY THIS SECTION EXISTS — read before adding a case above instead of here.
 *
 * Every one of §1-§8 places the derived cell at TOP LEVEL. §2 is titled EVASION and
 * does explore depth, but only depth WITHIN THE RHS (lambda body, bare callback
 * reference, `match`-arm block, unparseable RHS). Not one test varied where the CELL
 * ITSELF sits in the tree — and that was the uncovered axis. `collectDerivedCellDecls`
 * descended exactly `node.body` and `node.children`; a `for`-loop parks its `lift`
 * body under an `expr` wrapper, so the cell at
 *
 *     …expr.node.children[0].body[0]
 *
 * was never visited, never checked, and never diagnosed. Measured at S337 on the
 * shipped compiler, the reproducer at the head of this file moved into a `for`-loop
 * `lift` body compiled at exit 0 with ZERO `.server.js`,
 * `const { hashPassword } = _scrml_stdlib.auth;` in the client bundle,
 * `Bun.password.hash(password, { algorithm: "argon2id" })` in `_scrml/auth.js`, and
 * `_scrml_cs_reactive_set("pw", "secret")` inlining the caller's secret.
 *
 * §6.6.19's SHALL is not qualified by position. A test suite that fixes the position
 * cannot see a position bug, so the fixture below varies the position and holds the
 * cell constant — the exact inverse of §2.
 *
 * SIX of these eleven positions were measured NOT firing before the S337 fix:
 * `for`-loop `lift` body, `while`-loop `lift` body, `<each>` row body, `<engine>`
 * state-child body, loop-inside-conditional, and the `kind="tool"` nested case (where
 * what must hold is the carve-out, not the fire).
 *
 * TWO positions are deliberately absent because they are not AST positions at all:
 *   - A `<match>` MARKUP arm keeps its body as raw text (`match-block.armsRaw`), so no
 *     walk of any kind can see into it. Independently, `${ const <h> = … }` inside an
 *     arm does not parse — the arm closer-scanner reads the `<h>` as an open tag and
 *     fires `E-MATCH-PARSE-001`. (The `match` EXPRESSION arm — a `matchExpr` in the
 *     RHS — is a different thing and is covered by §2.)
 *   - A COMPONENT body is `component-def.raw` at build-AST time, but Stage 3.2 CE
 *     inlines it into the consuming markup before `runRI` runs, so the full pipeline
 *     already reached it before this fix. The `runRI`-only harness here cannot see it;
 *     it is pinned end-to-end by the conformance case instead.
 */
describe(`${CODE} §9 — POSITION: a derived cell is checked wherever it sits`, () => {
  const IMPORT = `\${ import { hashPassword } from 'scrml:auth' }`;

  test("in a `for`-loop `lift` body (the reported leak)", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
<items> = [1, 2]
<div>\${ for (let it of @items) { lift <div>\${ const <h> = hashPassword(@pw) }<span>\${@h}</span></div> } }</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("in a `while`-loop `lift` body", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
<n> = 0
<div>\${ while (@n < 1) { lift <div>\${ const <h> = hashPassword(@pw) }<span>\${@h}</span></div> } }</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("in an `if=`-gated subtree", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
<ok> = true
<div if=@ok>\${ const <h> = hashPassword(@pw) }<span>\${@h}</span></div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("in an `<each>` row-template body", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
<items> = [1, 2]
<each in=@items as it>
    <div>\${ const <h> = hashPassword(@pw) }<span>\${@h}</span></div>
</each>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("in an `<engine>` state-child body", () => {
    const source = `\${
    type FetchPhase:enum = { Idle, Loading }
    import { hashPassword } from 'scrml:auth'
    <pw> = "secret"
}
<engine for=FetchPhase initial=.Idle>
    <Idle rule=.Loading>
        <onTransition to=.Loading>\${ const <h> = hashPassword(@pw) }</>
    </>
    <Loading rule=.Idle></>
</>
<program>
<div>hi</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("two deep — a loop inside a conditional", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
<ok> = true
<items> = [1, 2]
<div if=@ok>\${ for (let it of @items) { lift <div>\${ const <h> = hashPassword(@pw) }<span>\${@h}</span></div> } }</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  /**
   * ⚠ THIS PINS A KNOWN FALSE POSITIVE — it asserts CURRENT behaviour, NOT desired behaviour.
   *
   * A derived cell inside an explicitly `server`-annotated function body fires the error, but that
   * body never reaches the browser, so there is no confidentiality leak to refuse — and the message
   * tells the adopter to "move the call into a function", which is exactly where it already is.
   *
   * PRE-EXISTING, not introduced by the S337 structural walk: the old body/children walk reached
   * function bodies too, and collected the same cell. Recorded here rather than silently ratified,
   * because a test that pins a false positive makes it harder to fix later (S337 review).
   * Filed for triage: the fix is a server-placement carve-out in Step 3b, mirroring the
   * kind="tool" carve-out §6.6.19 already takes.
   */
  test("in a `function` body", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
\${ function go() { const <h> = hashPassword(@pw) } }
<div>hi</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("in a `given` block body", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
<ok> = true
\${ given @ok { const <h> = hashPassword(@pw) } }
<div>hi</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("inside a nested `<template>` subtree", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
<div>
  <template>
    \${ const <h> = hashPassword(@pw) }
    <span>\${@h}</span>
  </template>
</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  /**
   * §64 CARVE-OUT, NESTED. `isToolProgram` reads the TOP-LEVEL `<program>`'s `kind=`
   * attribute, so it is depth-independent by construction — but "by construction" is
   * exactly the kind of claim that stops being true when a walk is widened, and the
   * widening is what this section is here for. A tool has no client boundary, so a
   * server-only module in one is not a leak and refusing would reject valid code.
   *
   * The fixture is not otherwise a legal tool program (a tool hosts no markup and no
   * reactive cells — §64.4 fires E-TOOL-003 for both downstream). That is deliberate
   * and harmless: this test asserts only that RI's derived check stays silent, which
   * is the property the carve-out owns.
   */
  test("NEGATIVE — a `kind=\"tool\"` program does NOT fire, nested or not", () => {
    const source = `<program kind="tool">
${IMPORT}
<pw> = "secret"
<items> = [1, 2]
\${ function main() { print("x") } }
<div>\${ for (let it of @items) { lift <div>\${ const <h> = hashPassword(@pw) }<span>\${@h}</span></div> } }</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(0);
  });

  test("NEGATIVE — a client-safe module in the SAME nested position does not fire", () => {
    const source = `<program>
\${ import { round } from 'scrml:math' }
<pw> = 1.5
<items> = [1, 2]
<div>\${ for (let it of @items) { lift <div>\${ const <h> = round(@pw) }<span>\${@h}</span></div> } }</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(0);
  });

  /**
   * §12.4 / §6.6.19 — the name appears ONLY inside a string literal, so there is no
   * reach. §6 pins this at top level; nesting must not turn an inert string into a
   * reference (the fail-OPEN direction of a widened walk would be to start matching
   * raw source text).
   */
  test("NEGATIVE — a string literal naming the import stays inert when nested", () => {
    const source = `<program>
${IMPORT}
<pw> = "secret"
<items> = [1, 2]
<div>\${ for (let it of @items) { lift <div>\${ const <h> = "call hashPassword here" }<span>\${@h}</span></div> } }</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(0);
  });

  /**
   * §6.6.19 shadowing, nested. §7 pins the top-level case with an RHS-local `const`
   * binding of the same name. The pair below asserts the property that matters — that
   * POSITION DOES NOT CHANGE THE SHADOW ANSWER — in both directions:
   *
   *   - an RHS-local `const` shadow does NOT fire, nested exactly as at top level;
   *   - a LAMBDA PARAMETER of the same name DOES fire, nested exactly as at top level,
   *     because `collectDerivedRhsLocalNames` stops at a nested binder on purpose
   *     ("erring narrow here is the fail-closed direction" — a too-wide shadow set is
   *     a MISS, i.e. a leak; a too-narrow one is a visible over-fire).
   *
   * The second half is a CONTROL, not an aspiration. If someone later widens the
   * shadow set to cover lambda params, both halves must move together — a nested-only
   * change would mean position had started to matter again.
   */
  test("NEGATIVE — an RHS-local `const` shadow still suppresses when nested", () => {
    const source = `<program>
\${
    type Phase:enum = { Idle, Busy }
    import { hashPassword } from 'scrml:auth'
    <phase>: Phase = .Idle
}
<items> = [1, 2]
<div>\${ for (let it of @items) { lift <div>\${ const <h> = match @phase { .Idle :> { const hashPassword = (x) => x; hashPassword("local") } .Busy :> "busy" } }<span>\${@h}</span></div> } }</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(0);
  });

  test("a LAMBDA-PARAM shadow fires identically at top level and nested", () => {
    const topLevel = `<program>
${IMPORT}
<pw> = "secret"
const <h> = ((hashPassword) => hashPassword(@pw))((s) => s)
<div><span>\${@h}</span></div>
</program>`;
    const nested = `<program>
${IMPORT}
<pw> = "secret"
<items> = [1, 2]
<div>\${ for (let it of @items) { lift <div>\${ const <h> = ((hashPassword) => hashPassword(@pw))((s) => s) }<span>\${@h}</span></div> } }</div>
</program>`;
    const atTop = errorsWithCode(runRIOn(topLevel).out, CODE).length;
    const atDepth = errorsWithCode(runRIOn(nested).out, CODE).length;
    expect(atTop).toBe(1);
    expect(atDepth).toBe(atTop);
  });
});

// ---------------------------------------------------------------------------
// §10 — WALK: the collector's structural walk, exercised directly on synthetic
//       ASTs that a parser cannot produce.
// ---------------------------------------------------------------------------

/**
 * These drive `collectDerivedCellDecls` DIRECTLY rather than through `runRI`, because
 * the properties under test — termination, identity, the skip-list — are properties of
 * THIS walk, and `runRI` runs several others over the same tree.
 *
 * That is not a convenience; it is a measured requirement. A synthetic cyclic AST fed
 * to `runRI` dies with `RangeError: Maximum call stack size exceeded` inside
 * `collectFileLevelBindingRoots` (`route-inference.ts:2600`), a pre-existing walk that
 * descends every property with no `seen` set at all — so a cycle test routed through
 * `runRI` would fail for a reason that has nothing to do with this collector. Filed as
 * a separate finding; not fixed here.
 *
 * The fixtures are shapes the parser does not emit. That is deliberate: the walk
 * descends EVERY array- and object-valued property by default, so it must survive node
 * shapes nothing produces today — which is the entire reason it is not a field list.
 */
describe(`${CODE} §10 — structural walk: termination, identity, skip-list`, () => {
  /** A `const <name> = hashPassword(@pw)` derived cell, as a bare AST node. */
  function derivedCellNode(name) {
    return {
      kind: "state-decl",
      shape: "derived",
      name,
      init: "hashPassword(@pw)",
      initExpr: {
        kind: "call",
        callee: { kind: "ident", name: "hashPassword" },
        args: [{ kind: "ident", name: "pw" }],
        span: { start: 0, end: 1 },
      },
      span: { start: 0, end: 1 },
    };
  }

  const collect = (nodes) => collectDerivedCellDecls({ filePath: "/test/synthetic.scrml", nodes });
  const namesOf = (nodes) => collect(nodes).map((n) => n.name);

  test("the harness is not vacuous — a bare derived cell is collected", () => {
    expect(namesOf([derivedCellNode("h")])).toEqual(["h"]);
  });

  /**
   * TERMINATION. A back-edge must not hang the compiler. `seen` is an identity set
   * over every visited object — not only over nodes reached through an array — so the
   * second arrival at `outer` returns immediately.
   */
  test("a CYCLE in the AST terminates and still finds the cell exactly once", () => {
    const outer = { kind: "markup", tag: "div", children: [derivedCellNode("h")] };
    // The back-edge sits under a key that is NOT skip-listed, so the walk really does
    // traverse it — putting it under `parent` would prove nothing about cycles.
    outer.children.push({ kind: "markup", tag: "span", backEdge: outer, children: [] });
    expect(namesOf([outer])).toEqual(["h"]);
  });

  test("a SELF-referential node terminates", () => {
    const node = { kind: "markup", tag: "div", children: [derivedCellNode("h")] };
    node.self = node;
    expect(namesOf([node])).toEqual(["h"]);
  });

  test("a shared ARRAY reached twice terminates and does not duplicate", () => {
    const shared = [derivedCellNode("h")];
    expect(namesOf([{ kind: "markup", tag: "div", children: shared, body: shared }])).toEqual(["h"]);
  });

  /**
   * NO DOUBLE-COUNTING. One cell OBJECT reachable by two paths is one cell, so it
   * yields one diagnostic. Without the identity set the same leak is reported twice
   * and an adopter who fixes it once still sees an error.
   */
  test("a cell reachable by TWO paths is collected exactly once", () => {
    const cell = derivedCellNode("h");
    expect(namesOf([
      { kind: "markup", tag: "div", children: [cell] },
      { kind: "markup", tag: "section", body: [cell] },
    ])).toEqual(["h"]);
  });

  test("two DISTINCT cells are both collected (the identity set is not over-deduping)", () => {
    expect(namesOf([
      { kind: "markup", tag: "div", children: [derivedCellNode("a")] },
      { kind: "markup", tag: "section", children: [derivedCellNode("b")] },
    ])).toEqual(["a", "b"]);
  });

  test("collection is in DOCUMENT order (diagnostics come out in source order)", () => {
    expect(namesOf([
      { kind: "markup", tag: "div", children: [derivedCellNode("first")] },
      { kind: "markup", tag: "div", someWrapper: { node: { body: [derivedCellNode("second")] } } },
      { kind: "markup", tag: "div", body: [derivedCellNode("third")] },
    ])).toEqual(["first", "second", "third"]);
  });

  /**
   * SKIP-LIST. `span`/`spans`/`parent`/`loc`/`_scope`/`_record` carry no AST node.
   * Not descending them is what keeps the walk off back-references and off non-plain
   * containers; this pins the behaviour so an edit to the skip-list has to face a red
   * test rather than change traversal silently.
   */
  test("the walk DOES descend `parent` — it is not a skip key (S337 review)", () => {
    // Was asserted the other way, and that assertion PINNED A FAIL-OPEN MISS as correct.
    // `parent` is not a node field at RI time (it appears only as a function parameter, and only
    // in post-RI codegen), so skipping it bought nothing — but the day a node kind adopts it for a
    // child-bearing field, a derived cell underneath would be silently missed and this test would
    // have called that correct. Descending is the safe direction for a confidentiality check: the
    // worst case is a loud, reversible spurious refusal, not a silent leak.
    expect(namesOf([{
      kind: "markup",
      tag: "div",
      children: [],
      parent: { kind: "markup", tag: "root", children: [derivedCellNode("found")] },
    }])).toEqual(["found"]);
  });

  test("only `span` and `_`-prefixed keys are skipped; everything else is descended", () => {
    // The skip set is now the codebase's own convention (`protect-analyzer.ts`,
    // `tag-canonicalizer.ts`, `indirect-callee-resolver.ts` all use the `_` prefix), not a
    // hardcoded list. Measured over the tracked corpus: this set, the old six-entry list, and NO
    // skip set at all all collect the SAME 68 cells — nothing here is load-bearing for the result.
    for (const key of ["span", "_scope", "_record", "_anythingElse"]) {
      const node = { kind: "markup", tag: "div", children: [] };
      node[key] = { kind: "markup", tag: "root", children: [derivedCellNode("hidden")] };
      expect(namesOf([node])).toEqual([]);
    }
    for (const key of ["parent", "loc", "expr", "attrs", "somethingNew"]) {
      const node = { kind: "markup", tag: "div", children: [] };
      node[key] = { kind: "markup", tag: "root", children: [derivedCellNode("found")] };
      expect(namesOf([node])).toEqual(["found"]);
    }
  });

  /**
   * A `Map`-valued property (the shape `spans` has) must not derail the walk. Note this
   * asserts SURVIVAL, not reach: a `Map`'s entries are invisible to `Object.keys`, so a
   * node parked in one is unreachable by design. No AST in the parsed corpus stores a
   * node that way (1363 files probed, zero non-plain constructors inside `nodes`).
   */
  test("a Map-valued property does not derail the walk", () => {
    expect(namesOf([{
      kind: "markup",
      tag: "div",
      spans: new Map([["a", { start: 0, end: 1 }]]),
      sideTable: new Map([["b", derivedCellNode("unreachable-by-design")]]),
      children: [derivedCellNode("h")],
    }])).toEqual(["h"]);
  });

  /**
   * THE REGRESSION GATE FOR THE DEFECT CLASS ITSELF. The pre-S337 walk descended a
   * hardcoded `body`/`children` pair, which is why a `for`-loop `lift` body
   * (`…expr.node.children[0].body[0]`) leaked. This fixture parks the cell under a
   * property name that does not exist anywhere in the compiler, so it can only pass if
   * the walk is genuinely structural. If someone reintroduces a field list, this fails.
   */
  test("a cell under an UNENUMERATED property name is still found", () => {
    expect(namesOf([{
      kind: "markup",
      tag: "div",
      someFutureNodeShape: { kind: "wrapper", node: { children: [derivedCellNode("h")] } },
    }])).toEqual(["h"]);
  });

  test("the exact `expr.node.children[].body[]` shape the `for`-loop `lift` produces", () => {
    expect(namesOf([{
      kind: "markup",
      tag: "div",
      children: [{
        kind: "logic",
        body: [{
          kind: "for-stmt",
          body: [{ kind: "lift", expr: { node: { children: [{ kind: "logic", body: [derivedCellNode("h")] }] } } }],
        }],
      }],
    }])).toEqual(["h"]);
  });

  test("reads `fileAST.ast.nodes` when `fileAST.nodes` is absent", () => {
    const out = collectDerivedCellDecls({
      filePath: "/test/synthetic.scrml",
      ast: { nodes: [{ kind: "markup", tag: "div", children: [derivedCellNode("h")] }] },
    });
    expect(out.map((n) => n.name)).toEqual(["h"]);
  });
});
