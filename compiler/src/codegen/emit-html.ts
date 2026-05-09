import { genVar } from "./var-counter.ts";
import { emitStringFromTree, exprNodeContainsMemberAccess } from "../expression-parser.ts";
import { escapeHtmlAttr, VOID_ELEMENTS } from "./utils.ts";
import { extractReactiveDeps, collectReactiveVarNames, extractReactiveDepsTransitive, buildFunctionBodyRegistry } from "./reactive-deps.ts";
import { hasTemplateInterpolation, rewriteBunEval } from "./rewrite.js";
import { CGError } from "./errors.ts";
import type { BindingRegistry } from "./binding-registry.ts";
import type { CompileContext } from "./context.ts";
import { isFlatDeclarationBlock, renderFlatDeclarationAsInlineStyle } from "./emit-css.ts";
// SPEC §6.4 / §5.4.1 / L17 — A1c C3 render-by-tag expansion. lookupStateCell resolves
// `<userName/>` to its decl record; getCellKind surfaces B5's `_cellKind` annotation
// (`"bindable"` for Shape 2 with bindable RHS — the only legal use kind that survives
// B6's diagnostic walker).
import { lookupStateCell, getCellKind } from "../symbol-table.ts";

// Supported bind: attribute names per SPEC §5.4
const SUPPORTED_BIND_NAMES = new Set(["value", "valueAsNumber", "checked", "selected", "files", "group"]);

// Supported transition types for transition:, in:, out: directives
const SUPPORTED_TRANSITIONS = new Set(["fade", "slide", "fly"]);

// Element-type restrictions per SPEC §5.4
const BIND_VALID_TAGS: Record<string, Set<string>> = {
  "bind:value":          new Set(["input", "textarea", "select"]),
  "bind:valueAsNumber":  new Set(["input", "textarea", "select"]),
  "bind:checked":        new Set(["input"]),
  "bind:selected":       new Set(["select"]),
  "bind:files":          new Set(["input"]),
  "bind:group":          new Set(["input"]),
};

// Lifecycle elements that emit no HTML — handled by emit-reactive-wiring.js
const LIFECYCLE_SILENT_TAGS = new Set(["timer", "poll"]);

/**
 * Phase 2b of if/show split: detect whether an if= element's subtree is
 * "clean" — i.e., contains no nested wiring (no events, no reactive
 * interpolation, no nested if=/show=, no components, no state openers,
 * no expression attributes). Clean subtrees route through mount/unmount
 * (template-clone + marker comment + scope teardown). Non-clean subtrees
 * fall back to the display-toggle path (Phase 1) until later sub-phases
 * extend mount/unmount to cover those cases.
 *
 * Conservative: when in doubt, return false (display-toggle is the safe
 * fallback that already works).
 */
function isCleanIfSubtree(children: any[]): boolean {
  for (const child of children ?? []) {
    if (!isCleanIfNode(child)) return false;
  }
  return true;
}

/**
 * Returns true if an attribute is "wiring-free" — does not require any
 * compile-time-emitted runtime wiring (event listeners, reactive
 * subscriptions, two-way bindings, conditional classes, transitions,
 * directive semantics). Static HTML attributes pass; reactive or
 * directive-style attributes do not.
 *
 * The optional `allowName` parameter lets the caller exempt one attribute
 * (typically the if= attribute on the element under consideration).
 */
function attrIsWiringFree(attr: any, allowName: string | null = null): boolean {
  const name: string = attr.name ?? "";
  if (name === allowName) return true;
  if (name === "if" || name === "show" || name === "else" || name === "else-if") return false;
  if (name === "protect" || name === "auth" || name === "slot") return false;
  if (name.startsWith("on")) return false;
  if (name.startsWith("bind:")) return false;
  if (name.startsWith("class:")) return false;
  if (name.startsWith("transition:") || name.startsWith("in:") || name.startsWith("out:")) return false;
  const val = attr.value;
  if (val) {
    if (val.kind === "variable-ref" && (val.name ?? "").startsWith("@")) return false;
    if (val.kind === "expr") return false;
    if (val.kind === "string-literal" && hasTemplateInterpolation(val.value)) return false;
  }
  return true;
}

function isCleanIfNode(node: any): boolean {
  if (!node || typeof node !== "object") return true;
  if (node.kind === "text" || node.kind === "comment") return true;
  if (node.kind !== "markup") return false; // logic, expr, state, if-chain, meta = not clean

  const tag: string = node.tag ?? node.tagName ?? "";
  // Components (capital first letter) and language-level state openers
  // are not "clean" — they have their own wiring.
  if (/^[A-Z]/.test(tag)) return false;

  const attrs: any[] = node.attributes ?? node.attrs ?? [];
  for (const attr of attrs) {
    if (!attrIsWiringFree(attr)) return false;
  }

  const children: any[] = node.children ?? [];
  for (const child of children) {
    if (!isCleanIfNode(child)) return false;
  }
  return true;
}

