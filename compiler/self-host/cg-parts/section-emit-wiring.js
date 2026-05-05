// ===========================================================================
// SECTION: emit-html (from emit-html.ts)
// ===========================================================================

// Supported bind: attribute names per SPEC §5.4
export const SUPPORTED_BIND_NAMES = new Set(["value", "valueAsNumber", "checked", "selected", "files", "group"]);

// Supported transition types for transition:, in:, out: directives
const SUPPORTED_TRANSITIONS = new Set(["fade", "slide", "fly"]);

// Element-type restrictions per SPEC §5.4
export const BIND_VALID_TAGS = {
  "bind:value":          new Set(["input", "textarea", "select"]),
  "bind:valueAsNumber":  new Set(["input", "textarea", "select"]),
  "bind:checked":        new Set(["input"]),
  "bind:selected":       new Set(["select"]),
  "bind:files":          new Set(["input"]),
  "bind:group":          new Set(["input"]),
};

// Lifecycle elements that emit no HTML — handled by emit-reactive-wiring.js
const LIFECYCLE_SILENT_TAGS = new Set(["timer", "poll"]);

// §35 Input state type elements that emit no HTML — handled by emit-reactive-wiring.js
const INPUT_STATE_TAGS = new Set(["keyboard", "mouse", "gamepad"]);

// §6.7.7 <request> — single-shot async fetch state type, emits no HTML
const REQUEST_TAGS = new Set(["request"]);

// §6.7.8 <timeout> — single-shot timer state type, emits no HTML
const TIMEOUT_TAGS = new Set(["timeout"]);

/**
 * Generate HTML from markup AST nodes.
 * Also populates the BindingRegistry for client JS wiring.
 */
