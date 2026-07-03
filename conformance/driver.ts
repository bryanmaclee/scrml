/**
 * Input-event driver (D3 (b)-runtime conformance — DD OQ2, RATIFIED S231).
 *
 * The 7-verb, selector-addressed, impl-NEUTRAL event vocabulary. Each verb is a
 * USER-INTENT description that lowers to a synthetic DOM event BOTH impls observe
 * identically through standard propagation — never a DOM-API call, never a
 * runtime-id handle, and NEVER a direct state-set (a direct `_scrml_reactive_set`
 * would bypass the handler pipeline and bake impl#1 into the contract — banned).
 *
 * Verbs:
 *   { click:   "#sel" }                  bubbling click
 *   { input:   "#sel", value: "ab" }     set value + fire `input`  (text/textarea/range)
 *   { change:  "#sel", value: "x"  }     set value + fire `change` (select / committed)
 *   { check:   "#sel" } / { uncheck: }   set checked + fire `change` (checkbox/radio)
 *   { submit:  "#form" }                 bubbling `submit`
 *   { key:     "#sel", press: "Enter" }  keydown + keyup for a named key
 *   { wait:    "settle" }                await the conformance hook's settled()
 *   { "advance-time": 1000 }             advance the VIRTUAL clock by N ms, then settle
 *
 * Real-time waits are deliberately excluded (non-deterministic). Time is driven
 * ONLY through the `advance-time` verb, which advances a deterministic virtual
 * clock (fake-clock.ts): ms>0 timers (`<onTimeout>` §51.0.M, `<onIdle>` §51.0.R,
 * debounce/throttle §6.13, intervals §6.7) fire EXCLUSIVELY on `advance-time`,
 * never on a wall clock. `advance-time` is a RATIFIED normative language-1.0
 * conformance-contract verb (impl#2 must honor it; the contract adopts a
 * virtual-clock model).
 */
import type { FakeClock } from "./fake-clock.ts";

type DomNode = any;

export type InputStep =
  | { click: string }
  | { input: string; value: string }
  | { change: string; value: string }
  | { check: string }
  | { uncheck: string }
  | { submit: string }
  | { key: string; press: string }
  | { wait: "settle" }
  | { "advance-time": number };

export interface ConformanceHook {
  snapshot(): { cells: Record<string, unknown>; derived: Record<string, unknown> };
  settled(): Promise<void>;
}

// Construct a DOM event using whatever constructors the happy-dom/browser
// global provides, falling back to the base Event when a specialized
// constructor is unavailable.
function makeEvent(type: string, init: Record<string, unknown>): any {
  const g = globalThis as any;
  if (type === "click" && typeof g.MouseEvent === "function") return new g.MouseEvent(type, init);
  if ((type === "keydown" || type === "keyup") && typeof g.KeyboardEvent === "function") {
    return new g.KeyboardEvent(type, init);
  }
  return new g.Event(type, init);
}

function require1(doc: DomNode, selector: string, verb: string): DomNode {
  const el = doc.querySelector(selector);
  if (!el) throw new Error("input driver: verb '" + verb + "' found no element for selector " + selector);
  return el;
}

function dispatch(el: DomNode, type: string, init: Record<string, unknown>): void {
  el.dispatchEvent(makeEvent(type, init));
}

/**
 * Apply ONE input step to the post-run live DOM. `hook` backs the `wait:"settle"`
 * verb (and is otherwise unused — inputs flow through real handler wiring).
 */
export async function applyInput(
  doc: DomNode,
  step: InputStep,
  hook: ConformanceHook | undefined,
  clock?: FakeClock,
): Promise<void> {
  if ("wait" in step) {
    if (hook && hook.settled) await hook.settled();
    return;
  }

  if ("advance-time" in step) {
    // Advance the deterministic virtual clock by N ms — fires every ms>0 timer
    // whose deadline lands in the window — then settle so the resulting reactive
    // propagation (+ any macrotask a fired timer kicked off) drains before the
    // next step. Without a clock threaded through, advance-time degrades to a
    // plain settle (defensive; the harness always threads one).
    if (clock) await clock.advance(step["advance-time"]);
    if (hook && hook.settled) await hook.settled();
    return;
  }

  if ("click" in step) {
    dispatch(require1(doc, step.click, "click"), "click", { bubbles: true, cancelable: true });
    return;
  }

  if ("input" in step) {
    const el = require1(doc, step.input, "input");
    el.value = step.value;
    dispatch(el, "input", { bubbles: true });
    return;
  }

  if ("change" in step) {
    const el = require1(doc, step.change, "change");
    el.value = step.value;
    dispatch(el, "change", { bubbles: true });
    return;
  }

  if ("check" in step) {
    const el = require1(doc, step.check, "check");
    el.checked = true;
    dispatch(el, "change", { bubbles: true });
    return;
  }

  if ("uncheck" in step) {
    const el = require1(doc, step.uncheck, "uncheck");
    el.checked = false;
    dispatch(el, "change", { bubbles: true });
    return;
  }

  if ("submit" in step) {
    dispatch(require1(doc, step.submit, "submit"), "submit", { bubbles: true, cancelable: true });
    return;
  }

  if ("key" in step) {
    const el = require1(doc, step.key, "key");
    const init = { key: step.press, bubbles: true, cancelable: true };
    dispatch(el, "keydown", init);
    dispatch(el, "keyup", init);
    return;
  }

  throw new Error("input driver: unrecognized step " + JSON.stringify(step));
}

/** Apply an ordered input sequence. `clock` backs the `advance-time` verb. */
export async function driveInputs(
  doc: DomNode,
  steps: InputStep[],
  hook: ConformanceHook | undefined,
  clock?: FakeClock,
): Promise<void> {
  for (const step of steps) {
    await applyInput(doc, step, hook, clock);
  }
}