/**
 * Strip if=/else-if=/else attributes from an if-chain branch element before
 * emitting. The chain wrapper (data-scrml-if-chain / data-scrml-chain-branch)
 * already drives visibility for the chain — the inner element's chain-construction
 * attribute is AST-level metadata and would (a) leak as a meaningless HTML attr
 * if not stripped and (b) post-Phase-2c trigger a duplicate mount/unmount
 * controller via emit-html's early-out gate. Returns a shallow-cloned node with
 * the chain attributes filtered out; original AST is not mutated.
 */
function stripChainBranchAttrs(node: any): any {
  if (!node || typeof node !== "object" || node.kind !== "markup") return node;
  const filtered = (node.attributes ?? node.attrs ?? []).filter(
    (a: any) => a && a.name !== "if" && a.name !== "else-if" && a.name !== "else",
  );
  return { ...node, attributes: filtered, attrs: filtered };
}

/**
 * Phase 2g: per-branch cleanliness check for if-chain branches.
 *
 * A chain branch element ALWAYS carries one of `if=` / `else-if=` / `else`
 * at the AST level (chain-construction metadata). Those three attributes
 * unconditionally fail `attrIsWiringFree`, so calling `isCleanIfNode` on
 * the raw branch would always return false. Apply the strip-precursor
 * conceptually here (without mutating the AST), then defer to the existing
 * `isCleanIfNode` predicate so cleanliness criteria match the single-`if=`
 * Phase 2c path verbatim.
 *
 * Returns true if the branch element compiles to clean HTML — lowercase tag,
 * no wiring-bearing attributes (after stripping if/else-if/else), and a
 * wholly-clean descendant tree per `isCleanIfSubtree`. Clean branches go
 * through the per-branch template+marker mount/unmount path. Dirty branches
 * stay inline-with-display-toggle wrapped in a per-branch wrapper inside the
 * chain wrapper (pre-Phase-2g shape, retained as the dirty-fallback shape).
 */
function isCleanChainBranch(branchElement: any): boolean {
  if (!branchElement || typeof branchElement !== "object") return true;
  if (branchElement.kind === "text" || branchElement.kind === "comment") return true;
  if (branchElement.kind !== "markup") return false;
  const stripped = stripChainBranchAttrs(branchElement);
  return isCleanIfNode(stripped);
}

// §35 Input state type elements that emit no HTML — handled by emit-reactive-wiring.js
const INPUT_STATE_TAGS = new Set(["keyboard", "mouse", "gamepad"]);

// §6.7.7 <request> — single-shot async fetch state type, emits no HTML
const REQUEST_TAGS = new Set(["request"]);

// §6.7.8 <timeout> — single-shot timer state type, emits no HTML
const TIMEOUT_TAGS = new Set(["timeout"]);

/**
 * A1c C3 — Lower a state-cell's validators to HTML-native attributes for
 * carry-forward at the render-by-tag expansion site (SPEC §6.4.2 step 4 — "Any
 * validators declared on the cell are wired as HTML attributes and connected
 * to the validity surface (§6.11)"). C3 emits the HTML-native subset; the
 * validity-surface side is C7+.
 *
 * Only the validators with HTML-native semantics get lowered:
 *
 *   - `req` (bareword, no args)        → `required` (boolean attribute)
 *   - `pattern(re|"...")`              → `pattern="<source>"` (string)
 *   - `min(N)`                         → `min="N"`              (string)
 *   - `max(N)`                         → `max="N"`              (string)
 *   - `length(>=N)`                    → `minlength="N"`        (string)
 *   - `length(<=N)`                    → `maxlength="N"`        (string)
 *   - `length(=N)`                     → both `minlength` + `maxlength` set to N
 *
 * All other validators (`is some`, `gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`oneOf`/`notIn`,
 * stdlib `email`/`url`/`numeric`/`integer`, `custom`) are NOT HTML-native — they
 * stay validity-surface-only (C7+).
 *
 * Returns an array of attribute objects matching the markup AST `attributes` shape
 * (`{name, value: {kind, value}}`). The caller appends these to the renderSpec
 * element's attribute list before re-emitting via `emitNode`.
 *
 * Tolerant by default: any unrecognised arg shape silently no-ops on that validator
 * (B9/B10 already enforced shape; defensive at codegen time).
 */
