/**
 * auth-graph — Auth-site enumerator tests.
 *
 * S90 wave A-3.1 — exercises `runAuthGraph` against synthesized FileAST
 * inputs covering the four AuthSiteKind variants per SCOPING §A-3.1:
 *   1. <program auth=>     (program-auth)
 *   2. <page auth=>        (page-auth)
 *   3. <auth role=> block  (auth-role-block)
 *   4. <channel auth=>     (channel-auth)
 *
 * Plus edge cases per brief: 0-gate file, multi-gate file, <auth> block
 * with no role= attr, nested <auth> blocks.
 */

import { describe, test, expect } from "bun:test";
import { runAuthGraph } from "../../src/auth-graph.ts";
import type {
  FileAST,
  MarkupNode,
  ChannelDeclNode,
  ASTNode,
  Span,
  AttrNode,
  AuthConfig,
} from "../../src/types/ast.ts";

const SPAN: Span = { file: "test.scrml", start: 0, end: 0, line: 1, col: 1 };

let nextId = 1;
function nid(): number {
  return nextId++;
}

function attr(name: string, valueStr: string | null): AttrNode {
  if (valueStr === null) {
    return { name, value: { kind: "absent" }, span: SPAN };
  }
  return {
    name,
    value: { kind: "string-literal", value: valueStr, span: SPAN },
    span: SPAN,
  };
}

function markup(
  tag: string,
  attrs: AttrNode[] = [],
  children: ASTNode[] = [],
): MarkupNode {
  return {
    id: nid(),
    span: SPAN,
    kind: "markup",
    tag,
    attrs,
    children,
    selfClosing: false,
    closerForm: `</${tag}>`,
    isComponent: false,
  };
}

function channel(
  attrs: AttrNode[] = [],
  children: ASTNode[] = [],
): ChannelDeclNode {
  return markup("channel", attrs, children) as ChannelDeclNode;
}

interface FileOpts {
  authConfig?: AuthConfig | null;
  channelDecls?: ChannelDeclNode[];
}

function file(
  filePath: string,
  nodes: ASTNode[],
  opts: FileOpts = {},
): FileAST {
  return {
    filePath,
    nodes,
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    channelDecls: opts.channelDecls,
    spans: {},
    hasProgramRoot: nodes.some(n => n && (n as MarkupNode).tag === "program"),
    authConfig: opts.authConfig ?? null,
    middlewareConfig: null,
  };
}

const REQUIRED_AUTH: AuthConfig = {
  auth: "required",
  loginRedirect: "/login",
  csrf: "off",
  sessionExpiry: "1h",
};

// ---------------------------------------------------------------------------
// §1 — program-auth gate
// ---------------------------------------------------------------------------

