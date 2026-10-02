/**
 * @module auth-graph
 *
 * §40 AuthGraph — auth-site enumerator + (TBD A-3.2) role-enum resolver +
 * (TBD A-3.3) per-gate classifier + (S90 A-3.4) auth-redirect cross-ref.
 *
 * S90 wave A-3.1 — auth-site enumeration only. This entry point produces
 * an `AuthGraph` with fully populated `gates` (per-file walk over four
 * AuthSiteKind variants) + best-effort `gateToEntryPoint` cross-ref.
 * Classification (`closed_form`/`gated_for_role`) and role-enum resolution
 * are left stubbed for downstream sub-phases.
 *
 * S90 wave A-3.4 — auth-redirect cross-ref. `crossRefRedirects` walks the
 * enumerated gate set, projects each gate's `redirect` field into the
 * `redirectTargets` map (verbatim path strings per OQ-A3-B (a) S90
 * ratification — no EntryPointId synthesis), and emits info-level
 * `I-AUTH-REDIRECT-UNRESOLVED` diagnostics for any redirect path that
 * does not match a URL pattern in `RouteMap.pages`.
 *
 * Consumer: A-2.5 Component 4 of the Reachability Solver
 * (`auth_gated_boundaries_visible_to(role)`). Per OQ-A2-I disposition, the
 * `W-AUTH-RUNTIME-FALLBACK` lint fires from A-2.5, NOT here. Per OQ-A2-F,
 * `E-CLOSURE-002` (no-role-enum-with-auth-gates) also fires from A-2.5.
 *
 * Pipeline position (per SCOPING §5.3): post-RI, post-TS, post-META, pre-RS.
 * A-3.5 wires this into `api.js` orchestration; A-3.1 + A-3.4 leave the
 * module uncalled by the driver — its only consumers at this stage are
 * the unit tests.
 *
 * Cross-references:
 *   - SCOPING: `docs/changes/a3-auth-graph-scoping/SCOPING.md`.
 *   - SPEC.md §40.1.1 — Static role classification (lines 17146-17163).
 *   - SPEC.md §40.9.5 — Component 4 normative statement (lines 17708-17734).
 *   - SPEC.md §40.9.9 — Worked example with `<auth role="admin">` block.
 *   - SPEC.md §40.4 — `<program>` middleware (loginRedirect default + auth modes).
 *   - PIPELINE.md Stage 7.6 — input contract (lines 2340-2348).
 */

import type {
  AuthGraph,
  AuthGate,
  AuthGraphDiagnostic,
  AuthGraphOutput,
  AuthSiteKind,
  EntryPointId,
  MarkupNodeId,
  RoleClassification,
  RoleEnum,
  RoleVariant,
} from "./types/auth-graph.js";

import type {
  ASTNode,
  AttrNode,
  AttrValue,
  ChannelDeclNode,
  ConstDeclNode,
  ExprNode,
  FileAST,
  LogicNode,
  MarkupNode,
  ReactiveDeclNode,
  Span,
  TypeDeclNode,
} from "./types/ast.js";

import type { RouteMap } from "./route-inference.js";

import {
  type ConstFoldEnv,
  type ConstResult,
  type ConstValue,
  partiallyEvaluateExpr,
} from "./codegen/constant-folder.js";
import { findTopLevelProgram, programRoleOptionsOf, type ProgramRoleOptions } from "./program-role.ts";

// ---------------------------------------------------------------------------
// File-shape normalization (CE-shape vs. post-META wrapper)
// ---------------------------------------------------------------------------

/**
 * Normalize an upstream `FileAST` value into the flat shape `runAuthGraph`
 * expects. Upstream stages produce two distinct shapes:
 *
 *   - CE / pre-TS stages (`ceResults`): top-level `.nodes` / `.authConfig` /
 *     `.channelDecls` / `.typeDecls` / `.filePath` / `.hasProgramRoot`.
 *   - Post-TS / META stages (`tsResult.files`): a wrapper
 *     `{ filePath, ast: FileAST, errors, ... }` where the same surface lives
 *     one level down under `.ast`.
 *
 * The A-3.5 wire-in at `api.js` passes `metaFiles` (post-META, so the wrapped
 * shape). This helper unwraps once at the boundary and returns a flat
 * `FileAST`-shaped object so downstream walkers can rely on top-level field
 * access without per-call duck-typing. Returns `null` when the input is null
 * / undefined / structurally unrecognizable.
 *
 * Mirrors the duck-type pattern at `compiler/src/reachability/component-1.ts`
 * lines 184-192 — kept here as a one-shot lift rather than per-access for
 * readability + a single point of failure.
 */
