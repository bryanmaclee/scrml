/**
 * S337 — a `(not to T)` write is classified against the DECLARED TYPE, not the
 * RHS's source text.
 *
 * SPEC §14.12.3 (`SPEC.md:9313`): *"For Shape 1 reactive cells, transition fires
 * on `@cell = value` where the cell's initial value is A-shaped and **the written
 * value is B-shaped**"*, restated at `:9315` as *"a `T`-shaped assignment"* and
 * at §6.2/`:2249` for the Shape-4 synthesized case.
 *
 * The pre-S337 implementation (`type-system.ts` `classifyWriteAgainstSpec`)
 * classified the presence branch as `initText.trim() === "not" ? "pre" : "post"`
 * — a comparison of the RHS's SOURCE TEXT against one literal that never
 * consulted a type at all. Any RHS not spelled `not` fired the transition, so a
 * write whose value the compiler ALREADY KNEW was still absent silently cleared
 * the read guard:
 *
 *     <v>: (not to User) = not
 *     <u>: (not to User) = not
 *     ${ @u = @v }        // `v` is `not` here — the write establishes nothing
 *     ${ @u.name }        // pre-S337: compiled CLEAN, reads a `not`
 *
 * S337 consults the RHS binding's own declared lifecycle type: a presence-
 * lifecycle binding denotes `T` only where it has itself been discriminated
 * (§14.12.6.1 — discrimination IS transition), so where it has not, the write
 * leaves the destination `pre`.
 *
 * SCOPE — what this suite deliberately pins as UNCHANGED:
 *   - A wrong-typed RHS (`@u = 42`) still classifies "post". scrml has no
 *     reactive-cell assignment type check at any locus; that is a separate gap
 *     and E-TYPE-001 would misname its root cause.
 *   - An in-flight RHS (`@u = loadUser()`) still classifies "post". The callee's
 *     declared return type IS the post-type; only the async rung
 *     (`not → pending → T`, dpa-023) makes the write premature, and that rung is
 *     ratified-in-direction but DEFERRED to its own arc. No third type-state is
 *     introduced here.
 *   - Every §14.12.6.1/§14.12.6.2 discrimination form: `given`, `is not`
 *     early-return, `match`, and `transition()` for variant-progression.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
function setup() {
  if (!TMP) TMP = mkdtempSync(join(tmpdir(), "lifecycle-write-type-"));
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

function typeErrors(result) {
  return result.errors.filter((e) => e.code === "E-TYPE-001");
}

const USER_TYPE = `type User:struct = {
  name: string,
  age: number
}
`;

// ---------------------------------------------------------------------------
// The defect — these FAIL before S337 and pass after
// ---------------------------------------------------------------------------

describe("S337 — a `(not to T)` write consults the RHS's declared type", () => {
  test("write from another `(not to T)` cell that is still absent does NOT transition", () => {
    // `@v` is textually not `not`, so the pre-S337 text comparison classified
    // the write "post" and the following member read compiled clean — reading a
    // value the compiler's own lifecycle model knew was absent.
    const src = `${USER_TYPE}
<v>: (not to User) = not
<u>: (not to User) = not

\${
    @u = @v
}
\${
    @u.name
}`;
    const result = compileSource("write-from-absent-cell", src);
    const fires = typeErrors(result);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toMatch(/binding `u`/);
    expect(fires[0].message).toMatch(/\(not to User\)/);
  });

  test("self-assignment of an absent cell does NOT transition it", () => {
    // The sharpest instance: `@u = @u` cannot possibly have established `User`,
    // yet `"@u" !== "not"` classified it "post".
    const src = `${USER_TYPE}
<u>: (not to User) = not

\${
    @u = @u
}
\${
    @u.name
}`;
    const result = compileSource("write-self-assign-absent", src);
    expect(typeErrors(result).length).toBeGreaterThanOrEqual(1);
  });

  test("Shape 4 synthesized `(not to T)` cells get the same treatment", () => {
    // §6.2 Shape 4 / §14.12.3: a no-RHS typed cell whose type has no canonical
    // empty defaults to `not` and acquires the lifecycle implicitly. The write
    // classification is the same code path, so the fix must reach it.
    const src = `${USER_TYPE}
<v>: User
<u>: User

\${
    @u = @v
}
\${
    @u.name
}`;
    const result = compileSource("write-from-absent-shape4", src);
    const fires = typeErrors(result);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toMatch(/SYNTHESIZED/);
  });
});

// ---------------------------------------------------------------------------
// The fix must not over-reach — a proven-present RHS still transitions
// ---------------------------------------------------------------------------

describe("S337 — a proven-present RHS still transitions (no over-rejection)", () => {
  test("write from a `(not to T)` cell that HAS been written transitions", () => {
    const src = `${USER_TYPE}
<v>: (not to User) = not
<u>: (not to User) = not

\${
    @v = < User name="a" age=1 >
}
\${
    @u = @v
}
\${
    @u.name
}`;
    const result = compileSource("write-from-present-cell", src);
    expect(typeErrors(result).length).toBe(0);
  });

  test("write of a `T`-shaped struct literal transitions", () => {
    const src = `${USER_TYPE}
<u>: (not to User) = not

\${
    @u = < User name="a" age=1 >
}
\${
    @u.name
}`;
    const result = compileSource("write-struct-literal", src);
    expect(typeErrors(result).length).toBe(0);
  });

  test("write from a cell that carries NO lifecycle is unchanged", () => {
    // The walker has no lifecycle-level proof about `@n`, so the pre-S337
    // answer stands. This pins that the fix did not widen into "reject anything
    // I cannot prove".
    const src = `${USER_TYPE}
<u>: (not to User) = not
<n>: number = 7

\${
    @u = @n
}
\${
    @u.name
}`;
    const result = compileSource("write-from-plain-cell", src);
    expect(typeErrors(result).length).toBe(0);
  });

  test("a non-bare-reference RHS is unchanged (call expression)", () => {
    // DEFERRED rung, pinned as unchanged: the callee's declared return type IS
    // the post-type. Only the async in-flight state makes such a write
    // premature, and that state does not exist in this two-state model.
    const src = `${USER_TYPE}
<u>: (not to User) = not

function makeUser(): User {
    return < User name="a" age=1 >
}

\${
    @u = makeUser()
}
\${
    @u.name
}`;
    const result = compileSource("write-from-call", src);
    expect(typeErrors(result).length).toBe(0);
  });

  test("a wrong-typed RHS is unchanged (separate missing check, not this one)", () => {
    // Pinned deliberately. scrml has no reactive-cell assignment type check at
    // any locus today; routing `@u = 42` through E-TYPE-001 ("accessed before
    // its lifecycle transition") would ship a diagnostic that does not name its
    // own root cause. If a cell-assignment type check lands later, THIS
    // expectation is the one it should flip.
    const src = `${USER_TYPE}
<u>: (not to User) = not

\${
    @u = 42
}
\${
    @u.name
}`;
    const result = compileSource("write-wrong-type", src);
    expect(typeErrors(result).length).toBe(0);
  });

  test("an explicit revert to `not` still reverts", () => {
    const src = `${USER_TYPE}
<u>: (not to User) = not

\${
    @u = < User name="a" age=1 >
}
\${
    @u = not
}
\${
    @u.name
}`;
    const result = compileSource("write-revert-to-not", src);
    expect(typeErrors(result).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §14.12 behaviour that already worked — pinned UNCHANGED
// ---------------------------------------------------------------------------

describe("S337 — §14.12 discrimination-as-transition is unchanged", () => {
  test("§14.12.6.1 `given` presence-guard still transitions", () => {
    const src = `${USER_TYPE}
<u>: (not to User) = not

\${
    given @u => {
        @u.name
    }
}`;
    const result = compileSource("keep-given", src);
    expect(typeErrors(result).length).toBe(0);
  });

  test("§14.12.6.1 `is not` early-return still transitions the outer scope", () => {
    const src = `${USER_TYPE}
<u>: (not to User) = not

function boot() {
    if (@u is not) { return }
    @u.name
}

\${
    boot()
}`;
    const result = compileSource("keep-is-not-early-return", src);
    expect(typeErrors(result).length).toBe(0);
  });

  test("§14.12.6.1 `match` given-arm is UNCHANGED — and is a PRE-EXISTING gap", () => {
    // PINNED AS-IS, NOT AS-SPECIFIED. §14.12.6.1 names three presence-discrimination
    // forms — `given`, `if (x is not) return`, and `match x { not => …, given x => … }`.
    // The first two transition a Shape-1 cell today (pinned above). The THIRD DOES
    // NOT: the arm body still reads as pre-transition and E-TYPE-001 fires.
    //
    // Measured identically on BOTH sides of S337 (stash / unstash), so this is not
    // a regression from the declared-type consult — it is a pre-existing hole in
    // the Shape-1 `match` arm path (`checkArmHasGivenPattern` needs the parser to
    // surface `given <name>` on `arm.test` / `arm.variant`, and for this source
    // form it does not). SURFACED to PA for a known-gaps filing, NOT fixed here.
    //
    // A `:struct` post-type additionally collides with §18.8.2 `E-TYPE-024`
    // ("match over a struct type — not supported"), which is why this fixture uses
    // `number[]`: it isolates the lifecycle behaviour from that independent rule.
    //
    // WHEN THE GAP IS CLOSED, this expectation flips to `.toBe(0)`.
    const src = `<rows>: (not to number[]) = not

\${
    match @rows {
        not => { log("absent") }
        given @rows => { @rows.length }
    }
}`;
    const result = compileSource("keep-match-given-arm", src);
    expect(typeErrors(result).length).toBeGreaterThanOrEqual(1);

    // The control that proves the fixture itself is well-formed: the SAME cell and
    // the SAME read pass under a `given` guard.
    const guarded = `<rows>: (not to number[]) = not

\${
    given @rows => { @rows.length }
}`;
    expect(typeErrors(compileSource("keep-match-control-given", guarded)).length).toBe(0);
  });

  test("§14.12.6.2 variant discrimination + `transition()` still passes", () => {
    const src = `type Article:enum = { Draft(body: string), Published(body: string, publishedAt: number) }

<phase>: (.Draft to .Published) = Article.Draft

\${
    if (@phase is .Draft) {
        transition(@phase)
        @phase.publishedAt
    }
}`;
    const result = compileSource("keep-variant-transition", src);
    expect(typeErrors(result).length).toBe(0);
    expect(
      result.errors.filter((e) => e.code === "E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED").length,
    ).toBe(0);
  });

  test("§14.12.6.2 variant discrimination WITHOUT `transition()` still fires", () => {
    const src = `type Article:enum = { Draft(body: string), Published(body: string, publishedAt: number) }

<phase>: (.Draft to .Published) = Article.Draft

\${
    if (@phase is .Draft) {
        @phase.publishedAt
    }
}`;
    const result = compileSource("keep-variant-no-transition", src);
    expect(
      result.errors.filter((e) => e.code === "E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED").length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("variant-progression writes are untouched by the presence-branch fix", () => {
    // The variant branch already consulted the annotation's variant NAMES, so a
    // bare-reference RHS matching neither name was already unclassifiable and
    // left the state alone. Pinned so the presence-branch change cannot leak.
    const postWrite = `type Article:enum = { Draft(body: string), Published(body: string, publishedAt: number) }

<phase>: (.Draft to .Published) = Article.Draft

\${
    @phase = Article.Published
}
\${
    @phase.publishedAt
}`;
    expect(typeErrors(compileSource("keep-variant-post-write", postWrite)).length).toBe(0);

    const bareRefWrite = `type Article:enum = { Draft(body: string), Published(body: string, publishedAt: number) }

<phase>: (.Draft to .Published) = Article.Draft
<other>: (.Draft to .Published) = Article.Draft

\${
    @phase = @other
}
\${
    @phase.publishedAt
}`;
    expect(typeErrors(compileSource("keep-variant-bare-ref", bareRefWrite)).length)
      .toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// S338 — round 2. The round-1 consult was keyed off the RHS SOURCE TEXT
// (`/^@?([A-Za-z_$][A-Za-z0-9_$]*)$/` against the trimmed init text), so it
// fired only for one exact spelling. Round 2 keys it off the parsed `initExpr`
// instead. Every test below FAILS against the round-1 implementation.
// ===========================================================================

describe("S338 — the consult reads the parsed RHS, not its spelling", () => {
  // -- B3: the paren cases -------------------------------------------------
  //
  // `@v`, `(@v)` and `((@v))` are the SAME expression; the parser produces one
  // `{ kind: "ident", name: "@v" }` node for all three because grouping parens
  // yield no node of their own. The round-1 text regex is anchored (`^…$`), so
  // any paren defeated it. Stripping one balanced layer was considered and
  // REJECTED: `((@v))` needs two and the next shape needs three.

  test("a parenthesised bare-cell RHS does NOT transition", () => {
    const src = `${USER_TYPE}
<v>: (not to User) = not
<u>: (not to User) = not

\${
    @u = (@v)
}
\${
    @u.name
}`;
    const fires = typeErrors(compileSource("s338-paren-rhs", src));
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toMatch(/binding `u`/);
  });

  test("a DOUBLY parenthesised bare-cell RHS does NOT transition", () => {
    // The case that rules out paren-stripping as a fix shape: any fixed number
    // of stripped layers is defeated by one more paren.
    const src = `${USER_TYPE}
<v>: (not to User) = not
<u>: (not to User) = not

\${
    @u = ((@v))
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338-dbl-paren-rhs", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("Shape 4 synthesized cells get the paren treatment too", () => {
    // The Shape-4 implicit form runs the same classifier and had the identical
    // hole; pinned separately because it reaches the code by another route.
    const src = `${USER_TYPE}
<v>: User
<u>: User

\${
    @u = (@v)
}
\${
    @u.name
}`;
    const fires = typeErrors(compileSource("s338-paren-shape4", src));
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toMatch(/SYNTHESIZED/);
  });

  // -- the absence-literal half of the same hole ---------------------------
  //
  // Found while fixing the above, and it is the WORSE direction: the pre-round-2
  // absence test was also textual (`trimmed === "not"`), so a §6.8 revert spelled
  // `@u = (not)` missed it and classified as a TRANSITION. That fails OPEN — the
  // following member read compiled CLEAN and read a `not` at runtime. Measured
  // identically on `origin/main`, so PRE-EXISTING, and closed here for free by
  // the same structural consult.

  test("a parenthesised revert to `not` still REVERTS (fail-open hole closed)", () => {
    const src = `${USER_TYPE}
<u>: (not to User) = not

\${
    @u = < User name="a" age=1 >
}
\${
    @u = (not)
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338-paren-revert", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("a doubly parenthesised revert to `not` still REVERTS", () => {
    const src = `${USER_TYPE}
<u>: (not to User) = not

\${
    @u = < User name="a" age=1 >
}
\${
    @u = ((not))
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338-dbl-paren-revert", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  // -- B2: the sigil is REQUIRED ------------------------------------------

  test("an UN-sigiled RHS is a local identifier and never consults the cell map", () => {
    // V5-strict: a bare `v` is a LOCAL identifier and does NOT denote `@v`
    // (PRIMER §3 — "Bare names in expressions are LOCAL identifiers only").
    // Round 1's `@?` made the sigil optional, so a local name resolved against
    // the CELL map and inherited an unrelated cell's lifecycle state — two
    // namespaces conflated by one optional character.
    //
    // `v` is undeclared here, so E-SCOPE-001 is expected and correct. What must
    // NOT appear is E-TYPE-001: that would be the cell map answering a question
    // about a name that was never a cell. Measured on `origin/main`:
    // ["E-SCOPE-001"]. Round 1: ["E-SCOPE-001","E-TYPE-001"].
    const src = `${USER_TYPE}
<v>: (not to User) = not
<u>: (not to User) = not

\${
    @u = v
}
\${
    @u.name
}`;
    const result = compileSource("s338-unsigiled-rhs", src);
    expect(typeErrors(result).length).toBe(0);
    expect(result.errors.filter((e) => e.code === "E-SCOPE-001").length)
      .toBeGreaterThanOrEqual(1);
  });

  // -- B1: the `kind === "presence"` restriction is load-bearing ----------

  test("a VARIANT-progression RHS does not trigger the presence consult", () => {
    // The restriction had ZERO coverage in round 1 while being called
    // load-bearing in both the doc comment and the landing record — relaxing
    // `rhsSpec.kind === "presence"` to `if (rhsSpec)` left every test green.
    //
    // Why it must stay: only a PRESENCE lifecycle has `not` as its pre-type, so
    // "not yet transitioned" and "still absent" are the same fact. A
    // variant-progression cell holds a REAL value in its pre-state
    // (`Article.Draft`), so its being "pre" proves nothing about whether the
    // write establishes the destination's post-shape. Consulting it would
    // reject a write the compiler has no evidence against.
    const src = `type Article:enum = { Draft(body: string), Published(body: string, publishedAt: number) }
${USER_TYPE}
<phase>: (.Draft to .Published) = Article.Draft
<u>: (not to User) = not

\${
    @u = @phase
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338-variant-rhs-no-consult", src)).length).toBe(0);
  });
});

// ===========================================================================
// S338 — the KNOWN FALSE POSITIVE, pinned as known-imperfect.
// Pinned rather than asserted-correct: this expectation is WRONG about the
// program and RIGHT about the compiler, and it exists so the day the walker's
// reach is fixed, this test fails and points at itself.
// ===========================================================================

describe("S338 — F2: a write the walker cannot see produces a FALSE POSITIVE", () => {
  test("PINNED AS-IS, NOT AS-SPECIFIED: an out-of-reach write leaves the RHS `pre`", () => {
    // `@v` IS genuinely a `User` when `@u = @v` runs — `loadIt()` is called on
    // the line above. But `walk()` skips `function-decl` (type-system.ts), so
    // the write inside the fn body never reaches the classifier, `@v` reads as
    // `pre`, and the copy is classified `pre` too. `@u.name` then fires.
    //
    // Measured: `[]` on `origin/main` @ 23ea2e5c → `["E-TYPE-001"]` here. So
    // this is a NEWLY-REJECTING false positive introduced by the declared-type
    // consult, and the landing record says so plainly rather than claiming the
    // false-positive surface is nil.
    //
    // It IS escapable, by the construct §14.12.6.1 already prescribes for
    // reading a presence cell — guard the READ (see the control below). What
    // does NOT help is guarding the WRITE, and that failure is PRE-EXISTING
    // (identical on `origin/main`).
    //
    // Closing it properly needs the call-flow fact — did `loadIt()` actually run
    // before the write? — which is the deferred arc. Narrowing the guard to
    // "skip the refinement when any unreachable write to the RHS exists" would
    // only trade this false POSITIVE for a false NEGATIVE.
    //
    // WHEN THE WALKER'S REACH IS FIXED, this expectation flips to `.toBe(0)`.
    const src = `${USER_TYPE}
<v>: (not to User) = not
<u>: (not to User) = not

function loadIt() {
    @v = < User name="a" age=1 >
}

\${
    loadIt()
    @u = @v
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338-f2-false-positive", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("the escape hatch works: guarding the READ with `given :>` compiles clean", () => {
    // This is the control that makes the pin above tolerable. It is not a
    // workaround invented for this defect — it is the §14.12.6.1 presence-guard,
    // the construct the language already requires for reading a `(not to T)`
    // cell. The adopter who hits F2 pays one edit, in the position the spec
    // already governs (SPEC.md:9315 names `given c :>` explicitly).
    //
    // S338 round 3 — the separator is `:>`, NOT `=>`. This test previously used
    // the DEPRECATED arrow glyph, which parses and emits identically but fires
    // W-GIVEN-ARROW-LEGACY (§42.2.3). The one test advertising the escape hatch
    // was pinning the deprecated spelling of it; the assertion below now also
    // proves the canonical form is warning-free, so a future re-deprecation
    // cannot quietly re-introduce the legacy glyph here.
    const src = `${USER_TYPE}
<v>: (not to User) = not
<u>: (not to User) = not

function loadIt() {
    @v = < User name="a" age=1 >
}

\${
    loadIt()
    @u = @v
}
\${
    given @u :> { @u.name }
}`;
    const result = compileSource("s338-f2-escape-hatch", src);
    expect(typeErrors(result).length).toBe(0);
    expect(
      [...result.errors, ...result.warnings]
        .filter((d) => d.code === "W-GIVEN-ARROW-LEGACY").length,
    ).toBe(0);
  });
});

// ===========================================================================
// S338 round 3 — THE DECLARATION LOCUS. Round 2 closed the absence-literal test
// at the WRITE and left it textual at the two MAP-BUILD loci, so the same defect
// survived at the declaration — and disabled round 2's own fix.
// ===========================================================================

describe("S338 r3 — the absence literal is structural at the DECLARATION too", () => {
  test("a declaration initialised `(not)` is ABSENT, and reading it fires", () => {
    // THE BLOCKER, bit-for-bit the defect this whole arc is named for. The cell
    // IS `not` — the emit is `_scrml_cs_reactive_set("u", null)` — but
    // `isInitOfPostType` compared the SOURCE TEXT `( not )` to `"not"`, missed,
    // and seeded the cell `post`. The markup read then compiled CLEAN.
    const src = `${USER_TYPE}
<u>: (not to User) = (not)
<p>\${@u.name}</p>`;
    expect(typeErrors(compileSource("s338r3-decl-paren-not", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("a declaration initialised `((not))` is ABSENT too", () => {
    const src = `${USER_TYPE}
<u>: (not to User) = ((not))
<p>\${@u.name}</p>`;
    expect(typeErrors(compileSource("s338r3-decl-dbl-paren-not", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("`= (not)` on the RHS cell does NOT launder the declared-type consult", () => {
    // The leak-through, and the reason this was a DO-NOT-LAND rather than a
    // cosmetic gap: seeding `v` as post meant `bindings.get("v")` reported post,
    // so `classifyWriteAgainstSpec`'s round-2 refinement never fired. Spelling
    // the RHS cell's initialiser `= (not)` was a COMPLETE ESCAPE from the
    // marquee fix — measured `[]` on BOTH refs before this round.
    const src = `${USER_TYPE}
<v>: (not to User) = (not)
<u>: (not to User) = not

\${
    @u = @v
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338r3-leakthrough", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("a reset re-evaluating a `(not)` initialiser reverts to ABSENT", () => {
    // The reset path with NO `default=` re-evaluates the initialiser (§6.8.1),
    // and took its text from `n.init` — the parenthesised spelling — so the
    // revert classified `post` and the post-reset read compiled clean.
    //
    // Note the asymmetry this pins: `default=(not)` was ALREADY correct before
    // round 3, because `readDefaultExprText` reads `defaultExpr.raw` (which the
    // parser normalises to `not`), whereas `readNodeInitText` prefers the raw
    // `n.init` SOURCE TEXT. Same value, two extraction paths, one holed.
    const src = `${USER_TYPE}
<u>: (not to User) = (not)

\${
    @u = < User name="a" age=1 >
}
\${
    reset(@u)
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338r3-reset-init-paren", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("`default=(not)` reverts to ABSENT (pinned — it already worked)", () => {
    // Pinned as a REGRESSION GUARD, not as a fix. This passed before round 3
    // for a reason that is easy to break: the `default=` extraction happens to
    // read the parsed node's `.raw`. If anyone "simplifies" that to read source
    // text the way the init path did, this goes silently green-to-broken.
    const src = `${USER_TYPE}
<u default=(not)>: (not to User) = not

\${
    @u = < User name="a" age=1 >
}
\${
    reset(@u)
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338r3-default-paren", src)).length)
      .toBeGreaterThanOrEqual(1);
  });

  test("a genuinely post-typed declaration still seeds POST (no over-refusal)", () => {
    // The counter-gate. The structural test must not make every declaration
    // look absent — a real struct-literal initialiser still transitions.
    const src = `${USER_TYPE}
<u>: (not to User) = not

\${
    @u = < User name="a" age=1 >
}
\${
    @u.name
}`;
    expect(typeErrors(compileSource("s338r3-post-init-unchanged", src)).length).toBe(0);
  });
});
