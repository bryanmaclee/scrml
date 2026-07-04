/**
 * E-TYPE-046 — Member Access Through a Possibly-`not` Receiver (SPEC §42.3.5).
 *
 * S237 (e-type-046-optional-member-access): a member access (`.field` /
 * `[key]` / `.method(...)`) through a PLAIN-OPTIONAL (`T | not` / `T?`) receiver
 * that may hold `not`, without optional-chaining the access (`recv?.field`,
 * §42.3.6) or narrowing the receiver (`if=` / `given` / `is not` / `match`,
 * §42.3.5), is compile error E-TYPE-046. `not` propagates; an unguarded
 * dereference would fault at runtime (`null`-access TypeError).
 *
 * BOUNDARY (§14.12.6.1): E-TYPE-046 is the plain-optional (steady-state) analog
 * of the LIFECYCLE guard E-TYPE-001. A lifecycle receiver — a bare-`T` no-RHS
 * Shape-4 cell (`implicitNotLifecycle`) or a `(not to T)` return — routes to
 * E-TYPE-001, NEVER here. A receiver fires exactly one of the two.
 *
 * Enforcement locus: `checkOptionalMemberAccess` (type-system), driven after
 * the lifecycle access checks in the type pass. This file is the fire/suppress
 * + boundary regression surface.
 */

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileWholeScrml(source, testName = `etype046-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return { errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(errors) {
  return errors.map((e) => e.code);
}
function countCode(src, code, name) {
  return codes(compileWholeScrml(src, name).errors).filter((c) => c === code).length;
}
function fires046(src, name) {
  return countCode(src, "E-TYPE-046", name) > 0;
}

// =============================================================================
// FIRE — a bare member access through a plain-optional receiver.
// =============================================================================
describe("E-TYPE-046 — MUST fire", () => {
  test("plain-optional cell union `T | not` — `${@user.name}`", () => {
    expect(fires046(
      `<user>: { name: string } | not\n<main><p>\${@user.name}</p></main>`,
      "fire-cell-union",
    )).toBe(true);
  });

  test("plain-optional cell suffix `T?` — `${@user.name}`", () => {
    expect(fires046(
      `<user>: { name: string }?\n<main><p>\${@user.name}</p></main>`,
      "fire-cell-suffix",
    )).toBe(true);
  });

  test("method call through optional receiver — `${@user.greet()}`", () => {
    expect(fires046(
      `<user>: { greet: string } | not\n<main><p>\${@user.greet()}</p></main>`,
      "fire-method",
    )).toBe(true);
  });

  test("per-hop: `@user?.address.city` fires on the bare `.city` hop", () => {
    expect(fires046(
      `<user>: { address: { city: string } | not } | not\n<main><p>\${@user?.address.city}</p></main>`,
      "fire-nested-perhop",
    )).toBe(true);
  });

  test("optional FIELD receiver — `@obj.optField.x` fires on `.x`", () => {
    expect(fires046(
      `<obj>: { optField: { x: string } | not, req: string } | not\n` +
      `<main>\${ given @obj :> { <p>\${@obj.optField.x}</p> } }</main>`,
      "fire-optfield",
    )).toBe(true);
  });

  test("computed: optional-value map — `@map[k].field`", () => {
    expect(fires046(
      `<map>: [string: { field: string } | not]\n<main><p>\${@map["k"].field}</p></main>`,
      "fire-map-computed",
    )).toBe(true);
  });

  test("logic body: unguarded read fires", () => {
    expect(fires046(
      `<user>: { name: string } | not\n` +
      `function greet() -> string | not { return @user.name }\n<main><p>\${greet()}</p></main>`,
      "fire-logic",
    )).toBe(true);
  });

  test("compound `if=(@user.isActive)` fires on the member in the condition", () => {
    expect(fires046(
      `<user>: { isActive: boolean } | not\n<main><div if=(@user.isActive)><p>hi</p></div></main>`,
      "fire-compound-if",
    )).toBe(true);
  });

  test("fires exactly once, not doubled, on a single unguarded access", () => {
    expect(countCode(
      `<user>: { name: string } | not\n<main><p>\${@user.name}</p></main>`,
      "E-TYPE-046",
      "fire-once",
    )).toBe(1);
  });
});

// =============================================================================
// SUPPRESS — absence-safe: optional-chained OR narrowed.
// =============================================================================
describe("E-TYPE-046 — MUST NOT fire", () => {
  test("optional chain `@user?.name`", () => {
    expect(fires046(
      `<user>: { name: string } | not\n<main><p>\${@user?.name}</p></main>`,
      "sup-qdot",
    )).toBe(false);
  });

  test("`if=` markup narrowing", () => {
    expect(fires046(
      `<user>: { name: string } | not\n<main><div if=@user><p>\${@user.name}</p></div></main>`,
      "sup-if",
    )).toBe(false);
  });

  test("`given @user :> { ... }` narrowing", () => {
    expect(fires046(
      `<user>: { name: string } | not\n<main>\${ given @user :> { <p>\${@user.name}</p> } }</main>`,
      "sup-given",
    )).toBe(false);
  });

  test("`if (@user is not) return` early-return narrowing", () => {
    expect(fires046(
      `<user>: { name: string } | not\n` +
      `function greet() -> string | not { if (@user is not) return not\n return @user.name }\n` +
      `<main><p>\${greet()}</p></main>`,
      "sup-isnot",
    )).toBe(false);
  });

  test("`if (@user is some) { ... }` positive narrowing", () => {
    expect(fires046(
      `<user>: { name: string } | not\n` +
      `function greet() -> string | not { if (@user is some) { return @user.name }\n return not }\n` +
      `<main><p>\${greet()}</p></main>`,
      "sup-issome",
    )).toBe(false);
  });

  test("`match @user { not :> … given @user :> … }` narrowing", () => {
    expect(fires046(
      `<user>: { name: string } | not\n` +
      `function greet() -> string | not { match @user { not :> return not\n given @user :> return @user.name } }\n` +
      `<main><p>\${greet()}</p></main>`,
      "sup-match",
    )).toBe(false);
  });

  test("ternary `@user is some ? @user.name : fallback` narrowing", () => {
    expect(fires046(
      `<user>: { name: string } | not = not\nconst <label> = @user is some ? @user.name : "x"\n<main><p>\${@label}</p></main>`,
      "sup-ternary",
    )).toBe(false);
  });

  test("bare non-optional cell `<user>: {name:string}` with a value — no `| not`", () => {
    expect(fires046(
      `<user>: { name: string } = <user name="x"/>\n<main><p>\${@user.name}</p></main>`,
      "sup-bare-nonopt",
    )).toBe(false);
  });

  test("optional-chained map `@map[k]?.field`", () => {
    expect(fires046(
      `<map>: [string: { field: string } | not]\n<main><p>\${@map["k"]?.field}</p></main>`,
      "sup-map-qdot",
    )).toBe(false);
  });

  test("fully optional-chained nested `@user?.address?.city`", () => {
    expect(fires046(
      `<user>: { address: { city: string } | not } | not\n<main><p>\${@user?.address?.city}</p></main>`,
      "sup-nested-fullqdot",
    )).toBe(false);
  });

  test("bare local shadowing a cell name — `let user = {...}; user.name` (no `@`)", () => {
    // Reactive cells are `@`-accessed in V5-strict; a bare `user` local that
    // shadows the cell name must NOT be treated as the optional cell.
    expect(fires046(
      `<user>: { name: string } | not\n` +
      `function f() -> string { let user = { name: "x" }\n return user.name }\n` +
      `<main><p>\${f()}</p></main>`,
      "sup-shadow-local",
    )).toBe(false);
  });

  test("ternary `@user is not ? fallback : @user.name` narrows the alternate", () => {
    expect(fires046(
      `<user>: { name: string } | not = not\nconst <label> = @user is not ? "none" : @user.name\n<main><p>\${@label}</p></main>`,
      "sup-ternary-isnot",
    )).toBe(false);
  });

  test("multi-variable `given @a, @b :> { ... }` narrows both", () => {
    expect(fires046(
      `<a>: { x: string } | not\n<b>: { y: string } | not\n` +
      `<main>\${ given @a, @b :> { <p>\${@a.x}\${@b.y}</p> } }</main>`,
      "sup-multi-given",
    )).toBe(false);
  });

  test("`else-if=@user` narrows like `if=`", () => {
    expect(fires046(
      `<user>: { name: string } | not\n` +
      `<main><div if=@user><p>\${@user.name}</p></div><div else-if=@user><p>\${@user.name}</p></div></main>`,
      "sup-elseif",
    )).toBe(false);
  });
});

// =============================================================================
// BOUNDARY — lifecycle receivers route to E-TYPE-001, never E-TYPE-046.
// =============================================================================
describe("E-TYPE-046 vs E-TYPE-001 boundary (§14.12.6.1)", () => {
  test("bare-`T` no-RHS cell fires E-TYPE-001, NOT E-TYPE-046", () => {
    const { errors } = compileWholeScrml(
      `<user>: { name: string }\n<main><p>\${@user.name}</p></main>`,
      "boundary-lifecycle",
    );
    const cs = codes(errors);
    expect(cs).toContain("E-TYPE-001");
    expect(cs).not.toContain("E-TYPE-046");
  });

  test("plain-optional cell fires E-TYPE-046, NOT E-TYPE-001", () => {
    const { errors } = compileWholeScrml(
      `<user>: { name: string } | not\n<main><p>\${@user.name}</p></main>`,
      "boundary-plain-optional",
    );
    const cs = codes(errors);
    expect(cs).toContain("E-TYPE-046");
    expect(cs).not.toContain("E-TYPE-001");
  });
});