function normalizeFileAST(input: unknown): FileAST | null {
  if (!input || typeof input !== "object") return null;
  const file = input as Record<string, unknown>;

  // Case 1 — already flat: `nodes` is at the top level. Return as-is (cast).
  if (Array.isArray(file.nodes)) {
    return file as unknown as FileAST;
  }

  // Case 2 — wrapped: dive into `.ast`. The wrapper carries the filePath /
  // errors / typed-side metadata at the top; the AST surface lives under
  // `.ast`. We construct a flat projection so all subsequent field accesses
  // hit the right level.
  const inner = file.ast as Record<string, unknown> | undefined;
  if (inner && typeof inner === "object" && Array.isArray(inner.nodes)) {
    const flatFilePath =
      (typeof file.filePath === "string" && file.filePath) ||
      (typeof inner.filePath === "string" ? inner.filePath : "<anon>");
    return {
      ...(inner as unknown as FileAST),
      filePath: flatFilePath,
    } as FileAST;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the A-3 §40 auth-graph derivation pass.
 *
 * At A-3.1 this is enumeration-only: walks every `FileAST` and records
 * one `AuthGate` per gate-bearing markup node, normalizing across the
 * four `AuthSiteKind` variants. Classification, role-enum resolution,
 * and redirect cross-ref are left for A-3.2/.3/.4.
 *
 * @param files — per-file ASTs from TAB.
 * @param routeMap — RI output. Used for the `gateToEntryPoint` cross-ref
 *   (PageRoute keys are file paths; we use the file path itself as the
 *   entry-point proxy until A-2.2.a finalizes the EntryPointId shape).
 *   Passed as `null` for unit tests that don't need cross-ref population.
 * @returns `{ graph, errors }` — `graph.errors` and `errors` are kept in
 *   sync (mirrors `RSOutput` pattern from `types/reachability.ts:299`).
 */
export function runAuthGraph(
  files: FileAST[],
  routeMap: RouteMap | null,
): AuthGraphOutput {
  // Normalize the input file shape. Upstream pipeline stages produce two
  // different shapes for `FileAST`:
  //   - CE / pre-TS stages: top-level `.nodes` / `.authConfig` / `.channelDecls`
  //     / `.typeDecls` / `.filePath` / `.hasProgramRoot`.
  //   - Post-TS / META stages: a `{ filePath, ast: FileAST, ... }` wrapper where
  //     the same fields live one level down under `.ast`.
  // RS Component 1 (reachability/component-1.ts:184-192) uses the same
  // duck-typed access pattern; A-3.5 wires the AG pass into api.js between
  // BP and RS where files arrive in the wrapped post-META shape — so we
  // unwrap once at the boundary and operate on the flat shape internally.
  const normalizedFiles = files.map(normalizeFileAST).filter((f): f is FileAST => f !== null);

  const gates = new Map<MarkupNodeId, AuthGate>();
  const gateToEntryPoint = new Map<MarkupNodeId, EntryPointId>();
  const redirectTargets = new Map<MarkupNodeId, string | null>();
  const errors: AuthGraphDiagnostic[] = [];

  for (const fileAST of normalizedFiles) {
    if (!fileAST) continue;
    enumerateFile(fileAST, routeMap, gates, gateToEntryPoint, errors);
  }

  // A-3.2: role enum resolution. Runs AFTER per-file enumeration so the
  // reference-based (b) discovery rule can read the gate set's `role`
  // attribute values. The resolver also fires E-AUTH-GRAPH-002 (auth
  // gates reference role variants but no enum is declared / ambiguous
  // discovery) when applicable.
  const roleEnum = resolveRoleEnum(normalizedFiles, gates, errors);

  // A-3.3 — per-gate classifier. Runs AFTER role-enum resolution so the
  // classifier can resolve identifier-form predicates against the
  // canonical variant set. Populates `gate.classification` in-place;
  // emits W-AUTH-PAGE-INFERRED info-lint for pages that lack explicit
  // `auth=` under a `<program auth="required">` enclosing scope (per
  // OQ-A3-C (b) S90 ratification — explicit-per-page-only inheritance).
  classifyGates(normalizedFiles, gates, roleEnum, errors);

  // A-3.4 — auth-redirect cross-ref. Projects each gate's `redirect`
  // field into the redirectTargets map verbatim (bare string per OQ-A3-B
  // (a) S90 ratification) and emits info-level I-AUTH-REDIRECT-UNRESOLVED
  // diagnostics for any redirect path not present in RouteMap.pages.
  crossRefRedirects(gates, routeMap, redirectTargets, errors);

  // A-3.5b (GITI-027 part A) — content-not-gated security lint. Runs after
  // enumeration so every `<auth role="X">` site is visible. Fires one
  // W-AUTH-CONTENT-NOT-GATED warning per auth-role-block gate, anchored at
  // the gate span. The lint surfaces the footgun that `<auth role=>` gates
  // only JS mount/behaviour (and only under --emit-per-route) and NEVER
  // withholds served HTML content — the gated markup ships verbatim in the
  // HTML payload, visible to all viewers regardless of role. Honest in BOTH
  // modes: per-route does NOT close the content leak. Content secrecy MUST
  // be enforced server-side. (SPEC §34 catalog + §40.9.5 cross-ref.)
  flagContentNotGated(gates, errors);

  const graph: AuthGraph = {
    gates,
    roleEnum,
    gateToEntryPoint,
    redirectTargets,          // populated by A-3.4 above
    errors,
  };

  return { graph, errors };
}

// ---------------------------------------------------------------------------
// Per-file enumeration
// ---------------------------------------------------------------------------

/** The `<program auth=>` literals that gate (§52.13): `"required"` and `"optional"`.
 *  `"none"` and every unrecognized literal (W-ATTR-002) apply no gate. */
const PROGRAM_GATING_AUTH: ReadonlySet<string> = new Set(["required", "optional"]);

/**
 * Walk one `FileAST` and append each gate-bearing site to the gates map.
 * Covers the four AuthSiteKind variants per SCOPING §2.2:
 *
 *   - `program-auth`     — `fileAST.authConfig.auth` is `"required"` or `"optional"`.
 *   - `page-auth`        — any MarkupNode where `tag === "page"` + `auth` attr.
 *   - `auth-role-block`  — any MarkupNode where `tag === "auth"`.
 *   - `channel-auth`     — any ChannelDeclNode where attrs include `auth`.
 */
function enumerateFile(
  fileAST: FileAST,
  routeMap: RouteMap | null,
  gates: Map<MarkupNodeId, AuthGate>,
  gateToEntryPoint: Map<MarkupNodeId, EntryPointId>,
  _errors: AuthGraphDiagnostic[],
): void {
  // -------------------------------------------------------------------
  // 1. program-auth — driven by FileAST.authConfig + the <program> node.
  //
  // authConfig.auth is "none"|"required"|"optional" (TAB normalization).
  // Per SCOPING §A-3.1.c bullet 1, a gate exists when auth != null && != "none".
  // The "optional" mode is a gate (it gates on session presence; A-3.3 will
  // classify this as closed_form: true / gated_for_role: ALL).
  // -------------------------------------------------------------------

  // S449 (g-auth-attr-invalid-or-dynamic-value-compiles-to-no-auth): authConfig.auth
  // is the RAW literal — compute-program-config does not normalize it — so the old
  // `!== "none"` test made `auth="Required"` / `auth=" required"` a program gate here
  // while route-inference (exact `=== "required"`) emitted NO auth check for it. The
  // auth graph then drove W-AUTH-LOGIN-MISSING / I-AUTH-REDIRECT-UNRESOLVED as if the
  // app were gated. §52.13.2: "On a `<program>`, an unrecognized value applies no auth
  // gate at all". Only the two gating literals of §52.13's three build a gate.
  if (fileAST.authConfig != null && PROGRAM_GATING_AUTH.has(fileAST.authConfig.auth as string)) {
    const programNode = findProgramNode(fileAST.nodes, programRoleOptionsOf(fileAST));
    if (programNode) {
      const gate = buildProgramGate(programNode, fileAST);
      gates.set(programNode.id, gate);
      gateToEntryPoint.set(programNode.id, fileAST.filePath);
    }
  }

  // -------------------------------------------------------------------
  // 2 + 3. Walk all markup nodes for `<page auth=>` and `<auth>` gates.
  //
  // Walker visits the entire AST tree (including nested page/auth bodies).
  // The collector predicate matches both AuthSiteKind variants in one pass.
  // -------------------------------------------------------------------

  walkMarkupNodes(fileAST.nodes, (node) => {
    if (node.tag === "page") {
      const authAttr = findAttr(node.attrs, "auth");
      if (authAttr) {
        const role = readStringAttr(authAttr);
        // Per SCOPING §A-3.1.c bullet 2: page-auth gate exists whenever
        // <page auth=> is present (any value, including "none" — A-3.3
        // will downgrade "none" to non-gating during classification).
        // For consistency with program-auth handling, we skip "none" here.
        if (role !== "none") {
          const gate = buildPageGate(node, fileAST, role, authAttr);
          gates.set(node.id, gate);
          gateToEntryPoint.set(node.id, resolvePageEntryPoint(node, fileAST, routeMap));
        }
      }
    } else if (node.tag === "auth") {
      // SCOPING §A-3.1.c bullet 3: any <auth> block counts as a gate,
      // even when `role=` is absent. A-3.3 will emit E-AUTH-GRAPH-004
      // for malformed (no-role, no-check) cases during classification;
      // A-3.1 only enumerates.
      const gate = buildAuthBlockGate(node, fileAST);
      gates.set(node.id, gate);
      gateToEntryPoint.set(node.id, resolvePageEntryPoint(node, fileAST, routeMap));
    }
  });

  // -------------------------------------------------------------------
  // 4. channel-auth — driven by FileAST.channelDecls + attr lookup.
  //
  // ChannelDeclNode is itself a MarkupNode (kind:"markup", tag:"channel")
  // per `ast.ts:1152` — already walked above. But for clarity + parity
  // with the §38 architecture, we re-walk channelDecls explicitly to
  // catch P3a-inlined channels that the markup walker may have already
  // visited via top-level traversal.
  // -------------------------------------------------------------------

  const channelDecls = fileAST.channelDecls ?? [];
  for (const channel of channelDecls) {
    if (!channel) continue;
    const authAttr = findAttr(channel.attrs, "auth");
    if (!authAttr) continue;
    const role = readStringAttr(authAttr);
    if (role === "none") continue;
    // Skip if already enumerated by the generic markup walker above —
    // channelDecls is a hoisted convenience list, the canonical AST
    // visit happened during walkMarkupNodes.
    if (gates.has(channel.id)) continue;
    const gate = buildChannelGate(channel, fileAST, role, authAttr);
    gates.set(channel.id, gate);
    gateToEntryPoint.set(channel.id, fileAST.filePath);
  }
}

// ---------------------------------------------------------------------------
// AuthGate constructors — one per AuthSiteKind
// ---------------------------------------------------------------------------

/** Build a program-auth gate. The `role` slot carries the auth-mode
 *  verbatim (e.g. "required" / "optional") — A-3.3 will read this as the
 *  predicate during classification. */
function buildProgramGate(programNode: MarkupNode, fileAST: FileAST): AuthGate {
  const authConfig = fileAST.authConfig;
  const role = authConfig ? authConfig.auth : null;
  return {
    siteKind: "program-auth",
    nodeId: programNode.id,
    filePath: fileAST.filePath,
    span: programNode.span,
    role,
    gateExpr: null,
    check: null,
    redirect: authConfig?.loginRedirect ?? null,
    classification: null,
    rawPredicate: `auth="${role ?? ""}"`,
  };
}

/** Build a page-auth gate. `role` carries the auth-mode verbatim from
 *  the `<page auth=>` attr; `redirect` carries `loginRedirect=` when
 *  present on the same `<page>`. */
function buildPageGate(
  pageNode: MarkupNode,
  fileAST: FileAST,
  role: string | null,
  authAttr: AttrNode,
): AuthGate {
  const loginRedirectAttr = findAttr(pageNode.attrs, "loginRedirect");
  const redirect = loginRedirectAttr ? readStringAttr(loginRedirectAttr) : null;
  return {
    siteKind: "page-auth",
    nodeId: pageNode.id,
    filePath: fileAST.filePath,
    span: authAttr.span ?? pageNode.span,
    role,
    gateExpr: null,
    check: null,
    redirect,
    classification: null,
    rawPredicate: `auth="${role ?? ""}"`,
  };
}

/** Build an auth-role-block gate. `role` is the `role=` attr value
 *  verbatim (e.g. "admin", "admin,dispatcher"); `check` is the `check=`
 *  attr value (server-fn ref) when present; `redirect` reads from
 *  `else=` first, then falls back to `redirect=` (both forms accepted
 *  per the registered allow-list). */
function buildAuthBlockGate(authNode: MarkupNode, fileAST: FileAST): AuthGate {
  const roleAttr = findAttr(authNode.attrs, "role");
  const role = roleAttr ? readStringAttr(roleAttr) : null;
  const checkAttr = findAttr(authNode.attrs, "check");
  const check = checkAttr ? readStringAttr(checkAttr) : null;
  const elseAttr = findAttr(authNode.attrs, "else");
  const redirectAttr = findAttr(authNode.attrs, "redirect");
  const redirect = elseAttr
    ? readStringAttr(elseAttr)
    : redirectAttr
      ? readStringAttr(redirectAttr)
      : null;

  // rawPredicate joins the gate-defining attrs for diagnostic printing.
  const parts: string[] = [];
  if (roleAttr) parts.push(`role="${role ?? ""}"`);
  if (checkAttr) parts.push(`check="${check ?? ""}"`);

  return {
    siteKind: "auth-role-block",
    nodeId: authNode.id,
    filePath: fileAST.filePath,
    span: roleAttr?.span ?? checkAttr?.span ?? authNode.span,
    role,
    gateExpr: null,
    check,
    redirect,
    classification: null,
    rawPredicate: parts.length > 0 ? parts.join(" ") : "<malformed>",
  };
}

/** Build a channel-auth gate. Per OQ-A3-D recommendation, channel-auth
 *  is binary closed-form — `role` carries the auth-mode verbatim
 *  ("required"/"optional"), A-3.3 will classify as gated_for_role = ALL
 *  non-anonymous variants. */
function buildChannelGate(
  channelNode: ChannelDeclNode,
  fileAST: FileAST,
  role: string | null,
  authAttr: AttrNode,
): AuthGate {
  return {
    siteKind: "channel-auth",
    nodeId: channelNode.id,
    filePath: fileAST.filePath,
    span: authAttr.span ?? channelNode.span,
    role,
    gateExpr: null,
    check: null,
    redirect: null,
    classification: null,
    rawPredicate: `auth="${role ?? ""}"`,
  };
}

// ---------------------------------------------------------------------------
// A-3.4 — auth-redirect cross-ref
// ---------------------------------------------------------------------------

/**
 * Project each gate's redirect target into the `redirectTargets` map and
 * cross-ref against `RouteMap.pages`. Emits two distinct diagnostics under
 * a TWO-TIER severity model (per OQ-1 ratification at
 * `docs/changes/03-contact-book-auth-redirect-SCOPING/SCOPING.md` §5):
 *
 *   1. `I-AUTH-REDIRECT-UNRESOLVED` (info, gate-local) — fires once per
 *      gate when that gate's specific redirect path does NOT match any
 *      `RouteMap.pages` entry. Surfaces typos / unimplemented routes
 *      WITHOUT escalating; the per-gate redirect is the page-author's
 *      concern per OQ-A2-E + OQ-A3-B (a) S90 ratification.
 *
 *   2. `W-AUTH-LOGIN-MISSING` (warning, compilation-scoped) — fires AT
 *      MOST ONCE per compilation when the structural gap is total: every
 *      gate that names a redirect names a target that does not resolve.
 *      Points adopters at `scrml generate auth` to scaffold a working
 *      login page. The S86 03-contact-book latent bug:
 *      `<program auth="required">` declared but no `/login` page exists
 *      anywhere in the compilation unit — the runtime 302 redirects to
 *      a 404, producing the e2e test tolerance window.
 *
 * Behaviour (per OQ-A3-B (a) S90 ratification — bare-string disposition):
 *   - Iterate every gate in `gates`.
 *   - Read `gate.redirect` verbatim (already extracted at enumeration time
 *     in build*Gate constructors from `FileAST.authConfig.loginRedirect`,
 *     `<page loginRedirect=>`, or `<auth else=/redirect=>`).
 *   - If the gate has no redirect, store `null` in `redirectTargets`.
 *   - If the gate has a redirect and `routeMap` is provided, scan
 *     `routeMap.pages.values()` for a matching `urlPattern`.
 *   - If no `pages` entry matches the redirect path, emit one
 *     `I-AUTH-REDIRECT-UNRESOLVED` diagnostic per unresolved gate.
 *   - When `routeMap` is `null` (unit-test mode), the projection still
 *     records redirect strings but emits no diagnostics — RouteMap is
 *     required to confirm resolution.
 *   - After the per-gate sweep, if at least one gate named a redirect
 *     target AND no gate's redirect resolved, emit ONE
 *     `W-AUTH-LOGIN-MISSING` warning anchored at the first gate that
 *     named a redirect.
 *
 * Per OQ-A2-E ratified S89: A-3.4 does NOT synthesize new entry-points.
 * The redirect target IS its own entry-point (if it exists in RouteMap);
 * absence is the page-author's concern, surfaced as INFO not ERROR for
 * the per-gate case and WARNING for the structural-gap case (so adopters
 * notice the missing /login page loudly enough to act).
 *
 * Per SPEC §40.4 + route-inference.ts:2443: when `<program auth=>` is set
 * but no explicit `loginRedirect=` is provided, RI defaults `loginRedirect`
 * to `"/login"`. A-3.4 preserves this default verbatim — the AuthConfig
 * already carries the resolved string.
 *
 * @param gates           — enumerated gates from A-3.1 (with `gate.redirect`
 *                          already extracted).
 * @param routeMap        — RI output. NULL skips diagnostic emission.
 * @param redirectTargets — output map; populated in-place.
 * @param errors          — diagnostic stream; appended in-place.
 */
function crossRefRedirects(
  gates: Map<MarkupNodeId, AuthGate>,
  routeMap: RouteMap | null,
  redirectTargets: Map<MarkupNodeId, string | null>,
  errors: AuthGraphDiagnostic[],
): void {
  // Build a fast lookup set of URL patterns from RouteMap.pages for
  // O(gates) total cost rather than O(gates × pages).
  const urlPatterns: Set<string> | null = routeMap
    ? collectUrlPatterns(routeMap)
    : null;

  // Track structural-gap state for the W-AUTH-LOGIN-MISSING tier-2 lint.
  // The tier-2 fires once per compilation when EVERY redirect-naming gate
  // failed to resolve — i.e., no working login page exists anywhere.
  let firstRedirectGate: AuthGate | null = null;
  let anyResolved = false;
  const unresolvedTargets = new Set<string>();

  for (const [nodeId, gate] of gates) {
    const redirect = gate.redirect;

    // Always record — null when the gate has no redirect, string verbatim
    // when it does. Consumer (A-2.5) reads this map directly.
    redirectTargets.set(nodeId, redirect);

    // Cross-ref to RouteMap.pages is best-effort. NULL redirect means
    // nothing to resolve. NULL routeMap means we're in unit-test mode
    // and can't verify — skip the diagnostic.
    if (redirect == null) continue;
    if (urlPatterns == null) continue;

    // Stable first-gate anchor for the tier-2 W-AUTH-LOGIN-MISSING site.
    // Iteration order over Map respects insertion order — and gates were
    // inserted in walk order — so this picks the lexically-first gate
    // that names a redirect.
    if (firstRedirectGate == null) firstRedirectGate = gate;

    if (urlPatterns.has(redirect)) {
      anyResolved = true;
    } else {
      unresolvedTargets.add(redirect);
      // Tightened S94: name the concrete fix command (`scrml generate
      // auth`) and the scaffold output path so the adopter has a
      // copy-pasteable resolution. For redirects other than the default
      // `/login`, suggest `--target-dir` so the adopter can place the
      // scaffold under the matching page path.
      const fixHint = redirect === "/login"
        ? `Run \`scrml generate auth\` to scaffold a working login page at \`pages/login.scrml\`.`
        : `Run \`scrml generate auth --target=./pages${redirect}.scrml\` to scaffold a working login page at the redirect path.`;
      errors.push({
        code: "I-AUTH-REDIRECT-UNRESOLVED",
        severity: "info",
        message:
          `Auth gate redirect target "${redirect}" does not match any ` +
          `page URL pattern in the route map. Either author a page at ` +
          `this path, or correct the redirect target. ${fixHint} ` +
          `(SPEC §40.1.1.)`,
        span: gate.span,
        filePath: gate.filePath,
      });
    }
  }

  // Tier-2 structural-gap signal — W-AUTH-LOGIN-MISSING.
  //
  // Fires when at least one gate names a redirect target AND no gate's
  // redirect actually resolves to a page in RouteMap.pages. This is the
  // S86 03-contact-book latent bug shape: <program auth="required">
  // declared, default loginRedirect="/login" produced by RI, but no
  // /login page authored anywhere. Per OQ-1 two-tier ratification: the
  // info-level per-gate I-AUTH-REDIRECT-UNRESOLVED is too quiet (commonly
  // suppressed) to surface this structural gap loudly enough. The
  // warning points at `scrml generate auth` so adopters have an exit
  // path that doesn't require authoring the page from scratch.
  if (firstRedirectGate != null && !anyResolved && unresolvedTargets.size > 0) {
    const targets = [...unresolvedTargets].map(t => `"${t}"`).join(", ");
    // Tightened S94: lead with the actionable `scrml generate auth`
    // command and name the exact file the scaffold writes
    // (`pages/login.scrml`) so the adopter has a one-line fix.
    // The "author manually" alternative is preserved as a secondary
    // path for adopters who need a custom login flow.
    errors.push({
      code: "W-AUTH-LOGIN-MISSING",
      severity: "warning",
      message:
        `Auth gates declare redirect target(s) ${targets} but no page in ` +
        `the compilation unit matches any of these paths. The runtime ` +
        `auth-check will 302 to a 404. Run \`scrml generate auth\` to ` +
        `scaffold a working login page at \`pages/login.scrml\` — ` +
        `or author one at the redirect path manually. (SPEC §40.1.1.)`,
      span: firstRedirectGate.span,
      filePath: firstRedirectGate.filePath,
    });
  }
}

/**
 * A-3.5b — content-not-gated security lint (GITI-027 part A).
 *
 * Fires one `W-AUTH-CONTENT-NOT-GATED` WARNING per `<auth role="X">` site.
 *
 * The footgun: `<auth role=>` is currently a JS-chunk-splitting optimization,
 * NOT a content-visibility control. `emit-html.ts` emits the `<auth>` element
 * as a passthrough literal and renders all of its children as static markup
 * into the served HTML payload. The reachability solver DOES compute per-role
 * visibility, but that verdict is consumed ONLY by the route-splitter to scope
 * JS mount sets — HTML emission never consults it. Consequently:
 *
 *   - DEFAULT mode (no --emit-per-route): the gate is a complete no-op for
 *     content; the gated markup + handlers ship to every viewer.
 *   - PER-ROUTE mode: JS mount is role-split, BUT the served HTML still
 *     carries the gated markup verbatim — only behaviour is withheld, not
 *     content.
 *
 * In BOTH modes the gated markup leaks. The message is therefore honest in
 * both: it does NOT claim --emit-per-route fixes the leak, and it directs
 * adopters to enforce sensitive gating server-side rather than relying on
 * `<auth role>` for content secrecy.
 *
 * Severity is WARNING (not info) — this is a security-relevant footgun and an
 * info lint is too quiet to surface it. The lint fires for any auth-role-block
 * gate that names a `role=` value (a real content gate); a check-only `<auth
 * check=>` with no `role=` is out of scope for this content-secrecy warning.
 *
 * @param gates  — enumerated gates from A-3.1.
 * @param errors — diagnostic stream; appended in-place.
 */
function flagContentNotGated(
  gates: Map<MarkupNodeId, AuthGate>,
  errors: AuthGraphDiagnostic[],
): void {
  for (const gate of gates.values()) {
    // Only `<auth role="X">` blocks render content children that leak into
    // the served HTML. Program/page/channel auth are request-boundary gates,
    // not content-subtree gates, and are out of scope for this lint.
    if (gate.siteKind !== "auth-role-block") continue;
    // A role-naming gate is the content-secrecy footgun. A bare `<auth>` or
    // a check-only `<auth check=>` (no role=) is handled by E-AUTH-GRAPH-004
    // / W-AUTH-RUNTIME-FALLBACK and is not this lint's concern.
    if (gate.role == null) continue;

    errors.push({
      code: "W-AUTH-CONTENT-NOT-GATED",
      severity: "warning",
      message:
        `<auth role="${gate.role}"> gates only JS mount/behaviour (and only ` +
        `under --emit-per-route), NOT served HTML content. The gated markup ` +
        `is emitted verbatim into the HTML payload and is visible to ALL ` +
        `viewers regardless of role — including under --emit-per-route, which ` +
        `role-splits JS behaviour but does NOT withhold HTML content. Do not ` +
        `rely on \`<auth role>\` for content secrecy; enforce sensitive ` +
        `gating server-side (e.g. branch in a server-fn / page loader on the ` +
        `authenticated role and omit the sensitive markup from the response). ` +
        `(SPEC §34, §40.9.5.)`,
      span: gate.span,
      filePath: gate.filePath,
    });
  }
}

/**
 * Collect the set of URL patterns from `RouteMap.pages` for redirect
 * cross-ref. `pages` is keyed by file path with `urlPattern` in the value;
 * we project the urlPattern set for O(1) `has` lookups.
 */
function collectUrlPatterns(routeMap: RouteMap): Set<string> {
  const out = new Set<string>();
  for (const pageRoute of routeMap.pages.values()) {
    if (pageRoute && typeof pageRoute.urlPattern === "string") {
      out.add(pageRoute.urlPattern);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// AST walking + attr utilities
// ---------------------------------------------------------------------------

/**
 * Recursive markup walker. Visits every MarkupNode in the AST tree,
 * including nested markup inside `<page>` / `<auth>` / `<channel>` bodies.
 *
 * Skips text / comment / logic / sql / style / meta nodes — they have no
 * gate semantics. Recurses into MarkupNode children only.
 */
function walkMarkupNodes(
  nodes: ASTNode[] | undefined,
  visit: (node: MarkupNode) => void,
): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node) continue;
    if (node.kind === "markup") {
      visit(node);
      walkMarkupNodes(node.children, visit);
    }
    // Skip other node kinds — gates only live on markup nodes per SCOPING.
  }
}

/** Find the file's top-level `<program>`, if any — the first with no `<program>`
 *  / `<page>` ancestor, whatever markup wraps it (the ONE shared role definition,
 *  program-role.ts; §4.12, S445). It is the node whose `auth=` became
 *  `authConfig`, so the program gate is anchored to the program that declared it. */
function findProgramNode(nodes: ASTNode[], roleOpts: ProgramRoleOptions = {}): MarkupNode | null {
  return findTopLevelProgram(nodes ?? [], roleOpts) as MarkupNode | null;
}

/** Lookup an attribute by name on a markup node's attr list. */
function findAttr(attrs: AttrNode[] | undefined, name: string): AttrNode | null {
  if (!Array.isArray(attrs)) return null;
  for (const attr of attrs) {
    if (attr?.name === name) return attr;
  }
  return null;
}

/**
 * Extract the string-literal value from an AttrNode. Returns the literal
 * verbatim for string-literal attrs; returns `null` for absent / interpolated /
 * expression attrs (interpolation-bearing forms are slot-reserved for
 * gateExpr, but per OQ-A3-A v0.3 grammar there is no interpolation surface
 * — the attribute-registry pins `supportsInterpolation: false`).
 */
function readStringAttr(attr: AttrNode | null | undefined): string | null {
  if (!attr) return null;
  const value = attr.value;
  if (!value) return null;
  if (value.kind === "string-literal") {
    return value.value ?? null;
  }
  if (value.kind === "absent") return null;
  // Other value shapes (variable-ref / call-ref / expr / props-block)
  // do not preserve a plain string. A-3.1 returns null; A-3.3 will
  // re-walk for interpolation forms when OQ-A3-A grammar admits them.
  return null;
}

/**
 * Resolve the entry-point id for a `<page>` or `<auth>` gate.
 *
 * Page-auth: the page IS its own entry-point. The PageRoute key in
 * `routeMap.pages` is the file path (per route-inference.ts:2532), so
 * we use the file path itself as the EntryPointId proxy. The EntryPointId
 * shape is finalized by A-2.2.a; A-3.1 records what we have.
 *
 * Auth-role-block: the enclosing page is the entry-point. For v0.3 with
 * file-based routing, the file path is the page identity, so we use the
 * file path as the entry-point id (matching the page-auth handling).
 *
 * Returns the file path verbatim as a string. A-2.5 / A-4 are responsible
 * for translating to the canonical EntryPointId once that surface lands.
 */
function resolvePageEntryPoint(
  _node: MarkupNode,
  fileAST: FileAST,
  _routeMap: RouteMap | null,
): EntryPointId {
  // Per SCOPING §2.1 + OQ-A2-E ratification: no synthesis. We record
  // the file path; A-2.2.a's EntryPointId scheme will canonicalize.
  return fileAST.filePath;
}

// ---------------------------------------------------------------------------
// A-3.2 — Role enum resolution (per SCOPING §A-3.2 + OQ-A3-F ratified S90)
// ---------------------------------------------------------------------------

/**
 * Discover the app-scope role enum per SPEC §40.1.1 line 17157
 * ("single scrml-native `:enum` type declared at app scope").
 *
 * Per OQ-A3-F ratified S90, A-3.2 implements a (b)+(c) **dual rule** with
 * reconciliation, falling through to E-AUTH-GRAPH-002 on ambiguity:
 *
 *   (b) Reference-based discovery (PRIMARY) — walk the enumerated gate
 *       set's `role=` attribute values. For each value that is a
 *       recognized enum-variant identifier (case-sensitive match against
 *       a declared enum's variants), record the enum that owns it.
 *       Exactly one match → use it.
 *
 *   (c) Entry-file `<program>`-body-scope discovery (FALLBACK) — when (b)
 *       yields zero matches OR multiple distinct enums, look at the entry
 *       file's `<program>` body for enum declarations. The first enum
 *       declared at app entry scope is the role enum.
 *
 *   Reconciliation — if (b) finds exactly one enum, use it. If (b) finds
 *   zero, use (c). If (b) finds multiple, check (c); if (c) matches one
 *   of the (b) candidates, use it; otherwise fire E-AUTH-GRAPH-002.
 *
 * Empty-role-enum + no-role-enum handling (per dispatch brief A-3.2.b):
 *   - No auth gates anywhere + no role enum found → synthesize
 *     `_anonymous` single-variant enum per PIPELINE Stage 7.6 line 2380.
 *   - Auth gates present but no role enum found → fire E-AUTH-GRAPH-002
 *     with diagnostic citing the gates that reference variants.
 *
 * @param files — per-file ASTs from TAB. Used to enumerate TypeDeclNode
 *   candidates across the whole corpus AND to identify the entry-file
 *   `<program>` body for (c).
 * @param gates — per-gate records produced by `runAuthGraph`'s
 *   enumeration pass. Used as the (b)-rule input.
 * @param errors — diagnostic sink. E-AUTH-GRAPH-002 fires here when the
 *   dual rule cannot reconcile to exactly one enum AND auth gates exist.
 */
export function resolveRoleEnum(
  files: FileAST[],
  gates: Map<MarkupNodeId, AuthGate>,
  errors: AuthGraphDiagnostic[],
): RoleEnum | null {
  // Step 1: collect ALL enum declarations across the corpus. Each entry
  // pairs an enum's name + parsed variant list + the file it was declared
  // in + its source span. Enums hoisted to FileAST.typeDecls are the
  // canonical source — this includes enums declared inside `<program>`
  // bodies AND top-level scope (TAB hoists both per ast-builder.js).
  const enumCandidates = collectEnumCandidates(files);
  if (enumCandidates.length === 0) {
    return handleNoEnumFound(gates, errors, files);
  }

  // Step 2: (b) reference-based discovery — find which enums own the
  // variant names appearing in <auth role="X"> attribute values.
  const referencedEnums = findEnumsReferencedByGates(gates, enumCandidates);

  // Step 3: dispatch on the (b) result.
  if (referencedEnums.length === 1) {
    // (b) found exactly one — use it. This is the empirical signal.
    return buildRoleEnum(referencedEnums[0]!, false);
  }

  if (referencedEnums.length === 0) {
    // (b) found nothing — fall to (c) entry-file program-body scope.
    const entryEnum = findEntryFileProgramScopeEnum(files, enumCandidates);
    if (entryEnum) {
      return buildRoleEnum(entryEnum, false);
    }
    // (c) also found nothing — handle no-enum-found path.
    return handleNoEnumFound(gates, errors, files);
  }

  // (b) found MULTIPLE distinct enums — reconcile with (c).
  const entryEnum = findEntryFileProgramScopeEnum(files, enumCandidates);
  if (entryEnum) {
    const matched = referencedEnums.find(
      (cand) => cand.name === entryEnum.name && cand.filePath === entryEnum.filePath,
    );
    if (matched) return buildRoleEnum(matched, false);
  }
  // Reconciliation failed — ambiguous. Fire E-AUTH-GRAPH-002.
  fireAmbiguousEnumDiagnostic(referencedEnums, gates, errors);
  return null;
}

/**
 * An enum candidate — a declared `:enum` type, paired with its parsed
 * variants and source location. Internal to A-3.2; not exported.
 */
interface EnumCandidate {
  name: string;
  variants: string[];
  filePath: string;
  span: Span;
  /** True when this candidate was declared inside a `<program>` body
   *  (vs hoisted from a top-level logic block). Drives the (c) fallback. */
  inProgramScope: boolean;
}

/**
 * Walk every `FileAST.typeDecls` AND every `<program>` body's nested
 * LogicNode typeDecls to enumerate every `:enum` declaration in the
 * compilation corpus. Each returned candidate carries the file path +
 * span + an `inProgramScope` flag for (c)-rule disambiguation.
 *
 * Variant lists are parsed via `parseEnumVariantsFromRaw` (a local copy
 * of the symbol-table.ts:4426 parser logic, scoped to A-3.2's needs).
 *
 * Empty-variant enums (e.g. `type Role: enum`) are still recorded as
 * candidates with `variants: []` — A-3.2.b uses the corpus position
 * (entry-file program-scope) to disambiguate; an empty enum that wins
 * the role-enum slot will downstream-trigger reachability behaviour
 * (no variants → no gated_for_role surfaces → A-2.5 worst-case).
 */
function collectEnumCandidates(files: FileAST[]): EnumCandidate[] {
  const out: EnumCandidate[] = [];

  for (const fileAST of files) {
    if (!fileAST) continue;

    // FileAST.typeDecls is the hoisted list of all type-decls in the
    // file (across all logic blocks). We use this as the canonical
    // source so we don't need to re-walk the AST tree for `:enum`
    // declarations.
    const hoisted = fileAST.typeDecls ?? [];
    for (const decl of hoisted) {
      if (!isEnumDecl(decl)) continue;
      out.push({
        name: decl.name,
        variants: parseEnumVariantsFromRaw(decl.raw ?? ""),
        filePath: fileAST.filePath,
        span: decl.span,
        inProgramScope: isDeclInProgramScope(decl, fileAST),
      });
    }
  }

  return out;
}

/**
 * (b)-rule: which enums own variant names referenced by `<auth role=>`
 * attribute values in the gate set?
 *
 * For each gate with a non-null `role` field that is a SINGLE bare
 * identifier (case-sensitive enum-variant shape), check which enum
 * candidates declare that variant. Multiple enums declaring the SAME
 * variant name → all of them are added to the candidate pool (the
 * caller's reconciliation rule handles the ambiguity).
 *
 * Skips:
 *   - gates with `role: null` (channel-auth without role, malformed gates).
 *   - gates whose role is a builtin auth-mode token ("required" /
 *     "optional" / "none") — these are program-auth / page-auth /
 *     channel-auth keywords, not role-enum-variant references.
 *   - comma-separated forms (`"admin,dispatcher"`) — A-3.2 reads only
 *     bare identifiers for the (b) rule; A-3.3 handles complex predicate
 *     parsing during classification.
 *
 * Returns the deduplicated set of enums (by name+filePath) referenced.
 */
function findEnumsReferencedByGates(
  gates: Map<MarkupNodeId, AuthGate>,
  enumCandidates: EnumCandidate[],
): EnumCandidate[] {
  const builtinAuthModes = new Set(["required", "optional", "none"]);
  const matched: EnumCandidate[] = [];
  const seen = new Set<string>();  // key: name + "\x00" + filePath

  for (const gate of gates.values()) {
    // Only auth-role-block gates carry actual variant-identifier role
    // values; program-auth / page-auth / channel-auth carry the auth-mode
    // keyword ("required"/"optional"). Per SCOPING §A-3.2.a, the (b) rule
    // reads `<auth role="X">` specifically.
    if (gate.siteKind !== "auth-role-block") continue;
    const role = gate.role;
    if (!role) continue;
    // Skip if it's a builtin auth-mode keyword (defensive — auth-role-block
    // shouldn't see these, but be paranoid).
    if (builtinAuthModes.has(role)) continue;
    // Only bare identifiers count for (b). A-3.3 will handle complex
    // forms (comma-OR, negation, interpolation) during classification.
    if (!isBareIdentifier(role)) continue;

    for (const cand of enumCandidates) {
      if (!cand.variants.includes(role)) continue;
      const key = `${cand.name}\x00${cand.filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push(cand);
    }
  }

  return matched;
}

/**
 * (c)-rule: discover the role enum by structural position — the first
 * enum declared inside the entry file's `<program>` body scope.
 *
 * "Entry file" heuristic (no normative SPEC text exists yet; A-3.5 will
 * formalize when integration wiring lands):
 *   - The first file in `files[]` with `hasProgramRoot: true`.
 *   - If none have a program root, the first file with at least one
 *     enum-in-program-scope candidate.
 *
 * "Program-body-scope" enum: an EnumCandidate whose `inProgramScope`
 * flag is true (set by `collectEnumCandidates`).
 *
 * Returns null when no entry-file enum exists.
 */
function findEntryFileProgramScopeEnum(
  files: FileAST[],
  enumCandidates: EnumCandidate[],
): EnumCandidate | null {
  // Prefer files with hasProgramRoot=true.
  const entryFile = files.find((f) => f && f.hasProgramRoot) ?? files[0];
  if (!entryFile) return null;

  // First enum in the entry file's program scope. We iterate
  // `enumCandidates` in collection order (which is FileAST.typeDecls
  // declaration order per `collectEnumCandidates`) — this gives a
  // deterministic "first" for repeated runs.
  for (const cand of enumCandidates) {
    if (cand.filePath !== entryFile.filePath) continue;
    if (!cand.inProgramScope) continue;
    return cand;
  }

  // Fallback: first enum in the entry file regardless of scope. This
  // matches the spirit of "app entry scope" when the entry file has
  // its enum declared at top-level (which TAB still hoists to
  // FileAST.typeDecls; the inProgramScope flag may be false).
  for (const cand of enumCandidates) {
    if (cand.filePath === entryFile.filePath) return cand;
  }
  return null;
}

/**
 * Build a `RoleEnum` record from a winning candidate. The
 * `isImplicitAnonymous: false` flag indicates a real adopter-declared
 * enum (vs the synthesized `_anonymous` fallback).
 */
function buildRoleEnum(cand: EnumCandidate, isImplicitAnonymous: boolean): RoleEnum {
  return {
    name: cand.name,
    variants: cand.variants.slice() as RoleVariant[],
    span: cand.span,
    filePath: cand.filePath,
    isImplicitAnonymous,
  };
}

/**
 * Handle the no-enum-found path per dispatch brief A-3.2.b:
 *
 *   - If NO auth gates anywhere AND no role enum → synthesize the
 *     `_anonymous` single-variant floor per PIPELINE Stage 7.6 line 2380.
 *     Adopter is building a no-auth app.
 *   - If at least one gate REFERENCES a role-enum variant (i.e. an
 *     `<auth role="X">` block where X is a bare-identifier) AND no role
 *     enum is declared → fire E-AUTH-GRAPH-002. Per OQ-A2-F, E-CLOSURE-002
 *     fires from A-2.5; A-3.2 surfaces the compile-time signal.
 *   - If only binary auth gates (program-auth / page-auth / channel-auth
 *     with `auth="required"`/`"optional"`) exist and no role enum is
 *     declared → no diagnostic; synthesize the `_anonymous` floor so
 *     downstream traversal still has a role to dispatch on. These gates
 *     are not role-variant references; they don't require a role enum.
 */
function handleNoEnumFound(
  gates: Map<MarkupNodeId, AuthGate>,
  errors: AuthGraphDiagnostic[],
  files: FileAST[],
): RoleEnum | null {
  const variantReferencingGates = gatesThatReferenceVariants(gates);

  if (gates.size === 0 || variantReferencingGates.length === 0) {
    // No variant-referencing gates — synthesize the anonymous floor.
    // This covers both the "no auth at all" case and the "only binary
    // gates" case (program-auth / page-auth / channel-auth with
    // auth=required which doesn't reference role-enum variants).
    return synthesizeAnonymousEnum(files);
  }

  // Variant-referencing gates exist but no role enum declared anywhere.
  // Fire E-AUTH-GRAPH-002 with the first such gate as the span anchor.
  const firstGate = variantReferencingGates[0]!;
  errors.push({
    code: "E-AUTH-GRAPH-002",
    severity: "error",
    message:
      "auth gates reference role variants but no `:enum` is declared at app scope. " +
      "Declare a single `:enum` type with variants matching the values referenced by " +
      "`<auth role=>` blocks (SPEC §40.1.1).",
    span: firstGate.span,
    filePath: firstGate.filePath,
  });
  return null;
}

/**
 * Filter: which gates carry a role-enum-variant reference (an
 * `<auth role="X">` block where X is a bare identifier — the (b) rule
 * input shape)? Returns gates in iteration order for deterministic
 * first-fire-site selection.
 */
function gatesThatReferenceVariants(
  gates: Map<MarkupNodeId, AuthGate>,
): AuthGate[] {
  const builtinAuthModes = new Set(["required", "optional", "none"]);
  const out: AuthGate[] = [];
  for (const gate of gates.values()) {
    if (gate.siteKind !== "auth-role-block") continue;
    const role = gate.role;
    if (!role) continue;
    if (builtinAuthModes.has(role)) continue;
    if (!isBareIdentifier(role)) continue;
    out.push(gate);
  }
  return out;
}

/**
 * Synthesize the `_anonymous` single-variant floor enum per PIPELINE
 * Stage 7.6 line 2380. Anchors the span to the entry file when one is
 * available; falls back to `<synthesized>` otherwise.
 */
function synthesizeAnonymousEnum(files: FileAST[]): RoleEnum {
  const fallbackFile = files.find((f) => f && f.hasProgramRoot) ?? files[0];
  const fallbackSpan: Span = {
    file: fallbackFile?.filePath ?? "<synthesized>",
    start: 0,
    end: 0,
    line: 1,
    col: 1,
  };
  return {
    name: "_anonymous",
    variants: ["_anonymous"] as RoleVariant[],
    span: fallbackSpan,
    filePath: fallbackFile?.filePath ?? "<synthesized>",
    isImplicitAnonymous: true,
  };
}

/**
 * Fire E-AUTH-GRAPH-002 for the ambiguous-multi-enum case: (b) found
 * multiple enums AND (c) did NOT resolve. Diagnostic message lists the
 * conflicting candidate names so the adopter can disambiguate by
 * collapsing to a single enum or by declaring one at entry-file
 * program scope.
 */
function fireAmbiguousEnumDiagnostic(
  candidates: EnumCandidate[],
  gates: Map<MarkupNodeId, AuthGate>,
  errors: AuthGraphDiagnostic[],
): void {
  const names = candidates.map((c) => `\`${c.name}\``).join(", ");
  const firstGate = gates.values().next().value as AuthGate | undefined;
  const span: Span = candidates[0]?.span ?? firstGate?.span ?? {
    file: "<unknown>", start: 0, end: 0, line: 1, col: 1,
  };
  errors.push({
    code: "E-AUTH-GRAPH-002",
    severity: "error",
    message:
      `auth-role gate values match variants from multiple distinct \`:enum\` types ` +
      `(${names}); add a single role enum at the entry file's \`<program>\` body ` +
      `scope to disambiguate (SPEC §40.1.1). The (b)+(c) discovery dual rule could ` +
      `not reconcile to a single enum.`,
    span,
    filePath: candidates[0]?.filePath ?? firstGate?.filePath ?? "<unknown>",
  });
}

// ---------------------------------------------------------------------------
// A-3.2 helpers — enum decl detection + variant parsing
// ---------------------------------------------------------------------------

/** True when the node is a `type X : enum` declaration. */
function isEnumDecl(decl: ASTNode | TypeDeclNode | null | undefined): decl is TypeDeclNode {
  if (!decl || typeof decl !== "object") return false;
  if ((decl as TypeDeclNode).kind !== "type-decl") return false;
  return (decl as TypeDeclNode).typeKind === "enum";
}

/**
 * Heuristic: was the TypeDeclNode declared inside a `<program>` body's
 * logic block? FileAST.typeDecls is the hoisted aggregate, so we have
 * to walk the AST to find which LogicNode owned the original
 * declaration.
 *
 * Identifies a decl as "in program scope" when:
 *   - The file has a `<program>` markup root, AND
 *   - The decl appears in a LogicNode whose parent chain includes the
 *     `<program>` markup node.
 *
 * For the purposes of A-3.2's (c) rule, we accept any enum hoisted from
 * a logic block whose parent chain reaches the `<program>` element. A
 * pragmatic match is sufficient — the worked example in SPEC §40.9.9
 * places the enum inside the entry file at file scope.
 *
 * Implementation: walk the AST from the file's nodes, tracking when
 * we're inside a `<program>` subtree, and look for the decl by
 * reference equality + by (name, raw) tuple. We never mutate the AST.
 */
function isDeclInProgramScope(decl: TypeDeclNode, fileAST: FileAST): boolean {
  if (!fileAST.hasProgramRoot) return false;
  return findDeclInProgramSubtree(fileAST.nodes, decl, false);
}

/**
 * Recursive search: traverse the AST in document order; toggle
 * `insideProgram=true` once we descend into the `<program>` markup
 * subtree. Within that subtree, any LogicNode whose typeDecls list
 * contains the target decl returns true.
 */
function findDeclInProgramSubtree(
  nodes: ASTNode[] | undefined,
  target: TypeDeclNode,
  insideProgram: boolean,
): boolean {
  if (!Array.isArray(nodes)) return false;
  for (const node of nodes) {
    if (!node) continue;
    if (node.kind === "markup") {
      const enteringProgram = node.tag === "program";
      const childInside = insideProgram || enteringProgram;
      if (findDeclInProgramSubtree(node.children, target, childInside)) {
        return true;
      }
    } else if (node.kind === "logic" && insideProgram) {
      const td = node.typeDecls ?? [];
      for (const candidate of td) {
        if (candidate === target) return true;
        // Reference equality may fail if the hoisting pass cloned the
        // node. Fall back to structural match on the load-bearing fields.
        if (
          candidate
          && candidate.name === target.name
          && candidate.typeKind === target.typeKind
          && candidate.raw === target.raw
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Parse an enum body's raw text to extract variant names. Mirrors
 * `symbol-table.ts:4426` parseEnumVariantNamesFromRaw — scoped to
 * A-3.2's needs. Returns an empty array for malformed / empty bodies.
 *
 * Recognizes:
 *   - Comma / newline / pipe separators between variants at paren depth 0.
 *   - `transitions { ... }` block (stripped — variants come first).
 *   - Payload-list `(field:type)` (stripped from variant name).
 *   - `renders ...` suffix (stripped from variant name).
 *   - Standard variant-name shape: `^[A-Z][A-Za-z0-9_]*$`.
 *
 * Empty enums (`type Role: enum` or `type Role: enum = {}`) return [].
 */
function parseEnumVariantsFromRaw(raw: string): string[] {
  const out: string[] = [];
  let body = (raw || "").trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return out;

  // Strip a `transitions { ... }` block if present (engine-decl form).
  let variantsSection = body;
  {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
      if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
      if (depth === 0 && body.slice(i).startsWith("transitions")) {
        const after = body.slice(i + "transitions".length).trimStart();
        if (after.startsWith("{")) {
          variantsSection = body.slice(0, i).trim();
          break;
        }
      }
    }
  }

  // Split on `\n`, `,`, and `|` at paren depth 0.
  const segments: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < variantsSection.length; i++) {
    const ch = variantsSection[i]!;
    if (ch === "(" || ch === "[" || ch === "{") { depth++; buf += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; buf += ch; continue; }
    if (depth === 0 && (ch === "\n" || ch === "," || ch === "|")) {
      if (buf.trim()) segments.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) segments.push(buf.trim());

  for (const seg of segments) {
    let text = seg;
    const paren = text.indexOf("(");
    if (paren >= 0) text = text.slice(0, paren).trim();
    const rendersIdx = text.indexOf(" renders ");
    if (rendersIdx >= 0) text = text.slice(0, rendersIdx).trim();
    if (!text) continue;
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(text)) continue;
    out.push(text);
  }
  return out;
}

/** Bare-identifier regex — single PascalCase / lowercase identifier. */
function isBareIdentifier(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.trim());
}

// ---------------------------------------------------------------------------
// A-3.3 — Per-gate classifier (closed-form vs runtime-fallback)
// ---------------------------------------------------------------------------

/**
 * Classify each gate's predicate against the resolved role enum. Populates
 * `gate.classification` in-place on the `AuthGate` records in `gates`.
 *
 * Dispatch by `siteKind` (per SCOPING §A-3.3.a):
 *
 *   - `program-auth` / `page-auth` (binary):
 *       `"required"` → closed-form, `gated_for_role` = all variants EXCEPT
 *                      the anonymous floor (i.e. the user-declared variants
 *                      whose name is not `_anonymous`). If the role enum
 *                      is the synthesized `_anonymous` floor, the gated
 *                      set is empty (no one passes a required gate when
 *                      no authenticated roles exist).
 *       `"optional"` → closed-form, `gated_for_role` = all variants
 *                      (no exclusion — `optional` admits everyone).
 *       `"none"`     → already filtered at A-3.1 (no gate enumerated).
 *
 *   - `channel-auth` (binary; per OQ-A3-D ratified S90):
 *       same shape as program-auth / page-auth.
 *
 *   - `auth-role-block` (`<auth role=...>`): per OQ-A3-A (d) ratified S90,
 *     dispatch on the role attribute's AttrValue shape:
 *       - `string-literal` ("admin" / "admin,dispatcher" / "!anonymous")
 *           → closed-form via static role-spec parser.
 *       - `variable-ref` (`role=publicRoles`) → look up the binding in
 *         the file-scope const env; if it folds to a string constant,
 *         parse as static role-spec. Reactive cells → runtime-fallback.
 *       - `expr` (`role=${expr}`) → fold via META constant-folder; if
 *         constant string → parse; otherwise runtime-fallback.
 *       - `absent` / `call-ref` / `props-block` → runtime-fallback.
 *
 *   - `auth-role-block` with `check=` (async server-fn form per SPEC
 *     §40.9.5 line 17724): always runtime-fallback (the check fn runs
 *     at render time; cannot statically classify per role).
 *
 * Side effects:
 *   - Mutates `gate.classification` in `gates` (sets the verdict).
 *   - Mutates `gate.gateExpr` for ExprAttr / VariableRef forms so the
 *     A-2.5 consumer (which reads `gate_expr` in the runtime-fallback
 *     branch) has the structured ExprNode to forward to A-4 codegen.
 *   - Emits `W-AUTH-PAGE-INFERRED` info-lint into `errors` for each
 *     `<page>` that lacks explicit `auth=` AND sits inside a file whose
 *     `<program auth=>` is `"required"`. The lint nudges adopters to
 *     declare per-page `auth=` for closure-analysis correctness (the
 *     program-level auth still enforces at the request boundary, but
 *     closure analysis runs against the per-page gate surface per
 *     OQ-A3-C (b) explicit-per-page-only ratification).
 */
function classifyGates(
  files: FileAST[],
  gates: Map<MarkupNodeId, AuthGate>,
  roleEnum: RoleEnum | null,
  errors: AuthGraphDiagnostic[],
): void {
  // Build a one-shot reverse index: MarkupNodeId → the AST node whose
  // attributes carry the predicate. Same node ids run through both
  // <auth>/<page>/<program> markup and <channel>; we map every gate-
  // bearing node we walked during enumeration.
  const nodeIndex = new Map<MarkupNodeId, MarkupNode | ChannelDeclNode>();

  // Per-file const-env cache. Building the env walks the file's logic
  // blocks once; classifiers within the file reuse the cached env.
  const constEnvByFile = new Map<string, ConstFoldEnv>();

  // Helper to look up an env lazily — first request per file builds it.
  function envForFile(fileAST: FileAST): ConstFoldEnv {
    const cached = constEnvByFile.get(fileAST.filePath);
    if (cached) return cached;
    const env = buildConstEnvForFile(fileAST);
    constEnvByFile.set(fileAST.filePath, env);
    return env;
  }

  // Index every gate-bearing markup node by id so the classifier can
  // re-read the original AttrValue shape (which A-3.1 does not preserve
  // on AuthGate — only the verbatim string is stored).
  for (const fileAST of files) {
    if (!fileAST) continue;
    indexGateNodes(fileAST, gates, nodeIndex);
    // Per OQ-A3-C (b) S90: emit W-AUTH-PAGE-INFERRED lint per file.
    emitPageInferredLints(fileAST, errors);
  }

  // Now classify each gate.
  for (const gate of gates.values()) {
    const node = nodeIndex.get(gate.nodeId);

    // Resolve the file that hosts this gate so we can pull the const env.
    const fileAST = files.find((f) => f && f.filePath === gate.filePath);
    const env = fileAST ? envForFile(fileAST) : { constBindings: new Map() };

    gate.classification = classifyOneGate(gate, node ?? null, roleEnum, env, errors);
  }
}

/**
 * Index every gate-bearing AST node by id so the classifier can read its
 * original `attrs`. Page-auth + auth-role-block markup nodes are walked
 * via the same generic markup walker A-3.1 uses; channel-auth nodes are
 * pulled from `fileAST.channelDecls`.
 *
 * Only nodes whose id appears in `gates` are indexed — avoids paying for
 * unrelated markup. Program-auth nodes are included for completeness but
 * the classifier never re-reads their attrs (the `role` field on the
 * AuthGate is the canonical surface for the auth-mode keyword).
 */
function indexGateNodes(
  fileAST: FileAST,
  gates: Map<MarkupNodeId, AuthGate>,
  nodeIndex: Map<MarkupNodeId, MarkupNode | ChannelDeclNode>,
): void {
  walkMarkupNodes(fileAST.nodes, (node) => {
    if (gates.has(node.id)) nodeIndex.set(node.id, node);
  });
  const channelDecls = fileAST.channelDecls ?? [];
  for (const channel of channelDecls) {
    if (!channel) continue;
    if (gates.has(channel.id)) nodeIndex.set(channel.id, channel);
  }
}

/**
 * Build a `ConstFoldEnv` for one file by collecting `const`-decl and
 * `const <X>` derived-cell declarations whose initializers fold to constants.
 *
 * Sources scanned:
 *   - Every `LogicNode.body` reached by walking `fileAST.nodes` (covers
 *     top-level logic blocks AND `<program>` / `<page>` body logic blocks).
 *   - Recognized statement kinds:
 *       `const-decl`        — `const x = expr` (plain const).
 *       `state-decl`        — when `isConst: true` (i.e. `const <x> = expr`
 *                              derived-cell form). Reactive cells
 *                              (`<x> = expr` with `isConst: false`) are
 *                              SKIPPED — their value changes at runtime.
 *
 * Each candidate's `initExpr` is partially evaluated. The current env
 * passes earlier bindings as input — so a later const can reference an
 * earlier one (one-pass forward fold; cycles silently break to RUNTIME).
 *
 * Identifiers with `@`-prefix (legacy reactive form) are ignored — A-3.3
 * reads only structural-form names. Cross-file imports are NOT followed
 * (A-3.3's const-resolution surface is intentionally per-file; the
 * worked example places the role-set decl alongside the gate).
 */
function buildConstEnvForFile(fileAST: FileAST): ConstFoldEnv {
  const bindings = new Map<string, ConstValue>();
  const decls = collectConstDecls(fileAST.nodes);

  for (const decl of decls) {
    if (!decl.initExpr) continue;
    const env: ConstFoldEnv = { constBindings: bindings };
    const r: ConstResult = partiallyEvaluateExpr(decl.initExpr, env);
    if (r.kind === "constant") {
      bindings.set(decl.name, r.value);
    }
    // RUNTIME results stay out of the env — they cannot resolve a
    // closed-form predicate, so the classifier falls through to
    // runtime-fallback when an identifier references a runtime-only
    // binding (matches the §40.9.2 worst-case-union semantics).
  }

  return { constBindings: bindings };
}

/**
 * Collect const-shaped declarations from every LogicNode reachable from
 * the file's AST nodes. Returns name + initExpr pairs in document order.
 *
 * Walks both top-level and markup-nested logic blocks (`<program>` /
 * `<page>` bodies contain LogicNodes). Visits any kind of statement and
 * filters for `const-decl` and `state-decl{isConst:true}`.
 */
function collectConstDecls(
  nodes: ASTNode[] | undefined,
): Array<{ name: string; initExpr: ExprNode | undefined }> {
  const out: Array<{ name: string; initExpr: ExprNode | undefined }> = [];

  function visit(node: ASTNode | null | undefined): void {
    if (!node) return;
    if (node.kind === "logic") {
      const logic = node as LogicNode;
      for (const stmt of logic.body ?? []) {
        if (!stmt) continue;
        if (stmt.kind === "const-decl") {
          const decl = stmt as ConstDeclNode;
          out.push({ name: decl.name, initExpr: decl.initExpr });
        } else if (stmt.kind === "state-decl") {
          const decl = stmt as ReactiveDeclNode;
          // Only `const <x> = expr` form is folded — plain reactive
          // cells are runtime-mutable by definition.
          if (decl.isConst === true) {
            out.push({ name: decl.name, initExpr: decl.initExpr });
          }
        }
      }
    } else if (node.kind === "markup") {
      const m = node as MarkupNode;
      for (const child of m.children ?? []) visit(child);
    }
    // Other node kinds (sql, css-inline, etc.) cannot host decls.
  }

  for (const node of nodes ?? []) visit(node);
  return out;
}

/**
 * Per OQ-A3-C (b) S90 ratification — emit `W-AUTH-PAGE-INFERRED` info-lint
 * for each `<page>` lacking explicit `auth=` when the file's
 * `<program auth=>` is `"required"`.
 *
 * Per route-inference.ts:2433 the program-level `authMiddleware` enforces
 * at the request boundary regardless. The lint is a closure-analysis
 * nudge: without explicit per-page `auth=`, A-2.5 has no per-page gate
 * to feed into per-role traversal — the page reads as ungated at the
 * closure-analysis layer.
 *
 * The lint fires once per qualifying `<page>` element (file-scoped scan).
 * Pages WITH explicit `auth=` (already enumerated as a `page-auth` gate
 * by A-3.1) do NOT fire the lint — they're already correctly captured.
 */
function emitPageInferredLints(
  fileAST: FileAST,
  errors: AuthGraphDiagnostic[],
): void {
  if (!fileAST.authConfig) return;
  if (fileAST.authConfig.auth !== "required") return;

  walkMarkupNodes(fileAST.nodes, (node) => {
    if (node.tag !== "page") return;
    const authAttr = findAttr(node.attrs, "auth");
    if (authAttr) return;  // already has explicit auth= — no lint.
    errors.push({
      code: "W-AUTH-PAGE-INFERRED",
      severity: "info",
      message:
        `<page> has no explicit auth= attribute under a <program auth="required"> ` +
        `enclosing scope. Per OQ-A3-C (b) ratification, page-level auth is NOT ` +
        `inherited from <program> for closure analysis; add an explicit auth= ` +
        `attribute to this <page> to participate in per-role chunking. The ` +
        `<program auth="required"> still enforces at the request boundary. ` +
        `(SPEC §40.1.1.)`,
      span: node.span,
      filePath: fileAST.filePath,
    });
  });
}

/**
 * Classify a single gate. Stateless given inputs; returns a
 * `RoleClassification` verdict or null when the gate is malformed and
 * cannot be classified (e.g. an `<auth>` block without `role=` AND
 * without `check=` — also fires E-AUTH-GRAPH-004).
 */
function classifyOneGate(
  gate: AuthGate,
  node: MarkupNode | ChannelDeclNode | null,
  roleEnum: RoleEnum | null,
  env: ConstFoldEnv,
  errors: AuthGraphDiagnostic[],
): RoleClassification | null {
  switch (gate.siteKind) {
    case "program-auth":
    case "page-auth":
    case "channel-auth":
      return classifyBinaryAuthGate(gate, roleEnum);
    case "auth-role-block":
      return classifyAuthRoleBlock(gate, node, roleEnum, env, errors);
  }
}

/**
 * Binary auth-gate classifier (program-auth / page-auth / channel-auth).
 *
 * The gate's `role` field carries the auth-mode keyword verbatim:
 *   - `"required"` → all NON-anonymous variants pass the gate.
 *   - `"optional"` → all variants pass (no exclusion).
 *   - anything else (including `null` for malformed) → runtime-fallback
 *     defensively. SPEC §52 keeps this surface tight; A-3.1 already
 *     filters `"none"` so it should not reach this branch.
 */
function classifyBinaryAuthGate(
  gate: AuthGate,
  roleEnum: RoleEnum | null,
): RoleClassification {
  const mode = gate.role;
  if (mode === "optional") {
    return { closed_form: true, gated_for_role: allVariants(roleEnum) };
  }
  if (mode === "required") {
    return {
      closed_form: true,
      gated_for_role: nonAnonymousVariants(roleEnum),
    };
  }
  // Defensive fallback — unknown auth-mode keywords (would have been
  // rejected upstream by attribute-registry, but be paranoid).
  return { closed_form: false, gate_expr: null };
}

/**
 * `<auth role=...>` block classifier.
 *
 * Reads the original AttrValue shape from the indexed markup node to
 * decide between static-string parsing, const-ref lookup, and
 * constant-folder evaluation. Falls through to runtime-fallback when
 * the predicate is non-foldable.
 *
 * `check=`-form gates (async server-fn check per SPEC §40.9.5 line
 * 17724) are unconditionally runtime-fallback regardless of how
 * `role=` looks — the check fn drives the verdict at render time.
 */
function classifyAuthRoleBlock(
  gate: AuthGate,
  node: MarkupNode | ChannelDeclNode | null,
  roleEnum: RoleEnum | null,
  env: ConstFoldEnv,
  errors: AuthGraphDiagnostic[],
): RoleClassification | null {
  // `<auth check=...>` always runtime-fallback per SPEC §40.9.5 line 17724.
  if (gate.check != null) {
    return { closed_form: false, gate_expr: null };
  }

  // Re-read the role attribute's structured AttrValue to dispatch on
  // its shape (string-literal vs variable-ref vs expr). When the
  // original node is available, the AttrValue tells us the real shape
  // of the predicate — `gate.role` (verbatim string) is null for
  // variable-ref / expr forms but the gate is still well-formed.
  const roleAttrValue = readRoleAttrValue(node);

  // Malformed: no role= attr AND no check= attr → E-AUTH-GRAPH-004.
  // We check this AFTER attempting to read the AttrValue so that
  // variable-ref / expr forms (where gate.role is null but the attr
  // exists with a non-string-literal value) are NOT treated as
  // malformed.
  if (roleAttrValue == null && gate.role == null && gate.check == null) {
    errors.push({
      code: "E-AUTH-GRAPH-004",
      severity: "error",
      message:
        "<auth> block has no `role=` and no `check=` attribute. " +
        "Declare a role predicate (e.g. `<auth role=\"Admin\">`) or a " +
        "server-fn check (`<auth check=\"hasPermission\">`). (SPEC §40.1.1.)",
      span: gate.span,
      filePath: gate.filePath,
    });
    return null;
  }

  if (roleAttrValue != null) {
    return classifyByAttrValue(roleAttrValue, gate, roleEnum, env, errors);
  }

  // Fallback: use the verbatim `gate.role` string (covers unit-test
  // gates synthesized via `string-literal` AttrValue, which is the
  // common case — and matches A-3.1's normalization path).
  if (gate.role != null) {
    return classifyStaticRoleString(gate.role, gate, roleEnum, errors);
  }

  return { closed_form: false, gate_expr: null };
}

/**
 * Dispatch a `<auth role=>` classification by the AttrValue shape.
 *
 * Per OQ-A3-A (d) ratified S90 the four shapes are:
 *   - `string-literal` — parse via `classifyStaticRoleString`.
 *   - `variable-ref`   — look up in const env. Closed-form if the
 *                        identifier resolves to a string constant;
 *                        runtime-fallback otherwise.
 *   - `expr`           — fold via META constant-folder; treat the
 *                        result like a static role string when
 *                        constant.
 *   - `absent` / `call-ref` / `props-block` — runtime-fallback.
 */
function classifyByAttrValue(
  v: AttrValue,
  gate: AuthGate,
  roleEnum: RoleEnum | null,
  env: ConstFoldEnv,
  errors: AuthGraphDiagnostic[],
): RoleClassification {
  if (v.kind === "string-literal") {
    return classifyStaticRoleString(v.value, gate, roleEnum, errors);
  }
  if (v.kind === "variable-ref") {
    // Reactive cells (`@cell`) are runtime by definition.
    if (v.name.startsWith("@")) {
      gate.gateExpr = v.exprNode ?? null;
      return { closed_form: false, gate_expr: gate.gateExpr };
    }
    // Const-ref: look up in the env. If the env has it (i.e. the decl
    // folded to a constant), use that value.
    if (env.constBindings.has(v.name)) {
      const value = env.constBindings.get(v.name)!;
      if (typeof value === "string") {
        return classifyStaticRoleString(value, gate, roleEnum, errors);
      }
      // Non-string const (e.g. an array of strings) — defer to runtime.
      // Future enhancement: accept arrays as variant lists.
    }
    // Unknown identifier OR reactive cell (`<x> = ...`) OR const that
    // didn't fold (depends on runtime). Runtime-fallback.
    gate.gateExpr = v.exprNode ?? null;
    return { closed_form: false, gate_expr: gate.gateExpr };
  }
  if (v.kind === "expr") {
    if (!v.exprNode) {
      return { closed_form: false, gate_expr: null };
    }
    const result = partiallyEvaluateExpr(v.exprNode, env);
    if (result.kind === "constant" && typeof result.value === "string") {
      return classifyStaticRoleString(result.value, gate, roleEnum, errors);
    }
    if (result.kind === "constant" && typeof result.value === "boolean") {
      // Boolean predicate: true admits all variants, false admits none.
      // Useful for `role=${flag}` patterns; rare but normatively closed-form.
      return {
        closed_form: true,
        gated_for_role: result.value
          ? allVariants(roleEnum)
          : new Set<RoleVariant>(),
      };
    }
    gate.gateExpr = v.exprNode;
    return { closed_form: false, gate_expr: v.exprNode };
  }
  // `absent` / `call-ref` / `props-block` → runtime-fallback.
  return { closed_form: false, gate_expr: null };
}

/**
 * Parse a static role-spec string and produce a `RoleClassification`.
 *
 * Supported predicate grammar:
 *   - `"Admin"`                — single variant; gated_for_role = {Admin}.
 *   - `"Admin,Dispatcher"`     — comma-OR; union of variants.
 *   - `" Admin , Dispatcher "` — whitespace tolerant.
 *   - `"!Anonymous"`           — negation; all variants except Anonymous.
 *   - `"!"` alone               — malformed → runtime-fallback.
 *
 * Variant-not-in-enum fires `E-AUTH-GRAPH-003` and returns
 * runtime-fallback (over-includes vs under-includes per §40.9.2
 * worst-case-union admission).
 */
function classifyStaticRoleString(
  raw: string,
  gate: AuthGate,
  roleEnum: RoleEnum | null,
  errors: AuthGraphDiagnostic[],
): RoleClassification {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return { closed_form: false, gate_expr: null };
  }

  // Without a resolved role enum, no per-role traversal is possible —
  // the gate's variant references are unresolvable. A-3.2 will already
  // have fired E-AUTH-GRAPH-002 in this state. Fall through to
  // runtime-fallback per §40.9.2 worst-case-union admission.
  if (roleEnum == null) {
    return { closed_form: false, gate_expr: null };
  }

  // Negation: `"!X"` admits all variants except X. Multiple negations
  // (`"!X,!Y"`) also work — we accept comma-OR of negations as the
  // intersection of each "all-except-X" set.
  const tokens = trimmed.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return { closed_form: false, gate_expr: null };
  }

  const variants = roleEnum ? new Set(roleEnum.variants) : null;
  const positives = new Set<RoleVariant>();
  const negatives = new Set<RoleVariant>();
  let malformed = false;

  for (const token of tokens) {
    const isNeg = token.startsWith("!");
    const name = isNeg ? token.slice(1).trim() : token;
    if (!name || !isBareIdentifier(name)) {
      malformed = true;
      break;
    }
    // Variant-name validation against the role enum. We are permissive
    // when no role enum was resolved — the gate's classification still
    // runs over the verbatim variant names (A-2.5 will surface this
    // path via worst-case-union when no enum is known).
    if (variants && !variants.has(name)) {
      errors.push({
        code: "E-AUTH-GRAPH-003",
        severity: "error",
        message:
          `<auth role="${name}"> references a variant that is not declared ` +
          `in the role enum \`${roleEnum?.name}\` ` +
          `(declared variants: ${roleEnum?.variants.join(", ") ?? ""}). ` +
          `(SPEC §40.1.1.)`,
        span: gate.span,
        filePath: gate.filePath,
      });
      // Over-includes per §40.9.2 worst-case admission.
      return { closed_form: false, gate_expr: null };
    }
    if (isNeg) negatives.add(name);
    else positives.add(name);
  }

  if (malformed) {
    return { closed_form: false, gate_expr: null };
  }

  // Mixed positive + negative is supported but rare. The resulting set
  // is: (positives ∪ (allVariants \ negatives)) when both sides have
  // members; OR plain positives; OR allVariants \ negatives.
  if (positives.size > 0 && negatives.size === 0) {
    return { closed_form: true, gated_for_role: positives };
  }
  if (negatives.size > 0 && positives.size === 0) {
    const all = allVariants(roleEnum);
    for (const n of negatives) all.delete(n);
    return { closed_form: true, gated_for_role: all };
  }
  if (positives.size > 0 && negatives.size > 0) {
    const all = allVariants(roleEnum);
    for (const n of negatives) all.delete(n);
    for (const p of positives) all.add(p);
    return { closed_form: true, gated_for_role: all };
  }

  // Should not be reachable — covered by the malformed branch above.
  return { closed_form: false, gate_expr: null };
}

/**
 * Extract the role attribute's AttrValue from the indexed AST node.
 * Returns null when the node is missing OR the node doesn't carry a
 * `role=` attribute (e.g. `<channel auth=>` uses `auth`, not `role`).
 */
function readRoleAttrValue(
  node: MarkupNode | ChannelDeclNode | null,
): AttrValue | null {
  if (!node) return null;
  const attrs = node.attrs;
  if (!Array.isArray(attrs)) return null;
  for (const attr of attrs) {
    if (attr?.name === "role") return attr.value;
  }
  return null;
}

/**
 * Build the set of ALL variants from a role enum. Returns an empty set
 * when no role enum was resolved — A-2.5's per-role traversal degrades
 * to worst-case-union when the enum is unknown.
 */
function allVariants(roleEnum: RoleEnum | null): Set<RoleVariant> {
  if (!roleEnum) return new Set<RoleVariant>();
  return new Set(roleEnum.variants);
}

/**
 * The variant set used for `auth="required"` gates: every declared
 * variant EXCEPT the anonymous floor.
 *
 * Per SPEC §40.1.1 the anonymous floor is conventionally named
 * `_anonymous` (the synthesized fallback) or `Anonymous` / `anonymous`
 * (the adopter-declared form per worked example §40.9.9). We exclude
 * both casings defensively.
 *
 * When the resolved enum is the synthesized `_anonymous` floor (i.e.
 * the only variant is `_anonymous`), the returned set is empty — no
 * authenticated viewers exist, so `required` gates exclude everyone.
 */
function nonAnonymousVariants(roleEnum: RoleEnum | null): Set<RoleVariant> {
  if (!roleEnum) return new Set<RoleVariant>();
  const out = new Set<RoleVariant>();
  for (const v of roleEnum.variants) {
    const lower = v.toLowerCase();
    if (lower === "_anonymous" || lower === "anonymous") continue;
    out.add(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Re-export the public types for convenience (some consumers will only
// need `runAuthGraph` and the result type — keep the import surface small).
// ---------------------------------------------------------------------------

export type {
  AuthGraph,
  AuthGate,
  AuthGraphDiagnostic,
  AuthGraphOutput,
  AuthSiteKind,
  EntryPointId,
  MarkupNodeId,
  RoleEnum,
  RoleVariant,
} from "./types/auth-graph.js";

// Helper exported for unit tests that want to interrogate individual
// fields without re-walking the AST. Not part of the consumer surface.
export const __test_helpers = {
  findAttr,
  readStringAttr,
  walkMarkupNodes,
  crossRefRedirects,
  collectUrlPatterns,
  parseEnumVariantsFromRaw,
  isBareIdentifier,
  classifyGates,
  buildConstEnvForFile,
  collectConstDecls,
  classifyStaticRoleString,
  classifyByAttrValue,
  classifyBinaryAuthGate,
  allVariants,
  nonAnonymousVariants,
};

