/**
 * MCP V0 — compile-time descriptor sidecars.
 *
 * Extracts the four runtime-introspection descriptors consumed by `scrml:mcp`
 * (sub-unit B + C, sequenced later) from the canonical compile-time data:
 *
 *   - `engines.json`     — per-engine name, type, variants, transition rules
 *   - `forms.json`       — per-form (compound state-decl) fields + resolved keys
 *   - `channels.json`    — per-channel name, topic, auto-synced cells + keys
 *   - `serverfns.json`   — per-server-function name, params, return type
 *
 * Authority: `docs/changes/mcp-v0-devtools-scoping/SCOPING.md` §3 Sub-unit A.
 * The shapes documented in SCOPING are the API contract sub-unit B (`scrml:mcp`
 * runtime helpers) consumes. Divergences SHALL surface to PA before landing.
 *
 * SPEC references:
 *   - §51.0 (engines — variants, rule= contract, derived engines)
 *   - §55.5-§55.10 (auto-synthesized validity surface, ValidationError)
 *   - §38 (channels — auto-synced cells per §38.4)
 *   - §47 (Output Name Encoding — resolved-key shape)
 *
 * **Resolved-key emission posture (SCOPING §3 Sub-unit B recommendation (b)):**
 * The sidecars emit RUNTIME keys post-`encodeKey()` so the runtime helper can
 * read them directly via `_scrml_reactive_get` / `_scrml_derived_get` without
 * re-implementing the encoding scheme. In default compile mode the encoding
 * context is `enabled=false` (passthrough), so the resolved key equals the
 * authored qualifiedName. When per-file encoding is enabled (production builds
 * with §47 encoding active), the sidecar emitter applies the same per-file
 * encoding context the validator runner used. App-wide aggregation passes the
 * per-file context per-file through `collectFormDescriptors` so each file's
 * own context governs its cell-key resolution.
 *
 * **Empty-app graceful degradation (SCOPING §5 Risk 6):** all four descriptor
 * arrays gracefully emit `[]` for the zero-engine / zero-form / zero-channel /
 * zero-server-fn case. The SPA-degenerate fixture verifies this contract.
 */

// ---------------------------------------------------------------------------
// Descriptor shapes — APP-WIDE arrays
// ---------------------------------------------------------------------------

export interface EngineVariantFieldDescriptor {
  /** Field name within the variant payload (per §14.4 / §14.3.2). */
  name: string;
  /** Raw type annotation string (e.g. `"int"`, `"BracketKind"`). For v0 the
   *  type is the source-text annotation; resolving to a normalized type-form
   *  is deferred until TS Stage 6 exposes its `fnSignatures` registry beyond
   *  per-file scope. */
  type: string;
}

export interface EngineVariantDescriptor {
  /** Variant tag — PascalCase, no leading dot (e.g. `"Done"`). */
  tag: string;
  /** Payload fields (empty array for unit variants like `Small`/`Big`). */
  fields: EngineVariantFieldDescriptor[];
}

export interface EngineDescriptor {
  /** Auto-declared variable name (no `@` prefix), or `var=` override. */
  name: string;
  /** Governing enum type (the `for=Type` attribute). */
  type: string;
  /** Variants of `type`, in declaration order. */
  variants: EngineVariantDescriptor[];
  /** `rule=` map keyed by FROM-variant tag. Each value is the legal-to set:
   *   - Single-target rule (`rule=.X`)            → `["X"]`
   *   - Multi-target rule  (`rule=(.A | .B)`)     → `["A", "B"]`
   *   - Wildcard rule      (`rule=*`)             → `["*"]`
   *   - Absent rule (terminal state)              → `[]`
   *   - Parse-error / legacy-arrow shape          → `[]`  (the rule body is
   *     unparseable for the agent's purposes — already surfaced via SYM
   *     diagnostics; we omit malformed entries from the descriptor).
   *
   *  Variants NOT listed as keys in `rules` are not represented as
   *  state-children in this engine (per §51.0.B exhaustiveness lint
   *  `W-ENGINE-NON-EXHAUSTIVE`); the LLM agent SHOULD treat absent keys as
   *  "no transition declared." */
  rules: Record<string, string[]>;
  /** `"primary"` for normal engines, `"derived"` for §51.0.J `derived=expr`
   *  engines (whose state is a function of an upstream cell, read-only from
   *  the adopter's perspective). */
  kind: "primary" | "derived";
}

