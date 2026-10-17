/**
 * s468 (s468-cps-unbound-cluster) — free-name.ts `identityReadInDefault` recognises
 * the ambient `@` identities (`@session`, `@currentUser`) in RAW text the parser
 * keeps unparsed (a block-bodied callback, a template interpolation), the same as
 * in the structured tree. Before s468 only the free `session` builtin was found in
 * raw text; `xs.forEach((x) => { n = @session.userId })` read as no identity.
 */
import { describe, test, expect } from "bun:test";
import { identityReadInDefault } from "../../src/free-name.ts";

const raw = (text) => ({ kind: "escape-hatch", raw: text });
const ALL = { currentUserAmbient: true, sessionProjection: true };

describe("identityReadInDefault — raw text", () => {
  test("`@session` in a block-bodied callback", () => {
    expect(identityReadInDefault(raw("xs.forEach((x) => { n = @session.userId })"), [], ALL)).toBe("@session");
  });
  test("`@currentUser` in raw text", () => {
    expect(identityReadInDefault(raw("xs.map((x) => { return @currentUser.id })"), [], ALL)).toBe("@currentUser");
  });
  test("the options still gate each identity", () => {
    expect(identityReadInDefault(raw("f(() => { n = @session.userId })"), [], { currentUserAmbient: true, sessionProjection: false })).toBe(null);
    expect(identityReadInDefault(raw("f(() => { n = @currentUser.id })"), [], { currentUserAmbient: false, sessionProjection: true })).toBe(null);
  });
  test("a string mentioning `@session`, a longer name, or plain data is not a read", () => {
    expect(identityReadInDefault(raw("f(() => { n = '@session' })"), [], ALL)).toBe(null);
    expect(identityReadInDefault(raw("f(() => { n = @sessionX + 1 })"), [], ALL)).toBe(null);
    expect(identityReadInDefault(raw("xs.forEach((x) => { n = n + x })"), [], ALL)).toBe(null);
  });
  test("the free `session` builtin in raw text is still found, and a bound one is not", () => {
    expect(identityReadInDefault(raw("f(() => { n = session.userId })"), [], ALL)).toBe("session");
    expect(identityReadInDefault(raw("f((session) => { n = session.userId })"), [], ALL)).toBe(null);
  });
});