export function generateHtml(nodes, ctxOrErrors, csrfEnabledLegacy, registryLegacy, fileASTLegacy) {
  // Support both new (nodes, ctx) and legacy (nodes, errors, csrfEnabled, registry, fileAST) signatures
  let errors;
  let csrfEnabled;
  let registry;
  let fileAST;
  if (ctxOrErrors && typeof ctxOrErrors == "object" && "fileAST" in ctxOrErrors) {
    // New CompileContext signature
    const ctx = ctxOrErrors;
    errors = ctx.errors;
    csrfEnabled = ctx.csrfEnabled;
    registry = ctx.registry;
    fileAST = ctx.fileAST;
  } else {
    // Legacy positional signature
    errors = ctxOrErrors ?? [];
    csrfEnabled = csrfEnabledLegacy ?? false;
    registry = registryLegacy;
    fileAST = fileASTLegacy;
  }
  const parts = [];

  const reactiveVarNames = fileAST ? collectReactiveVarNames(fileAST) : null;

  function emitNode(node) {
    if (!node || typeof node != "object") return;

    if (node.kind == "text") {
      parts.push(node.value ?? node.text ?? "");
      return;
    }

    if (node.kind == "comment") {
      return;
    }

    if (node.kind == "state") {
      for (const child of node.children ?? []) {
        emitNode(child);
      }
      return;
    }

    // §17.1.1: if-chain — render all branches, only first active is visible
    if (node.kind == "if-chain") {
      const chainId = genVar("if_chain");
      for (let bIdx = 0; bIdx < (node.branches?.length ?? 0); bIdx++) {
        const branch = node.branches[bIdx];
        const branchId = `${chainId}_b${bIdx}`;
        parts.push(`<div data-scrml-if-chain="${chainId}" data-scrml-chain-branch="${branchId}" style="display:none">`);
        emitNode(branch.element);
        parts.push(`</div>`);
        // Register the branch for event wiring
        if (registry) {
          registry.addLogicBinding({
            kind: "if-chain-branch",
            chainId,
            branchId,
            branchIndex: bIdx,
            condition: branch.condition,
            refs: branch.condition?.refs ?? (branch.condition?.name ? [branch.condition.name.replace(/^@/, "")] : []),
          });
        }
      }
      if (node.elseBranch) {
        const elseId = `${chainId}_else`;
        parts.push(`<div data-scrml-if-chain="${chainId}" data-scrml-chain-branch="${elseId}" style="display:none">`);
        emitNode(node.elseBranch);
        parts.push(`</div>`);
        if (registry) {
          registry.addLogicBinding({
            kind: "if-chain-else",
            chainId,
            branchId: elseId,
          });
        }
      }
      return;
    }

    if (node.kind == "markup") {
      const tag = node.tag ?? node.tagName ?? "div";
      const attrs = node.attributes ?? node.attrs ?? [];
      const children = node.children ?? [];
      const isSelfClosing = node.selfClosing === true && children.length == 0;
      const isVoid = VOID_ELEMENTS.has(tag);

      if (tag == "errorBoundary" || tag == "errorboundary") {
        const boundaryId = genVar("error_boundary");
        parts.push(`<div data-scrml-error-boundary="${boundaryId}">`);
        for (const child of children) {
          emitNode(child);
        }
        parts.push("</div>");
        return;
      }

      if (tag == "program") {
        // Named programs are worker bundles (§4.12.4) — skip entirely.
        // Only emit children for the unnamed/root program.
        const nameAttr = attrs.find((a) => a.name == "name");
        if (nameAttr) return;
        for (const child of children) {
          emitNode(child);
        }
        return;
      }

      if (LIFECYCLE_SILENT_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map((attrs ?? []).map((a) => [a.name, a]));

        if (!attrMap.has("interval")) {
          if (errors) {
            errors.push(new CGError(
              "E-LIFECYCLE-009",
              `E-LIFECYCLE-009: \`<${tag}>\` is missing the required \`interval\` attribute. ` +
              `The interval specifies how often the body executes, in milliseconds. ` +
              `Example: \`<${tag} interval=1000>\`.`,
              span,
            ));
          }
        } else {
          const intervalAttr = attrMap.get("interval");
          const intervalVal = intervalAttr?.value;
          let intervalMs = null;
          if (intervalVal?.kind == "string-literal") {
            intervalMs = parseInt(intervalVal.value, 10);
          } else if (intervalVal?.kind == "variable-ref") {
            const raw = intervalVal.name ?? "";
            intervalMs = parseInt(raw, 10);
          }
          if (intervalMs !== null && !isNaN(intervalMs) && intervalMs <= 0) {
            if (errors) {
              errors.push(new CGError(
                "E-LIFECYCLE-010",
                `E-LIFECYCLE-010: \`<${tag}>\` has \`interval=${intervalMs}\` which is zero or negative. ` +
                `The interval must be a positive integer (milliseconds). ` +
                `Example: \`interval=1000\` for 1 second.`,
                span,
              ));
            }
          }
        }

        if (attrMap.has("running")) {
          const runningAttr = attrMap.get("running");
          const runningVal = runningAttr?.value;
          if (runningVal?.kind == "variable-ref" && runningVal.name == "false") {
            if (errors) {
              errors.push(new CGError(
                "W-LIFECYCLE-007",
                `W-LIFECYCLE-007: \`<${tag}>\` has \`running=false\` as a boolean literal. ` +
                `This timer starts paused and has no way to resume without a reactive \`@variable\`. ` +
                `Use \`running=@yourVar\` to make the running state reactive, or remove the attribute to always run.`,
                span,
                "warning",
              ));
            }
          }
        }

        if (tag == "timer") {
          if (isSelfClosing || children.length == 0) {
            if (errors) {
              errors.push(new CGError(
                "W-LIFECYCLE-002",
                `W-LIFECYCLE-002: \`<timer>\` has no body and no observable effect. ` +
                `A timer with no logic body only increments tickCount. ` +
                `If you need tick counting, add a \`${"${"}.<#id>.tickCount = <#id>.tickCount + 1${"}"}\` body, ` +
                `or remove this timer.`,
                span,
                "warning",
              ));
            }
          }
        }

        if (tag == "poll") {
          if (isSelfClosing || children.length == 0) {
            if (errors) {
              errors.push(new CGError(
                "E-LIFECYCLE-012",
                `E-LIFECYCLE-012: \`<poll>\` requires a logic body. ` +
                `A poll that fetches nothing is nonsensical. ` +
                `Add a \`\${ @data = fetchSomething() }\` body.`,
                span,
              ));
            }
          }
        }

        return;
      }

      if (INPUT_STATE_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map((attrs ?? []).map((a) => [a.name, a]));

        if (!attrMap.has("id")) {
          const errCodes = { keyboard: "E-INPUT-001", mouse: "E-INPUT-002", gamepad: "E-INPUT-003" };
          const code = errCodes[tag] ?? "E-INPUT-001";
          if (errors) {
            errors.push(new CGError(
              code,
              `${code}: \`<${tag}>\` requires an \`id\` attribute. Without an id, the ` +
              `input state cannot be referenced via \`<#id>\`. ` +
              `Add \`id="yourName"\` to the element.`,
              span,
            ));
          }
        }

        if (tag == "gamepad" && attrMap.has("index")) {
          const indexAttr = attrMap.get("index");
          const indexVal = indexAttr?.value;
          let indexNum = null;
          if (indexVal?.kind == "string-literal") {
            indexNum = parseInt(indexVal.value, 10);
          } else if (indexVal?.kind == "variable-ref") {
            indexNum = parseInt((indexVal.name ?? "").replace(/^@/, ""), 10);
          }
          if (indexNum !== null && !isNaN(indexNum) && (indexNum < 0 || indexNum > 3)) {
            if (errors) {
              errors.push(new CGError(
                "E-INPUT-004",
                `E-INPUT-004: \`<gamepad>\` attribute \`index\` must be 0, 1, 2, or 3 ` +
                `(the Gamepad API supports at most 4 simultaneous gamepads). ` +
                `Got \`${indexNum}\`. Use a value in [0, 1, 2, 3].`,
                span,
              ));
            }
          }
        }

        return;
      }

      if (REQUEST_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map((attrs ?? []).map((a) => [a.name, a]));

        if (!attrMap.has("id")) {
          if (errors) {
            errors.push(new CGError(
              "E-LIFECYCLE-018",
              `E-LIFECYCLE-018: \`<request>\` requires an \`id\` attribute. Without an id, ` +
              `the fetch state cannot be referenced via \`<#id>.loading\`, \`<#id>.data\`, etc. ` +
              `Add \`id="yourName"\` to the element.`,
              span,
            ));
          }
        }

        return;
      }

      if (TIMEOUT_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map((attrs ?? []).map((a) => [a.name, a]));

        if (!attrMap.has("delay")) {
          if (errors) {
            errors.push(new CGError(
              "E-TIMEOUT-001",
              `E-TIMEOUT-001: \`<timeout>\` requires a \`delay\` attribute. ` +
              `The delay specifies when the timeout fires, in milliseconds. ` +
              `Example: \`<timeout id="guard" delay=5000>\`.`,
              span,
            ));
          }
        } else {
          const delayAttr = attrMap.get("delay");
          const delayVal = delayAttr?.value;
          let delayMs = null;
          if (delayVal?.kind == "string-literal") {
            delayMs = parseInt(delayVal.value, 10);
          } else if (delayVal?.kind == "variable-ref") {
            const raw = (delayVal.name ?? "").replace(/^@/, "");
            delayMs = parseInt(raw, 10);
          }
          if (delayMs !== null && !isNaN(delayMs) && delayMs <= 0) {
            if (errors) {
              errors.push(new CGError(
                "E-TIMEOUT-002",
                `E-TIMEOUT-002: \`<timeout>\` has \`delay=${delayMs}\` which is zero or negative. ` +
                `The delay must be a positive integer (milliseconds). ` +
                `Example: \`delay=5000\` for 5 seconds.`,
                span,
              ));
            }
          }
        }

        return;
      }

      if (tag == "channel") {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map((attrs ?? []).map((a) => [a.name, a]));
        if (!attrMap.has("name")) {
          if (errors) {
            errors.push(new CGError(
              "E-CHANNEL-001",
              `E-CHANNEL-001: \`<channel>\` is missing the required \`name\` attribute. ` +
              `The name identifies this channel and sets the WebSocket URL path. ` +
              `Example: \`<channel name="chat">\`.`,
              span,
            ));
          }
        }
        return;
      }

      // Pre-pass: validate bind: attributes
      if (errors) {
        for (const attr of attrs) {
          if (!attr || !attr.name) continue;
          if (!attr.name.startsWith("bind:")) continue;

          const bindName = attr.name;
          const suffix = bindName.slice(5);
          const span = attr.span ?? node.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 };

          if (!SUPPORTED_BIND_NAMES.has(suffix)) {
            errors.push(new CGError(
              "E-ATTR-011",
              `E-ATTR-011: \`${bindName}\` is not a supported bind: attribute. ` +
              `Supported names: ${[...SUPPORTED_BIND_NAMES].join(", ")}.`,
              span,
            ));
          }

          const val = attr.value;
          const isReactive = val && val.kind == "variable-ref" &&
            (val.name ?? "").startsWith("@");
          if (!isReactive && SUPPORTED_BIND_NAMES.has(suffix)) {
            const rawName = val && val.kind == "variable-ref"
              ? val.name
              : (val && val.kind == "string-literal" ? val.value : null);
            const hint = rawName
              ? ` \`${rawName}\` is not reactive. Use \`@${rawName}\` or change \`${bindName}\` to \`${suffix}=${rawName}\`.`
              : ` The right-hand side of \`${bindName}\` must be an \`@\`-prefixed reactive variable.`;
            errors.push(new CGError(
              "E-ATTR-010",
              `E-ATTR-010: \`bind:\` requires a reactive \`@\` variable.${hint}`,
              span,
            ));
          }

          if (SUPPORTED_BIND_NAMES.has(suffix)) {
            const validTags = BIND_VALID_TAGS[bindName];
            if (validTags && !validTags.has(tag)) {
              errors.push(new CGError(
                "E-ATTR-011",
                `E-ATTR-011: \`${bindName}\` is not valid on \`<${tag}>\`. ` +
                `Valid elements: ${[...validTags].map((t) => `<${t}>`).join(", ")}.`,
                span,
              ));
            }
          }
        }
      }

      // Pre-scan for transition directives
      let transitionEnter = null;
      let transitionExit = null;
      for (const attr of attrs) {
        if (!attr || !attr.name) continue;
        const aName = attr.name;
        if (aName.startsWith("transition:")) {
          const type = aName.slice(11);
          if (SUPPORTED_TRANSITIONS.has(type)) {
            transitionEnter = type;
            transitionExit = type;
          }
        } else if (aName.startsWith("in:")) {
          const type = aName.slice(3);
          if (SUPPORTED_TRANSITIONS.has(type)) {
            transitionEnter = type;
          }
        } else if (aName.startsWith("out:")) {
          const type = aName.slice(4);
          if (SUPPORTED_TRANSITIONS.has(type)) {
            transitionExit = type;
          }
        }
      }

      parts.push(`<${tag}`);

      if (node._expandedFrom) {
        parts.push(` data-scrml-scope="${escapeHtmlAttr(node._expandedFrom)}"`);
      }

      for (const attr of attrs) {
        if (!attr) continue;
        const name = attr.name;
        const val = attr.value;

        if (name.startsWith("transition:") || name.startsWith("in:") || name.startsWith("out:")) {
          continue;
        }

        if (name.startsWith("bind:")) {
          const bindId = genVar(`bind_${name.replace(":", "_")}`);
          parts.push(` data-scrml-${name.replace(":", "-")}="${bindId}"`);
          if (!attr._bindId) attr._bindId = bindId;
          continue;
        }

        if (name.startsWith("class:")) {
          const classBindId = genVar(`class_${name.replace(":", "_")}`);
          parts.push(` data-scrml-${name.replace(":", "-")}="${classBindId}"`);
          if (!attr._bindId) attr._bindId = classBindId;
          continue;
        }

        if (name == "ref" && val && val.kind == "variable-ref") {
          const refName = val.name.replace(/^@/, "");
          parts.push(` data-scrml-ref="${escapeHtmlAttr(refName)}"`);
          continue;
        }

        if (!val || val.kind == "absent") {
          parts.push(` ${name}`);
        } else if (val.kind == "string-literal") {
          if (hasTemplateInterpolation(val.value)) {
            const tplId = genVar(`attr_tpl_${name}`);
            parts.push(` ${name}="" data-scrml-attr-tpl-${name}="${tplId}"`);
            if (!attr._tplId) attr._tplId = tplId;
          } else {
            parts.push(` ${name}="${escapeHtmlAttr(val.value)}"`);
          }
        } else if (val.kind == "variable-ref") {
          const varName = val.name ?? "";
          if (varName.startsWith("@") && name == "if") {
            // §3: if=@var — reactive conditional display binding.
            // The @-prefix is meaningful here: it marks the variable as reactive.
            const placeholderId = genVar(`attr_${name}`);
            parts.push(` data-scrml-bind-if="${placeholderId}"`);
            if (registry) {
              const ifVarName = varName.replace(/^@/, "");
              const ifBaseVar = ifVarName.split(".")[0];
              const hasDotPath = ifVarName.includes(".");
              registry.addLogicBinding({
                placeholderId,
                expr: `@${ifVarName}`,
                isConditionalDisplay: true,
                varName: ifBaseVar,
                ...(hasDotPath ? { dotPath: ifVarName } : {}),
                ...(transitionEnter ? { transitionEnter } : {}),
                ...(transitionExit ? { transitionExit } : {}),
              });
            }
          } else {
            // General attribute: strip optional @ prefix so show=@count
            // resolves identically to show=count (allow-atvar-in-attrs).
            const resolved = varName.replace(/^@/, "");
            parts.push(` ${name}="${escapeHtmlAttr(resolved)}"`);
          }
        } else if (val.kind == "expr") {
          if (name == "if") {
            const placeholderId = genVar(`attr_${name}`);
            parts.push(` data-scrml-bind-if="${placeholderId}"`);
            if (registry) {
              registry.addLogicBinding({
                placeholderId,
                expr: val.raw,
                isConditionalDisplay: true,
                condExpr: val.raw,
                refs: val.refs,
                ...(transitionEnter ? { transitionEnter } : {}),
                ...(transitionExit ? { transitionExit } : {}),
              });
            }
          } else if (name.startsWith("on")) {
            // Event attribute with ${...} expression value, e.g. onclick=${() => fn(arg)}
            const placeholderId = genVar(`attr_${name}`);
            parts.push(` data-scrml-bind-${name}="${placeholderId}"`);
            if (registry) {
              registry.addEventBinding({
                placeholderId,
                eventName: name,
                handlerName: "",
                handlerArgs: [],
                handlerExpr: val.raw,
              });
            }
          }
        } else if (val.kind == "call-ref") {
          // Defense-in-depth: server-only call names must not become client event bindings.
          // This can occur if the tokenizer misparses ^{} meta content in attribute position.
          const SERVER_ONLY_CALL = /^(bun\.eval|Bun\.|process\.|fs\.)/;
          if (SERVER_ONLY_CALL.test(val.name ?? "")) {
            // Silently drop — tokenizer fix should prevent this from reaching CG.
          } else {
            const placeholderId = genVar(`attr_${name}`);
            parts.push(` data-scrml-bind-${name}="${placeholderId}"`);
            if (registry) {
              registry.addEventBinding({
                placeholderId,
                eventName: name,
                handlerName: val.name,
                handlerArgs: val.args ?? [],
              });
            }
          }
        }
      }

      if (isSelfClosing || isVoid) {
        parts.push(" />");
        return;
      }

      parts.push(">");

      if (csrfEnabled && tag == "form") {
        const csrfId = genVar("csrf");
        parts.push(`<input type="hidden" name="_csrf" value="" data-scrml-csrf="${csrfId}" />`);
      }

      for (const child of children) {
        emitNode(child);
      }

      parts.push(`</${tag}>`);
      return;
    }

    // For logic blocks embedded in markup, emit a placeholder span for client JS
    if (node.kind == "logic") {
      if (node.body?.length == 1 && node.body[0]?.kind == "bare-expr") {
        const expr = node.body[0].expr ?? "";
        if (/\bbun\s*\.\s*eval\s*\(/.test(expr)) {
          const evalErrors = [];
          const inlined = rewriteBunEval(expr, evalErrors);
          if (evalErrors.length == 0 && !inlined.includes("bun.eval")) {
            try {
              const parsed = JSON.parse(inlined);
              parts.push(String(parsed));
            } catch {
              parts.push(inlined);
            }
            if (errors) {
              for (const e of evalErrors) errors.push(new CGError(e.code, e.message, node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 }));
            }
            return;
          }
        }
      }

      const placeholderId = genVar("logic");
      parts.push(`<span data-scrml-logic="${placeholderId}"></span>`);
      if (registry && node.body) {
        for (const child of node.body) {
          if (child && child.kind == "bare-expr" && child.expr) {
            const reactiveRefs = extractReactiveDeps(child.expr, reactiveVarNames);
            registry.addLogicBinding({ placeholderId, expr: child.expr, reactiveRefs });
          }
        }
      }
      return;
    }

    if (node.kind == "meta") {
      if (node.id != null) {
        const metaScopeId = `_scrml_meta_${node.id}`;
        parts.push(`<span data-scrml-meta="${metaScopeId}"></span>`);
      }
      return;
    }
  }

  for (const node of nodes) {
    emitNode(node);
  }

  return parts.join("");
}

// ===========================================================================
// SECTION: emit-css (from emit-css.ts)
// ===========================================================================

/**
 * Render the CSS rules from a single CSS block (inline #{} or style block)
 * into a CSS string fragment.
 */
function renderCssBlock(block) {
  if (block.rules && Array.isArray(block.rules)) {
    const ruleParts = [];
    for (const rule of block.rules) {
      if (rule.selector && rule.declarations) {
        // Grouped rule: selector { declarations }
        const declParts = [];
        for (const decl of rule.declarations) {
          let value = decl.value;
          if (decl.reactiveRefs && decl.reactiveRefs.length > 0) {
            if (decl.isExpression) {
              const exprPropName = `scrml-expr-${decl.reactiveRefs.map(r => r.name).join("-")}`;
              value = `var(--${exprPropName})`;
            } else {
              value = replaceCssVarRefs(value);
            }
          }
          declParts.push(`${decl.prop}: ${value};`);
        }
        ruleParts.push(`${rule.selector} { ${declParts.join(" ")} }`);
      } else if (rule.selector) {
        // Flat selector (no braces — legacy / unusual)
        ruleParts.push(rule.selector);
      } else if (rule.prop && rule.value !== undefined) {
        let value = rule.value;
        if (rule.reactiveRefs && rule.reactiveRefs.length > 0) {
          if (rule.isExpression) {
            const exprPropName = `scrml-expr-${rule.reactiveRefs.map(r => r.name).join("-")}`;
            value = `var(--${exprPropName})`;
          } else {
            value = replaceCssVarRefs(value);
          }
        }
        ruleParts.push(`${rule.prop}: ${value};`);
      }
    }
    return ruleParts.join(" ");
  }
  // Fallback: use body/text/value string directly (backward compat with tests)
  return block.body ?? block.text ?? block.value ?? "";
}