function _validatorAttrsForCell(declNode: any): Array<{ name: string; value: { kind: string; value: string } }> {
  const validators: any[] = (declNode?.validators as any[]) ?? [];
  if (!Array.isArray(validators) || validators.length === 0) return [];
  const out: Array<{ name: string; value: { kind: string; value: string } }> = [];
  for (const v of validators) {
    if (!v || typeof v !== "object") continue;
    const name: string = v.name ?? "";
    const args: any[] | null = v.args ?? null;

    // `req` — args === null (bareword) per B9 contract.
    if (name === "req" && args === null) {
      out.push({ name: "required", value: { kind: "string-literal", value: "" } });
      continue;
    }

    if (!Array.isArray(args) || args.length === 0) continue;

    const firstArg = args[0];

    if (name === "pattern") {
      // pattern(/regex/) → escape-hatch with raw text "/^.../" (B9 specifics).
      // pattern("regex") → ExprNode with litType:"string".
      let patternSrc: string | null = null;
      if (firstArg?.kind === "escape-hatch" && typeof firstArg.raw === "string") {
        // Strip leading/trailing `/` from regex literal raw form.
        const raw: string = firstArg.raw;
        const rxMatch = raw.match(/^\/(.*)\/[gimsuy]*$/);
        patternSrc = rxMatch ? rxMatch[1] : raw;
      } else if (firstArg?.kind === "lit" && firstArg.litType === "string" && typeof firstArg.value === "string") {
        patternSrc = firstArg.value;
      }
      if (patternSrc !== null) {
        out.push({ name: "pattern", value: { kind: "string-literal", value: patternSrc } });
      }
      continue;
    }

    if (name === "min" || name === "max") {
      let numStr: string | null = null;
      if (firstArg?.kind === "lit" && firstArg.litType === "number" && firstArg.value !== undefined) {
        numStr = String(firstArg.value);
      } else if (firstArg?.kind === "escape-hatch" && typeof firstArg.raw === "string") {
        // Defensive: numbers might land in escape-hatch in rare AST shapes.
        const trimmed = firstArg.raw.trim();
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) numStr = trimmed;
      }
      if (numStr !== null) {
        out.push({ name, value: { kind: "string-literal", value: numStr } });
      }
      continue;
    }

    if (name === "length") {
      // RelationalPredicateNode (B9 sibling kind): {kind:"relational-predicate", op, value:ExprNode}
      if (firstArg?.kind === "relational-predicate") {
        const op: string = firstArg.op ?? "";
        const valExpr = firstArg.value;
        let numStr: string | null = null;
        if (valExpr?.kind === "lit" && valExpr.litType === "number" && valExpr.value !== undefined) {
          numStr = String(valExpr.value);
        }
        if (numStr === null) continue;
        if (op === ">=") {
          out.push({ name: "minlength", value: { kind: "string-literal", value: numStr } });
        } else if (op === "<=") {
          out.push({ name: "maxlength", value: { kind: "string-literal", value: numStr } });
        } else if (op === "=") {
          out.push({ name: "minlength", value: { kind: "string-literal", value: numStr } });
          out.push({ name: "maxlength", value: { kind: "string-literal", value: numStr } });
        }
        // ">" / "<" / "!=" — not HTML-native (no off-by-one HTML attr); skip.
      }
      continue;
    }

    // All other validators are validity-surface-only; no HTML-attr lowering.
  }
  return out;
}

/**
 * Generate HTML from markup AST nodes.
 * Also populates the BindingRegistry for client JS wiring.
 */