export interface FormFieldDescriptor {
  /** Leaf field name (e.g. `"name"` for `@signup.name`). */
  name: string;
  /** Compound-rooted qualified name (e.g. `"signup.name"`). */
  qualifiedName: string;
  /** Runtime key for `<compound>.<field>.errors` — readable via
   *  `_scrml_derived_get(errorsKey)` to retrieve the field's `ValidationError`
   *  array (per §55.6 + §55.9). */
  errorsKey: string;
  /** Runtime key for `<compound>.<field>.isValid` — readable via
   *  `_scrml_derived_get(isValidKey)`. */
  isValidKey: string;
  /** Runtime key for `<compound>.<field>.touched` — readable via
   *  `_scrml_reactive_get(touchedKey)`. */
  touchedKey: string;
}

export interface FormDescriptor {
  /** Compound state-decl name (e.g. `"signup"`). The form-status surface lives
   *  on `@<formName>` per §55.5. */
  formName: string;
  /** Resolved key for `<formName>.errors` compound rollup. */
  errorsKey: string;
  /** Resolved key for `<formName>.isValid` compound rollup. */
  isValidKey: string;
  /** Resolved key for `<formName>.touched` compound rollup. */
  touchedKey: string;
  /** Resolved key for `<formName>.submitted`. */
  submittedKey: string;
  /** Per-field descriptors for the validatable children (excludes
   *  compound-typed children, markup-typed children, and `derived` children
   *  per the §55.6 emission predicate mirrored from `emit-synth-surface.ts`). */
  fields: FormFieldDescriptor[];
}

export interface ChannelAutoSyncedCell {
  /** Cell name (no `@` prefix). */
  name: string;
  /** Runtime key for the cell — readable via `_scrml_reactive_get(key)`. */
  key: string;
}

export interface ChannelDescriptor {
  /** Channel `name=` attribute (defaults to `"channel"` if absent — mirrors
   *  `emit-channel.ts:extractChannelAttrs`). */
  name: string;
  /** Channel `topic=` attribute (defaults to `name` per §38.3). */
  topic: string;
  /** V5-strict state-decls inside the channel body — auto-synced per §38.4. */
  autoSyncedCells: ChannelAutoSyncedCell[];
}

export interface ServerFnParamDescriptor {
  /** Param identifier as authored. */
  name: string;
  /** Raw type annotation string from the `function foo(x: int)` source form,
   *  or `"unknown"` when the param is unannotated. For v0 the annotation is
   *  reported as the source-text string; structural-type resolution awaits
   *  TS Stage 6 exposing `fnSignatures` beyond per-file scope. */
  type: string;
}

export interface ServerFnDescriptor {
  /** Function name as declared. */
  name: string;
  params: ServerFnParamDescriptor[];
  /** Raw return-type annotation string (after `->` or `:`), or `"unknown"`
   *  when unannotated. Same v0 caveat as `ServerFnParamDescriptor.type`. */
  returnType: string;
  /** Absolute file path the server-fn is declared in (useful for the agent
   *  to disambiguate same-named handlers across files). */
  file: string;
  /** Permanent v0 marker — V0 MCP is enumeration-only; the LLM agent cannot
   *  invoke server fns from the read-only surface (PA Q2 ratification). */
  dispatchable: false;
}

// ---------------------------------------------------------------------------
// Encoding-context type — a structural alias over `EncodingContext.encode`
// ---------------------------------------------------------------------------

/** Minimal structural type for the per-file encoding context's `encode()`
 *  method, so the descriptor extractor stays decoupled from the full
 *  `EncodingContext` class. Falsy ctx ⇒ passthrough. */
interface EncodeCtxLike {
  encode(originalName: string): string;
}

function makeEncodeKey(ctx: EncodeCtxLike | null | undefined): (k: string) => string {
  if (!ctx) return (k) => k;
  return (k) => ctx.encode(k);
}

