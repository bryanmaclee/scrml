/**
 * Session/Auth (Option C Hybrid) -- Unit Tests
 *
 * Tests for session/auth support across the pipeline:
 *   - html-elements.js: auth attributes on <program>
 *   - ast-builder.js: auth attribute parsing and authConfig extraction
 *   - route-inference.js: auth middleware generation
 *   - code-generator.js: session middleware, CSRF injection, @session projection, session.destroy()
 *
 * Coverage:
 *   S1  <program> element shape includes auth, loginRedirect, csrf, sessionExpiry attributes
 *   S2  AST builder parses auth="required" and stores authConfig on AST
 *   S3  AST builder applies defaults: loginRedirect="/login", csrf="off", sessionExpiry="1h"
 *   S4  AST builder stores auth properties directly on the program markup node
 *   S5  AST builder: no authConfig when auth attribute is absent
 *   S6  RI generates authMiddleware when auth="required"
 *   S7  RI does not generate authMiddleware when auth is absent
 *   S8  RI authMiddleware includes correct loginRedirect, csrf, sessionExpiry
 *   S9  CG server JS includes session middleware when auth is configured
 *   S10 CG server JS includes auth check middleware with redirect
 *   S11 CG server JS includes session.destroy() handler
 *   S12 CG server JS includes CSRF functions when csrf="auto"
 *   S13 CG server JS omits CSRF functions when csrf="off"
 *   S14 CG client JS includes @session reactive projection when auth is configured
 *   S15 CG client JS includes session.destroy() with redirect
 *   S16 CG client JS omits @session when auth is not configured
 *   S17 CG HTML injects CSRF hidden input into <form> when csrf="auto"
 *   S18 CG HTML does not inject CSRF input when csrf="off"
 *   S19 CG loginRedirect wiring uses custom path
 */

import { describe, test, expect } from "bun:test";
import { getElementShape } from "../../src/html-elements.js";
import { buildAST } from "../../src/ast-builder.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { runRI } from "../../src/route-inference.js";
import { runCG } from "../../src/code-generator.js";
import { computeProgramConfig } from "../../src/compute-program-config.ts";
import * as acorn from "acorn";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(start, file = "/test/app.scrml") {
  return { file, start, end: start + 10, line: 1, col: start + 1 };
}

/**
 * Parse a scrml source string through BS + TAB to get a FileAST.
 *
 * S115 (DD #27 / F6 / Pivot 2) — `authConfig` / `middlewareConfig` extraction
 * (and the `<program>`-node auth annotation side-effect) is no longer done at
 * TAB time inside `buildAST`. It is performed by the pipeline-agnostic
 * `computeProgramConfig` pre-codegen pass, invoked at the api.js PRECG seam,
 * which mutates the FileAST. This helper reproduces that seam so the existing
 * `result.ast.authConfig` / `programNode.auth` assertions still hold.
 */
function parseSource(source, filePath = "/test/app.scrml") {
  const bsResult = splitBlocks(filePath, source);
  const tabResult = buildAST(bsResult);
  if (tabResult.ast) {
    const cfg = computeProgramConfig(tabResult.ast.nodes ?? []);
    tabResult.ast.authConfig = cfg.authConfig;
    tabResult.ast.middlewareConfig = cfg.middlewareConfig;
  }
  return tabResult;
}

/**
 * Build a minimal FileAST with the given nodes and optional authConfig.
 */
function makeFileAST(filePath, nodes, opts = {}) {
  return {
    filePath,
    nodes,
    ast: {
      filePath,
      nodes,
      authConfig: opts.authConfig ?? null,
      imports: [],
      exports: [],
      components: [],
      typeDecls: [],
      spans: {},
      hasProgramRoot: true,
    },
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    nodeTypes: opts.nodeTypes ?? new Map(),
  };
}

function makeMarkupNode(tag, attrs = [], children = [], opts = {}) {
  return {
    kind: "markup",
    tag,
    attributes: attrs,
    attrs,
    children,
    selfClosing: opts.selfClosing ?? false,
    span: opts.span ?? span(0),
    ...opts,
  };
}