describe("§1 program-auth enumeration", () => {
  test("file with <program> + authConfig.auth='required' → one program-auth gate", () => {
    const program = markup("program", [attr("auth", "required")]);
    const f = file("/abs/a.scrml", [program], { authConfig: REQUIRED_AUTH });

    const { graph, errors } = runAuthGraph([f], null);

    expect(errors).toHaveLength(0);
    expect(graph.gates.size).toBe(1);
    const gate = graph.gates.get(program.id);
    expect(gate).toBeDefined();
    expect(gate!.siteKind).toBe("program-auth");
    expect(gate!.role).toBe("required");
    expect(gate!.redirect).toBe("/login");
    expect(gate!.classification).toBeNull();
    expect(gate!.filePath).toBe("/abs/a.scrml");
    // cross-ref records the file path as entry-point proxy
    expect(graph.gateToEntryPoint.get(program.id)).toBe("/abs/a.scrml");
  });

  test("file with authConfig.auth='none' → no program-auth gate enumerated", () => {
    const program = markup("program", [attr("auth", "none")]);
    const noAuth: AuthConfig = {
      auth: "none",
      loginRedirect: "/login",
      csrf: "off",
      sessionExpiry: "1h",
    };
    const f = file("/abs/b.scrml", [program], { authConfig: noAuth });

    const { graph } = runAuthGraph([f], null);

    expect(graph.gates.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §2 — page-auth gate
// ---------------------------------------------------------------------------

describe("§2 page-auth enumeration", () => {
  test("<page auth='required'> inside program body → one page-auth gate", () => {
    const page = markup("page", [
      attr("route", "/admin"),
      attr("auth", "required"),
      attr("loginRedirect", "/signin"),
    ]);
    const program = markup("program", [], [page]);
    const f = file("/abs/p.scrml", [program]);

    const { graph } = runAuthGraph([f], null);

    expect(graph.gates.size).toBe(1);
    const gate = graph.gates.get(page.id);
    expect(gate).toBeDefined();
    expect(gate!.siteKind).toBe("page-auth");
    expect(gate!.role).toBe("required");
    expect(gate!.redirect).toBe("/signin");
    expect(gate!.classification).toBeNull();
    expect(graph.gateToEntryPoint.get(page.id)).toBe("/abs/p.scrml");
  });

  test("<page auth='none'> → no page-auth gate (skip 'none' values per A-3.1.c)", () => {
    const page = markup("page", [attr("route", "/home"), attr("auth", "none")]);
    const program = markup("program", [], [page]);
    const f = file("/abs/home.scrml", [program]);

    const { graph } = runAuthGraph([f], null);

    expect(graph.gates.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §3 — auth-role-block gate
// ---------------------------------------------------------------------------

describe("§3 auth-role-block enumeration", () => {
  test("<auth role='admin' else='/login'> inside <page> body → one auth-role-block gate", () => {
    const authBlock = markup("auth", [
      attr("role", "admin"),
      attr("else", "/login"),
    ]);
    const page = markup("page", [attr("route", "/admin")], [authBlock]);
    const program = markup("program", [], [page]);
    const f = file("/abs/admin.scrml", [program]);

    const { graph } = runAuthGraph([f], null);

    expect(graph.gates.size).toBe(1);
    const gate = graph.gates.get(authBlock.id);
    expect(gate).toBeDefined();
    expect(gate!.siteKind).toBe("auth-role-block");
    expect(gate!.role).toBe("admin");
    expect(gate!.check).toBeNull();
    expect(gate!.redirect).toBe("/login");
    expect(gate!.classification).toBeNull();
    expect(gate!.rawPredicate).toContain('role="admin"');
    // entry-point cross-ref points at the enclosing file's page
    expect(graph.gateToEntryPoint.get(authBlock.id)).toBe("/abs/admin.scrml");
  });

  test("<auth check='hasPermission' redirect='/forbidden'> → records check + redirect", () => {
    const authBlock = markup("auth", [
      attr("check", "hasPermission"),
      attr("redirect", "/forbidden"),
    ]);
    const page = markup("page", [], [authBlock]);
    const f = file("/abs/check.scrml", [page]);

    const { graph } = runAuthGraph([f], null);

    expect(graph.gates.size).toBe(1);
    const gate = graph.gates.get(authBlock.id);
    expect(gate).toBeDefined();
    expect(gate!.siteKind).toBe("auth-role-block");
    expect(gate!.role).toBeNull();
    expect(gate!.check).toBe("hasPermission");
    expect(gate!.redirect).toBe("/forbidden");
    expect(gate!.rawPredicate).toContain('check="hasPermission"');
  });

  test("<auth> block with no role/check attrs → still enumerated (A-3.3 emits E-AUTH-GRAPH-004)", () => {
    const authBlock = markup("auth", []);
    const page = markup("page", [], [authBlock]);
    const f = file("/abs/malformed.scrml", [page]);

    const { graph, errors } = runAuthGraph([f], null);

    // A-3.1 enumerates malformed gates without emitting diagnostics —
    // A-3.3 handles E-AUTH-GRAPH-004 during classification.
    expect(errors).toHaveLength(0);
    expect(graph.gates.size).toBe(1);
    const gate = graph.gates.get(authBlock.id);
    expect(gate).toBeDefined();
    expect(gate!.role).toBeNull();
    expect(gate!.check).toBeNull();
    expect(gate!.rawPredicate).toBe("<malformed>");
  });

  test("nested <auth> blocks → each is enumerated as its own gate", () => {
    const innerAuth = markup("auth", [attr("role", "superadmin")]);
    const outerAuth = markup("auth", [attr("role", "admin")], [
      markup("h1"),
      innerAuth,
    ]);
    const page = markup("page", [], [outerAuth]);
    const f = file("/abs/nested.scrml", [page]);

    const { graph } = runAuthGraph([f], null);

    expect(graph.gates.size).toBe(2);
    const outer = graph.gates.get(outerAuth.id);
    const inner = graph.gates.get(innerAuth.id);
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(outer!.role).toBe("admin");
    expect(inner!.role).toBe("superadmin");
    expect(outer!.siteKind).toBe("auth-role-block");
    expect(inner!.siteKind).toBe("auth-role-block");
  });
});

// ---------------------------------------------------------------------------
// §4 — channel-auth gate
// ---------------------------------------------------------------------------

describe("§4 channel-auth enumeration", () => {
  test("<channel auth='required' name='presence'> → one channel-auth gate", () => {
    const ch = channel([
      attr("name", "presence"),
      attr("auth", "required"),
    ]);
    const program = markup("program", [], [ch]);
    const f = file("/abs/ws.scrml", [program], { channelDecls: [ch] });

    const { graph } = runAuthGraph([f], null);

    expect(graph.gates.size).toBe(1);
    const gate = graph.gates.get(ch.id);
    expect(gate).toBeDefined();
    expect(gate!.siteKind).toBe("channel-auth");
    expect(gate!.role).toBe("required");
    expect(gate!.classification).toBeNull();
    expect(graph.gateToEntryPoint.get(ch.id)).toBe("/abs/ws.scrml");
  });

  test("<channel auth='none'> → no channel-auth gate", () => {
    const ch = channel([attr("name", "open"), attr("auth", "none")]);
    const program = markup("program", [], [ch]);
    const f = file("/abs/o.scrml", [program], { channelDecls: [ch] });

    const { graph } = runAuthGraph([f], null);

    expect(graph.gates.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §5 — 0-gate + multi-gate aggregation
// ---------------------------------------------------------------------------

describe("§5 aggregate cases", () => {
  test("file with no auth surface → empty graph", () => {
    const program = markup("program", [], [markup("h1"), markup("p")]);
    const f = file("/abs/plain.scrml", [program]);

    const { graph, errors } = runAuthGraph([f], null);

    expect(errors).toHaveLength(0);
    expect(graph.gates.size).toBe(0);
    expect(graph.gateToEntryPoint.size).toBe(0);
    expect(graph.roleEnum).toBeNull();
    expect(graph.redirectTargets.size).toBe(0);
  });

  test("file with all four AuthSiteKind variants → four gates, one per kind", () => {
    const authBlock = markup("auth", [attr("role", "admin")]);
    const ch = channel([attr("name", "presence"), attr("auth", "required")]);
    const page = markup("page", [
      attr("route", "/dashboard"),
      attr("auth", "required"),
    ], [authBlock]);
    const program = markup("program", [attr("auth", "required")], [
      page,
      ch,
    ]);
    const f = file("/abs/multi.scrml", [program], {
      authConfig: REQUIRED_AUTH,
      channelDecls: [ch],
    });

    const { graph, errors } = runAuthGraph([f], null);

    expect(errors).toHaveLength(0);
    expect(graph.gates.size).toBe(4);

    const siteKinds = new Set([...graph.gates.values()].map(g => g.siteKind));
    expect(siteKinds.has("program-auth")).toBe(true);
    expect(siteKinds.has("page-auth")).toBe(true);
    expect(siteKinds.has("auth-role-block")).toBe(true);
    expect(siteKinds.has("channel-auth")).toBe(true);

    // All gates carry the same file path
    for (const gate of graph.gates.values()) {
      expect(gate.filePath).toBe("/abs/multi.scrml");
      expect(gate.classification).toBeNull();
    }
  });

  test("multiple files → gates aggregated across files", () => {
    const fileA_program = markup("program", [attr("auth", "required")]);
    const fileA = file("/abs/a.scrml", [fileA_program], {
      authConfig: REQUIRED_AUTH,
    });

    const fileB_authBlock = markup("auth", [attr("role", "admin")]);
    const fileB_page = markup("page", [], [fileB_authBlock]);
    const fileB = file("/abs/b.scrml", [fileB_page]);

    const { graph } = runAuthGraph([fileA, fileB], null);

    expect(graph.gates.size).toBe(2);
    expect(graph.gates.get(fileA_program.id)?.filePath).toBe("/abs/a.scrml");
    expect(graph.gates.get(fileB_authBlock.id)?.filePath).toBe("/abs/b.scrml");
  });
});

// ---------------------------------------------------------------------------
// §6 — graph shape contract
// ---------------------------------------------------------------------------

describe("§6 AuthGraph shape contract (A-3.1 enumeration-only)", () => {
  test("A-3.1 leaves roleEnum / redirectTargets stubbed", () => {
    const authBlock = markup("auth", [attr("role", "admin")]);
    const page = markup("page", [], [authBlock]);
    const f = file("/abs/stub.scrml", [page]);

    const { graph } = runAuthGraph([f], null);

    // Per SCOPING §2.1 — A-3.2 populates roleEnum, A-3.4 populates
    // redirectTargets. A-3.1 leaves both stubbed.
    expect(graph.roleEnum).toBeNull();
    expect(graph.redirectTargets.size).toBe(0);

    // gates + gateToEntryPoint ARE populated by A-3.1.
    expect(graph.gates.size).toBe(1);
    expect(graph.gateToEntryPoint.size).toBe(1);
  });

  test("graph.errors matches output.errors (mirrors RSOutput pattern)", () => {
    const program = markup("program", [attr("auth", "required")]);
    const f = file("/abs/s.scrml", [program], { authConfig: REQUIRED_AUTH });

    const { graph, errors } = runAuthGraph([f], null);

    // Per types/auth-graph.ts AuthGraphOutput JSDoc: graph.errors and
    // errors overlap intentionally — same array reference at A-3.1 because
    // no diagnostics fire (and both are empty).
    expect(graph.errors).toEqual(errors);
  });
});