// ---------------------------------------------------------------------------
// engines.json extractor
// ---------------------------------------------------------------------------

/** Extract `EngineVariantDescriptor[]` from a parsed type-decl whose body
 *  declares an enum (e.g. `type Phase:enum = { Idle, Loading, Done(rows: int) }`).
 *  Mirrors `parseEnumVariantsFromRaw` (meta-checker.ts) but additionally
 *  preserves payload-field annotations as `EngineVariantFieldDescriptor[]`. */
export function parseEnumVariantsWithFields(raw: string): EngineVariantDescriptor[] {
  const out: EngineVariantDescriptor[] = [];
  let body = (raw ?? "").trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return out;

  // Match the splitter used by parseEnumVariantsFromRaw: `,` / `|` / newline.
  // Parentheses MUST be respected — `Done(rows: int)` may contain a comma
  // when fields are multiple (`OpenAt(depth: int, opener: BracketKind)`).
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") {
      depth++;
      current += c;
    } else if (c === ")") {
      depth--;
      current += c;
    } else if ((c === "," || c === "|" || c === "\n") && depth === 0) {
      if (current.trim()) parts.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current);

  for (const part of parts) {
    let trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(".")) trimmed = trimmed.slice(1).trim();

    const parenIdx = trimmed.indexOf("(");
    if (parenIdx < 0) {
      // Unit variant — `Idle`, `Loading`, `Done`, etc.
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
        out.push({ tag: trimmed, fields: [] });
      }
      continue;
    }

    const tag = trimmed.slice(0, parenIdx).trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tag)) continue;

    // Extract the parenthesized field list — strip trailing `)` if present.
    let fieldBody = trimmed.slice(parenIdx + 1);
    const closeIdx = fieldBody.lastIndexOf(")");
    if (closeIdx >= 0) fieldBody = fieldBody.slice(0, closeIdx);
    fieldBody = fieldBody.trim();

    const fields: EngineVariantFieldDescriptor[] = [];
    if (fieldBody) {
      // Field list — top-level comma-split, respecting nested parens.
      const fieldParts: string[] = [];
      let fd = 0;
      let cur = "";
      for (let i = 0; i < fieldBody.length; i++) {
        const c = fieldBody[i];
        if (c === "(") {
          fd++;
          cur += c;
        } else if (c === ")") {
          fd--;
          cur += c;
        } else if (c === "," && fd === 0) {
          if (cur.trim()) fieldParts.push(cur);
          cur = "";
        } else {
          cur += c;
        }
      }
      if (cur.trim()) fieldParts.push(cur);

      for (const fp of fieldParts) {
        const fpTrim = fp.trim();
        const colonIdx = fpTrim.indexOf(":");
        if (colonIdx < 0) {
          // Positional / unannotated payload — emit name only with unknown
          // type. This is rare in scrml (named fields are canonical per §14.4)
          // but tolerable for v0 introspection.
          if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fpTrim)) {
            fields.push({ name: fpTrim, type: "unknown" });
          }
          continue;
        }
        const fieldName = fpTrim.slice(0, colonIdx).trim();
        const fieldType = fpTrim.slice(colonIdx + 1).trim();
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(fieldName)) {
          fields.push({ name: fieldName, type: fieldType || "unknown" });
        }
      }
    }

    out.push({ tag, fields });
  }

  return out;
}

/** Build the `rules: { fromVariant: [legalTo, ...] }` map for one engine
 *  from its `EngineStateChildEntry[]` (the SYM PASS 11 output / fallback).
 *  Mirrors `EngineRuleForm` shape variants from `compiler/src/symbol-table.ts`. */