function makeFormNode(children = [], attrs = []) {
  return makeMarkupNode("form", attrs, children);
}

// ---------------------------------------------------------------------------
// S1: <program> element shape includes auth attributes
// ---------------------------------------------------------------------------

describe("S1: <program> element shape auth attributes", () => {
  test("program shape includes auth attribute", () => {
    const shape = getElementShape("program");
    expect(shape).not.toBeNull();
    expect(shape.attributes.has("auth")).toBe(true);
  });

  test("program shape includes loginRedirect attribute", () => {
    const shape = getElementShape("program");
    expect(shape.attributes.has("loginRedirect")).toBe(true);
  });

  test("program shape includes csrf attribute", () => {
    const shape = getElementShape("program");
    expect(shape.attributes.has("csrf")).toBe(true);
  });

  test("program shape includes sessionExpiry attribute", () => {
    const shape = getElementShape("program");
    expect(shape.attributes.has("sessionExpiry")).toBe(true);
  });

  test("auth attributes are all string type", () => {
    const shape = getElementShape("program");
    expect(shape.attributes.get("auth").type).toBe("string");
    expect(shape.attributes.get("loginRedirect").type).toBe("string");
    expect(shape.attributes.get("csrf").type).toBe("string");
    expect(shape.attributes.get("sessionExpiry").type).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// S2-S5: AST builder auth parsing
// ---------------------------------------------------------------------------

describe("S2: AST builder parses auth attributes", () => {
  test("auth='required' is stored in authConfig", () => {
    const result = parseSource('<program auth="required">\n</program>');
    expect(result.ast.authConfig).not.toBeNull();
    expect(result.ast.authConfig.auth).toBe("required");
  });

  test("all auth attributes are parsed", () => {
    const result = parseSource(
      '<program auth="required" loginRedirect="/signin" csrf="auto" sessionExpiry="2h">\n</program>'
    );
    const cfg = result.ast.authConfig;
    expect(cfg.auth).toBe("required");
    expect(cfg.loginRedirect).toBe("/signin");
    expect(cfg.csrf).toBe("auto");
    expect(cfg.sessionExpiry).toBe("2h");
  });
});

describe("S3: AST builder auth attribute defaults", () => {
  test("loginRedirect defaults to /login", () => {
    const result = parseSource('<program auth="required">\n</program>');
    expect(result.ast.authConfig.loginRedirect).toBe("/login");
  });

  test("csrf defaults to off", () => {
    const result = parseSource('<program auth="required">\n</program>');
    expect(result.ast.authConfig.csrf).toBe("off");
  });

  test("sessionExpiry defaults to 1h", () => {
    const result = parseSource('<program auth="required">\n</program>');
    expect(result.ast.authConfig.sessionExpiry).toBe("1h");
  });
});

describe("S4: program node annotated with auth properties", () => {
  test("program markup node has auth, loginRedirect, csrf, sessionExpiry", () => {
    const result = parseSource(
      '<program auth="required" loginRedirect="/signin" csrf="auto" sessionExpiry="30m">\n</program>'
    );
    const programNode = result.ast.nodes.find(n => n.kind === "markup" && n.tag === "program");
    expect(programNode).toBeDefined();
    expect(programNode.auth).toBe("required");
    expect(programNode.loginRedirect).toBe("/signin");
    expect(programNode.csrf).toBe("auto");
    expect(programNode.sessionExpiry).toBe("30m");
  });
});

describe("S5: no authConfig when auth is absent", () => {
  test("authConfig is null when no auth attribute", () => {
    const result = parseSource('<program db="./app.db">\n</program>');
    expect(result.ast.authConfig).toBeNull();
  });

  test("program node has no auth property when auth is absent", () => {
    const result = parseSource('<program db="./app.db">\n</program>');
    const programNode = result.ast.nodes.find(n => n.kind === "markup" && n.tag === "program");
    expect(programNode.auth).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S6-S8: RI auth middleware generation
// ---------------------------------------------------------------------------

describe("S6: RI generates authMiddleware", () => {
  test("authMiddleware entry created when auth=required", () => {
    const file = makeFileAST("/test/app.scrml", [], {
      authConfig: { auth: "required", loginRedirect: "/login", csrf: "off", sessionExpiry: "1h" },
    });
    const result = runRI({ files: [file], protectAnalysis: null });
    expect(result.routeMap.authMiddleware).toBeDefined();
    expect(result.routeMap.authMiddleware.size).toBe(1);
    expect(result.routeMap.authMiddleware.has("/test/app.scrml")).toBe(true);
  });
});

describe("S7: RI no authMiddleware when absent", () => {
  test("authMiddleware is empty when no auth config", () => {
    const file = makeFileAST("/test/app.scrml", []);
    const result = runRI({ files: [file], protectAnalysis: null });
    expect(result.routeMap.authMiddleware.size).toBe(0);
  });
});

describe("S8: RI authMiddleware has correct properties", () => {
  test("authMiddleware entry has loginRedirect, csrf, sessionExpiry", () => {
    const file = makeFileAST("/test/app.scrml", [], {
      authConfig: { auth: "required", loginRedirect: "/auth", csrf: "auto", sessionExpiry: "2h" },
    });
    const result = runRI({ files: [file], protectAnalysis: null });
    const mw = result.routeMap.authMiddleware.get("/test/app.scrml");
    expect(mw.auth).toBe("required");
    expect(mw.loginRedirect).toBe("/auth");
    expect(mw.csrf).toBe("auto");
    expect(mw.sessionExpiry).toBe("2h");
  });
});

// ---------------------------------------------------------------------------
// S8b: RI auto-escalates auth when protect= fields exist
// ---------------------------------------------------------------------------

function makeProtectAnalysis(filePath, tableName, protectedFields) {
  const stateBlockId = `${filePath}::0`;
  const views = new Map();
  views.set(stateBlockId, {
    stateBlockId,
    dbPath: "/test/db.sqlite",
    tables: new Map([
      [tableName, {
        tableName,
        fullSchema: [],
        clientSchema: [],
        protectedFields: new Set(protectedFields),
      }],
    ]),
  });
  return { views };
}

describe("S8b: RI auto-escalates auth for protect= fields", () => {
  test("file with protect= but no auth= gets auto-injected auth middleware", () => {
    const file = makeFileAST("/test/app.scrml", []);
    const pa = makeProtectAnalysis("/test/app.scrml", "users", ["password_hash", "email"]);
    const result = runRI({ files: [file], protectAnalysis: pa });
    expect(result.routeMap.authMiddleware.size).toBe(1);
    expect(result.routeMap.authMiddleware.has("/test/app.scrml")).toBe(true);
    const mw = result.routeMap.authMiddleware.get("/test/app.scrml");
    expect(mw.auth).toBe("required");
    expect(mw.csrf).toBe("auto");
    expect(mw.autoEscalated).toBe(true);
  });

  test("auto-escalated auth uses sensible defaults", () => {
    const file = makeFileAST("/test/app.scrml", []);
    const pa = makeProtectAnalysis("/test/app.scrml", "users", ["secret"]);
    const result = runRI({ files: [file], protectAnalysis: pa });
    const mw = result.routeMap.authMiddleware.get("/test/app.scrml");
    expect(mw.loginRedirect).toBe("/login");
    expect(mw.csrf).toBe("auto");
    expect(mw.sessionExpiry).toBe("1h");
  });

  test("explicit auth= takes precedence over auto-escalation", () => {
    const file = makeFileAST("/test/app.scrml", [], {
      authConfig: { auth: "required", loginRedirect: "/signin", csrf: "off", sessionExpiry: "2h" },
    });
    const pa = makeProtectAnalysis("/test/app.scrml", "users", ["password_hash"]);
    const result = runRI({ files: [file], protectAnalysis: pa });
    expect(result.routeMap.authMiddleware.size).toBe(1);
    const mw = result.routeMap.authMiddleware.get("/test/app.scrml");
    // Explicit config wins — not auto defaults
    expect(mw.loginRedirect).toBe("/signin");
    expect(mw.csrf).toBe("off");
    expect(mw.sessionExpiry).toBe("2h");
    expect(mw.autoEscalated).toBeUndefined();
  });

  test("file without protect= and without auth= gets no auth middleware", () => {
    const file = makeFileAST("/test/app.scrml", []);
    const result = runRI({ files: [file], protectAnalysis: null });
    expect(result.routeMap.authMiddleware.size).toBe(0);
  });

  test("file with empty protect= (no protected fields) gets no auto-escalation", () => {
    const file = makeFileAST("/test/app.scrml", []);
    const pa = makeProtectAnalysis("/test/app.scrml", "users", []); // empty set
    const result = runRI({ files: [file], protectAnalysis: pa });
    expect(result.routeMap.authMiddleware.size).toBe(0);
  });

  test("W-AUTH-001 warning emitted on auto-escalation", () => {
    const file = makeFileAST("/test/app.scrml", []);
    const pa = makeProtectAnalysis("/test/app.scrml", "users", ["password_hash"]);
    const result = runRI({ files: [file], protectAnalysis: pa });
    const warning = result.errors.find(e => e.code === "W-AUTH-001");
    expect(warning).toBeDefined();
    expect(warning.severity).toBe("warning");
    expect(warning.message).toContain("protect=");
    expect(warning.message).toContain("auto-injected");
  });

  test("no W-AUTH-001 when explicit auth= is present", () => {
    const file = makeFileAST("/test/app.scrml", [], {
      authConfig: { auth: "required", loginRedirect: "/login", csrf: "auto", sessionExpiry: "1h" },
    });
    const pa = makeProtectAnalysis("/test/app.scrml", "users", ["password_hash"]);
    const result = runRI({ files: [file], protectAnalysis: pa });
    const warning = result.errors.find(e => e.code === "W-AUTH-001");
    expect(warning).toBeUndefined();
  });

  test("multiple files — only file with protect= gets auto-escalated", () => {
    const file1 = makeFileAST("/test/public.scrml", []);
    const file2 = makeFileAST("/test/admin.scrml", []);
    const pa = makeProtectAnalysis("/test/admin.scrml", "users", ["password_hash"]);
    const result = runRI({ files: [file1, file2], protectAnalysis: pa });
    expect(result.routeMap.authMiddleware.size).toBe(1);
    expect(result.routeMap.authMiddleware.has("/test/admin.scrml")).toBe(true);
    expect(result.routeMap.authMiddleware.has("/test/public.scrml")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S8c: RI auth precedence (ss19 #6/#7 — the login-wall bug)
//
// An EXPLICIT auth= declaration (on <program> OR <page>) MUST win over the
// protect= auto-escalation in Step 8b. Before the fix, a file with protect=
// fields was unconditionally escalated to auth="required" + W-AUTH-001 unless
// it was registered in Step 8a (which only handles <program auth="required">).
// That wrongly overrode <page auth="optional"|"none"> (and <program> non-
// required modes), force-installing _scrml_auth_check on e.g. a login page's
// own RPC — which 302'd to /login, making the page unauthenticatable.
//
// Precedence matrix exercised here: {optional, none, required, absent}
// x {program-level, page-level} x {protect= present}.
// ---------------------------------------------------------------------------

function authAttr(value) {
  return { name: "auth", value: { kind: "string-literal", value } };
}
function strAttr(name, value) {
  return { name, value: { kind: "string-literal", value } };
}
function pageNode(attrs = []) {
  return makeMarkupNode("page", attrs, []);
}

describe("S8c: RI auth precedence — explicit auth= wins over protect= escalation", () => {
  const FP = "/test/login.scrml";
  const pa = () => makeProtectAnalysis(FP, "users", ["label"]);

  // --- program-level auth= (carried on authConfig) ---

  test("<program auth=\"optional\"> + protect= — NOT escalated, no W-AUTH-001", () => {
    const file = makeFileAST(FP, [], {
      authConfig: { auth: "optional", loginRedirect: "/login", csrf: "off", sessionExpiry: "1h" },
    });
    const result = runRI({ files: [file], protectAnalysis: pa() });
    expect(result.routeMap.authMiddleware.has(FP)).toBe(false);
    expect(result.errors.find(e => e.code === "W-AUTH-001")).toBeUndefined();
  });

  test("<program auth=\"none\"> + protect= — NOT escalated, no W-AUTH-001", () => {
    const file = makeFileAST(FP, [], {
      authConfig: { auth: "none", loginRedirect: "/login", csrf: "off", sessionExpiry: "1h" },
    });
    const result = runRI({ files: [file], protectAnalysis: pa() });
    expect(result.routeMap.authMiddleware.has(FP)).toBe(false);
    expect(result.errors.find(e => e.code === "W-AUTH-001")).toBeUndefined();
  });

  test("<program auth=\"required\"> + protect= — gated (8a), no W-AUTH-001", () => {
    const file = makeFileAST(FP, [], {
      authConfig: { auth: "required", loginRedirect: "/signin", csrf: "off", sessionExpiry: "2h" },
    });
    const result = runRI({ files: [file], protectAnalysis: pa() });
    const mw = result.routeMap.authMiddleware.get(FP);
    expect(mw).toBeDefined();
    expect(mw.auth).toBe("required");
    expect(mw.loginRedirect).toBe("/signin"); // program's own settings, not escalation defaults
    expect(mw.autoEscalated).toBeUndefined();
    expect(result.errors.find(e => e.code === "W-AUTH-001")).toBeUndefined();
  });

  // --- page-level auth= (read directly from the <page> markup node) ---

  test("<page auth=\"optional\"> + protect= — NOT escalated, no W-AUTH-001 (#6/#7)", () => {
    const file = makeFileAST(FP, [pageNode([authAttr("optional")])]);
    const result = runRI({ files: [file], protectAnalysis: pa() });
    expect(result.routeMap.authMiddleware.has(FP)).toBe(false);
    expect(result.errors.find(e => e.code === "W-AUTH-001")).toBeUndefined();
  });

  test("<page auth=\"none\"> + protect= — NOT escalated, no W-AUTH-001", () => {
    const file = makeFileAST(FP, [pageNode([authAttr("none")])]);
    const result = runRI({ files: [file], protectAnalysis: pa() });
    expect(result.routeMap.authMiddleware.has(FP)).toBe(false);
    expect(result.errors.find(e => e.code === "W-AUTH-001")).toBeUndefined();
  });

  test("<page auth=\"required\"> + protect= — gated, no W-AUTH-001 (explicit)", () => {
    const file = makeFileAST(FP, [pageNode([authAttr("required")])]);
    const result = runRI({ files: [file], protectAnalysis: pa() });
    const mw = result.routeMap.authMiddleware.get(FP);
    expect(mw).toBeDefined();
    expect(mw.auth).toBe("required");
    // Explicit page-level declaration — NOT an auto-escalation.
    expect(mw.autoEscalated).toBeUndefined();
    // No W-AUTH-001: the page HAS an explicit auth= attribute.
    expect(result.errors.find(e => e.code === "W-AUTH-001")).toBeUndefined();
  });

  test("<page auth=\"required\" loginRedirect=> + protect= — page's loginRedirect honoured", () => {
    const file = makeFileAST(FP, [pageNode([authAttr("required"), strAttr("loginRedirect", "/signin"), strAttr("csrf", "off")])]);
    const result = runRI({ files: [file], protectAnalysis: pa() });
    const mw = result.routeMap.authMiddleware.get(FP);
    expect(mw).toBeDefined();
    expect(mw.loginRedirect).toBe("/signin");
    expect(mw.csrf).toBe("off");
  });

  // --- absent auth= (the case W-AUTH-001 is actually meant for) ---

  test("absent auth= + protect= — STILL auto-escalates + W-AUTH-001 (preserved)", () => {
    const file = makeFileAST(FP, []);
    const result = runRI({ files: [file], protectAnalysis: pa() });
    const mw = result.routeMap.authMiddleware.get(FP);
    expect(mw).toBeDefined();
    expect(mw.auth).toBe("required");
    expect(mw.autoEscalated).toBe(true);
    expect(result.errors.find(e => e.code === "W-AUTH-001")).toBeDefined();
  });

  // --- sanity: explicit non-required auth= WITHOUT protect= ---

  test("<page auth=\"optional\"> WITHOUT protect= — no authMiddleware, no warning", () => {
    const file = makeFileAST(FP, [pageNode([authAttr("optional")])]);
    const result = runRI({ files: [file], protectAnalysis: null });
    expect(result.routeMap.authMiddleware.has(FP)).toBe(false);
    expect(result.errors.find(e => e.code === "W-AUTH-001")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S9-S16: CG code generation
// ---------------------------------------------------------------------------

describe("S9: CG server JS includes session middleware", () => {
  test("server JS contains session middleware when auth is configured", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/login",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.serverJs).not.toBeNull();
    expect(output.serverJs).toContain("_scrml_session_middleware");
    expect(output.serverJs).toContain("scrml_sid");
  });
});

describe("S10: CG server JS includes auth check middleware", () => {
  test("auth check redirects to loginRedirect", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/signin",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.serverJs).toContain("_scrml_auth_check");
    expect(output.serverJs).toContain("/signin");
    expect(output.serverJs).toContain("302");
  });
});

describe("S11: CG server JS includes session.destroy()", () => {
  test("session destroy handler is generated", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/login",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.serverJs).toContain("_scrml_session_destroy");
    expect(output.serverJs).toContain("/_scrml/session/destroy");
    expect(output.serverJs).toContain("Expires=Thu, 01 Jan 1970");
  });
});

describe("S12: CG server JS includes CSRF when csrf=auto", () => {
  test("CSRF functions generated when csrf=auto", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/login",
          csrf: "auto",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.serverJs).toContain("_scrml_generate_csrf");
    expect(output.serverJs).toContain("_scrml_validate_csrf");
    expect(output.serverJs).toContain("X-CSRF-Token");
  });
});

describe("S13: CG server JS omits CSRF when csrf=off", () => {
  test("no CSRF functions when csrf=off", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/login",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.serverJs).not.toContain("_scrml_generate_csrf");
    expect(output.serverJs).not.toContain("_scrml_validate_csrf");
  });
});

describe("S14: CG client JS includes @session projection", () => {
  test("@session reactive variable generated when auth is configured", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/login",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).not.toBeNull();
    expect(output.clientJs).toContain("_scrml_session");
    expect(output.clientJs).toContain("_scrml_session_init");
    expect(output.clientJs).toContain("/_scrml/session");
  });
});

describe("S15: CG client JS session.destroy() with redirect", () => {
  test("session.destroy() clears session and redirects", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/auth/login",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.clientJs).toContain("destroy");
    expect(output.clientJs).toContain("/_scrml/session/destroy");
    expect(output.clientJs).toContain("/auth/login");
  });
});

describe("S16: CG client JS omits @session when no auth", () => {
  test("no @session when auth is not configured", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map(),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    // No client JS at all (no functions, no @session)
    // or client JS without session
    if (output.clientJs) {
      expect(output.clientJs).not.toContain("_scrml_session_init");
    }
  });
});

// ---------------------------------------------------------------------------
// S14b: Issue #15 (an adopter, v0.7.0) — the @session reactive projection must not
// collide across the app-shell client and an auth-gated page client.
//
// In a shell/layout app, `app.client.js` is loaded as a classic <script> on
// EVERY composed page (codegen/index.ts shell-composition); an auth-gated page
// ALSO loads its own `*.client.js`. Two classic scripts share one global
// lexical environment, so the former top-level `let _scrml_session` /
// `const session` declarations collided ("Identifier '_scrml_session' has
// already been declared") and the page never hydrated. The projection is now a
// window-anchored idempotent singleton (`var session` — redeclarable across
// classic scripts — plus a `window._scrml_session_projection` guard), so the
// two scripts coexist and the projection initializes exactly once.
// ---------------------------------------------------------------------------

describe("S14b: Issue #15 @session projection idempotent across two clients", () => {
  function clientWithAuth(filePath) {
    const file = makeFileAST(filePath, [makeMarkupNode("program", [], [])]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        [filePath, {
          filePath,
          auth: "required",
          loginRedirect: "/login",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    return result.outputs.get(filePath).clientJs;
  }

  test("projection is a window-anchored singleton, not a bare top-level let/const", () => {
    const js = clientWithAuth("/test/app.scrml");
    expect(js).not.toBeNull();
    // The top-level binding is `var session` (redeclarable), guarded by the
    // window-anchored singleton — the bare `let`/`const` forms are gone.
    expect(js).toContain("var session = ");
    expect(js).toContain("window._scrml_session_projection");
    expect(js).not.toContain("\nlet _scrml_session = null;");
    expect(js).not.toContain("\nconst session = {");
    // The reactive wiring is unchanged inside the IIFE.
    expect(js).toContain("_scrml_session_init();");
    expect(js).toContain("/_scrml/session");
  });

  test("app-shell client + auth-gated page client coexist in one global scope", () => {
    // Two classic <script>s share one global lexical environment. Concatenating
    // the two emitted clients and parsing in "script" mode reproduces exactly
    // that — it MUST NOT throw "Identifier '_scrml_session' has already been
    // declared".
    const appJs = clientWithAuth("/test/app.scrml");
    const pageJs = clientWithAuth("/test/pages/dash.scrml");
    const combined = appJs + "\n" + pageJs;
    expect(() =>
      acorn.parse(combined, { ecmaVersion: "latest", sourceType: "script" }),
    ).not.toThrow();
  });

  test("control — the pre-fix bare-`let` shape DOES collide (guards the test)", () => {
    // Sanity: prove the script-mode parse actually detects the collision the
    // fix removes, so the test above cannot pass vacuously.
    const preFix =
      "let _scrml_session = null;\nlet _scrml_session = null;\n";
    expect(() =>
      acorn.parse(preFix, { ecmaVersion: "latest", sourceType: "script" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// S17-S18: CG CSRF injection in HTML
// ---------------------------------------------------------------------------

describe("S17: CG HTML injects CSRF into forms when csrf=auto", () => {
  test("form element gets hidden CSRF input", () => {
    const formNode = makeFormNode([
      { kind: "text", value: "Submit", span: span(20) },
    ]);
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], [formNode]),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/login",
          csrf: "auto",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.html).toContain('name="_csrf"');
    expect(output.html).toContain('data-scrml-csrf');
    expect(output.html).toContain('type="hidden"');
  });
});

describe("S18: CG HTML no CSRF when csrf=off", () => {
  test("form element does not get CSRF input when csrf=off", () => {
    const formNode = makeFormNode([
      { kind: "text", value: "Submit", span: span(20) },
    ]);
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], [formNode]),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/login",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    if (output.html) {
      expect(output.html).not.toContain('name="_csrf"');
    }
  });
});

// ---------------------------------------------------------------------------
// S19: loginRedirect custom path wiring
// ---------------------------------------------------------------------------

describe("S19: CG loginRedirect uses custom path", () => {
  test("custom loginRedirect path in server and client JS", () => {
    const file = makeFileAST("/test/app.scrml", [
      makeMarkupNode("program", [], []),
    ]);
    const routeMap = {
      functions: new Map(),
      authMiddleware: new Map([
        ["/test/app.scrml", {
          filePath: "/test/app.scrml",
          auth: "required",
          loginRedirect: "/custom/auth/page",
          csrf: "off",
          sessionExpiry: "1h",
        }],
      ]),
    };
    const result = runCG({ files: [file], routeMap, depGraph: null, protectAnalysis: null });
    const output = result.outputs.get("/test/app.scrml");
    expect(output.serverJs).toContain("/custom/auth/page");
    expect(output.clientJs).toContain("/custom/auth/page");
  });
});
