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

describe(`${CODE} §7 — RHS-local shadowing (DIRECT limb only, since round 4)`, () => {
  // ROUND 4: this suppression is now LIMB (a)'s alone. The transitive limb
  // passes `shadow: "none"` and fires on every reference (§11l), because codegen
  // renames server-FN references scope-blind — an RI suppression there silently
  // miscompiled. Limb (a) keeps the suppression: codegen does NOT rename
  // server-only IMPORT references, so the emitted CALL does resolve to the local
  // binder.
  //
  // !! THIS PIN ASSERTS THE DIAGNOSTIC, AND NOTHING ABOUT THE ARTIFACTS. !!
  //
  // Round 4 additionally claimed here that "RI's suppression agrees with what
  // actually runs". ROUND 5 STRUCK THAT: measured on THIS FILE'S OWN SOURCE,
  // compiled end to end, the exit-0 build emits NO `.server.js`, writes
  // `const { hashPassword } = _scrml_stdlib.auth;` into the client bundle, and
  // ships the argon2id implementation in the `scrml-runtime.*.js` the emitted
  // HTML loads (4x `Bun.password`). The chunk survives because codegen's
  // `prune-server-only-stdlib-chunks` keeps it on any TEXTUAL occurrence of the
  // bound name (emit-client.ts:2898-2945) — route inference is never consulted —
  // and the SPEC-ratified string-literal suppression (§6 above) leaks the same
  // way with no shadow anywhere. The suppression is also RHS-WIDE, not lexically
  // scoped, so a binder in one arm silences a GENUINE sibling-arm reference that
  // codegen emits as a live client-side call.
  //
  // Both are PRE-EXISTING (codegen is untouched by this arc) and are recorded as
  // §6.6.19's DIRECT-limb residual; closure is its own arc. Do NOT read a green
  // §7 as an artifact-safety claim.
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

// ---------------------------------------------------------------------------
// §11 — TRANSITIVE reach through local function hops (S338).
//
// §1-§10 pin the DIRECT limb: the derived RHS names the imported server-only
// binding itself. That limb refused, and the identical reach ONE HOP AWAY through
// a local function compiled at exit 0 with no diagnostic at all — because Step 4
// is direct-only ("Calling a server function is NOT a trigger"), so
// `resolvedServerFnIds` holds only the function that TOUCHES the server-only work,
// while codegen colours the whole caller chain `async` on its way up.
//
// THE FAILURE IS NOT THE DIRECT LIMB'S FAILURE. Confidentiality is INTACT here:
// the server-only implementation stays server-side and the call lowers to a fetch
// stub. But `_scrml_derived_get` invokes the recompute thunk with no `await`
// (§6.6.4), so the PROMISE becomes the cell's value and is what gets rendered.
// Measured on `main` before this landed, all at exit 0 with an empty diagnostic set:
//
//   `_scrml_cs_derived_declare("h", () => _scrml_fetch_doHash_3(…))`   // 1 hop
//   `_scrml_levelA_5` / `_scrml_levelB_4` both emitted `async`          // 3 hops
//   a `ping`/`pong` mutual-recursion cycle
//   `const c = _scrml_fetch_countRows_3();`                            // ?{} route,
//       a SECOND emission shape — W-DERIVED-001 lowers it to a bare `const`, no
//       `derived_declare` at all. Hence the check keys on the AST decl, never on
//       the emission shape.
//
// EVERY TEST HERE THAT ASSERTS A REFUSAL HAS A BITE PROOF IN §11d: the same shape
// with the server reach removed must compile clean. A refusal test that would pass
// against a check that refuses everything proves nothing.
// ---------------------------------------------------------------------------

/** A `<program>` with local `fnSrc` declarations and a derived cell over `rhs`. */
function programWithFns(fnSrc, rhs, imports = "import { hashPassword } from 'scrml:auth'") {
  return `<program>
\${ ${imports} }

<pw> = "secret"

\${ ${fnSrc} }

const <computed> = ${rhs}

<div>\${@computed}</div>

</program>`;
}

describe(`${CODE} §11a — a hop through a local function fires`, () => {
  test("ONE hop: the RHS calls a fn that reaches the server-only import", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "doHash(@pw)",
    ));
    const hits = errorsWithCode(out, CODE);
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe("error");
  });

  test("THREE hops: levelA -> levelB -> levelC -> hashPassword", () => {
    const { out } = runRIOn(programWithFns(
      `function levelC(p) { return hashPassword(p) }
function levelB(p) { return levelC(p) }
function levelA(p) { return levelB(p) }`,
      "levelA(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("a `?{}` SQL helper fires — the trigger need not be an import", () => {
    // The DIRECT limb keys on the escalation-server-only IMPORT map, so this
    // program has no import at all. It fires only if the transitive limb reads
    // route inference's placement result rather than the import map.
    const source = `<program db="./app.db">
<schema>
table users {
  id: integer primary key
}
</schema>

\${ function countRows() {
    const rows = ?{ SELECT id FROM users }
    return rows.length
} }

const <computed> = countRows()

<div>\${@computed}</div>

</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  /**
   * THE S338 REVIEW'S F1 — the closure's own one-hop miss, and the reason the
   * hop edge set is not built from `record.callees`.
   *
   * That walker "returns at `case \"lambda\"` and never descends", so `wrap` had
   * an EMPTY callee list and fell out of the caller relation entirely. Measured
   * at the first-cut HEAD: exit 0, empty diagnostic set, and the emitted client
   * carried `async function _scrml_wrap_4(x) { return (await _scrml_mapAsync([x],
   * async (v) => await _scrml_fetch_doHash_3(v)))[0]; }` bound straight into
   * `_scrml_cs_derived_declare("h", () => _scrml_wrap_4(…))` — byte-for-byte the
   * "ONE hop" shape above, differing only in the inner call's POSITION.
   *
   * This is the exact evasion the S299 adversarial review proved against a
   * calls-only reach check, reintroduced one level up. If someone "simplifies"
   * the edge set back to `callees`, this is the test that goes red.
   */
  test("F1 REGRESSION PIN — a hop whose inner call sits inside a LAMBDA fires", () => {
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function wrap(x) { return [x].map(v => doHash(v))[0] }`,
      "wrap(@pw)",
    ));
    const hits = errorsWithCode(out, CODE);
    expect(hits.length).toBe(1);
    // and the chain must traverse the hop it could not previously see
    expect(hits[0].message).toContain("const <computed> -> wrap -> doHash");
  });

  test("a hop reached from a LAMBDA inside the RHS fires (reach is any depth)", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map((s) => doHash(s))",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("a BARE REFERENCE to the hop fn fires, not just a call (§6.6.19 reach rule)", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map(doHash)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });
});

describe(`${CODE} §11b — transitivity terminates`, () => {
  test("a mutual-recursion CYCLE reaching the server fires and does not hang", () => {
    const { out } = runRIOn(programWithFns(
      `function ping(p) { return pong(p) }
function pong(p) { return ping(hashPassword(p)) }`,
      "ping(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("a self-recursive fn reaching the server fires and does not hang", () => {
    const { out } = runRIOn(programWithFns(
      "function grind(p, k) { return grind(hashPassword(p), k) }",
      "grind(@pw, 1)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });
});

describe(`${CODE} §11c — the message names the HOP CHAIN, not just the endpoint`, () => {
  const { out } = runRIOn(programWithFns(
    `function levelC(p) { return hashPassword(p) }
function levelB(p) { return levelC(p) }
function levelA(p) { return levelB(p) }`,
    "levelA(@pw)",
  ));
  const msg = errorsWithCode(out, CODE)[0]?.message ?? "";

  test("the full chain appears, cell first", () => {
    expect(msg).toContain("const <computed> -> levelA -> levelB -> levelC");
  });

  test("it names WHY the terminus is server-side", () => {
    expect(msg).toContain("`levelC` is on the server because");
    expect(msg).toContain("scrml:auth");
  });

  test("it does NOT repeat the direct limb's fix, which the author already applied", () => {
    // "move the call into a `function`" is the DIRECT limb's resolution. Telling
    // an author who has already done exactly that to do it again names no root
    // cause -- a diagnostic that does not name root cause is a diagnostic bug.
    expect(msg).not.toContain("move the call into a `function`");
    expect(msg).toContain("do not read this value through a derived cell");
  });

  test("it is honest that this is a CORRECTNESS refusal, not a leak", () => {
    expect(msg).toContain("CORRECTNESS refusal, not a confidentiality one");
  });

  test("no internal placement token reaches the author", () => {
    // Steps 5b/5c record propagated placements as synthetic reasons carrying
    // `caller-context-propagation` / `closure-capture:<name>` in `resourceType`,
    // which `describeServerTrigger` would render verbatim into the message.
    expect(msg).not.toContain("caller-context-propagation");
    expect(msg).not.toContain("closure-capture:");
  });

  test("a caller-context-PROMOTED terminus is explained in English", () => {
    // `label` has no server work of its own; Step 5c places it server-side
    // because its only function-caller is server. Measured on `main`: this
    // program emitted an HTTP round trip for `return "v:" + s`, at exit 0.
    const source = `<program>
\${ import { hashPassword } from 'scrml:auth' }

<pw> = "secret"

\${ function label(s) { return "v:" + s }
function store(p) { return label(hashPassword(p)) } }

const <computed> = label(@pw)

<div onclick={ store(@pw) }>\${@computed}</div>

</program>`;
    const m = errorsWithCode(runRIOn(source).out, CODE)[0]?.message ?? "";
    // Round 4: "every function DECLARATION". The unqualified "every function that
    // calls it" was a false universal whenever a client markup handler visibly
    // called the fn — 5c's caller edges count declared-function callers only.
    expect(m).toContain("every function declaration that calls it is server-side");
    expect(m).toContain("markup event-handler call sites do not count as callers");
    expect(m).not.toContain("caller-context-propagation");
  });
});

describe(`${CODE} §11d — BITE PROOFS: the same shapes with the reach removed`, () => {
  // Each of these is the §11a/§11b fixture with ONLY the server reach taken out.
  // If any of them fires, the check is refusing on the SHAPE (a derived cell that
  // calls a local function) rather than on the REACH, and every refusal above is
  // worthless as evidence.

  test("ONE hop, purely-client fn: clean", () => {
    const { out } = runRIOn(programWithFns(
      "function shout(s) { return s.toUpperCase() }",
      "shout(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("THREE hops, all purely-client: clean", () => {
    const { out } = runRIOn(programWithFns(
      `function levelC(p) { return p.trim() }
function levelB(p) { return levelC(p) }
function levelA(p) { return levelB(p) }`,
      "levelA(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("a purely-client mutual-recursion CYCLE: clean, and terminates", () => {
    const { out } = runRIOn(programWithFns(
      `function alpha(s) { return beta(s) }
function beta(s) { return alpha(s.trim()) }`,
      "alpha(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("a lambda over a purely-client fn: clean", () => {
    const { out } = runRIOn(programWithFns(
      "function shout(s) { return s.toUpperCase() }",
      "[@pw].map((s) => shout(s))",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("a bare reference to a purely-client fn: clean", () => {
    const { out } = runRIOn(programWithFns(
      "function shout(s) { return s.toUpperCase() }",
      "[@pw].map(shout)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("the server-reaching fn EXISTS but the derived RHS does not reach it: clean", () => {
    // The strongest bite proof: the file has an escalated fn AND a derived cell.
    // Only the absence of an edge between them keeps this clean.
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function shout(s) { return s.toUpperCase() }`,
      "shout(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  // NOTE (round 4, S345): the "RHS-local `const` shadowing a server-reaching fn:
  // clean" pin that used to close this block MOVED to §11l and FLIPPED to a
  // refusal. It was never a sound bite proof: RI suppressed the diagnostic while
  // codegen renamed the shadowed call to the async fetch stub anyway, so the
  // "clean" compile was a silent miscompile (a Promise bound into the derived
  // recompute), not an over-fire guard. §11l pins the final shadow semantics.
});

describe(`${CODE} §11f — the transitive limb shares the direct limb's REFERENCE rules`, () => {
  // Both limbs call the same `collectDerivedRhsServerOnlyRefs` /
  // `scanForServerOnlyBindingRefs` pair with different name sets, so what counts
  // as a REFERENCE (depth, lambda bodies, string-literals-are-not-references) is
  // one rule. Since round 4 (S345) the limbs deliberately DIFFER on two axes —
  // raw-text handling (`RawSubtreeMode`, §11k) and SHADOWING (limb (a) suppresses
  // RHS-local binder names; limb (b) suppresses nothing — §11l). These pin what
  // is still shared: if someone hand-rolls a second scanner for the transitive
  // limb, these are what catch the drift.

  test("a LAMBDA-PARAM collision FIRES, exactly as it does for the direct limb (§7)", () => {
    // DESCRIPTIVE OF CURRENT BEHAVIOUR, NOT A RATIFICATION (S345 ruling): a
    // lambda parameter does not shadow, so a param name colliding with a
    // server-reaching fn fires. The governing design intent remains the pre-S338
    // sentence ("a name bound inside the RHS shadows … and SHALL NOT fire"),
    // with real lexical scoping queued as its own conformance-restoration arc.
    // When that arc lands, THIS pin flips to 0 — deliberately, citing the arc.
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "((doHash) => doHash(@pw))((s) => s)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("round 4: the lambda-param fire does NOT depend on arrow body style", () => {
    // The round-4 body-style unification (work-order finding: an UNUSED param
    // colliding with a server-reaching name fired only when the arrow was
    // block-bodied, because the escape-hatch ESTree walk counted param-position
    // identifiers while the scrml expr-node walk stored params as strings).
    // Same program, both body styles, identical disposition — the §6.6.19
    // sentence "A LAMBDA PARAMETER DOES NOT SHADOW, AND THEREFORE FIRES" is now
    // true of BOTH representations instead of one.
    const exprBody = runRIOn(programWithFns(
      "function total(p) { return hashPassword(p) }",
      "[1, 2].map((total) => 1)",
    ));
    const blockBody = runRIOn(programWithFns(
      "function total(p) { return hashPassword(p) }",
      "[1, 2].map((total) => { return 1 })",
    ));
    expect(errorsWithCode(exprBody.out, CODE).length).toBe(1);
    expect(errorsWithCode(blockBody.out, CODE).length).toBe(1);
  });

  test("round 4 CONTROL: a non-colliding param stays clean in both body styles", () => {
    const exprBody = runRIOn(programWithFns(
      "function total(p) { return hashPassword(p) }",
      "[1, 2].map((v) => 1)",
    ));
    const blockBody = runRIOn(programWithFns(
      "function total(p) { return hashPassword(p) }",
      "[1, 2].map((v) => { return 1 })",
    ));
    expect(errorsWithCode(exprBody.out, CODE).length).toBe(0);
    expect(errorsWithCode(blockBody.out, CODE).length).toBe(0);
  });

  test("a name only inside a STRING LITERAL is not a reference: clean", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      '"call doHash on the server"',
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("a mutable cell initialiser is still NOT in scope (§5 scope pin holds)", () => {
    // Deleting `const` must not silence the transitive limb any more than it
    // silences the direct one -- but the position genuinely is undiagnosed, and
    // this pins that it stayed that way rather than being widened by accident.
    const source = `<program>
\${ import { hashPassword } from 'scrml:auth' }

<pw> = "secret"

\${ function doHash(p) { return hashPassword(p) } }

<computed> = doHash(@pw)

<div>\${@computed}</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(0);
  });
});

describe(`${CODE} §11e — the DIRECT limb is unchanged by the transitive one`, () => {
  test("a direct reach still emits exactly ONE diagnostic, not two", () => {
    // THE RHS MUST NAME BOTH, or this test cannot fail (S338 review F6). The
    // first cut used an RHS of just `hashPassword(@pw)`: the transitive limb
    // never matched `doHash` at all, so the `continue` that de-duplicates the
    // two limbs could be DELETED and this still passed — it pinned nothing.
    // Naming both makes it bite: 1 here, 2 with the `continue` removed.
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "hashPassword(@pw) + doHash(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("and it is the DIRECT message — the leak wording, not the Promise wording", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "hashPassword(@pw)",
    ));
    const msg = errorsWithCode(out, CODE)[0].message;
    expect(msg).toContain("move the call into a `function`");
    expect(msg).toContain("Do NOT just delete `const`");
  });

  test("§64 `kind=\"tool\"` still carves out BOTH limbs", () => {
    const source = `<program kind="tool">
\${ import { hashPassword } from 'scrml:auth' }

\${ function doHash(p) { return hashPassword(p) }
function main(argv) { println(doHash("x")) } }

const <computed> = doHash("seed")

</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §11g — the two SPEC `SHALL` guards that had ZERO coverage (S338 review F5).
//
// Both of these sentences were normative and both mutants survived the whole
// suite: deleting the same-file filter in `callersOf`, and flipping the
// ambiguity guard's `every` to `some`, each left the tree fully green. A `SHALL`
// with no test is a comment.
// ---------------------------------------------------------------------------

describe(`${CODE} §11g — same-file resolution and the ambiguity guard`, () => {
  /** Two files in one RI run: a derived cell in A, a same-named server fn in B. */
  function runRIOnTwoFiles(srcA, srcB) {
    const a = parseFileAST(srcA, "/test/a.scrml");
    const b = parseFileAST(srcB, "/test/b.scrml");
    return runRI({ files: [a, b], protectAnalysis: { views: new Map() } });
  }

  /**
   * MUTANT B6 — change `serverReachingNamesHere`'s
   * `ids.filter((id) => analysisMap.get(id)?.filePath === filePath)` to `ids`
   * and this goes red. Verified by applying that exact edit: 74 pass -> 1 fail.
   *
   * `fnNameToNodeIds` is name-keyed and GLOBAL across files. File A's derived RHS
   * names `shout` with NO same-file declaration of it — an import, or simply
   * undefined — while file B has an unrelated server-reaching `shout`. Firing on
   * A would reject correct code on a coincidence of naming, which is precisely
   * what Step 5c-bis refused to do for E-ROUTE-002 (§12.4). This is also the
   * positive statement of the DOCUMENTED cross-file residual: we knowingly do not
   * catch a genuine cross-file reach, because catching it means firing on this.
   *
   * A HAS NO LOCAL `shout` ON PURPOSE. The obvious fixture — a pure-client
   * `shout` in A alongside the server `shout` in B — CANNOT kill this mutant: the
   * AMBIGUITY guard below catches it first (A's own `shout` is not reaching, so
   * `every()` fails and nothing fires either way). Two guards, two fixtures; a
   * fixture that trips both proves neither.
   */
  test("a coincidental same-name server fn in ANOTHER file does NOT fire", () => {
    const out = runRIOnTwoFiles(
      `<program>
<name> = "ada"
const <loud> = shout(@name)
<div>\${@loud}</div>
</program>`,
      `<program>
\${ import { hashPassword } from 'scrml:auth' }
<pw> = "secret"
<o> = ""
\${ function shout(s) { return hashPassword(s) } }
<button onclick={ @o = shout(@pw) }>go</button>
<div>\${@o}</div>
</program>`,
    );
    const hits = (out.errors ?? []).filter(
      (e) => e && e.code === CODE && e.filePath === "/test/a.scrml",
    );
    expect(hits.length).toBe(0);
  });

  /**
   * MUTANT B7 — flip `sameFile.every(...)` to `sameFile.some(...)` in
   * `serverReachingNamesHere` and this goes red.
   *
   * One file, one NAME, two same-file declarations: a top-level `pick` that is
   * CLIENT-PINNED, and a nested `pick` inside a server-escalated function. The
   * call in the derived RHS unambiguously binds to the top-level one, so firing
   * would be an over-refusal. §12.4's rule: fire only when EVERY same-file
   * candidate is server-reaching.
   *
   * THE PIN IS LOad-BEARING AND THE FIRST DRAFT OF THIS TEST DID NOT HAVE IT.
   * With a plain `function pick(s) { return s.trim() }`, Step 5c's caller-context
   * fixpoint PROMOTES the top-level `pick` server-side — `inverseCallerMap` is
   * name-keyed, so `outer`'s call to its own NESTED `pick` registers a
   * server caller against BOTH declarations. Both then become server-reaching,
   * `every()` is satisfied honestly, and the diagnostic is CORRECT rather than an
   * ambiguity-guard failure. `document.title` puts the top-level `pick` in
   * `clientPinnedFnIds`, which 5c skips, so the ambiguity survives to be tested.
   * (That name-keyed promotion is a pre-existing §12.2 imprecision, not this
   * rule's — recorded here because it silently defeats the obvious fixture.)
   */
  test("an AMBIGUOUS same-file name (one reaching, one not) does NOT fire", () => {
    const source = `<program>
\${ import { hashPassword } from 'scrml:auth' }
<pw> = "secret"
<o> = ""

\${ function pick(s) { document.title = s; return s }

function outer(p) {
    function pick(q) { return hashPassword(q) }
    return pick(p)
} }

const <computed> = pick(@pw)

<button onclick={ @o = outer(@pw) }>go</button>
<div>\${@computed}\${@o}</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §11i — THE S343 BLOCKER: limb (b) refused on a NAME COINCIDENCE.
//
// Shipped in round 2 and caught by review before landing. The transitive limb
// handed its name set to the shared scanner's RAW-TEXT branch, and that name set
// is not ~4 imported stdlib members — it is EVERY server-reaching function name
// in the file. `status`, `total`, `format`, `label`. Ordinary vocabulary. So:
//
//   function status(p) { return hashPassword(p) }              // server-reaching
//   const <labels> = @nums.map(v => { return "status " + v })  // REFUSED. string literal.
//   const <sts>    = @rows.map(r => { return r.status })       // REFUSED. member property.
//
// Both measured at exit 0 on `main` and exit 1 on the arc — an INTRODUCED
// regression, and one that violates two sentences §6.6.19 states normatively: a
// name inside a string literal "SHALL NOT fire", and the limbs "SHALL be the same
// rules … applied to a different name set".
//
// WHY THE ARC'S OWN EVIDENCE COULD NOT SEE IT. Migration was measured ZERO over
// 2362 sources with 7401/7401 artifacts byte-identical. That measurement is
// structurally blind to this: the trigger is a name COINCIDENCE, which no corpus
// file happens to contain. A clean differential is not an answer to a question it
// cannot express.
//
// THE MECHANISM, AND WHY IT IS NOT AN EDGE CASE. A BLOCK-BODIED ARROW — the most
// ordinary derived-RHS shape in the language — is an `escape-hatch` carrying only
// raw text, while the SAME arrow with an expression body lowers structurally.
// Hence `@rows.map(r => r.status)` was already clean and
// `@rows.map(r => { return r.status })` refused: whether a property counted as a
// reference depended on whether the RHS happened to parse.
//
// THE FIX. Limb (b) PARSES the raw text and matches identifier POSITIONS
// (`RawSubtreeMode: "structural"`); where it does not parse, it DECLINES. The
// direct limb keeps the text scan — a miss there ships a secret.
//
// EVERY ACCEPT BELOW IS PAIRED WITH A REFUSE ON THE SAME SHAPE. An "it compiles"
// test passes trivially against a check that stopped firing altogether, which is
// the exact way this fix could go wrong.
// ---------------------------------------------------------------------------

describe(`${CODE} §11i — a name COINCIDENCE is not a reach (S343 blocker)`, () => {
  /** `status` is server-reaching; the derived RHS only *looks* like it names it. */
  const withStatusFn = (rhs) => `<program>
\${ import { hashPassword } from 'scrml:auth' }

<pw> = "secret"
<nums> = [1, 2]
<rows> = []

\${ function status(p) { return hashPassword(p) } }

const <computed> = ${rhs}

<div>\${@computed}</div>

</program>`;

  test("PA REPRODUCER 1 — the name appears only in a STRING LITERAL: clean", () => {
    const { out } = runRIOn(withStatusFn('@nums.map(v => { return "status " + v })'));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("PA REPRODUCER 2 — the name is a MEMBER PROPERTY: clean", () => {
    const { out } = runRIOn(withStatusFn("@rows.map(r => { return r.status })"));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("a non-computed OBJECT KEY of the same name: clean", () => {
    const { out } = runRIOn(withStatusFn("@rows.map(r => { return { status: 1 } })"));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("TEMPLATE-LITERAL TEXT naming the fn: clean", () => {
    const { out } = runRIOn(withStatusFn("@nums.map(v => { return `status is ok` })"));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  /**
   * THE BITE PROOFS. Each is the paired shape with a REAL reference in the same
   * position, through the same block-bodied arrow, on the same structural route.
   * Without these, every ACCEPT above would also pass against a limb (b) that had
   * simply stopped looking inside a block body at all — which is precisely the
   * over-correction this fix must not be.
   */
  test("BITE — a real CALL in the same block body still refuses", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map(v => { return doHash(v) })",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("BITE — a COMPUTED member access naming the fn still refuses", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map(r => { return r[doHash] })",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("BITE — a template-literal INTERPOLATION (not text) still refuses", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map(v => { return `x${doHash(v)}` })",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("BITE — an object-literal VALUE hop (not a key) still refuses", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map(v => { return { run: doHash } })",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("BITE — an ALIAS bound inside the block body still refuses", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map(v => { const f = doHash; return f(v) })",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("BITE — a DEAD nested reference still refuses (reference, not call)", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map(v => { if (false) { doHash(v) } return v })",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("BITE — TWO-LEVEL block-body lambda nesting still refuses", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      "[@pw].map(v => { return [v].map(w => { return doHash(w) }) })",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §11j — the SECOND raw-scan site: the hop EDGE SET had the identical defect.
//
// `computeServerReachingFns` builds the caller relation with the same scanner
// over each FUNCTION BODY, with `live` = every same-file function name. So a
// function whose body merely CONTAINS the string `"status "` became a caller of
// `status`, and any derived cell reading it was refused — with a hop chain
// (`const <labels> -> label -> status`) naming an edge that does not exist in the
// source. Measured at S343: exit 0 on `main`, exit 1 on the arc.
//
// `serverReach` is consumed by limb (b) and by nothing else, so this site takes
// the same `"structural"` rule. Fixing one without the other would have left the
// blocker half open behind a green §11i.
// ---------------------------------------------------------------------------

describe(`${CODE} §11j — the hop EDGE SET does not resolve on a text coincidence`, () => {
  test("a string literal in a hop fn's block body is not an edge: clean", () => {
    const { out } = runRIOn(programWithFns(
      `function status(p) { return hashPassword(p) }
function label(v) { return [v].map(x => { return "status " + x })[0] }`,
      "label(1)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("a member property in a hop fn's block body is not an edge: clean", () => {
    const { out } = runRIOn(programWithFns(
      `function status(p) { return hashPassword(p) }
function label(rs) { return rs.map(r => { return r.status })[0] }`,
      "label([])",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  /**
   * BITE — the F1 REGRESSION PIN's shape with a BLOCK body. §11a pins the
   * expression-bodied `[x].map(v => doHash(v))`, which lowers structurally and so
   * never touched the raw branch at all. The block-bodied form is the one this
   * fix rerouted, so it is the one that proves the edge set still closes.
   */
  test("BITE — a real call inside a hop fn's block body IS an edge", () => {
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function wrap(x) { return [x].map(v => { return doHash(v) })[0] }`,
      "wrap(@pw)",
    ));
    const hits = errorsWithCode(out, CODE);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("const <computed> -> wrap -> doHash");
  });

  test("BITE — a BARE REFERENCE inside a hop fn's block body IS an edge", () => {
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function wrap(x) { return [x].map(v => { return [v].map(doHash) })[0] }`,
      "wrap(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("BITE — mutual recursion reached through a block body still terminates and refuses", () => {
    const { out } = runRIOn(programWithFns(
      `function ping(p) { return [p].map(x => { return pong(x) })[0] }
function pong(p) { return ping(hashPassword(p)) }`,
      "ping(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §11k — the two limbs now differ on ONE axis, deliberately. Pin BOTH sides.
// ---------------------------------------------------------------------------

describe(`${CODE} §11k — the DIRECT limb keeps the text scan`, () => {
  /**
   * NOT AN ASPIRATION — these pin CURRENT, INTENDED behaviour, and the asymmetry
   * is the point. On limb (a) a miss ships a server-only implementation into a
   * browser bundle, so matching text the parser could not reach is the deliberate
   * fail-closed choice (§12.2's disposition for ambiguity on this boundary). On
   * limb (b) a miss renders a Promise — loud, local, fixable, and already slated
   * to be relaxed when dpa-023's `pending` lands — while a false refusal breaks
   * correct code at build time. Opposite costs, opposite safe directions.
   *
   * Narrowing limb (a) to the structural route would make a CONFIDENTIALITY rule
   * newly-ACCEPTING and overturn a deliberate S331 choice. That is a ruling, not a
   * cleanup. If it is ever taken, these two tests are the ones that must be
   * rewritten — deliberately, with the ruling cited — rather than quietly deleted.
   */
  test("a string literal naming the IMPORT in a block body still fires (over-fire, kept)", () => {
    const { out } = runRIOn(programDeriving(
      "scrml:auth", "hashPassword", '[1].map(v => { return "hashPassword " + v })',
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("a member property named after the IMPORT in a block body still fires", () => {
    const { out } = runRIOn(programDeriving(
      "scrml:auth", "hashPassword", "[1].map(v => { return v.hashPassword })",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  /**
   * THE COST OF THE FIX, PINNED SO IT CANNOT BE FORGOTTEN.
   *
   * An RHS that does not parse at all (`if @pw { … } else { … }` lowers to an
   * `escape-hatch` with `nativeKind: "ParseError"`) is where limb (b) DECLINES.
   * A genuine hop hidden there gets no E-DERIVED-SERVER-ONLY-REACH.
   *
   * END-TO-END the shape does NOT ship silently (measured, round 4): codegen's
   * emit parse gate refuses it at exit 1 with a generic `E-CODEGEN-INVALID-LOGIC`
   * ("could not lower this construct… This is a compiler defect. Please report
   * it.") and writes no artifacts. So today's cost is not a rendered Promise —
   * it is a ROOT-CAUSE-FREE diagnostic where §6.6.19's chain-naming message is
   * specified, one that actively invites a false compiler-bug report. Recorded
   * as a SPEC residual in §6.6.19 (round 4), not only here.
   *
   * That is the accepted trade and not an oversight: guessing from text is what
   * refused two correct programs above, and on a correctness refusal a miss is
   * recoverable while a false refusal is not. §2's companion test shows the DIRECT
   * limb still catches the identical shape, so the confidentiality boundary is
   * unaffected — only the root-cause-naming diagnostic has a hole.
   *
   * The right closure is a derived RHS that PARSES, not a better text scan. If the
   * `if`-expression ever lowers to real expr nodes, this test should flip to 1 and
   * the residual disappears with no change to the rule.
   */
  test("RESIDUAL — limb (b) DECLINES on an unparseable RHS (documented miss)", () => {
    const { out } = runRIOn(programWithFns(
      "function doHash(p) { return hashPassword(p) }",
      'if @pw { doHash(@pw) } else { "x" }',
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("...while the DIRECT limb still catches the identical unparseable shape", () => {
    const { out } = runRIOn(programDeriving(
      "scrml:auth", "hashPassword", 'if @pw { hashPassword(@pw) } else { "x" }',
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });
});

describe(`${CODE} §11h — §64 tool carve-out`, () => {
  test("`kind=\"tool\"` carves out BOTH limbs", () => {
    const source = `<program kind="tool">
\${ import { hashPassword } from 'scrml:auth' }

\${ function doHash(p) { return hashPassword(p) }
function main(argv) { println(doHash("x")) } }

const <computed> = doHash("seed")

</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §11l — ROUND-4 SHADOW SEMANTICS (S345): on the TRANSITIVE limb, a same-file
// name shadow does NOT suppress the refusal — any reference fires.
//
// WHY. Round 4's review executed four shapes where a name-based suppression
// produced a SILENT miss at exit 0 with an async fetch stub bound into the
// synchronous derived recompute (a rendered Promise): a branch-local `const`
// suppressing a genuine SIBLING-branch reference in a hop caller (if / while),
// a match-arm `const` suppressing a genuine SIBLING-arm reference in the RHS,
// and the SPEC-blessed RHS-local shadow itself — where RI suppressed while
// codegen renamed the shadowed call to the fetch stub anyway, so the "clean"
// compile called the server and rendered a Promise, with the local binder dead.
//
// RI and codegen must AGREE. Codegen's reference-renaming on this limb is
// scope-blind in the FIRING direction (every reference to a server-placed fn
// becomes the stub), so RI is now scope-blind in the FIRING direction too: every
// shape codegen would rewrite is refused at compile time.
//
// ROUND 5 removed the LAST suppression — a hop caller's own PARAMETERS. Round 4
// kept it as "provably scope-correct", which is true of the scanner and false of
// the outcome: codegen's raw-text `post-fn-name-mangle` renames the parameter
// BINDING to the fetch stub and colours the caller `async`, so that carve-out
// was the same silent Promise-render miss round 4 removed everywhere else. The
// limb now suppresses on NOTHING.
//
// DESCRIPTIVE, NOT RATIFIED (S345): the governing design intent remains the
// pre-S338 sentence — a binder shadows within its own scope and SHALL NOT fire.
// Real lexical scoping, in the scanner AND codegen's renamer together, is the
// queued conformance-restoration arc. When it lands, the refusals below flip to
// clean deliberately, citing that arc — and the §11l bite controls keep the
// flip honest.
// ---------------------------------------------------------------------------

describe(`${CODE} §11l — same-file shadows do not suppress the transitive limb (round 4)`, () => {
  test("if-SIBLING shadow miss (the round-4 blocker shape): FIRES", () => {
    // A branch-local `const doHash` used to delete the name from the hop
    // caller's live set for the WHOLE body, so the genuine sibling-branch
    // reference produced no edge and the program compiled at exit 0.
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function wrap(x) { if (x) { const doHash = (v) => v; return doHash(x) } return doHash(x) }`,
      "wrap(@pw)",
    ));
    const hits = errorsWithCode(out, CODE);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("const <computed> -> wrap -> doHash");
  });

  test("while-body shadow with the genuine reference AFTER the loop: FIRES", () => {
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function wrap(x) { let acc = x; while (false) { const doHash = (v) => v; acc = doHash(acc) } return doHash(acc) }`,
      "wrap(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(1);
  });

  test("match-arm shadow with a genuine SIBLING-arm reference: FIRES", () => {
    const source = `<program>
\${
    type Phase:enum = { Idle, Busy }
    import { hashPassword } from 'scrml:auth'
    <phase>: Phase = .Idle
}
<pw> = "secret"

\${ function doHash(p) { return hashPassword(p) } }

const <computed> = match @phase { .Idle :> { const doHash = (x) => x; doHash("local") } .Busy :> doHash(@pw) }

<div>\${@computed}</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("an RHS-local `const` shadow with NO other reference: FIRES (was §11d's clean pin)", () => {
    // The former pin asserted 0 on the strength of the SPEC shadow sentence.
    // Executed round 4: the exit-0 bundle contained
    //   `const doHash = ( x ) => x; return _scrml_fetch_doHash_3 ( "local" );`
    // — codegen renamed the shadowed CALL to the async stub, the local was dead,
    // and the derived cell's value was the pending Promise. Firing here is what
    // makes RI agree with what codegen actually emits, until the lexical-scoping
    // arc fixes both together.
    const source = `<program>
\${
    type Phase:enum = { Idle, Busy }
    import { hashPassword } from 'scrml:auth'
    <phase>: Phase = .Idle
}
<pw> = "secret"

\${ function doHash(p) { return hashPassword(p) } }

const <computed> = match @phase { .Idle :> { const doHash = (x) => x; doHash("local") } .Busy :> "busy" }

<div>\${@computed}</div>
</program>`;
    expect(errorsWithCode(runRIOn(source).out, CODE).length).toBe(1);
  });

  test("`let` and `~` (bare-assignment) RHS-local shadows: FIRE identically", () => {
    const mk = (binder) => `<program>
\${
    type Phase:enum = { Idle, Busy }
    import { hashPassword } from 'scrml:auth'
    <phase>: Phase = .Idle
}
<pw> = "secret"

\${ function doHash(p) { return hashPassword(p) } }

const <computed> = match @phase { .Idle :> { ${binder}; doHash("local") } .Busy :> "busy" }

<div>\${@computed}</div>
</program>`;
    expect(errorsWithCode(runRIOn(mk("let doHash = (x) => x")).out, CODE).length).toBe(1);
    expect(errorsWithCode(runRIOn(mk("doHash = (x) => x")).out, CODE).length).toBe(1);
  });

  test("BITE — a DIFFERENT-named local binder does not fire (the name set, not the shape)", () => {
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function wrap(x) { if (x) { const other = (v) => v; return other(x) } return "y" }`,
      "wrap(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("a hop caller's own PARAM does not suppress either (round 5): FIRES", () => {
    // ROUND 4 PINNED THIS AT 0, AND THE PIN RATIFIED A MISCOMPILE.
    //
    // The lexical premise ("a param scopes over the whole body, so it is the one
    // provably-scope-correct suppression") is true of the SCANNER and irrelevant
    // to the OUTCOME: codegen's `post-fn-name-mangle` (emit-client.ts:2955-2998)
    // is a raw-text alternation pass whose lookahead `(?=\s*[(;,}\]\n)]|$)`
    // matches a parameter in a parameter LIST, so it renames the PARAMETER
    // BINDING to the fetch stub and colours the caller `async`. Measured round 5
    // on the pre-round-5 tree, compiling THIS EXACT SOURCE end to end — exit 0,
    // zero errors, and:
    //
    //   async function _scrml_wrap_4(_scrml_fetch_doHash_3) { … }
    //   /* W-DERIVED-001 … */ const computed = _scrml_wrap_4((v) => v);
    //
    // (this shape has no reactive dependency, so W-DERIVED-001 lowers it to a
    // bare `const` — the SECOND emission route; the `_scrml_cs_derived_declare`
    // route shows the same defect when a reactive dep is added, which is the
    // conf §6 `hop-param` fixture). Either way an `async` call result lands in a
    // value the markup renders synchronously: the silent Promise-render this
    // limb exists to refuse. Firing is the loud, fixable direction; the
    // executed-artifact twin is conf §6 `hop-param`.
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function wrap(doHash) { return doHash("x") }`,
      "wrap((v) => v)",
    ));
    const hits = errorsWithCode(out, CODE);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("const <computed> -> wrap -> doHash");
  });

  test("BITE — a hop caller with a NON-colliding param does not fire (the name set, not the shape)", () => {
    // The differential control for the pin above: same file, same hop shape,
    // parameter renamed. Only the collision distinguishes them, so the refusal
    // above is attributable to the name and to nothing structural.
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function wrap(fn) { return fn("x") }`,
      "wrap((v) => v)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §11m — RESIDUAL: FILE-LEVEL FUNCTION-VALUED BINDINGS ARE NOT HOP NODES.
//
// The round-4 review falsified an in-code claim that these three shapes "were
// all ALREADY refused via 5b" — measured at N=3 on both main and the arc tip,
// NONE is refused by anything: the hop population is `function-decl`s only
// (`analysisMap` / `fnNameToNodeIds`), so a file-level `let`/`const` binding
// over a server-reaching function is neither a 5b seed nor a hop node nor a
// matched name, and the emitted client binds the async stub through the alias
// into the derived recompute at exit 0 (e.g. `let f = _scrml_fetch_doHash_3;
// _scrml_cs_derived_declare("computed", () => f(…))`).
//
// These pins record the MISS as a documented residual (§6.6.19's residual
// list), exactly like §11k's unparseable-RHS decline: closing it needs an
// alias-aware hop population — its own mechanism with its own
// direction-of-change measurement, not a side effect of round 4's shadow fix.
// If any of these starts firing, that closure has landed and the SPEC residual
// must be retired in the same change.
// ---------------------------------------------------------------------------

describe(`${CODE} §11m — RESIDUAL: function-valued bindings are missed (documented)`, () => {
  test("RESIDUAL — `let f = doHash` aliasing a server-reaching fn: NOT caught", () => {
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
let f = doHash`,
      "f(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("RESIDUAL — `let api = { run: doHash }` object-valued alias: NOT caught", () => {
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
let api = { run: doHash }`,
      "api.run(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("RESIDUAL — `const g = (p) => doHash(p)` lambda-valued hop: NOT caught", () => {
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
const g = (p) => doHash(p)`,
      "g(@pw)",
    ));
    expect(errorsWithCode(out, CODE).length).toBe(0);
  });

  test("BITE — the same middle hop as a `function` declaration IS caught", () => {
    // Differential control: only the binding FORM differs from the residual
    // above, and the function-decl form refuses with the full chain. This is
    // what pins the miss to the hop population rather than to the reach rules.
    const { out } = runRIOn(programWithFns(
      `function doHash(p) { return hashPassword(p) }
function g(p) { return doHash(p) }`,
      "g(@pw)",
    ));
    const hits = errorsWithCode(out, CODE);
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("const <computed> -> g -> doHash");
  });
});