function buildRulesMap(stateChildren: any[] | undefined | null): Record<string, string[]> {
  const rules: Record<string, string[]> = {};
  if (!Array.isArray(stateChildren)) return rules;

  for (const child of stateChildren) {
    if (!child || typeof child !== "object") continue;
    const tag = typeof child.tag === "string" ? child.tag : null;
    if (!tag) continue;

    const rule = child.rule;
    if (!rule || typeof rule !== "object") {
      // No rule = terminal state — represent as empty array.
      rules[tag] = [];
      continue;
    }

    switch (rule.kind) {
      case "absent":
        rules[tag] = [];
        break;
      case "single":
        rules[tag] = typeof rule.target === "string" ? [rule.target] : [];
        break;
      case "multi":
        rules[tag] = Array.isArray(rule.targets)
          ? rule.targets.filter((t: unknown): t is string => typeof t === "string")
          : [];
        break;
      case "wildcard":
        rules[tag] = ["*"];
        break;
      case "legacy-arrow":
      case "parse-error":
      default:
        // Unparseable shapes — already surfaced via SYM diagnostics. Emit an
        // empty array so the descriptor remains JSON-valid; the agent cannot
        // reason about a malformed rule, and the absence is honest.
        rules[tag] = [];
        break;
    }
  }
  return rules;
}

/** Resolve an engine's variant list. Preference order:
 *
 *   1. Look up the `governedType` in `fileAST.typeDecls` for the file the
 *      engine was declared in; parse its body via `parseEnumVariantsWithFields`.
 *   2. If the engine's parsed `stateChildren` cover variants the type-decl
 *      lookup missed (cross-file enum), seed with state-child tags + empty
 *      field lists so the descriptor still surfaces the engine's variant set.
 *
 *  The combined list de-duplicates by tag; type-decl-derived entries (richer
 *  field info) win over state-child-derived ones. */
function resolveVariants(
  engineDecl: any,
  typeDecls: any[] | undefined | null,
): EngineVariantDescriptor[] {
  const out: EngineVariantDescriptor[] = [];
  const seen = new Set<string>();

  const governedType = typeof engineDecl?.governedType === "string"
    ? engineDecl.governedType
    : null;

  if (governedType && Array.isArray(typeDecls)) {
    const typeDecl = typeDecls.find((td: any) =>
      td && td.kind === "type-decl" && td.name === governedType
    );
    if (typeDecl && typeof typeDecl.raw === "string") {
      const parsed = parseEnumVariantsWithFields(typeDecl.raw);
      for (const v of parsed) {
        if (!seen.has(v.tag)) {
          out.push(v);
          seen.add(v.tag);
        }
      }
    }
  }

  // Fallback: seed from state-children for any variant not surfaced via the
  // type-decl lookup (e.g. cross-file enum imports — out-of-scope file's
  // typeDecls aren't in the local fileAST).
  const stateChildren = engineDecl?._record?.engineMeta?.stateChildren;
  if (Array.isArray(stateChildren)) {
    for (const child of stateChildren) {
      const tag = typeof child?.tag === "string" ? child.tag : null;
      if (tag && !seen.has(tag)) {
        out.push({ tag, fields: [] });
        seen.add(tag);
      }
    }
  }

  return out;
}

/** Collect every engine across every file as an `EngineDescriptor[]`. */
export function collectEngineDescriptors(tabResults: any[]): EngineDescriptor[] {
  const descriptors: EngineDescriptor[] = [];
  if (!Array.isArray(tabResults)) return descriptors;

  // Cross-file engine de-dup: cross-file mounts of the same singleton (§51.0.D)
  // are inlined at consumer sites. We key by `varName` (the auto-declared cell
  // identifier) since that IS the singleton identity — duplicate descriptors
  // for the same singleton would mislead the LLM agent into thinking multiple
  // engines exist.
  const seenVarNames = new Set<string>();

  for (const tab of tabResults) {
    const fileAST = tab?.ast;
    if (!fileAST) continue;

    // Reuse the canonical engine collector — it walks markup, descends into
    // nested engines (§51.0.Q.1), and respects pre-collected `machineDecls`.
    const enginesInFile = collectAllEngineDeclsFromAST(fileAST);
    for (const engine of enginesInFile) {
      const meta = engine?._record?.engineMeta;
      if (!meta) continue;

      // Skip legacy `<machine>` decls — they have a separate runtime path
      // (emit-machines.ts) and shouldn't appear in the v0 MCP surface
      // (legacy decls don't carry the engine-singleton semantics V0 docs).
      if (engine.legacyMachineKeyword === true) continue;

      const varName = typeof meta.varName === "string" && meta.varName
        ? meta.varName
        : (typeof engine.engineName === "string" ? engine.engineName : null);
      if (!varName) continue;
      if (seenVarNames.has(varName)) continue;
      seenVarNames.add(varName);

      const governedType = typeof meta.forType === "string"
        ? meta.forType
        : (typeof engine.governedType === "string" ? engine.governedType : "unknown");

      const variants = resolveVariants(engine, fileAST.typeDecls);
      const rules = buildRulesMap(meta.stateChildren);

      // Derived engines (§51.0.J) carry a non-null `derivedExpr`; primary
      // engines carry a `initialVariant` and direct-write semantics.
      const isDerived = meta.derivedExpr !== null && meta.derivedExpr !== undefined;

      descriptors.push({
        name: varName,
        type: governedType,
        variants,
        rules,
        kind: isDerived ? "derived" : "primary",
      });
    }
  }

  return descriptors;
}