export function generateHtml(
  nodes: any[],
  ctxOrErrors: CompileContext | CGError[] | null,
  csrfEnabledLegacy?: boolean,
  registryLegacy?: BindingRegistry | null,
  fileASTLegacy?: any,
): string {
  // Support both new (nodes, ctx) and legacy (nodes, errors, csrfEnabled, registry, fileAST) signatures
  let errors: CGError[];
  let csrfEnabled: boolean;
  let registry: BindingRegistry | null | undefined;
  let fileAST: any;
  if (ctxOrErrors && typeof ctxOrErrors === "object" && "fileAST" in ctxOrErrors) {
    // New CompileContext signature
    const ctx = ctxOrErrors as CompileContext;
    errors = ctx.errors;
    csrfEnabled = ctx.csrfEnabled;
    registry = ctx.registry;
    fileAST = ctx.fileAST;
  } else {
    // Legacy positional signature
    errors = (ctxOrErrors as CGError[] | null) ?? [];
    csrfEnabled = csrfEnabledLegacy ?? false;
    registry = registryLegacy;
    fileAST = fileASTLegacy;
  }
  const parts: string[] = [];

  const reactiveVarNames: Set<string> | null = fileAST ? collectReactiveVarNames(fileAST) : null;
  const fnBodyRegistry = fileAST ? buildFunctionBodyRegistry(fileAST) : null;
  // A1c C3 — file-scope handle for render-by-tag tag→cell resolution.
  // `runSYM` (symbol-table.ts:6271) attaches `_scope` non-enumerably to the FileAST.
  // When the AST was constructed without SYM (raw test fixtures), fileScope is null
  // and render-by-tag detection is skipped — the legacy raw-tag emission path keeps
  // working for tests that bypass symbol-table population.
  const fileScope: any = fileAST?._scope ?? null;

  function emitNode(node: any): void {
    if (!node || typeof node !== "object") return;

    if (node.kind === "text") {
      parts.push(node.value ?? node.text ?? "");
      return;
    }

    if (node.kind === "comment") {
      return;
    }

    if (node.kind === "state") {
      for (const child of node.children ?? []) {
        emitNode(child);
      }
      return;
    }

    // §17.1.1: if-chain — Phase 2g (mount/unmount per branch)
    //
    // Approach A + W-keep-chain-only + per-branch mixed-cleanliness dispatch:
    //   - Single chain wrapper `<div data-scrml-if-chain="N">` retained for
    //     adopter CSS targeting.
    //   - Per-branch dispatch:
    //     * Clean branch (no events / no reactive interp / no nested wiring):
    //       emit `<template id=...><inner></template><!--scrml-if-marker:...-->`.
    //       Per-branch wrapper DROPPED — the controller mounts/unmounts the
    //       template into the chain wrapper directly. Honors §17.1.1 line 7533
    //       ("only one span exists in the DOM at any time") for clean branches.
    //     * Dirty branch (has events, bind:, transitions, components, reactive
    //       interp, etc): retain pre-Phase-2g per-branch wrapper
    //       `<div data-scrml-chain-branch="K" style="display:none"><inner></div>`.
    //       Controller toggles `display` for these (today's display-toggle
    //       behavior, scoped per branch).
    //   - Strip-precursor (`stripChainBranchAttrs`) applies in BOTH paths to
    //     prevent if=/else-if=/else leakage and to prevent the inner element
    //     from re-triggering the standalone if= early-out gate at lines 575-603.
    //   - The chain controller in emit-event-wiring.ts reads the per-branch
    //     `branchMode` field and dispatches mount/unmount vs display-toggle
    //     per branch on the active-branch transition.
    //
    // Reuses Phase 2c B1 helpers (_scrml_create_scope, _scrml_mount_template,
    // _scrml_unmount_scope, _scrml_find_if_marker) verbatim. No new runtime
    // helpers. No spec amendment. See deep-dive
    // `docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` §9.
    if (node.kind === "if-chain") {
      const chainId = genVar("if_chain");
      parts.push(`<div data-scrml-if-chain="${chainId}">`);

      for (let bIdx = 0; bIdx < (node.branches?.length ?? 0); bIdx++) {
        const branch = node.branches[bIdx];
        const branchId = `${chainId}_b${bIdx}`;
        const isClean = isCleanChainBranch(branch.element);
        const stripped = stripChainBranchAttrs(branch.element);

        if (isClean) {
          // Clean branch: <template> + <!--scrml-if-marker:...-->
          const templateId = genVar("scrml_chain_tpl");
          const markerId = genVar("scrml_chain_marker");
          parts.push(`<template id="${templateId}">`);
          emitNode(stripped);
          parts.push(`</template>`);
          parts.push(`<!--scrml-if-marker:${markerId}-->`);
          if (registry) {
            registry.addLogicBinding({
              kind: "if-chain-branch",
              chainId,
              branchId,
              branchIndex: bIdx,
              branchMode: "mount",
              templateId,
              markerId,
              condition: branch.condition,
              refs: branch.condition?.refs ?? (branch.condition?.name ? [branch.condition.name.replace(/^@/, "")] : []),
            });
          }
        } else {
          // Dirty branch: per-branch wrapper retained, display-toggle.
          parts.push(`<div data-scrml-chain-branch="${branchId}" style="display:none">`);
          emitNode(stripped);
          parts.push(`</div>`);
          if (registry) {
            registry.addLogicBinding({
              kind: "if-chain-branch",
              chainId,
              branchId,
              branchIndex: bIdx,
              branchMode: "display",
              condition: branch.condition,
              refs: branch.condition?.refs ?? (branch.condition?.name ? [branch.condition.name.replace(/^@/, "")] : []),
            });
          }
        }
      }

      if (node.elseBranch) {
        const elseId = `${chainId}_else`;
        const isClean = isCleanChainBranch(node.elseBranch);
        const stripped = stripChainBranchAttrs(node.elseBranch);

        if (isClean) {
          const templateId = genVar("scrml_chain_tpl");
          const markerId = genVar("scrml_chain_marker");
          parts.push(`<template id="${templateId}">`);
          emitNode(stripped);
          parts.push(`</template>`);
          parts.push(`<!--scrml-if-marker:${markerId}-->`);
          if (registry) {
            registry.addLogicBinding({
              kind: "if-chain-else",
              chainId,
              branchId: elseId,
              branchMode: "mount",
              templateId,
              markerId,
            });
          }
        } else {
          parts.push(`<div data-scrml-chain-branch="${elseId}" style="display:none">`);
          emitNode(stripped);
          parts.push(`</div>`);
          if (registry) {
            registry.addLogicBinding({
              kind: "if-chain-else",
              chainId,
              branchId: elseId,
              branchMode: "display",
            });
          }
        }
      }

      parts.push(`</div>`);
      return;
    }

    if (node.kind === "markup") {
      const tag: string = node.tag ?? node.tagName ?? "div";
      const attrs: any[] = node.attributes ?? node.attrs ?? [];
      const children: any[] = node.children ?? [];
      const isSelfClosing: boolean = node.selfClosing === true && children.length === 0;
      const isVoid: boolean = VOID_ELEMENTS.has(tag);

      if (tag === "errorBoundary" || tag === "errorboundary") {
        const boundaryId = genVar("error_boundary");
        parts.push(`<div data-scrml-error-boundary="${boundaryId}">`);
        for (const child of children) {
          emitNode(child);
        }
        parts.push("</div>");
        return;
      }

      if (tag === "program") {
        // Named programs are worker bundles (§4.12.4) — skip entirely.
        // Only emit children for the unnamed/root program.
        const nameAttr = attrs.find((a: any) => a.name === "name");
        if (nameAttr) return;
        for (const child of children) {
          emitNode(child);
        }
        return;
      }

      if (LIFECYCLE_SILENT_TAGS.has(tag)) {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));

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
          let intervalMs: number | null = null;
          if (intervalVal?.kind === "string-literal") {
            intervalMs = parseInt(intervalVal.value, 10);
          } else if (intervalVal?.kind === "variable-ref") {
            const raw: string = intervalVal.name ?? "";
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
          if (runningVal?.kind === "variable-ref" && runningVal.name === "false") {
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

        if (tag === "timer") {
          if (isSelfClosing || children.length === 0) {
            if (errors) {
              errors.push(new CGError(
                "W-LIFECYCLE-002",
                `W-LIFECYCLE-002: \`<timer>\` has no body and no observable effect. ` +
                `A timer with no logic body only increments tickCount. ` +
                `If you need tick counting, add a \`${"\${"}<#id>.tickCount = <#id>.tickCount + 1}\` body, ` +
                `or remove this timer.`,
                span,
                "warning",
              ));
            }
          }
        }

        if (tag === "poll") {
          if (isSelfClosing || children.length === 0) {
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
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));

        if (!attrMap.has("id")) {
          const errCodes: Record<string, string> = { keyboard: "E-INPUT-001", mouse: "E-INPUT-002", gamepad: "E-INPUT-003" };
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

        if (tag === "gamepad" && attrMap.has("index")) {
          const indexAttr = attrMap.get("index");
          const indexVal = indexAttr?.value;
          let indexNum: number | null = null;
          if (indexVal?.kind === "string-literal") {
            indexNum = parseInt(indexVal.value, 10);
          } else if (indexVal?.kind === "variable-ref") {
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
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));

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
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));

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
          let delayMs: number | null = null;
          if (delayVal?.kind === "string-literal") {
            delayMs = parseInt(delayVal.value, 10);
          } else if (delayVal?.kind === "variable-ref") {
            const raw: string = (delayVal.name ?? "").replace(/^@/, "");
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

      if (tag === "channel") {
        const span = node.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const attrMap = new Map<string, any>((attrs ?? []).map((a: any) => [a.name, a]));
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

          const bindName: string = attr.name;
          const suffix: string = bindName.slice(5);
          const span = attr.span ?? node.span ?? { file: "", start: 0, end: 0, line: 0, col: 0 };

          if (!SUPPORTED_BIND_NAMES.has(suffix)) {
            errors.push(new CGError(
              "E-ATTR-011",
              `E-ATTR-011: \`${bindName}\` is not a supported bind: attribute. ` +
              `Supported: \`bind:value\`, \`bind:checked\`, \`bind:selected\`, \`bind:group\`, \`bind:this\`.`,
              span,
            ));
          }

          const val = attr.value;
          const isReactive: boolean = val && val.kind === "variable-ref" &&
            (val.name ?? "").startsWith("@");
          if (!isReactive && SUPPORTED_BIND_NAMES.has(suffix)) {
            const rawName: string | null = val && val.kind === "variable-ref"
              ? val.name
              : (val && val.kind === "string-literal" ? val.value : null);
            const hint = rawName
              ? ` \`${rawName}\` is not reactive. Use \`@${rawName}\` or change \`${bindName}\` to \`${suffix}=${rawName}\`.`
              : ` The right-hand side of \`${bindName}\` must be an \`@\`-prefixed reactive variable, e.g. \`bind:value=@myVar\`.`;
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
                `Valid elements: ${[...validTags].map((t: string) => `<${t}>`).join(", ")}.`,
                span,
              ));
            }
          }
        }
      }

      // Pre-scan for transition directives
      let transitionEnter: string | null = null;
      let transitionExit: string | null = null;
      for (const attr of attrs) {
        if (!attr || !attr.name) continue;
        const aName: string = attr.name;
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

      // DQ-7: Pre-scan children for flat-declaration #{} blocks.
      // Flat-declaration #{} (all prop:value pairs, no selectors) compiles to
      // inline style="" on the containing element instead of an @scope CSS block.
      // Only applies to elements inside a component scope (_expandedFrom set).
      let flatInlineStyle: string | null = null;
      if (node._expandedFrom) {
        const flatParts: string[] = [];
        for (const child of children) {
          if (child && child.kind === "css-inline" && isFlatDeclarationBlock(child)) {
            const inline = renderFlatDeclarationAsInlineStyle(child);
            if (inline) flatParts.push(inline);
          }
        }
        if (flatParts.length > 0) flatInlineStyle = flatParts.join(" ");
      }

      // ---------------------------------------------------------------------
      // Phase 2c (LIVE): if/show split mount/unmount path for clean subtrees.
      //
      // Per SPEC §17.1 if= is DOM existence, not visibility — the element is
      // not rendered when the condition is false. Clean-subtree if= elements
      // (lowercase tag, all attributes wiring-free, all descendants in
      // {text, comment, markup} with the same constraints recursively) compile
      // to a <template id="..."> wrapping the inner element + a
      // <!--scrml-if-marker:N--> placeholder comment. emit-event-wiring then
      // emits a controller that calls _scrml_mount_template on truthy and
      // _scrml_unmount_scope on falsy (LIFO scope teardown per §6.7.2).
      //
      // Non-clean subtrees (events, binds, transitions, components, nested
      // reactive content, expr attributes, …) fall through to the legacy
      // display-toggle path below. Phase 2d-2h will progressively widen the
      // cleanliness gate.
      //
      // Approach B1 (template + marker comment) was locked by the user in
      // S49 after a 5-phase deep-dive. Alternatives B4 (DOM-keep + scope-swap)
      // and B5 (compile-time-static-analysis + hide-on-init) eliminated on
      // §17.1 verbatim, cross-ecosystem dev expectation, stale-DOM event
      // delegation hazard, and Svelte 5 PR sveltejs/svelte#603 (separating
      // unmount from destroy) grounds. See deep-dive §3, §8, §10.
      // ---------------------------------------------------------------------
      const ifAttrCheck = attrs.find((a: any) => a.name === "if");
      if (
        ifAttrCheck &&
        ifAttrCheck.value &&
        (ifAttrCheck.value.kind === "variable-ref" || ifAttrCheck.value.kind === "expr") &&
        !/^[A-Z]/.test(tag) &&
        attrs.every((a: any) => attrIsWiringFree(a, "if")) &&
        isCleanIfSubtree(children)
      ) {
        const ifVal = ifAttrCheck.value;
        const templateId = genVar("scrml_tpl");
        const markerId = genVar("if_marker");
        parts.push(`<template id="${templateId}">`);
        const innerNode = { ...node, attributes: attrs.filter((a: any) => a.name !== "if"), attrs: attrs.filter((a: any) => a.name !== "if") };
        emitNode(innerNode);
        parts.push(`</template>`);
        parts.push(`<!--scrml-if-marker:${markerId}-->`);
        if (registry) {
          if (ifVal.kind === "variable-ref") {
            const ifVarName = (ifVal.name ?? "").replace(/^@/, "");
            const ifBaseVar = ifVarName.split(".")[0];
            const hasDotPath = ifVarName.includes(".");
            registry.addLogicBinding({ placeholderId: markerId, expr: `@${ifVarName}`, isMountToggle: true, templateId, markerId, varName: ifBaseVar, ...(hasDotPath ? { dotPath: ifVarName } : {}) } as any);
          } else {
            registry.addLogicBinding({ placeholderId: markerId, expr: ifVal.raw, isMountToggle: true, templateId, markerId, condExpr: ifVal.raw, condExprNode: ifVal.exprNode, refs: ifVal.refs } as any);
          }
        }
        return;
      }

      // ---------------------------------------------------------------------
      // A1c C3 — Render-by-tag expansion (SPEC §6.4 / §5.4.1 / L17, L16).
      //
      // When a self-closing lowercase markup tag resolves to a registered
      // Shape 2 `bindable` state cell (B5 `_cellKind === "bindable"`), expand
      // the use site to the cell's `renderSpec.element` markup tree at this
      // DOM position. The expansion is identical at every use site (§6.4.4
      // forbids per-site overrides). Multi-render correctness (L16) is
      // intrinsic — the underlying reactive cell (declared by C1) is shared
      // across all expansion sites; each rendered DOM node is fresh.
      //
      // C3 emits the EXPANSION SHAPE only — the actual `bind:value` /
      // `bind:checked` / `bind:files` / `bind:group` dispatch by render-spec
      // element type is C4 (§5.4.1 dispatch table). C3 stamps a
      // `data-scrml-render-by-tag` data-attribute hookpoint that C4's wiring
      // emitter consumes (mirrors the existing `data-scrml-bind-*` /
      // `data-scrml-attr-tpl-*` placeholder conventions).
      //
      // Validators carry forward as HTML-native attributes per §6.4.2 step 4
      // (req → required, pattern → pattern, min/max → min/max, length(>=N) →
      // minlength). Validity-surface wiring (`@cell.isValid`/`.errors`) is
      // C7+ scope; not emitted here.
      //
      // B6 (symbol-table.ts:1715) has already fired E-CELL-NO-RENDER-SPEC /
      // E-CELL-RENDER-SPEC-NOT-BINDABLE on illegal use sites at A1b time,
      // so by codegen time only legal use sites survive. PascalCase tags
      // (component territory; B6 v1 accepts silently) are skipped — they
      // route through the existing component branch.
      //
      // Skip predicates: void/lifecycle/input-state/request/timeout/channel
      // tags + non-self-closed forms + uppercase-first-letter (component) +
      // tags without a render-spec resolution (HTML built-ins like <br/>).
      if (
        isSelfClosing &&
        fileScope &&
        /^[a-z]/.test(tag) &&
        !VOID_ELEMENTS.has(tag) &&
        !LIFECYCLE_SILENT_TAGS.has(tag) &&
        !INPUT_STATE_TAGS.has(tag) &&
        !REQUEST_TAGS.has(tag) &&
        !TIMEOUT_TAGS.has(tag) &&
        tag !== "channel" &&
        tag !== "errorBoundary" && tag !== "errorboundary" &&
        tag !== "program"
      ) {
        const decl = lookupStateCell(fileScope, tag);
        const cellKind = decl ? getCellKind(decl.declNode as any) : undefined;
        if (decl && cellKind === "bindable") {
          const renderSpecRoot: any = (decl.declNode as any).renderSpec?.element;
          if (renderSpecRoot && renderSpecRoot.kind === "markup") {
            const renderById = genVar("render_by_tag");

            // Collect the renderSpec's existing attributes (decl-site authoritative).
            const baseAttrs: any[] = renderSpecRoot.attributes ?? renderSpecRoot.attrs ?? [];

            // Lower HTML-native validators to attributes per §6.4.2 step 4.
            const validatorAttrs = _validatorAttrsForCell(decl.declNode as any);

            // Hookpoint attribute for C4's bind:* dispatch.
            const renderByTagAttr = {
              name: "data-scrml-render-by-tag",
              value: { kind: "string-literal", value: renderById },
            };

            // Build the expanded markup node — clone the renderSpec.element
            // shallowly with the augmented attribute list. Don't mutate the
            // source AST; downstream walkers may revisit.
            const expanded = {
              ...renderSpecRoot,
              attributes: [...baseAttrs, ...validatorAttrs, renderByTagAttr],
              attrs: undefined,
            };

            // Emit via the regular markup walker — recurses through children,
            // attaches data-scrml-bind-*/-class:/-on*/etc placeholders for
            // any reactive attributes the renderSpec already carries, and
            // honours all the standard attribute-emission paths.
            emitNode(expanded);

            // Record the binding for C4 + downstream consumers.
            if (registry) {
              registry.addLogicBinding({
                kind: "render-by-tag",
                placeholderId: renderById,
                cellName: tag,
                renderSpecTag: renderSpecRoot.tag,
                renderSpecAttrs: baseAttrs,
                declValidators: (decl.declNode as any).validators ?? [],
              } as any);
            }
            return;
          }
        }
      }

      parts.push(`<${tag}`);

      if (node._expandedFrom) {
        // DQ-7: data-scrml="Name" is the @scope root attribute (native CSS @scope).
        // Replaces prior data-scrml-scope="Name" attribute.
        parts.push(` data-scrml="${escapeHtmlAttr(node._expandedFrom)}"`);
      }

      // DQ-7: inject flat-declaration #{} content as inline style=""
      if (flatInlineStyle) {
        parts.push(` style="${escapeHtmlAttr(flatInlineStyle)}"`);
      }

      for (const attr of attrs) {
        if (!attr) continue;
        const name: string = attr.name;
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

        if (name === "ref" && val && val.kind === "variable-ref") {
          const refName: string = val.name.replace(/^@/, "");
          parts.push(` data-scrml-ref="${escapeHtmlAttr(refName)}"`);
          continue;
        }

        if (!val || val.kind === "absent") {
          parts.push(` ${name}`);
        } else if (val.kind === "string-literal") {
          if (hasTemplateInterpolation(val.value)) {
            const tplId = genVar(`attr_tpl_${name}`);
            parts.push(` ${name}="" data-scrml-attr-tpl-${name}="${tplId}"`);
            if (!attr._tplId) attr._tplId = tplId;
          } else {
            parts.push(` ${name}="${escapeHtmlAttr(val.value)}"`);
          }
        } else if (val.kind === "variable-ref") {
          const varName: string = val.name ?? "";
          if (varName.startsWith("@") && (name === "if" || name === "show")) {
            // §17.1 / §17.2: if=@var / show=@var — reactive conditional binding.
            // The @-prefix marks the variable as reactive.
            // if=  → mount/unmount semantics (Phase 2 work; today: display-toggle)
            // show= → display-toggle semantics (Vue v-show)
            const placeholderId = genVar(`attr_${name}`);
            const dataAttr = name === "show" ? "data-scrml-bind-show" : "data-scrml-bind-if";
            parts.push(` ${dataAttr}="${placeholderId}"`);
            if (registry) {
              const ifVarName = varName.replace(/^@/, "");
              const ifBaseVar = ifVarName.split(".")[0];
              const hasDotPath = ifVarName.includes(".");
              registry.addLogicBinding({
                placeholderId,
                expr: `@${ifVarName}`,
                ...(name === "show" ? { isVisibilityToggle: true } : { isConditionalDisplay: true }),
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
        } else if (val.kind === "expr") {
          if (name === "if" || name === "show") {
            const placeholderId = genVar(`attr_${name}`);
            const dataAttr = name === "show" ? "data-scrml-bind-show" : "data-scrml-bind-if";
            parts.push(` ${dataAttr}="${placeholderId}"`);
            if (registry) {
              registry.addLogicBinding({
                placeholderId,
                expr: val.raw,
                ...(name === "show" ? { isVisibilityToggle: true } : { isConditionalDisplay: true }),
                condExpr: val.raw,
                condExprNode: val.exprNode,
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
                handlerExprNode: val.exprNode,
              });
            }
          }
        } else if (val.kind === "call-ref") {
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
                handlerArgExprNodes: val.argExprNodes,
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

      if (csrfEnabled && tag === "form") {
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
    if (node.kind === "logic") {
      if (node.body?.length === 1 && node.body[0]?.kind === "bare-expr") {
        // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
        const expr: string = node.body[0].exprNode ? emitStringFromTree(node.body[0].exprNode) : (node.body[0].expr ?? "");
        if (/\bbun\s*\.\s*eval\s*\(/.test(expr)) {
          const evalErrors: any[] = [];
          const inlined: string = rewriteBunEval(expr, evalErrors);
          if (evalErrors.length === 0 && !inlined.includes("bun.eval")) {
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
      // Annotate the AST node with its placeholder ID so the client JS emitter
      // can target lift-exprs to the correct DOM position.
      (node as any)._placeholderId = placeholderId;
      parts.push(`<span data-scrml-logic="${placeholderId}"></span>`);
      if (registry && node.body) {
        for (const child of node.body) {
          // Phase 4d Step 8: ExprNode-first; runtime-only string fallback (bare-expr.expr TS field deleted)
          if (child && child.kind === "bare-expr" && (child.exprNode || child.expr)) {
            const exprStr = child.exprNode ? emitStringFromTree(child.exprNode) : child.expr;
            const reactiveRefs = fnBodyRegistry
              ? extractReactiveDepsTransitive(exprStr, reactiveVarNames, fnBodyRegistry)
              : extractReactiveDeps(exprStr, reactiveVarNames);
            registry.addLogicBinding({ placeholderId, expr: exprStr, exprNode: child.exprNode, reactiveRefs });
          }
        }
      }
      return;
    }

    if (node.kind === "meta") {
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