/**
 * Collect and concatenate all CSS from inline #{} blocks and <style> blocks.
 * When a CSS rule contains reactive @var references, replaces them with
 * CSS custom property references (var(--scrml-varName)).
 *
 * Component-scoped CSS (blocks inside a component expanded by CE, tagged with
 * `_componentScope` by collectCssBlocks) is wrapped in a native CSS @scope block.
 *
 * @param nodes  — top-level AST nodes
 */
export function generateCss(nodes, cssBlocks) {
  const { inlineBlocks, styleBlocks } = cssBlocks ?? collectCssBlocks(nodes);

  // Separate program-level blocks from component-scoped blocks.
  const programInlineBlocks = inlineBlocks.filter(b => b._componentScope == null);
  const componentInlineBlocks = inlineBlocks.filter(b => b._componentScope != null);
  const programStyleBlocks = styleBlocks.filter(b => b._componentScope == null);
  const componentStyleBlocks = styleBlocks.filter(b => b._componentScope != null);

  const parts = [];

  // --- Program-level CSS (no @scope wrapping) ---
  for (const block of programInlineBlocks) {
    const css = renderCssBlock(block);
    if (css) parts.push(css);
  }
  for (const block of programStyleBlocks) {
    const body = block.body ?? block.text ?? block.value ?? "";
    if (body) parts.push(body);
  }

  // --- Component-scoped CSS (wrapped in @scope) ---
  // componentName → rendered CSS fragments
  const componentCssMap = new Map();

  for (const block of componentInlineBlocks) {
    const name = block._componentScope;
    const css = renderCssBlock(block);
    if (!css) continue;
    if (!componentCssMap.has(name)) componentCssMap.set(name, []);
    componentCssMap.get(name).push(css);
  }
  for (const block of componentStyleBlocks) {
    const name = block._componentScope;
    const body = block.body ?? block.text ?? block.value ?? "";
    if (!body) continue;
    if (!componentCssMap.has(name)) componentCssMap.set(name, []);
    componentCssMap.get(name).push(body);
  }

  for (const [name, cssParts] of componentCssMap) {
    const scopeBlock = [
      `@scope ([data-scrml-scope="${name}"]) to ([data-scrml-scope]:not([data-scrml-scope="${name}"])) {`,
      cssParts.join("\n"),
      `}`,
    ].join("\n");
    parts.push(scopeBlock);
  }

  return parts.join("\n");
}

// ===========================================================================
// SECTION: emit-bindings (from emit-bindings.ts)
// ===========================================================================

// ---------------------------------------------------------------------------
// buildEnumVarMap
// ---------------------------------------------------------------------------

/**
 * Build a map from reactive variable name → enum type name.
 */
function buildEnumVarMap(fileAST) {
  const result = new Map();

  // Step 1: build a map from variant name → enum type name from typeDecls
  const typeDecls = fileAST.typeDecls ?? fileAST.ast?.typeDecls ?? [];
  const variantToEnum = new Map();

  for (const decl of typeDecls) {
    if (!decl || decl.kind != "type-decl" || decl.typeKind != "enum") continue;
    const typeName = decl.name ?? "";
    if (!typeName) continue;

    const variants = collectEnumVariantNames(decl);
    for (const v of variants) {
      if (!variantToEnum.has(v)) {
        variantToEnum.set(v, typeName);
      }
    }
  }

  if (variantToEnum.size == 0) return result;

  // Step 2: walk all nodes in the file to find reactive-decl nodes inside logic blocks
  const topNodes = fileAST.nodes ?? (fileAST.ast ? fileAST.ast.nodes : []);
  walkForReactiveDecls(topNodes, variantToEnum, result);

  return result;
}

/**
 * Recursively walk nodes, descend into logic block bodies, and collect
 * reactive-decl nodes whose init expression matches a known enum variant.
 */
function walkForReactiveDecls(nodes, variantToEnum, result) {
  for (const node of nodes) {
    if (!node || typeof node != "object") continue;

    if (node.kind == "logic" && Array.isArray(node.body)) {
      for (const stmt of node.body) {
        if (!stmt || typeof stmt != "object") continue;
        if (stmt.kind == "state-decl" || stmt.kind == "reactive-derived-decl") {
          const varName = stmt.name ?? "";
          const init = typeof stmt.init == "string" ? stmt.init.trim() : "";
          if (!varName || !init) continue;
          // Match init to a known enum variant:
          //   ".Light"    → "Light"
          //   "::Light"   → "Light"
          //   "Light"     → "Light"  (bare PascalCase — only match if it's a known variant)
          const stripped = init.replace(/^::/, "").replace(/^\./, "");
          const enumTypeName = variantToEnum.get(stripped);
          if (enumTypeName) {
            result.set(varName, enumTypeName);
          }
        }
      }
    }

    // Descend into children (markup elements can contain logic blocks)
    if (Array.isArray(node.children)) {
      walkForReactiveDecls(node.children, variantToEnum, result);
    }
  }
}

/**
 * Extract all variant names from an enum type declaration.
 * Uses structured variants array when present, falls back to raw parse.
 */