/** Local mirror of `emit-engine.ts:collectC12EngineDecls` — duplicated here
 *  to avoid a circular import (emit-engine imports a number of CG helpers
 *  that pull in the whole emit chain). The walk shape is identical. */
function collectAllEngineDeclsFromAST(fileAST: any): any[] {
  const out: any[] = [];
  if (!fileAST) return out;

  const preCollected = fileAST.machineDecls ?? fileAST.ast?.machineDecls;
  if (Array.isArray(preCollected) && preCollected.length > 0) {
    for (const node of preCollected) {
      if (node?.kind === "engine-decl") out.push(node);
    }
    return out;
  }

  const nodes: any[] = (fileAST.nodes ?? fileAST.ast?.nodes ?? []) as any[];
  function visit(list: any[]): void {
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "engine-decl") {
        out.push(node);
        if (Array.isArray(node.bodyChildren)) visit(node.bodyChildren);
      }
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(nodes);
  return out;
}

// ---------------------------------------------------------------------------
// forms.json extractor
// ---------------------------------------------------------------------------

/** Predicate: this state-decl is a compound parent (the auto-synth validity
 *  surface root per §55.5). Mirrors the predicate at `emit-synth-surface.ts:122`. */
function isCompoundParent(node: any): boolean {
  return (
    node?.kind === "state-decl" &&
    (node?._cellKind === "compound-parent" || Array.isArray(node?.children))
  );
}

/** Predicate: this child is one of the validatable per-field surfaces (mirrors
 *  the filter at `emit-synth-surface.ts:135-147`). */
function isValidatableField(child: any): boolean {
  if (!child || typeof child !== "object") return false;
  if (child.kind !== "state-decl") return false;
  if (child._cellKind === "compound-parent" || Array.isArray(child.children)) return false;
  if (child._cellKind === "markup-typed") return false;
  if (child.shape === "derived" && child.isConst === true) return false;
  return true;
}

/** Walk the file AST and collect every compound state-decl. Walks top-level
 *  + descends into markup children so `formFor`-synthesized compounds and
 *  hand-authored compounds inside `<program>` / `<page>` bodies are both
 *  surfaced. */
function collectCompoundDeclsFromAST(fileAST: any): any[] {
  const out: any[] = [];
  if (!fileAST) return out;

  const nodes: any[] = (fileAST.nodes ?? fileAST.ast?.nodes ?? []) as any[];

  function visit(list: any[]): void {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (isCompoundParent(node)) {
        out.push(node);
        // Don't descend into a compound's children for additional COMPOUNDS —
        // the form-status surface is rooted at the outermost compound; nested
        // sub-compounds are addressable via dotted-path keys on the parent.
        continue;
      }
      // Descend into block-bearing nodes that may host state-decls.
      if (Array.isArray(node.children)) visit(node.children);
      if (Array.isArray(node.body)) visit(node.body);
      if (Array.isArray(node.bodyChildren)) visit(node.bodyChildren);
    }
  }
  visit(nodes);
  return out;
}

