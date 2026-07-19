/**
 * compute-program-config — downstream pre-codegen pass for `authConfig` and
 * `middlewareConfig`.
 *
 * Relocated S115 (DD #27 / F6 / Pivot 2) out of `ast-builder.js`'s TAB-time
 * FileAST assembly into a pipeline-agnostic post-AST / pre-codegen pass. The
 * native parser (v0.6) feeds this its own top-level node stream with no
 * further change — the pass is a PURE function of `nodes`.
 *
 * It extracts two program-level config objects from the `<program>` markup
 * node's attributes:
 *   - `authConfig`       — `auth=` / `loginRedirect=` / `csrf=` / `sessionExpiry=`
 *                          (Option C hybrid, §52.13).
 *   - `middlewareConfig` — `cors=` / `log=` / `ratelimit=` / `headers=` /
 *                          `idempotency-store=` / `idempotency-ttl=` /
 *                          `batch-in-list-cap=` / `cors-max-age=` /
 *                          `channel-reconnect=` (§39).
 *
 * Side-effect (preserved verbatim from the original ast-builder.js block):
 * when `auth=` is present, the `<program>` markup node is annotated directly
 * with `auth` / `loginRedirect` / `csrf` / `sessionExpiry` for downstream
 * stages that walk the node.
 *
 * NOT relocated: the E-MW-002 ratelimit-format validation — that is an
 * error-emitting check, not extraction, and stays in `ast-builder.js`.
 */

export interface AuthConfig {
  auth: string;
  loginRedirect: string;
  csrf: string;
  sessionExpiry: string;
  // §20.5.1 (S266, i29e B4b) — the raw `session-secure=` value ("true" | "false").
  // Default "true" → `__Host-scrml_sid` + always-Secure; "false" → plain
  // `scrml_sid`, no Secure (a conscious TLS-less deployment).
  sessionSecure: string;
}

export interface MiddlewareConfig {
  cors: string | null;
  log: string | null;
  ratelimit: string | null;
  headers: string | null;
  idempotencyStore: string | null;
  idempotencyTTL: string | null;
  batchInListCap: string | null;
  corsMaxAge: string | null;
  channelReconnect: string | null;
}

/**
 * MCP V0 Sub-unit D — config struct for the `<program mcp>` opt-in attribute.
 *
 * Present when the <program> markup carries the `mcp` attribute (bare or with
 * a recognized value). Two recognized values per SCOPING §3 Q3.4 ratification:
 *
 *   - "dev-only" (default — also resolved when the attribute is bare-present,
 *     e.g. `<program mcp>` or `<program mcp="">` — the boolean-attribute
 *     idiom). Generated `_server.js` runtime gates the MCP boot behind
 *     `process.env.NODE_ENV !== "production"`.
 *   - "always" — boot unconditionally (CI / production introspection).
 *
 * When this config is non-null, api.js auto-flips `emitPerRoute: true` (so the
 * MCP descriptor sidecars + chunks.json are emitted) and the generated
 * `_server.js` includes a `scrml:mcp` boot import. When null, no MCP-related
 * compile-time effect occurs (zero opt-out cost for non-adopters).
 *
 * Per SCOPING line 275 caveat: there is no canonical compile-time dev-vs-prod
 * hook in the compiler today (§58 Build Story is spec-only as of S118), so
 * the "dev-only" gate is implemented as a RUNTIME env-var check in the
 * generated `_server.js`. Revisit once build-story implementation lands.
 */
export interface McpConfig {
  /** "dev-only" | "always" — canonicalized from the attribute value. */
  mode: "dev-only" | "always";
}

export interface ProgramConfig {
  authConfig: AuthConfig | null;
  middlewareConfig: MiddlewareConfig | null;
  mcpConfig: McpConfig | null;
}

/**
 * Extract `authConfig` + `middlewareConfig` from a top-level AST node stream.
 *
 * PURE with respect to `nodes` as a collection — but, exactly as the original
 * TAB-time block did, it MUTATES the `<program>` markup node in place with the
 * parsed auth properties (`auth` / `loginRedirect` / `csrf` / `sessionExpiry`)
 * when `auth=` is present. That side-effect is intentional and preserved.
 *
 * @param nodes Top-level AST nodes (live `buildAST` output or native-parser).
 */
