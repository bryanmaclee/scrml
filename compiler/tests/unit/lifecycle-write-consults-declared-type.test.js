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