/** Collect every form descriptor across every file. */
export function collectFormDescriptors(tabResults: any[]): FormDescriptor[] {
  const descriptors: FormDescriptor[] = [];
  if (!Array.isArray(tabResults)) return descriptors;

  // Cross-file form de-dup by `formName`. Forms are file-local declarations,
  // so duplicate names across files would imply a name clash already caught
  // by SYM. We dedupe defensively.
  const seenNames = new Set<string>();

  for (const tab of tabResults) {
    const fileAST = tab?.ast;
    if (!fileAST) continue;

    // The encoding context is per-file. In default compile mode encoding is
    // disabled (passthrough), so the resolved key equals the qualified name.
    // When §47 encoding is active per-file, `ctx.encode()` returns the
    // registered encoded name; this resolves correctly because the sidecar
    // is computed during the same compile that produced the per-file ctx.
    //
    // For the v0 sidecar, since encoding contexts are constructed inside CG
    // (per-file) but the extractor runs post-CG with only file-AST data, we
    // emit raw qualified names — the runtime helper uses the same default-off
    // encoding path. Production builds with encoding enabled need a follow-on
    // (capture the encoding ctx alongside cgResult, then pass through). For
    // v0 this is documented as a known limitation; raw names work for the
    // overwhelmingly-common default-off configuration.
    const encodeKey: (k: string) => string = (k) => k;

    const compounds = collectCompoundDeclsFromAST(fileAST);
    for (const compound of compounds) {
      const formName = typeof compound.name === "string" ? compound.name : null;
      if (!formName) continue;
      if (seenNames.has(formName)) continue;
      seenNames.add(formName);

      const fields: FormFieldDescriptor[] = [];
      const children: any[] = Array.isArray(compound.children) ? compound.children : [];
      for (const child of children) {
        if (!isValidatableField(child)) continue;
        const childName = typeof child.name === "string" ? child.name : null;
        if (!childName) continue;
        const qualifiedName = `${formName}.${childName}`;
        fields.push({
          name: childName,
          qualifiedName,
          errorsKey: encodeKey(`${qualifiedName}.errors`),
          isValidKey: encodeKey(`${qualifiedName}.isValid`),
          touchedKey: encodeKey(`${qualifiedName}.touched`),
        });
      }

      descriptors.push({
        formName,
        errorsKey: encodeKey(`${formName}.errors`),
        isValidKey: encodeKey(`${formName}.isValid`),
        touchedKey: encodeKey(`${formName}.touched`),
        submittedKey: encodeKey(`${formName}.submitted`),
        fields,
      });
    }
  }

  return descriptors;
}

// ---------------------------------------------------------------------------
// channels.json extractor
// ---------------------------------------------------------------------------

/** Walk a channel body and collect V5-strict state-decl cells. Per §38.4,
 *  every state-decl inside a channel body auto-syncs across clients. */