export function computeProgramConfig(nodes: any[]): ProgramConfig {
  // ---------------------------------------------------------------------------
  // Session/auth attribute extraction from <program> (Option C hybrid)
  //
  // When <program auth="required" loginRedirect="/login" csrf="auto" sessionExpiry="2h">
  // is present, extract these into a top-level `authConfig` and annotate the
  // program markup node with the parsed auth properties.
  // ---------------------------------------------------------------------------

  let authConfig: AuthConfig | null = null;
  const programNode = Array.isArray(nodes)
    ? nodes.find((n: any) => n.kind === "markup" && n.tag === "program")
    : undefined;
  if (programNode) {
    const programAttrs = programNode.attrs ?? [];

    const getAttrValue = (name: string): string | null => {
      const a = programAttrs.find((attr: any) => attr.name === name);
      if (!a || !a.value || a.value.kind === "absent") return null;
      if (a.value.kind === "string-literal") return a.value.value;
      return null;
    };

    const authVal = getAttrValue("auth");
    if (authVal) {
      const loginRedirect = getAttrValue("loginRedirect") ?? "/login";
      const csrf = getAttrValue("csrf") ?? "off";
      const sessionExpiry = getAttrValue("sessionExpiry") ?? "1h";
      // §20.5.1 (S266, i29e B4b) — the session-cookie Secure mode ("true" default
      // → `__Host-scrml_sid` + always-Secure; "false" → plain `scrml_sid`, no
      // Secure). Threaded into authMiddlewareEntry by route-inference exactly like
      // sessionExpiry. A NO-auth session app reads the raw attribute directly in
      // emit-server (there is no authConfig to hang it on).
      const sessionSecure = getAttrValue("session-secure") ?? "true";

      authConfig = {
        auth: authVal,
        loginRedirect,
        csrf,
        sessionExpiry,
        sessionSecure,
      };

      // Annotate the program node directly for downstream stages
      programNode.auth = authVal;
      programNode.loginRedirect = loginRedirect;
      programNode.csrf = csrf;
      programNode.sessionExpiry = sessionExpiry;
      programNode.sessionSecure = sessionSecure;
    }
  }

  // ---------------------------------------------------------------------------
  // Middleware attribute extraction from <program> (§39)
  //
  // When <program cors="*" log="structured" ratelimit="100/min" headers="strict">
  // is present, extract these into a top-level `middlewareConfig`.
  // `csrf=` is extracted into authConfig (above) — canonical value set is
  // "auto" | "off" per §52.13; the previously-separate middleware-mode csrf="on"
  // value was retired at S80 alongside E-MW-001.
  // ---------------------------------------------------------------------------

  let middlewareConfig: MiddlewareConfig | null = null;
  if (programNode) {
    const programAttrs2 = programNode.attrs ?? [];

    const getMWAttr = (attrName: string): string | null => {
      const a = programAttrs2.find((attr: any) => attr.name === attrName);
      if (!a || !a.value || a.value.kind === "absent") return null;
      if (a.value.kind === "string-literal") return a.value.value;
      return null;
    };

    const mwCors = getMWAttr("cors");
    const mwLog = getMWAttr("log");
    const mwRatelimit = getMWAttr("ratelimit");
    const mwHeaders = getMWAttr("headers");
    // §39.2.6 (A9 Ext 5): idempotency-store= attribute. Values:
    // "auto" (default) | "sqlite" | "postgres" | "mysql" | "redis" | "none".
    // Resolved per §19.9.6 paragraph 3 default-resolution algorithm in
    // monotonicity-analyzer.ts (Stage 5.5).
    const mwIdempotencyStore = getMWAttr("idempotency-store");
    // S79 audit fix C.1 (§19.9.6, §39.2.6 extension): idempotency-ttl=
    // attribute override. Raw value (parsed at codegen time). Accepted shape:
    // bare millis ("3600000") OR duration string ("1h"/"7d"/"24h"/"300s"/"30m").
    // Default (null): 24h (Stripe convention).
    const mwIdempotencyTTL = getMWAttr("idempotency-ttl");
    // S79 audit fix C.2 (§8.10.6 extension): batch-in-list-cap= attribute
    // override. Raw value (decimal integer string). Default (null): 32766
    // (SQLite 3.32+ SQLITE_MAX_VARIABLE_NUMBER). Adopters with Postgres
    // (~65535) or older SQLite (999) override here.
    const mwBatchInListCap = getMWAttr("batch-in-list-cap");
    // S81 audit fix F.1 (§39.2.1 extension): cors-max-age= attribute override
    // for the Access-Control-Max-Age header value the compiler emits on the
    // OPTIONS preflight response. Raw value (parsed at codegen time into a
    // positive integer seconds value). Default (null): 86400 (Firefox effective
    // cap). The override is silently ignored when cors= is absent (CORS as a
    // whole is opt-in).
    const mwCorsMaxAge = getMWAttr("cors-max-age");
    // S81 audit fix F.2 (§38.3.1): channel-reconnect= attribute override for
    // the default WS onclose setTimeout cadence applied to channels that lack
    // an explicit per-channel reconnect= attribute. Raw value (parsed at
    // codegen time into millis; accepts bare integer ms or "Nms"/"Ns"/"Nm"/"Nh"
    // duration strings — same shape as idempotency-ttl minus "d"). Default
    // (null): 2000 ms. Per-channel reconnect= still wins when both present.
    const mwChannelReconnect = getMWAttr("channel-reconnect");

    if (
      mwCors !== null || mwLog !== null || mwRatelimit !== null
      || mwHeaders !== null || mwIdempotencyStore !== null
      || mwIdempotencyTTL !== null || mwBatchInListCap !== null
      || mwCorsMaxAge !== null || mwChannelReconnect !== null
    ) {
      middlewareConfig = {
        cors: mwCors, log: mwLog, ratelimit: mwRatelimit, headers: mwHeaders,
        idempotencyStore: mwIdempotencyStore,
        idempotencyTTL: mwIdempotencyTTL,
        batchInListCap: mwBatchInListCap,
        corsMaxAge: mwCorsMaxAge,
        channelReconnect: mwChannelReconnect,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // MCP V0 Sub-unit D — extract <program mcp> opt-in attribute.
  //
  // Per attribute-registry.js the allowedValues are ["dev-only", "always"];
  // bare-present (`<program mcp>`) — the boolean-attribute idiom — defaults
  // to "dev-only". Any other value is silently treated as "dev-only" here
  // (VP-1 W-ATTR-002 has already surfaced the unknown-value warning to the
  // adopter); falling back to the safer default avoids accidentally enabling
  // the "always" path on a typo.
  //
  // Authority: docs/changes/mcp-v0-devtools-scoping/SCOPING.md §3 Sub-unit D.
  // ---------------------------------------------------------------------------
  let mcpConfig: McpConfig | null = null;
  if (programNode) {
    const programAttrs3 = programNode.attrs ?? [];
    const mcpAttr = programAttrs3.find((attr: any) => attr.name === "mcp");
    if (mcpAttr) {
      let mode: "dev-only" | "always" = "dev-only";
      if (mcpAttr.value && mcpAttr.value.kind === "string-literal") {
        const literal = mcpAttr.value.value;
        if (literal === "always") {
          mode = "always";
        } else if (literal === "" || literal === "dev-only") {
          mode = "dev-only";
        } else {
          // Unrecognized literal — VP-1 surfaces W-ATTR-002. Default to the
          // safer "dev-only" so a typo does not silently enable production
          // wiring.
          mode = "dev-only";
        }
      } else if (mcpAttr.value && mcpAttr.value.kind === "absent") {
        // <program mcp> with no `=value` syntax at all — boolean-attribute
        // idiom; resolve to the default.
        mode = "dev-only";
      }
      mcpConfig = { mode };
    }
  }

  return { authConfig, middlewareConfig, mcpConfig };
}