function collectEnumVariantNames(decl) {
  if (Array.isArray(decl.variants)) {
    return decl.variants
      .map((v) => v.name ?? "")
      .filter((name) => typeof name == "string" && /^[A-Z]/.test(name));
  }

  const raw = decl.raw ?? "";
  let body = raw.trim();
  if (body.startsWith("{")) body = body.slice(1);
  if (body.endsWith("}")) body = body.slice(0, -1);
  body = body.trim();
  if (!body) return [];

  const names = [];
  for (const part of body.split(/[\n,|]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Strip leading :: or . (enum variant prefix forms)
    const clean = trimmed.replace(/^::/, "").replace(/^\./, "");
    // For payload variants like Found(id: number), extract just the name
    const name = clean.split(/[\s(]/)[0];
    if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * Emit ref= attribute wiring and bind:/class: directive wiring.
 */
export function emitBindings(ctx) {
  const { fileAST, encodingCtx } = ctx;
  const lines = [];

  // -------------------------------------------------------------------------
  // Step 2.5: Generate ref= attribute wiring (DOM element references)
  // -------------------------------------------------------------------------
  const allMarkupNodes = ctx.analysis?.markupNodes ?? collectMarkupNodes(getNodes(fileAST));
  const refMarkupNodes = allMarkupNodes;
  for (const mkNode of refMarkupNodes) {
    const nodeAttrs = mkNode.attributes ?? mkNode.attrs ?? [];
    for (const rAttr of nodeAttrs) {
      if (!rAttr || rAttr.name != "ref") continue;
      if (rAttr.value && rAttr.value.kind == "variable-ref") {
        const refVarName = (rAttr.value.name ?? "").replace(/^@/, "");
        const encodedRefName = encodingCtx ? encodingCtx.encode(refVarName) : refVarName;
        lines.push(`// ref=@${refVarName}`);
        lines.push(`_scrml_reactive_set(${JSON.stringify(encodedRefName)}, document.querySelector('[data-scrml-ref="${refVarName}"]'));`);
        lines.push("");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Build enum var map once for this file
  // -------------------------------------------------------------------------
  const enumVarMap = buildEnumVarMap(fileAST);

  // -------------------------------------------------------------------------
  // Step 3: Generate bind: directive wiring and class: directives
  // -------------------------------------------------------------------------
  const bindMarkupNodes = allMarkupNodes;
  for (const mkNode of bindMarkupNodes) {
    const nodeAttrs = mkNode.attributes ?? mkNode.attrs ?? [];
    for (const bAttr of nodeAttrs) {
      if (!bAttr || !bAttr.name) continue;

      // bind: directives — two-way binding
      if (bAttr.name.startsWith("bind:") && bAttr.value && bAttr.value.kind == "variable-ref") {
        const bVarRaw = (bAttr.value.name ?? "").replace(/^@/, ""); // e.g. "name" or "form.email"
        const bElemId = genVar(`bind_elem_${mkNode.tag ?? "el"}`);
        const bindDataAttr = `data-scrml-${bAttr.name.replace(":", "-")}`;
        const bindSelector = bAttr._bindId
          ? `[${bindDataAttr}="${bAttr._bindId}"]`
          : `[${bindDataAttr}]`;

        // Decompose dotted path: "form.email.field" → rootKey="form", pathSegs=["email","field"]
        const dotIndex = bVarRaw.indexOf(".");
        const isPath = dotIndex != -1;
        const rootKey = isPath ? bVarRaw.slice(0, dotIndex) : bVarRaw;
        const pathSegs = isPath ? bVarRaw.slice(dotIndex + 1).split(".") : [];

        const readExpr = isPath
          ? `_scrml_reactive_get(${JSON.stringify(rootKey)})${pathSegs.map(s => `.${s}`).join("")}`
          : `_scrml_reactive_get(${JSON.stringify(rootKey)})`;

        const writeExpr = (newValExpr) => isPath
          ? `_scrml_reactive_set(${JSON.stringify(rootKey)}, _scrml_deep_set(_scrml_reactive_get(${JSON.stringify(rootKey)}), ${JSON.stringify(pathSegs)}, ${newValExpr}))`
          : `_scrml_reactive_set(${JSON.stringify(rootKey)}, ${newValExpr})`;

        if (bAttr.name == "bind:value") {
          // SPEC §5.4: <select> uses "change" event; all other elements use "input"
          const elementTag = mkNode.tag ?? "";
          const inputEvent = elementTag == "select" ? "change" : "input";

          // §5.4 / §14.4.1: When the bound @var is enum-typed and the element is a <select>,
          // auto-coerce the string from event.target.value back to the enum variant.
          const enumTypeName = elementTag == "select" ? enumVarMap.get(rootKey) : undefined;
          const writeValue = enumTypeName
            ? `(${enumTypeName}_toEnum[event.target.value] ?? event.target.value)`
            : "event.target.value";

          lines.push(`// bind:value=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.value = ${readExpr};`);
          lines.push(`    ${bElemId}.addEventListener(${JSON.stringify(inputEvent)}, (event) => ${writeExpr(writeValue)});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.value = ${readExpr}; });`);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name == "bind:valueAsNumber") {
          // SPEC §5.4 M-3: bind:valueAsNumber coerces event.target.value to Number.
          const elementTag = mkNode.tag ?? "";
          const inputEvent = elementTag == "select" ? "change" : "input";
          lines.push(`// bind:valueAsNumber=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.value = ${readExpr};`);
          lines.push(`    ${bElemId}.addEventListener(${JSON.stringify(inputEvent)}, (event) => ${writeExpr("Number(event.target.value)")});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.value = ${readExpr}; });`);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name == "bind:checked") {
          lines.push(`// bind:checked=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.checked = ${readExpr};`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.checked")});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.checked = ${readExpr}; });`);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name == "bind:selected") {
          lines.push(`// bind:selected=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.value = ${readExpr};`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.value")});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.value = ${readExpr}; });`);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name == "bind:files") {
          lines.push(`// bind:files=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.files")});`);
          lines.push(`    _scrml_effect(() => { /* files are read-only from DOM — effect tracks @${bVarRaw} */ ${readExpr}; });`);
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.name == "bind:group") {
          lines.push(`// bind:group=@${bVarRaw}`);
          lines.push(`{`);
          lines.push(`  const ${bElemId} = document.querySelector('${bindSelector}');`);
          lines.push(`  if (${bElemId}) {`);
          lines.push(`    ${bElemId}.checked = (${readExpr} === ${bElemId}.value);`);
          lines.push(`    ${bElemId}.addEventListener("change", (event) => ${writeExpr("event.target.value")});`);
          lines.push(`    _scrml_effect(() => { ${bElemId}.checked = (${readExpr} === ${bElemId}.value); });`);
          lines.push(`  }`);
          lines.push(`}`);
        }
        lines.push("");
      }

      // class: directives — conditional class toggling
      // Supports four RHS forms per §5.5.2:
      //   1. variable-ref @var:   class:active=@isActive
      //   2. variable-ref obj.p:  class:done=todo.completed
      //   3. expr:                class:active=(@tool === "select")
      //   4. call-ref:            class:active=isComplete()
      if (bAttr.name.startsWith("class:") && bAttr.value && (
        bAttr.value.kind == "variable-ref" ||
        bAttr.value.kind == "expr" ||
        bAttr.value.kind == "call-ref"
      )) {
        const cClassName = bAttr.name.slice(6); // strip "class:"
        const cElemId = genVar(`class_elem_${mkNode.tag ?? "el"}`);
        const classDataAttr = `data-scrml-${bAttr.name.replace(":", "-")}`;
        const classSelector = bAttr._bindId
          ? `[${classDataAttr}="${bAttr._bindId}"]`
          : `[${classDataAttr}]`;

        if (bAttr.value.kind == "variable-ref") {
          const rawName = bAttr.value.name ?? "";
          const isReactive = rawName.startsWith("@");

          if (isReactive) {
            // §5.5.2 form 1: class:active=@isActive — reactive variable
            const cVarName = rawName.replace(/^@/, "");
            lines.push(`// class:${cClassName}=@${cVarName}`);
            lines.push(`{`);
            lines.push(`  const ${cElemId} = document.querySelector('${classSelector}');`);
            lines.push(`  if (${cElemId}) {`);
            lines.push(`    if (_scrml_reactive_get(${JSON.stringify(cVarName)})) { ${cElemId}.classList.add(${JSON.stringify(cClassName)}); }`);
            lines.push(`    _scrml_effect(() => { ${cElemId}.classList.toggle(${JSON.stringify(cClassName)}, !!_scrml_reactive_get(${JSON.stringify(cVarName)})); });`);
            lines.push(`  }`);
            lines.push(`}`);
          } else {
            // §5.5.2 form 2: class:done=todo.completed — property access on a reactive root
            const dotIndex = rawName.indexOf(".");
            const rootKey = dotIndex != -1 ? rawName.slice(0, dotIndex) : rawName;
            const pathStr = dotIndex != -1 ? rawName.slice(dotIndex) : ""; // e.g. ".completed"
            const readExpr = pathStr
              ? `_scrml_reactive_get(${JSON.stringify(rootKey)})${pathStr}`
              : `_scrml_reactive_get(${JSON.stringify(rootKey)})`;
            lines.push(`// class:${cClassName}=${rawName}`);
            lines.push(`{`);
            lines.push(`  const ${cElemId} = document.querySelector('${classSelector}');`);
            lines.push(`  if (${cElemId}) {`);
            lines.push(`    if (${readExpr}) { ${cElemId}.classList.add(${JSON.stringify(cClassName)}); }`);
            lines.push(`    _scrml_effect(() => { ${cElemId}.classList.toggle(${JSON.stringify(cClassName)}, !!(${readExpr})); });`);
            lines.push(`  }`);
            lines.push(`}`);
          }
        } else if (bAttr.value.kind == "expr") {
          // §5.5.2 form 3: class:active=(@tool === "select")
          const rawExpr = bAttr.value.raw ?? "";
          const exprRefs = bAttr.value.refs ?? [];
          const rewrittenExpr = rewriteReactiveRefs(rawExpr);
          lines.push(`// class:${cClassName}=${rawExpr}`);
          lines.push(`{`);
          lines.push(`  const ${cElemId} = document.querySelector('${classSelector}');`);
          lines.push(`  if (${cElemId}) {`);
          lines.push(`    if (${rewrittenExpr}) { ${cElemId}.classList.add(${JSON.stringify(cClassName)}); }`);
          // Auto-tracking effect handles all reactive dependencies automatically
          if (exprRefs.length > 0) {
            lines.push(`    _scrml_effect(() => { ${cElemId}.classList.toggle(${JSON.stringify(cClassName)}, !!(${rewrittenExpr})); });`);
          } else {
            lines.push(`    // No reactive refs — class toggled once at mount based on initial expression value`);
          }
          lines.push(`  }`);
          lines.push(`}`);
        } else if (bAttr.value.kind == "call-ref") {
          // §5.5.2 form 4: class:active=isComplete() — function call
          const fnName = bAttr.value.name ?? "";
          const fnArgs = bAttr.value.args ?? [];
          const rawArgs = fnArgs.join(", ");
          const callExpr = rawArgs ? `${fnName}(${rawArgs})` : `${fnName}()`;
          const rewrittenCall = rewriteReactiveRefs(callExpr);
          // Collect reactive dep names from raw args (before rewrite)
          const callRefs = [];
          const refRe = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
          let refMatch;
          while ((refMatch = refRe.exec(rawArgs)) !== null) {
            if (!callRefs.includes(refMatch[1])) callRefs.push(refMatch[1]);
          }
          lines.push(`// class:${cClassName}=${callExpr}`);
          lines.push(`{`);
          lines.push(`  const ${cElemId} = document.querySelector('${classSelector}');`);
          lines.push(`  if (${cElemId}) {`);
          lines.push(`    if (${rewrittenCall}) { ${cElemId}.classList.add(${JSON.stringify(cClassName)}); }`);
          if (callRefs.length > 0) {
            lines.push(`    _scrml_effect(() => { ${cElemId}.classList.toggle(${JSON.stringify(cClassName)}, !!(${rewrittenCall})); });`);
          } else {
            lines.push(`    // No reactive refs in call args — class toggled once at mount`);
          }
          lines.push(`  }`);
          lines.push(`}`);
        }
        lines.push("");
      }

      // template-attr: dynamic attribute from template literal interpolation
      // Detected by _tplId marker set on the attr by emit-html.js.
      if (
        bAttr.value &&
        bAttr.value.kind == "string-literal" &&
        bAttr._tplId
      ) {
        const attrName = bAttr.name;
        const rawValue = bAttr.value.value ?? "";
        const tplSelector = `[data-scrml-attr-tpl-${attrName}="${bAttr._tplId}"]`;
        const tplElemId = genVar(`tpl_elem_${mkNode.tag ?? "el"}`);

        // Rewrite the template literal value: @var → _scrml_reactive_get("var")
        const { jsExpr, reactiveVars } = rewriteTemplateAttrValue(rawValue);

        lines.push(`// template-attr ${attrName}="${rawValue}"`);
        lines.push(`{`);
        lines.push(`  const ${tplElemId} = document.querySelector('${tplSelector}');`);
        lines.push(`  if (${tplElemId}) {`);
        lines.push(`    ${tplElemId}.setAttribute(${JSON.stringify(attrName)}, ${jsExpr});`);
        // Auto-tracking effect handles all reactive dependencies automatically
        if (reactiveVars.length > 0) {
          lines.push(`    _scrml_effect(() => { ${tplElemId}.setAttribute(${JSON.stringify(attrName)}, ${jsExpr}); });`);
        }
        lines.push(`  }`);
        lines.push(`}`);
        lines.push("");
      }
    }
  }

  return lines;
}

// ===========================================================================
// SECTION: emit-event-wiring (from emit-event-wiring.ts)
// ===========================================================================

/**
 * Events that bubble reliably and are safe to delegate to document.
 * All other event types use Approach A (querySelectorAll + forEach).
 */
const DELEGABLE_EVENTS = new Set(["click", "submit"]);

/**
 * Find the matching closing brace/paren/bracket starting at `openPos`.
 * Returns the index of the closing character, or -1 if not found.
 */
function findMatchingClose(str, openPos) {
  const open = str[openPos];
  const close = open == "{" ? "}" : open == "(" ? ")" : "]";
  let depth = 1;
  let i = openPos + 1;
  while (i < str.length) {
    const ch = str[i];
    if (ch == '"' || ch == "'" || ch == "`") {
      i++;
      while (i < str.length && str[i] != ch) {
        if (str[i] == "\\") i++;
        i++;
      }
    } else if (ch == open) {
      depth++;
    } else if (ch == close) {
      depth--;
      if (depth == 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * If `raw` is a `fn(params) { body }` expression (the scrml fn shorthand),
 * return { params, body } with the body content extracted.
 * Returns null if it is not a fn() expression.
 */
function parseFnExpression(raw) {
  // Match: optional whitespace, then `fn` keyword, then `(`
  const m = raw.match(/^\s*fn\s*(\()/);
  if (!m) return null;

  // Find the closing paren of the parameter list
  const parenOpen = raw.indexOf("(", m.index + (m[0].length - 1));
  const parenClose = findMatchingClose(raw, parenOpen);
  if (parenClose < 0) return null;
  const params = raw.slice(parenOpen + 1, parenClose).trim();

  // Find the opening brace of the body
  const afterParen = raw.slice(parenClose + 1).trimStart();
  if (!afterParen.startsWith("{")) return null;
  const braceOpen = parenClose + 1 + (raw.slice(parenClose + 1).length - afterParen.length);
  const braceClose = findMatchingClose(raw, braceOpen);
  if (braceClose < 0) return null;
  const body = raw.slice(braceOpen + 1, braceClose).trim();

  return { params, body };
}

/**
 * If `raw` is an arrow function `(params) => body` or `param => body`,
 * return true.
 */
function isArrowFunction(raw) {
  return /^\s*\([^)]*\)\s*=>/.test(raw) ||
         /^\s*[\w$_][\w$_0-9]*\s*=>/.test(raw);
}

export function emitEventWiring(ctx, fnNameMap) {
  const eventBindings = ctx.registry.eventBindings;
  const logicBindings = ctx.registry.logicBindings;
  const encodingCtx = ctx.encodingCtx;
  const lines = [];

  const hasEvents = eventBindings && eventBindings.length > 0;
  const hasLogic = logicBindings && logicBindings.length > 0;
  if (!hasEvents && !hasLogic) {
    return lines;
  }

  lines.push("");
  lines.push("// --- Event handler wiring (compiler-generated) ---");
  lines.push("document.addEventListener('DOMContentLoaded', function() {");

  // -------------------------------------------------------------------------
  // Step 8: Wire event handlers from HTML bindings to generated functions
  //
  // Approach D: Split by delegability.
  //   - Delegable (click, submit): handler registry + document.addEventListener
  //   - Non-delegable: Approach A querySelectorAll + forEach per event type.
  // -------------------------------------------------------------------------

  // Group event bindings by event type (e.g. "onclick", "onsubmit", "onchange")
  const byEventType = new Map();

  for (const binding of eventBindings) {
    const { placeholderId, eventName, handlerName, handlerArgs } = binding;
    const domEvent = eventName.replace(/^on/, ""); // onclick → click

    let handlerExpr;

    if (binding.handlerExpr) {
      // Raw expression from ${...} attribute value — use as the handler body.
      // Three cases:
      // Case A: fn() { body } — scrml fn shorthand
      // Case B: Arrow function `(p) => expr` or `p => expr`
      // Case C: Plain expression / statement

      const fnParsed = parseFnExpression(binding.handlerExpr);
      if (fnParsed !== null) {
        // Case A: fn(params) { body } — rewrite the body, construct function directly.
        const rewrittenBody = rewriteBlockBody(fnParsed.body);
        handlerExpr = `function(${fnParsed.params}) { ${rewrittenBody}; }`;
      } else if (isArrowFunction(binding.handlerExpr)) {
        // Case B: Arrow function — rewrite reactive refs in the expression but
        // do not add an outer wrapper.
        handlerExpr = rewriteExpr(binding.handlerExpr);
      } else {
        // Case C: Plain expression or statement body. Rewrite and wrap.
        const rewritten = rewriteBlockBody(binding.handlerExpr);
        handlerExpr = `function(event) { ${rewritten}; }`;
      }
    } else {
      // call-ref path: resolve handler name and serialize arguments
      const resolvedHandler = fnNameMap.get(handlerName) || handlerName;

      const argsStr = (handlerArgs ?? []).map((a) => {
        if (typeof a == "string") return rewriteExpr(a);
        const node = a;
        if (node && node.kind == "string-literal") return JSON.stringify(node.value);
        if (node && node.kind == "number-literal") return String(node.value);
        if (node && node.kind == "variable-ref") return `_scrml_reactive_get(${JSON.stringify((node.name || "").replace(/^@/, ""))})`;
        if (node && typeof node.value != "undefined") return JSON.stringify(node.value);
        return String(a);
      }).join(", ");

      // For submit events on forms, auto-inject event.preventDefault()
      const preventLine = domEvent == "submit" ? "event.preventDefault(); " : "";
      handlerExpr = `function(event) { ${preventLine}${resolvedHandler}(${argsStr}); }`;
    }

    if (!byEventType.has(eventName)) {
      byEventType.set(eventName, []);
    }
    byEventType.get(eventName).push({ placeholderId, handlerExpr });
  }

  // Emit wiring — delegable events use document.addEventListener with ancestor
  // walk; non-delegable events use Approach A querySelectorAll + forEach.
  for (const [eventName, entries] of byEventType) {
    const domEvent = eventName.replace(/^on/, ""); // onclick → click

    if (DELEGABLE_EVENTS.has(domEvent)) {
      // -----------------------------------------------------------------------
      // Approach D path: handler registry + delegated document listener
      // -----------------------------------------------------------------------
      const registryVarName = `_scrml_${domEvent}`;

      // Emit the handler registry object
      lines.push(`  const ${registryVarName} = {`);
      for (const { placeholderId, handlerExpr } of entries) {
        lines.push(`    ${JSON.stringify(placeholderId)}: ${handlerExpr},`);
      }
      lines.push(`  };`);

      // Emit a single document.addEventListener with ancestor walk
      lines.push(`  document.addEventListener(${JSON.stringify(domEvent)}, function(event) {`);
      lines.push(`    let t = event.target;`);
      lines.push(`    while (t && t !== document) {`);
      lines.push(`      const id = t.getAttribute(${JSON.stringify("data-scrml-bind-" + eventName)});`);
      lines.push(`      if (id && ${registryVarName}[id]) { ${registryVarName}[id](event); return; }`);
      lines.push(`      t = t.parentElement;`);
      lines.push(`    }`);
      lines.push(`  });`);
    } else {
      // -----------------------------------------------------------------------
      // Approach A path: batch querySelectorAll + forEach per event type
      // -----------------------------------------------------------------------
      const mapVarName = `_scrml_${domEvent}_handlers`;

      // Emit the handler dispatch map
      lines.push(`  const ${mapVarName} = {`);
      for (const { placeholderId, handlerExpr } of entries) {
        lines.push(`    ${JSON.stringify(placeholderId)}: ${handlerExpr},`);
      }
      lines.push(`  };`);

      // Emit one querySelectorAll to wire all handlers for this event type
      lines.push(`  document.querySelectorAll('[data-scrml-bind-${eventName}]').forEach(function(el) {`);
      lines.push(`    const _scrml_id = el.getAttribute('data-scrml-bind-${eventName}');`);
      lines.push(`    if (${mapVarName}[_scrml_id]) el.addEventListener(${JSON.stringify(domEvent)}, ${mapVarName}[_scrml_id]);`);
      lines.push(`  });`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 9: Wire reactive display for logic placeholders
  // -------------------------------------------------------------------------
  if (logicBindings && logicBindings.length > 0) {
    lines.push("");
    lines.push("  // --- Reactive display wiring ---");
    for (const binding of logicBindings) {
      const { placeholderId, expr } = binding;

      // Conditional display (if=) — toggle element visibility
      if (binding.isConditionalDisplay) {
        const hasTransition = binding.transitionEnter || binding.transitionExit;

        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-bind-if="${placeholderId}"]');`);
        lines.push(`    if (el) {`);

        // Build the condition expression string used for evaluation
        let conditionCode;
        let subscribeVars;

        if (binding.condExpr) {
          const compiled = rewriteExpr(binding.condExpr);
          conditionCode = `(${compiled})`;
          subscribeVars = binding.refs ?? [];
        } else if (binding.varName) {
          const condVarName = binding.varName;
          const encodedCondVar = encodingCtx && encodingCtx.enabled ? encodingCtx.encode(condVarName) : condVarName;
          if (binding.dotPath) {
            conditionCode = `(_scrml_reactive_get(${JSON.stringify(encodedCondVar)}).${binding.dotPath.slice(condVarName.length + 1)})`;
          } else {
            conditionCode = `_scrml_reactive_get(${JSON.stringify(encodedCondVar)})`;
          }
          subscribeVars = [encodedCondVar];
        }

        if (conditionCode && subscribeVars !== undefined) {
          if (!hasTransition) {
            // No transition — simple display toggle (original behavior)
            lines.push(`      el.style.display = ${conditionCode} ? "" : "none";`);
            lines.push(`      _scrml_effect(function() { el.style.display = ${conditionCode} ? "" : "none"; });`);
          } else {
            // Transition-aware display toggle
            const enterClass = binding.transitionEnter ? `"scrml-enter-${binding.transitionEnter}"` : null;
            const exitClass = binding.transitionExit ? `"scrml-exit-${binding.transitionExit}"` : null;

            // Initial state — no animation on first render
            lines.push(`      el.style.display = ${conditionCode} ? "" : "none";`);

            // Build the transition toggle function
            lines.push(`      function _scrml_transition_${placeholderId.replace(/[^a-zA-Z0-9_]/g, "_")}() {`);
            lines.push(`        const _scrml_show = ${conditionCode};`);
            lines.push(`        if (_scrml_show) {`);
            if (enterClass) {
              lines.push(`          el.style.display = "";`);
              lines.push(`          el.classList.add(${enterClass});`);
              lines.push(`          el.addEventListener("animationend", function _scrml_ae() { el.classList.remove(${enterClass}); el.removeEventListener("animationend", _scrml_ae); }, { once: true });`);
            } else {
              lines.push(`          el.style.display = "";`);
            }
            lines.push(`        } else {`);
            if (exitClass) {
              lines.push(`          el.classList.add(${exitClass});`);
              lines.push(`          el.addEventListener("animationend", function _scrml_ae() { el.classList.remove(${exitClass}); el.style.display = "none"; el.removeEventListener("animationend", _scrml_ae); }, { once: true });`);
            } else {
              lines.push(`          el.style.display = "none";`);
            }
            lines.push(`        }`);
            lines.push(`      }`);

            lines.push(`      _scrml_effect(_scrml_transition_${placeholderId.replace(/[^a-zA-Z0-9_]/g, "_")});`);
          }
        }

        lines.push(`    }`);
        lines.push(`  }`);
        continue;
      }

      // Extract all @var references from the expression.
      let varRefs;
      if (binding.reactiveRefs !== undefined && binding.reactiveRefs !== null) {
        // Use pre-annotated deps — string-literal-aware, filtered to known reactive vars
        varRefs = Array.from(binding.reactiveRefs);
      } else {
        // Fallback: regex scan of the raw expression string
        varRefs = [];
        const varRefRegex = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
        let match;
        while ((match = varRefRegex.exec(expr)) !== null) {
          varRefs.push(match[1]);
        }
      }

      if (varRefs.length > 0) {
        let rewrittenExpr = rewriteExpr(expr);

        // When encoding is active, replace _scrml_reactive_get("name") with encoded names
        if (encodingCtx && encodingCtx.enabled) {
          for (const ref of varRefs) {
            const encoded = encodingCtx.encode(ref);
            if (encoded != ref) {
              rewrittenExpr = rewrittenExpr.split(`_scrml_reactive_get("${ref}")`).join(`_scrml_reactive_get(${JSON.stringify(encoded)})`);
            }
          }
        }

        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-logic="${placeholderId}"]');`);
        lines.push(`    if (el) {`);
        lines.push(`      el.textContent = ${rewrittenExpr};`);

        lines.push(`      _scrml_effect(function() { el.textContent = ${rewrittenExpr}; });`);

        lines.push(`    }`);
        lines.push(`  }`);
      }
    }
  }

  // --- §17.1.1: if-chain wiring ---
  if (logicBindings && logicBindings.length > 0) {
    // Group chain branches by chainId
    const chains = new Map();
    for (const binding of logicBindings) {
      if (binding.kind == "if-chain-branch" || binding.kind == "if-chain-else") {
        const chainId = binding.chainId;
        if (!chains.has(chainId)) chains.set(chainId, []);
        chains.get(chainId).push(binding);
      }
    }

    for (const [chainId, chainBindings] of chains) {
      lines.push("");
      lines.push(`  // if-chain: ${chainId}`);
      lines.push(`  {`);
      lines.push(`    const _chain_branches = document.querySelectorAll('[data-scrml-if-chain="${chainId}"]');`);
      lines.push(`    function _update_chain_${chainId.replace(/[^a-zA-Z0-9_]/g, "_")}() {`);

      // Evaluate conditions in order
      const condBranches = chainBindings.filter((b) => b.kind == "if-chain-branch");
      const elseBranch = chainBindings.find((b) => b.kind == "if-chain-else");

      lines.push(`      let _active = null;`);
      for (const branch of condBranches) {
        let condCode;
        if (branch.condition?.raw) {
          condCode = rewriteReactiveRefs(branch.condition.raw);
        } else if (branch.condition?.name) {
          const varName = branch.condition.name.replace(/^@/, "");
          condCode = `_scrml_reactive_get(${JSON.stringify(varName)})`;
        } else {
          condCode = "true";
        }
        lines.push(`      if (_active === null && (${condCode})) _active = "${branch.branchId}";`);
      }
      if (elseBranch) {
        lines.push(`      if (_active === null) _active = "${elseBranch.branchId}";`);
      }
      lines.push(`      for (const el of _chain_branches) {`);
      lines.push(`        el.style.display = el.getAttribute("data-scrml-chain-branch") === _active ? "" : "none";`);
      lines.push(`      }`);
      lines.push(`    }`);
      lines.push(`    _update_chain_${chainId.replace(/[^a-zA-Z0-9_]/g, "_")}();`);

      // Auto-tracking effect handles all reactive deps
      lines.push(`    _scrml_effect(_update_chain_${chainId.replace(/[^a-zA-Z0-9_]/g, "_")});`);
      lines.push(`  }`);
    }
  }

  lines.push("});");

  return lines;
}

// ===========================================================================
// SECTION: emit-reactive-wiring (from emit-reactive-wiring.ts)
// ===========================================================================

/**
 * Emit top-level logic statements and CSS variable bridge wiring.
 */
export function emitReactiveWiring(ctx) {
  const { fileAST, errors, encodingCtx } = ctx;
  const lines = [];

  const derivedNames = collectDerivedVarNames(fileAST);
  const emitOpts = derivedNames.size > 0 ? { derivedNames, encodingCtx } : { encodingCtx };

  // Step 4: Generate top-level logic statements
  const topLevel = ctx.analysis?.topLevelLogic ?? collectTopLevelLogicStatements(fileAST);
  for (const stmt of topLevel) {
    if (isServerOnlyNode(stmt)) {
      errors.push(new CGError(
        "W-CG-001",
        `W-CG-001: Top-level ${stmt.kind} block suppressed from client output. ` +
        `Server-only constructs (SQL, transactions, server-context meta) must be ` +
        `inside server-boundary functions. This block will not execute.`,
        stmt.span ?? { file: fileAST.filePath ?? "", start: 0, end: 0, line: 1, col: 1 },
        "warning",
      ));
      continue;
    }

    const code = emitLogicNode(stmt, emitOpts);
    if (code) lines.push(code);
  }

  // Single-pass classification of markup nodes (replaces 5 independent AST walks)
  const { lifecycleNodes, inputStateNodes, requestNodes, timeoutNodes, bindPropsWirings } =
    classifyMarkupNodes(getNodes(fileAST));

  // Step 5: Generate <timer> and <poll> lifecycle initialization (§6.7.5, §6.7.6)
  if (lifecycleNodes.length > 0) {
    lines.push("");
    lines.push("// --- lifecycle initialization (compiler-generated) ---");
    for (const lcNode of lifecycleNodes) {
      const lcLines = emitLifecycleNode(lcNode, errors, fileAST.filePath ?? "");
      for (const l of lcLines) lines.push(l);
    }
  }

  // Step 5b: Generate <keyboard>, <mouse>, <gamepad> input state initialization (§35)
  if (inputStateNodes.length > 0) {
    lines.push("");
    lines.push("// --- input state initialization (compiler-generated) ---");
    for (const isNode of inputStateNodes) {
      const isLines = emitInputStateNode(isNode, errors, fileAST.filePath ?? "");
      for (const l of isLines) lines.push(l);
    }
  }

  // Step 5.5: Generate <channel> client-side WebSocket initialization (§35)
  const channelNodes = ctx.analysis?.channelNodes ?? collectChannelNodes(getNodes(fileAST));
  if (channelNodes.length > 0) {
    lines.push("");
    lines.push("// --- channel WebSocket client initialization (§35, compiler-generated) ---");
    for (const chNode of channelNodes) {
      const chLines = emitChannelClientJs(chNode, errors, fileAST.filePath ?? "");
      for (const l of chLines) lines.push(l);
    }
  }

  // Step 5c: Generate <request> single-shot async fetch initialization (§6.7.7)
  if (requestNodes.length > 0) {
    lines.push("");
    lines.push("// --- request async fetch initialization (§6.7.7, compiler-generated) ---");
    for (const rqNode of requestNodes) {
      const rqLines = emitRequestNode(rqNode, errors, fileAST.filePath ?? "");
      for (const l of rqLines) lines.push(l);
    }
  }

  // Step 5d: Generate <timeout> single-shot timer initialization (§6.7.8)
  if (timeoutNodes.length > 0) {
    lines.push("");
    lines.push("// --- timeout single-shot timer initialization (§6.7.8, compiler-generated) ---");
    for (const toNode of timeoutNodes) {
      const toLines = emitTimeoutNode(toNode, errors, fileAST.filePath ?? "");
      for (const l of toLines) lines.push(l);
    }
  }

  // Step 6: Generate CSS variable bridge
  const cssBridges = ctx.analysis?.cssBridges ?? collectCssVariableBridges(getNodes(fileAST));
  if (cssBridges.length > 0) {
    lines.push("");
    lines.push("// --- CSS variable bridge (compiler-generated) ---");

    for (const bridge of cssBridges) {
      const target = bridge.scoped
        ? `_scrml_el`
        : `document.documentElement`;

      if (bridge.isExpression) {
        const exprJs = bridge.expr.replace(
          /@([A-Za-z_$][A-Za-z0-9_$]*)/g,
          `_scrml_reactive_get("$1")`
        );
        const evalFn = genVar("css_expr");
        lines.push(`function ${evalFn}() { return ${exprJs}; }`);
        lines.push(`${target}.style.setProperty(${JSON.stringify(bridge.customProp)}, ${evalFn}());`);
        if (bridge.refs.length > 0) {
          lines.push(`_scrml_effect(() => ${target}.style.setProperty(${JSON.stringify(bridge.customProp)}, ${evalFn}()));`);
        }
      } else {
        lines.push(`${target}.style.setProperty(${JSON.stringify(bridge.customProp)}, _scrml_reactive_get(${JSON.stringify(bridge.varName)}));`);
        lines.push(`_scrml_effect(() => ${target}.style.setProperty(${JSON.stringify(bridge.customProp)}, _scrml_reactive_get(${JSON.stringify(bridge.varName)})));`);
      }
    }
  }

  // Step 7: Generate bind: prop bidirectional wiring (§15.11.1)
  if (bindPropsWirings.length > 0) {
    lines.push("");
    lines.push("// --- bind: prop bidirectional wiring (compiler-generated) ---");
    for (const { propName, callerVar, componentName } of bindPropsWirings) {
      const guardVar = genVar("bind_sync");
      const propJs = JSON.stringify(propName);
      const callerJs = JSON.stringify(callerVar);
      lines.push(`// bind:${propName}=@${callerVar} (from ${componentName})`);
      lines.push(`let ${guardVar} = false;`);
      lines.push(`_scrml_effect(function() {`);
      lines.push(`  const _v = _scrml_reactive_get(${callerJs});`);
      lines.push(`  if (${guardVar}) return; ${guardVar} = true;`);
      lines.push(`  _scrml_reactive_set(${propJs}, _v);`);
      lines.push(`  ${guardVar} = false;`);
      lines.push(`});`);
      lines.push(`_scrml_effect(function() {`);
      lines.push(`  const _v = _scrml_reactive_get(${propJs});`);
      lines.push(`  if (${guardVar}) return; ${guardVar} = true;`);
      lines.push(`  _scrml_reactive_set(${callerJs}, _v);`);
      lines.push(`  ${guardVar} = false;`);
      lines.push(`});`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Single-pass markup classification (replaces 5 independent AST walks)
// ---------------------------------------------------------------------------

/**
 * Walk the AST once and classify markup nodes into all 5 wiring buckets.
 */
function classifyMarkupNodes(nodes) {
  const result = {
    lifecycleNodes: [],
    inputStateNodes: [],
    requestNodes: [],
    timeoutNodes: [],
    bindPropsWirings: [],
  };

  function visit(nodeList) {
    for (const node of nodeList) {
      if (!node || typeof node != "object") continue;

      if (node.kind == "markup") {
        const tag = node.tag ?? "";

        if (tag == "timer" || tag == "poll") {
          result.lifecycleNodes.push(node);
        } else if (tag == "keyboard" || tag == "mouse" || tag == "gamepad") {
          result.inputStateNodes.push(node);
        } else if (tag == "request") {
          result.requestNodes.push(node);
        } else if (tag == "timeout") {
          result.timeoutNodes.push(node);
        }

        // bindProps is not exclusive — any markup node can have _bindProps
        if (Array.isArray(node._bindProps) && node._bindProps.length > 0) {
          const componentName = node._expandedFrom ?? node.tag ?? "unknown";
          for (const { propName, callerVar } of node._bindProps) {
            result.bindPropsWirings.push({ propName, callerVar, componentName });
          }
        }

        // Recurse into markup children
        if (Array.isArray(node.children)) {
          visit(node.children);
        }
        continue;
      }

      // Skip logic block children — reactive-wiring nodes are not inside logic blocks
      if (node.kind == "logic" && Array.isArray(node.body)) {
        continue;
      }

      // Recurse into all other node kinds
      if (Array.isArray(node.children)) {
        visit(node.children);
      }
    }
  }

  visit(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Lifecycle node emission
// ---------------------------------------------------------------------------

function emitLifecycleNode(node, errors, filePath) {
  const lines = [];
  const tag = node.tag ?? "timer";
  const attrs = node.attrs ?? node.attributes ?? [];
  const children = node.children ?? [];
  const span = node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  const attrMap = new Map(attrs.map((a) => [a.name, a]));

  const intervalAttr = attrMap.get("interval");
  let intervalMs = null;
  if (intervalAttr) {
    const v = intervalAttr.value;
    if (v?.kind == "string-literal") {
      intervalMs = parseInt(v.value, 10);
    } else if (v?.kind == "variable-ref") {
      const raw = (v.name ?? "").replace(/^@/, "");
      intervalMs = parseInt(raw, 10);
    }
  }

  if (intervalMs === null || isNaN(intervalMs) || intervalMs <= 0) {
    intervalMs = 1000;
  }

  const idAttr = attrMap.get("id");
  let timerId = null;
  if (idAttr) {
    const v = idAttr.value;
    if (v?.kind == "string-literal") timerId = v.value;
    else if (v?.kind == "variable-ref") timerId = (v.name ?? "").replace(/^@/, "");
  }

  const timerVar = timerId ? `"${timerId}"` : JSON.stringify(genVar("timer"));
  const scopeVar = JSON.stringify(genVar("scope"));

  const runningAttr = attrMap.get("running");
  let runningVarName = null;
  let runningIsAlwaysTrue = true;
  if (runningAttr) {
    const v = runningAttr.value;
    if (v?.kind == "variable-ref") {
      const raw = v.name ?? "";
      if (raw.startsWith("@")) {
        runningVarName = raw.slice(1);
        runningIsAlwaysTrue = false;
      } else if (raw == "true") {
        runningIsAlwaysTrue = true;
      } else if (raw == "false") {
        runningIsAlwaysTrue = false;
      }
    }
  }

  let bodyCode = "/* empty */";
  const logicChild = children.find((c) => c?.kind == "logic");
  if (logicChild && Array.isArray(logicChild.body) && logicChild.body.length > 0) {
    const bodyLines = [];
    for (const stmt of logicChild.body) {
      const code = emitLogicNode(stmt);
      if (code) bodyLines.push(code);
    }
    bodyCode = bodyLines.join("\n  ");
  }

  lines.push(`// <${tag}${timerId ? ` id="${timerId}"` : ""}> interval=${intervalMs}ms`);
  lines.push(`_scrml_timer_start(${scopeVar}, ${timerVar}, ${intervalMs}, function() {`);
  lines.push(`  ${bodyCode}`);
  lines.push(`});`);

  if (!runningIsAlwaysTrue && !runningVarName) {
    lines.push(`_scrml_timer_pause(${scopeVar}, ${timerVar});`);
  }

  if (runningVarName) {
    const varJs = JSON.stringify(runningVarName);
    lines.push(`if (!_scrml_reactive_get(${varJs})) { _scrml_timer_pause(${scopeVar}, ${timerVar}); }`);
    lines.push(`_scrml_effect(function() {`);
    lines.push(`  if (_scrml_reactive_get(${varJs})) { _scrml_timer_resume(${scopeVar}, ${timerVar}); } else { _scrml_timer_pause(${scopeVar}, ${timerVar}); }`);
    lines.push(`});`);
  }

  lines.push(`_scrml_register_cleanup(() => _scrml_timer_stop(${scopeVar}, ${timerVar}));`);

  return lines;
}

// ---------------------------------------------------------------------------
// Input state node emission
// ---------------------------------------------------------------------------

function emitInputStateNode(node, errors, filePath) {
  const lines = [];
  const tag = node.tag ?? "keyboard";
  const attrs = node.attrs ?? node.attributes ?? [];
  const span = node.span ?? { file: filePath, start: 0, end: 0, line: 1, col: 1 };

  const attrMap = new Map(attrs.map((a) => [a.name, a]));

  const idAttr = attrMap.get("id");
  let inputId = null;
  if (idAttr) {
    const v = idAttr.value;
    if (v?.kind == "string-literal") inputId = v.value;
    else if (v?.kind == "variable-ref") inputId = (v.name ?? "").replace(/^@/, "");
  }

  const inputIdJs = inputId ? JSON.stringify(inputId) : JSON.stringify(genVar("input"));
  const scopeVar = JSON.stringify(genVar("scope"));

  if (tag == "keyboard") {
    lines.push(`// <keyboard${inputId ? ` id="${inputId}"` : ""}>`);
    lines.push(`_scrml_input_keyboard_create(${inputIdJs}, ${scopeVar});`);
    lines.push(`_scrml_register_cleanup(() => _scrml_input_keyboard_destroy(${inputIdJs}, ${scopeVar}));`);
  } else if (tag == "mouse") {
    const targetAttr = attrMap.get("target");
    let targetExpr = "null";
    if (targetAttr) {
      const v = targetAttr.value;
      if (v?.kind == "variable-ref") {
        const raw = (v.name ?? "").replace(/^@/, "");
        targetExpr = `() => _scrml_reactive_get(${JSON.stringify(raw)})`;
      }
    }
    lines.push(`// <mouse${inputId ? ` id="${inputId}"` : ""}${targetAttr ? " target=..." : ""}>`);
    lines.push(`_scrml_input_mouse_create(${inputIdJs}, ${scopeVar}, ${targetExpr});`);
    lines.push(`_scrml_register_cleanup(() => _scrml_input_mouse_destroy(${inputIdJs}, ${scopeVar}));`);
  } else if (tag == "gamepad") {
    const indexAttr = attrMap.get("index");
    let gamepadIndex = 0;
    if (indexAttr) {
      const v = indexAttr.value;
      if (v?.kind == "string-literal") {
        const n = parseInt(v.value, 10);
        if (!isNaN(n) && n >= 0 && n <= 3) gamepadIndex = n;
      } else if (v?.kind == "variable-ref") {
        const n = parseInt((v.name ?? "").replace(/^@/, ""), 10);
        if (!isNaN(n) && n >= 0 && n <= 3) gamepadIndex = n;
      }
    }
    lines.push(`// <gamepad${inputId ? ` id="${inputId}"` : ""} index=${gamepadIndex}>`);
    lines.push(`_scrml_input_gamepad_create(${inputIdJs}, ${scopeVar}, ${gamepadIndex});`);
    lines.push(`_scrml_register_cleanup(() => _scrml_input_gamepad_destroy(${inputIdJs}, ${scopeVar}));`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Request node emission (§6.7.7)
// ---------------------------------------------------------------------------

function emitRequestNode(node, errors, filePath) {
  const lines = [];
  const attrs = node.attrs ?? node.attributes ?? [];

  const attrMap = new Map(attrs.map((a) => [a.name, a]));

  const idAttr = attrMap.get("id");
  let requestId = null;
  if (idAttr) {
    const v = idAttr.value;
    if (v?.kind == "string-literal") requestId = v.value;
    else if (v?.kind == "variable-ref") requestId = (v.name ?? "").replace(/^@/, "");
    else if (typeof v == "string") requestId = v;
  }

  if (!requestId) return lines;

  const urlAttr = attrMap.get("url");
  let urlExpr = '""';
  if (urlAttr) {
    const v = urlAttr.value;
    if (v?.kind == "string-literal") urlExpr = JSON.stringify(v.value);
    else if (typeof v == "string") urlExpr = JSON.stringify(v);
    else if (typeof v?.value == "string") urlExpr = JSON.stringify(v.value);
  }

  const depsAttr = attrMap.get("deps");
  const depsVars = [];
  if (depsAttr) {
    const v = depsAttr.value;
    if (v?.kind == "array" && Array.isArray(v.elements)) {
      for (const el of v.elements) {
        if (el?.kind == "variable-ref") depsVars.push((el.name ?? "").replace(/^@/, ""));
      }
    } else if (typeof v?.value == "string") {
      const matches = v.value.matchAll(/@([A-Za-z_$][A-Za-z0-9_$]*)/g);
      for (const m of matches) depsVars.push(m[1]);
    }
  }

  const methodAttr = attrMap.get("method");
  let method = "GET";
  if (methodAttr) {
    const v = methodAttr.value;
    if (v?.kind == "string-literal") method = v.value;
    else if (typeof v == "string") method = v;
    else if (typeof v?.value == "string") method = v.value;
  }

  const stateVar = `_scrml_request_${requestId}`;
  const fetchFn = `_scrml_request_${requestId}_fetch`;
  const seqVar = `_scrml_request_${requestId}_seq`;
  const mountedVar = `_scrml_request_${requestId}_mounted`;

  lines.push(`// <request id="${requestId}">`);
  lines.push(`var ${stateVar} = { loading: true, data: null, error: null, stale: false };`);
  lines.push(`var ${seqVar} = 0;`);
  lines.push(`var ${mountedVar} = true;`);
  lines.push(`async function ${fetchFn}() {`);
  lines.push(`  var _seq = ++${seqVar};`);
  lines.push(`  ${stateVar}.loading = true;`);
  lines.push(`  ${stateVar}.error = null;`);
  lines.push(`  if (${stateVar}.data !== null) { ${stateVar}.stale = true; }`);
  lines.push(`  _scrml_notify(${JSON.stringify(requestId)});`);
  lines.push(`  try {`);
  lines.push(`    var _res = await fetch(${urlExpr}, { method: ${JSON.stringify(method)} });`);
  lines.push(`    if (!_res.ok) throw new Error("HTTP " + _res.status);`);
  lines.push(`    var _data = await _res.json();`);
  lines.push(`    if (!${mountedVar} || _seq !== ${seqVar}) return;`);
  lines.push(`    ${stateVar}.data = _data;`);
  lines.push(`  } catch (_e) {`);
  lines.push(`    if (!${mountedVar} || _seq !== ${seqVar}) return;`);
  lines.push(`    ${stateVar}.error = _e;`);
  lines.push(`  }`);
  lines.push(`  ${stateVar}.loading = false;`);
  lines.push(`  ${stateVar}.stale = false;`);
  lines.push(`  _scrml_notify(${JSON.stringify(requestId)});`);
  lines.push(`}`);
  lines.push(`${stateVar}.refetch = ${fetchFn};`);
  lines.push(`_scrml_register_cleanup(function() { ${mountedVar} = false; });`);

  if (depsVars.length > 0) {
    const depsJs = depsVars.map(d => `_scrml_reactive_get(${JSON.stringify(d)})`).join(", ");
    lines.push(`_scrml_effect(function() {`);
    lines.push(`  var _d = [${depsJs}];`);
    lines.push(`  if (${mountedVar}) ${fetchFn}();`);
    lines.push(`});`);
  } else {
    lines.push(`${fetchFn}();`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Timeout node emission (§6.7.8)
// ---------------------------------------------------------------------------

function emitTimeoutNode(node, errors, filePath) {
  const lines = [];
  const attrs = node.attrs ?? node.attributes ?? [];
  const children = node.children ?? [];

  const attrMap = new Map(attrs.map((a) => [a.name, a]));

  // Extract delay attribute
  const delayAttr = attrMap.get("delay");
  let delayMs = null;
  if (delayAttr) {
    const v = delayAttr.value;
    if (v?.kind == "string-literal") {
      delayMs = parseInt(v.value, 10);
    } else if (v?.kind == "variable-ref") {
      const raw = (v.name ?? "").replace(/^@/, "");
      delayMs = parseInt(raw, 10);
    }
  }
  if (delayMs === null || isNaN(delayMs) || delayMs <= 0) {
    delayMs = 1000; // fallback (error already reported in emit-html)
  }

  // Extract id attribute
  const idAttr = attrMap.get("id");
  let timeoutId = null;
  if (idAttr) {
    const v = idAttr.value;
    if (v?.kind == "string-literal") timeoutId = v.value;
    else if (v?.kind == "variable-ref") timeoutId = (v.name ?? "").replace(/^@/, "");
  }

  const timerVar = genVar("timeout");

  // Extract body code from logic children
  let bodyCode = "";
  for (const child of children) {
    if (!child || typeof child != "object") continue;
    if (child.kind == "logic" && Array.isArray(child.body)) {
      const bodyLines = [];
      for (const stmt of child.body) {
        const code = emitLogicNode(stmt);
        if (code) bodyLines.push(code);
      }
      bodyCode = bodyLines.join("\n    ");
    }
  }

  lines.push(`// <timeout${timeoutId ? ` id="${timeoutId}"` : ""} delay=${delayMs}>`);

  // Emit the setTimeout call
  lines.push(`var ${timerVar} = setTimeout(function() {`);
  if (bodyCode) {
    lines.push(`    ${bodyCode}`);
  }
  if (timeoutId) {
    lines.push(`    _scrml_reactive_set(${JSON.stringify(timeoutId + "_fired")}, true);`);
  }
  lines.push(`}, ${delayMs});`);

  // Emit cancel function and initial fired state if id is present
  if (timeoutId) {
    lines.push(`_scrml_reactive_set(${JSON.stringify(timeoutId + "_fired")}, false);`);
    lines.push(`function ${timeoutId}_cancel() { clearTimeout(${timerVar}); }`);
  }

  // Register scope cleanup — cancel timeout on teardown (§6.7.2, step 2)
  lines.push(`_scrml_register_cleanup(function() { clearTimeout(${timerVar}); });`);

  return lines;
}

// ===========================================================================
// SECTION: emit-channel (from emit-channel.ts)
// ===========================================================================

// ---------------------------------------------------------------------------
// Channel node collection
// ---------------------------------------------------------------------------

/**
 * Walk an AST node tree and collect all `<channel>` markup nodes.
 */
export function collectChannelNodes(nodes) {
  const result = [];

  function visit(nodeList) {
    for (const node of nodeList) {
      if (!node || typeof node != "object") continue;

      if (node.kind == "markup") {
        if ((node.tag ?? "") == "channel") {
          result.push(node);
        }
        if (Array.isArray(node.children)) {
          visit(node.children);
        }
        continue;
      }

      if (node.kind == "logic" && Array.isArray(node.body)) {
        continue;
      }

      if (Array.isArray(node.children)) {
        visit(node.children);
      }
    }
  }

  visit(nodes);
  return result;
}

// ---------------------------------------------------------------------------
// Channel attribute extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract channel attributes from a `<channel>` markup node.
 */
function extractChannelAttrs(node) {
  const attrs = node.attrs ?? node.attributes ?? [];
  const attrMap = new Map(attrs.map((a) => [a.name, a]));

  const nameAttr = attrMap.get("name");
  let name = "channel";
  if (nameAttr) {
    const v = nameAttr.value;
    if (v?.kind == "string-literal") name = v.value;
    else if (v?.kind == "variable-ref") name = (v.name ?? "").replace(/^@/, "");
    else if (typeof v == "string") name = v;
  }

  const safeName = name.replace(/[^a-zA-Z0-9_]/g, "_");

  const topicAttr = attrMap.get("topic");
  let topic = name;
  if (topicAttr) {
    const v = topicAttr.value;
    if (v?.kind == "string-literal") topic = v.value;
    else if (v?.kind == "variable-ref") topic = (v.name ?? "").replace(/^@/, "");
    else if (typeof v == "string") topic = v;
  }

  const reconnAttr = attrMap.get("reconnect");
  let reconnectMs = 2000;
  if (reconnAttr) {
    const v = reconnAttr.value;
    const raw = v?.kind == "string-literal" ? v.value : (v?.name ?? "").replace(/^@/, "");
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed >= 0) reconnectMs = parsed;
  }

  const hasProtect = attrMap.has("protect");
  const hasPresence = attrMap.has("presence");

  return { name, safeName, topic, reconnectMs, hasProtect, hasPresence };
}

/**
 * Extract `onserver:` lifecycle attribute handlers from a channel node.
 */
function extractChannelHandlers(node) {
  const attrs = node.attrs ?? node.attributes ?? [];
  const attrMap = new Map(attrs.map((a) => [a.name, a]));

  function attrToCall(attr) {
    if (!attr) return null;
    const v = attr.value;
    if (!v) return null;
    if (v.kind == "call") return `${v.name}(${v.args ?? ""})`;
    if (v.kind == "variable-ref") return `${v.name}()`;
    if (v.kind == "string-literal") return v.value;
    return null;
  }

  return {
    open: attrToCall(attrMap.get("onserver:open")),
    message: attrToCall(attrMap.get("onserver:message")),
    close: attrToCall(attrMap.get("onserver:close")),
  };
}

/**
 * Extract `@shared` variable names from a channel node's children.
 */
export function extractSharedVars(node) {
  const shared = [];
  const children = node.children ?? [];

  function walkForShared(nodeList) {
    for (const n of nodeList) {
      if (!n || typeof n != "object") continue;
      if (n.kind == "state-decl" && n.isShared === true) {
        shared.push(n.name ?? "");
      }
      if (Array.isArray(n.children)) walkForShared(n.children);
      if (n.kind == "logic" && Array.isArray(n.body)) walkForShared(n.body);
    }
  }

  walkForShared(children);
  return shared.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Client JS emission
// ---------------------------------------------------------------------------

/**
 * Emit client-side JavaScript for a single `<channel>` node.
 */
export function emitChannelClientJs(node, errors, filePath) {
  const lines = [];
  const { name, safeName, topic, reconnectMs } = extractChannelAttrs(node);
  const { open: openHandler, message: msgHandler } = extractChannelHandlers(node);
  const sharedVars = extractSharedVars(node);

  const varName = `_scrml_ws_${safeName}`;
  const wsVar = "_ws";
  const reconnVar = "_reconn";
  const connectFn = "_connect";

  lines.push(`// <channel name="${name}" topic="${topic}"> — WebSocket client (§35)`);
  lines.push(`const ${varName} = (() => {`);
  lines.push(`  let ${wsVar}, ${reconnVar};`);
  lines.push(`  function ${connectFn}() {`);
  lines.push(`    ${wsVar} = new WebSocket(\`ws://\${location.host}/_scrml_ws/${safeName}\`);`);

  if (openHandler) {
    lines.push(`    ${wsVar}.onopen = () => { ${openHandler}; };`);
  } else {
    lines.push(`    ${wsVar}.onopen = () => {};`);
  }

  lines.push(`    ${wsVar}.onmessage = (e) => {`);
  lines.push(`      try {`);
  lines.push(`        const _d = JSON.parse(e.data);`);

  if (sharedVars.length > 0) {
    lines.push(`        if (_d.__type === "__sync") {`);
    lines.push(`          // @shared variable sync from server`);
    for (const varN of sharedVars) {
      lines.push(`          if (_d.__key === ${JSON.stringify(varN)}) _scrml_reactive_set(${JSON.stringify(varN)}, _d.__val);`);
    }
    lines.push(`          return;`);
    lines.push(`        }`);
  }

  if (msgHandler) {
    lines.push(`        ${msgHandler};`);
  }

  lines.push(`      } catch (_e) {}`);
  lines.push(`    };`);

  if (reconnectMs > 0) {
    lines.push(`    ${wsVar}.onclose = () => { ${reconnVar} = setTimeout(${connectFn}, ${reconnectMs}); };`);
  } else {
    lines.push(`    ${wsVar}.onclose = () => {};`);
  }

  lines.push(`  }`);
  lines.push(`  ${connectFn}();`);
  lines.push(`  _scrml_register_cleanup(() => { ${wsVar}?.close(); clearTimeout(${reconnVar}); });`);
  lines.push(`  return {`);
  lines.push(`    send: (d) => ${wsVar}?.readyState === 1 && ${wsVar}.send(JSON.stringify(d)),`);
  lines.push(`    close: () => ${wsVar}?.close(),`);

  if (sharedVars.length > 0) {
    lines.push(`    syncShared: (key, val) => ${wsVar}?.readyState === 1 &&`);
    lines.push(`      ${wsVar}.send(JSON.stringify({ __type: "__sync", __key: key, __val: val })),`);
  }

  lines.push(`  };`);
  lines.push(`})();`);

  if (sharedVars.length > 0) {
    lines.push(`// @shared effects for <channel name="${name}">`);
    for (const varN of sharedVars) {
      lines.push(`_scrml_effect(() => ${varName}.syncShared(${JSON.stringify(varN)}, _scrml_reactive_get(${JSON.stringify(varN)})));`);
    }
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Server route emission
// ---------------------------------------------------------------------------

/**
 * Emit server-side JavaScript for a single `<channel>` node.
 */
export function emitChannelServerJs(node, errors, filePath, hasAuth) {
  if (hasAuth === undefined) hasAuth = false;
  const lines = [];
  const { name, safeName, topic, hasProtect } = extractChannelAttrs(node);

  const path = `/_scrml_ws/${safeName}`;

  lines.push(`// <channel name="${name}"> — WebSocket upgrade route (§35)`);
  lines.push(`routes.push({`);
  lines.push(`  path: ${JSON.stringify(path)},`);
  lines.push(`  method: "GET",`);
  lines.push(`  isWebSocket: true,`);
  lines.push(`  handler: (req, server) => {`);

  if (hasAuth || hasProtect) {
    lines.push(`    // Auth check for WebSocket upgrade`);
    lines.push(`    const _authResult = _scrml_auth_check(req);`);
    lines.push(`    if (_authResult) return _authResult;`);
  }

  lines.push(`    const ok = server.upgrade(req, { data: { __ch: ${JSON.stringify(name)}, __topic: ${JSON.stringify(topic)} } });`);
  lines.push(`    return ok ? undefined : new Response("WebSocket upgrade failed", { status: 400 });`);
  lines.push(`  },`);
  lines.push(`});`);

  return lines;
}

// ---------------------------------------------------------------------------
// WebSocket handlers object emission
// ---------------------------------------------------------------------------

/**
 * Emit the merged `_scrml_ws_handlers` export for all channels in a file.
 */
export function emitChannelWsHandlers(channelNodes, errors, filePath) {
  if (channelNodes.length == 0) return [];

  const lines = [];
  lines.push(`// WebSocket handlers for ${channelNodes.length} channel(s) — passed to Bun.serve() websocket:`);
  lines.push(`export const _scrml_ws_handlers = {`);

  // open
  lines.push(`  open(ws) {`);
  lines.push(`    ws.subscribe(ws.data.__topic);`);
  for (const node of channelNodes) {
    const { name } = extractChannelAttrs(node);
    const { open: openHandler } = extractChannelHandlers(node);
    if (openHandler) {
      lines.push(`    if (ws.data.__ch === ${JSON.stringify(name)}) { ${openHandler}; }`);
    }
  }
  lines.push(`  },`);

  // message
  lines.push(`  message(ws, raw) {`);
  lines.push(`    try {`);
  lines.push(`      const d = JSON.parse(raw);`);
  lines.push(`      const __ch = ws.data.__ch;`);
  for (const node of channelNodes) {
    const { name } = extractChannelAttrs(node);
    const { message: msgHandler } = extractChannelHandlers(node);
    const sharedVars = extractSharedVars(node);

    lines.push(`      if (__ch === ${JSON.stringify(name)}) {`);

    if (sharedVars.length > 0) {
      lines.push(`        if (d.__type === "__sync") {`);
      lines.push(`          // Broadcast @shared sync to all other subscribers`);
      lines.push(`          ws.publish(ws.data.__topic, raw);`);
      lines.push(`          return;`);
      lines.push(`        }`);
    }

    if (msgHandler) {
      lines.push(`        ${msgHandler};`);
    }

    lines.push(`      }`);
  }
  lines.push(`    } catch (_e) {}`);
  lines.push(`  },`);

  // close
  lines.push(`  close(ws) {`);
  lines.push(`    ws.unsubscribe(ws.data.__topic);`);
  for (const node of channelNodes) {
    const { name } = extractChannelAttrs(node);
    const { close: closeHandler } = extractChannelHandlers(node);
    if (closeHandler) {
      lines.push(`    if (ws.data.__ch === ${JSON.stringify(name)}) { ${closeHandler}; }`);
    }
  }
  lines.push(`  },`);

  lines.push(`};`);

  return lines;
}