function collectChannelAutoSyncedCells(channelNode: any): ChannelAutoSyncedCell[] {
  const out: ChannelAutoSyncedCell[] = [];
  if (!channelNode || !Array.isArray(channelNode.children)) return out;

  function visit(list: any[]): void {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      // V5-strict state-decls inside the channel body are auto-synced.
      // Nested logic-block locals (`let x = ...`) are NOT auto-synced
      // per §38.4 ("LOCALS declared inside a channel body's logic blocks
      // SHALL NOT auto-sync. Only V5-strict structural-decl cells are synced.")
      // We surface only kind:"state-decl" nodes — LogicStatement-form let/const
      // do not match this predicate.
      if (node.kind === "state-decl" && typeof node.name === "string") {
        const cellName = node.name;
        out.push({ name: cellName, key: cellName });
        // Skip descent into child cells — auto-sync is per-cell rooted at
        // each top-level state-decl; nested compound children are referenced
        // via dotted paths through the parent.
        continue;
      }
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(channelNode.children);
  return out;
}

/** Extract a channel's `name` and `topic` attributes. Mirrors
 *  `emit-channel.ts:extractChannelAttrs` defaults. */
function extractChannelNameAndTopic(channelNode: any): { name: string; topic: string } {
  const attrs: any[] = channelNode.attrs ?? channelNode.attributes ?? [];
  const attrMap = new Map<string, any>(attrs.map((a: any) => [a.name, a]));

  const nameAttr = attrMap.get("name");
  let name = "channel";
  if (nameAttr) {
    const v = nameAttr.value;
    if (v?.kind === "string-literal") name = v.value;
    else if (v?.kind === "variable-ref") name = (v.name ?? "").replace(/^@/, "");
    else if (typeof v === "string") name = v;
  }

  const topicAttr = attrMap.get("topic");
  let topic = name;
  if (topicAttr) {
    const v = topicAttr.value;
    if (v?.kind === "string-literal") topic = v.value;
    else if (v?.kind === "variable-ref") topic = (v.name ?? "").replace(/^@/, "");
    else if (typeof v === "string") topic = v;
  }

  return { name, topic };
}

/** Walk a file AST to discover all `<channel>` markup nodes. Mirrors
 *  `emit-channel.ts:collectChannelNodes` but is duplicated locally to avoid
 *  pulling the full emit chain. P3.A exporter-side channels are filtered —
 *  consumer-inlined copies emit the runtime, so the descriptor entry comes
 *  from the consumer side too. (Single-file fixtures, where there is no
 *  inline expansion, emit unchanged.) */
function collectChannelNodesFromAST(fileAST: any): any[] {
  const out: any[] = [];
  if (!fileAST) return out;

  const nodes: any[] = (fileAST.nodes ?? fileAST.ast?.nodes ?? []) as any[];
  function visit(list: any[]): void {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "markup" && (node.tag ?? "") === "channel") {
        // P3.A exporter-side filtering — see emit-channel.ts:67-69 for
        // the matching rationale.
        if (node._p3aIsExport !== true) out.push(node);
        if (Array.isArray(node.children)) visit(node.children);
        continue;
      }
      if (node.kind === "logic" && Array.isArray(node.body)) continue;
      if (Array.isArray(node.children)) visit(node.children);
    }
  }
  visit(nodes);
  return out;
}

/** Collect every channel descriptor across every file. */
export function collectChannelDescriptors(tabResults: any[]): ChannelDescriptor[] {
  const descriptors: ChannelDescriptor[] = [];
  if (!Array.isArray(tabResults)) return descriptors;

  const seenNames = new Set<string>();

  for (const tab of tabResults) {
    const fileAST = tab?.ast;
    if (!fileAST) continue;

    const channels = collectChannelNodesFromAST(fileAST);
    for (const channelNode of channels) {
      const { name, topic } = extractChannelNameAndTopic(channelNode);
      if (!name) continue;
      // Channels are app-scope singletons by `name` (per §38.2 + the WS-route
      // shape `/_scrml_ws/<name>`). Dedupe by name across files.
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const autoSyncedCells = collectChannelAutoSyncedCells(channelNode);
      descriptors.push({ name, topic, autoSyncedCells });
    }
  }

  return descriptors;
}

// ---------------------------------------------------------------------------
// serverfns.json extractor
// ---------------------------------------------------------------------------

/** Param-list extractor for a function-decl AST node.
 *
 *  `FunctionDeclNode.params` is currently `string[]` (per `compiler/src/types/ast.ts:821`),
 *  with each entry potentially carrying a `:`-typed annotation in its source
 *  form. The native-parser/ast-builder may also produce param objects with
 *  `{ name, typeAnnotation }` shape — we accept both shapes defensively. */
function extractParamDescriptors(params: unknown): ServerFnParamDescriptor[] {
  const out: ServerFnParamDescriptor[] = [];
  if (!Array.isArray(params)) return out;

  for (const param of params) {
    if (typeof param === "string") {
      // String form — may be `"name"` or `"name: Type"`.
      const colonIdx = param.indexOf(":");
      if (colonIdx < 0) {
        const name = param.trim();
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
          out.push({ name, type: "unknown" });
        }
        continue;
      }
      const name = param.slice(0, colonIdx).trim();
      const type = param.slice(colonIdx + 1).trim() || "unknown";
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        out.push({ name, type });
      }
      continue;
    }

    if (param && typeof param === "object") {
      const obj = param as { name?: unknown; typeAnnotation?: unknown };
      const name = typeof obj.name === "string" ? obj.name : null;
      if (!name) continue;
      const type = typeof obj.typeAnnotation === "string" && obj.typeAnnotation
        ? obj.typeAnnotation
        : "unknown";
      out.push({ name, type });
    }
  }

  return out;
}

/** Discover every `server`-prefixed function-decl across all files. Walks the
 *  file ASTs directly (FunctionDeclNode.isServer is the canonical marker per
 *  `compiler/src/types/ast.ts:827`). Cross-references `riResult.routeMap` is
 *  NOT required for discovery — `isServer` already marks server boundary at
 *  AST time. (`routeMap.functions` is keyed by node-id and is useful for
 *  AUTO-escalated server functions; for v0 we surface only EXPLICITLY-marked
 *  `server function`s — those are what an adopter authored as RPC-callable.) */
function collectServerFnNodes(fileAST: any): Array<{ node: any; file: string }> {
  const out: Array<{ node: any; file: string }> = [];
  if (!fileAST) return out;
  const filePath = typeof fileAST.filePath === "string" ? fileAST.filePath : "";

  // Server fns are declared at file top or inside markup body bodies (per §12,
  // §38 channel bodies). Walk every nestable container.
  const nodes: any[] = (fileAST.nodes ?? fileAST.ast?.nodes ?? []) as any[];

  function visit(list: any[]): void {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      if (node.kind === "function-decl" && node.isServer === true) {
        out.push({ node, file: filePath });
      }
      // Descend into block-bearing containers.
      if (Array.isArray(node.body)) visit(node.body);
      if (Array.isArray(node.children)) visit(node.children);
      if (Array.isArray(node.bodyChildren)) visit(node.bodyChildren);
    }
  }
  visit(nodes);
  return out;
}

/** Collect every server-fn descriptor across every file. */
export function collectServerFnDescriptors(tabResults: any[]): ServerFnDescriptor[] {
  const descriptors: ServerFnDescriptor[] = [];
  if (!Array.isArray(tabResults)) return descriptors;

  // Cross-file de-dup by `name+file` — same-named server fns in different
  // files are distinct routes (different file → different page-scope) and
  // should both surface. We do NOT dedupe by name alone.
  const seen = new Set<string>();

  for (const tab of tabResults) {
    const fileAST = tab?.ast;
    if (!fileAST) continue;

    const serverFns = collectServerFnNodes(fileAST);
    for (const { node, file } of serverFns) {
      const name = typeof node.name === "string" ? node.name : null;
      if (!name) continue;
      const key = `${file}::${name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const params = extractParamDescriptors(node.params);

      // Return-type — try `returnTypeAnnotation` first (the canonical
      // ast-builder field per type-system.ts:3869), then `returnType` for
      // forward-compat with any resolved-type-on-AST changes.
      const returnType: string =
        (typeof node.returnTypeAnnotation === "string" && node.returnTypeAnnotation)
          ? node.returnTypeAnnotation
          : (typeof node.returnType === "string" && node.returnType
              ? node.returnType
              : "unknown");

      descriptors.push({
        name,
        params,
        returnType,
        file,
        dispatchable: false,
      });
    }
  }

  return descriptors;
}

// ---------------------------------------------------------------------------
// Top-level — build all four descriptor surfaces
// ---------------------------------------------------------------------------

export interface McpDescriptors {
  engines: EngineDescriptor[];
  forms: FormDescriptor[];
  channels: ChannelDescriptor[];
  serverFns: ServerFnDescriptor[];
}

/** Build all four descriptor arrays in one pass over the per-file `tabResults`.
 *  Each sub-extractor is independent — the v0 emitter SHOULD call each as a
 *  separate sidecar write (per SCOPING §3 Sub-unit A's per-sidecar shape). */
export function buildMcpDescriptors(tabResults: any[]): McpDescriptors {
  return {
    engines: collectEngineDescriptors(tabResults),
    forms: collectFormDescriptors(tabResults),
    channels: collectChannelDescriptors(tabResults),
    serverFns: collectServerFnDescriptors(tabResults),
  };
}
