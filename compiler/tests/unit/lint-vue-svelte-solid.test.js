/**
 * S97 — W-LINT-017 (Vue) + W-LINT-018 (Svelte) + W-LINT-019 (Solid)
 *
 * Three framework-reactive-primitive lints. Each fires on the CALL form
 * (`\bword\s*\(`) and skips inside `//` comments. Pre-fix all of these
 * fired generic `E-SCOPE-001` ("undefined identifier `ref`") — caught
 * but adopter-unhelpful. Post-fix the W-LINT-* names the framework + a
 * scrml-primitive correction.
 *
 * Coverage rationale per lint:
 *   W-LINT-017 (Vue): ref/reactive/computed/watch/onMounted/defineProps
 *     and other composition-API entry points
 *   W-LINT-018 (Svelte): writable/readable/derived/setContext/dispatcher
 *     and lifecycle helpers (excluding onMount/onDestroy — too risky
 *     given scrml may grow similar names)
 *   W-LINT-019 (Solid): createSignal/createEffect/createMemo/createStore
 *     and friends; skips control-flow components (For/Show — markup-tag
 *     context not available at lint time)
 *
 * Non-goal: `$store` auto-subscribe (Svelte) and `<For>` (Solid markup
 * tag) — separate detection paths needed; not in this pass.
 */

import { describe, test, expect } from "bun:test";
import { lintGhostPatterns } from "../../src/lint-ghost-patterns.js";

function lintCodes(src) {
  return lintGhostPatterns(src).map((d) => d.code);
}

// ---------------------------------------------------------------------------
// §1 — W-LINT-017 (Vue composition API)
// ---------------------------------------------------------------------------

describe("§1 — W-LINT-017 Vue composition API", () => {
  test("§1.1 ref(0) call fires", () => {
    const src = `<program>\${ const c = ref(0) }<div>\${c}</div></program>`;
    expect(lintCodes(src)).toContain("W-LINT-017");
  });

  test("§1.2 reactive({ ... }) call fires", () => {
    const src = `<program>\${ const s = reactive({ count: 0 }) }<div>x</div></program>`;
    expect(lintCodes(src)).toContain("W-LINT-017");
  });

  test("§1.3 computed / watch / watchEffect all fire", () => {
    const src = `<program>\${
      const c = computed(() => @x * 2)
      watch(c, (v) => log(v))
      watchEffect(() => log(c))
    }<div>x</div></program>`;
    const w17Count = lintCodes(src).filter((c) => c === "W-LINT-017").length;
    expect(w17Count).toBe(3);
  });

  test("§1.4 onMounted / onUnmounted / onBeforeMount lifecycle hooks fire", () => {
    const src = `<program>\${
      onMounted(() => log("mount"))
      onUnmounted(() => log("unmount"))
      onBeforeMount(() => log("before"))
    }<div>x</div></program>`;
    const w17Count = lintCodes(src).filter((c) => c === "W-LINT-017").length;
    expect(w17Count).toBe(3);
  });

  test("§1.5 defineComponent / defineProps / defineEmits fire", () => {
    const src = `<program>\${
      const C = defineComponent({ name: "X" })
      const p = defineProps(["a", "b"])
      const e = defineEmits(["close"])
    }<div>x</div></program>`;
    const w17Count = lintCodes(src).filter((c) => c === "W-LINT-017").length;
    expect(w17Count).toBe(3);
  });

  test("§1.6 comment-skipping (no false-fire)", () => {
    const src = `<program>
    // ref(0) is Vue, scrml uses <x> = 0 instead
    <x> = 0
    <div>\${@x}</div>
</program>`;
    expect(lintCodes(src)).not.toContain("W-LINT-017");
  });
});

// ---------------------------------------------------------------------------
// §2 — W-LINT-018 (Svelte stores / lifecycle)
// ---------------------------------------------------------------------------

describe("§2 — W-LINT-018 Svelte stores", () => {
  test("§2.1 writable(0) call fires", () => {
    const src = `<program>\${ const c = writable(0) }<div>x</div></program>`;
    expect(lintCodes(src)).toContain("W-LINT-018");
  });

  test("§2.2 readable(0, ...) call fires", () => {
    const src = `<program>\${ const c = readable(0, () => {}) }<div>x</div></program>`;
    expect(lintCodes(src)).toContain("W-LINT-018");
  });

  test("§2.3 derived(...) CALL fires (does NOT collide with derived=expr engine attr)", () => {
    // The pattern requires `derived\s*\(` — the call form. Engine attr is
    // `derived=expr` (no parens after `derived`), so it doesn't trip the
    // pattern.
    const src = `<program>\${ const d = derived(a, ($a) => $a * 2) }<div>x</div></program>`;
    expect(lintCodes(src)).toContain("W-LINT-018");
  });

  test("§2.4 engine `derived=expr` attribute does NOT fire (regression guard)", () => {
    const src = `type Mode:enum = { A, B }

<program>
    <mode>: Mode = .A
    <engine for=Mode derived=@mode>
        .A => .B
        .B => .A
    </>
</program>`;
    // `derived=` (no parens) is the canonical engine attribute per §51.0.J;
    // must NOT trip the Svelte store lint.
    expect(lintCodes(src)).not.toContain("W-LINT-018");
  });

  test("§2.5 setContext / getContext / createEventDispatcher fire", () => {
    const src = `<program>\${
      setContext("k", v)
      const ctx = getContext("k")
      const d = createEventDispatcher()
    }<div>x</div></program>`;
    const w18Count = lintCodes(src).filter((c) => c === "W-LINT-018").length;
    expect(w18Count).toBe(3);
  });

  test("§2.6 comment-skipping (no false-fire)", () => {
    const src = `<program>
    // writable(0) is Svelte, scrml uses <x> = 0 instead
    <x> = 0
    <div>\${@x}</div>
</program>`;
    expect(lintCodes(src)).not.toContain("W-LINT-018");
  });
});

// ---------------------------------------------------------------------------
// §3 — W-LINT-019 (Solid primitives)
// ---------------------------------------------------------------------------

describe("§3 — W-LINT-019 Solid primitives", () => {
  test("§3.1 createSignal(0) call fires", () => {
    const src = `<program>\${ const [c, sc] = createSignal(0) }<div>x</div></program>`;
    expect(lintCodes(src)).toContain("W-LINT-019");
  });

  test("§3.2 createEffect, createMemo, createStore all fire", () => {
    const src = `<program>\${
      createEffect(() => log(@x))
      const d = createMemo(() => @x * 2)
      const [s, ss] = createStore({ a: 1 })
    }<div>x</div></program>`;
    const w19Count = lintCodes(src).filter((c) => c === "W-LINT-019").length;
    expect(w19Count).toBe(3);
  });

  test("§3.3 createResource / createContext / batch / untrack fire", () => {
    const src = `<program>\${
      const [r] = createResource(fetchData)
      const Ctx = createContext()
      batch(() => { @a = 1; @b = 2 })
      const v = untrack(() => @x)
    }<div>x</div></program>`;
    const w19Count = lintCodes(src).filter((c) => c === "W-LINT-019").length;
    expect(w19Count).toBe(4);
  });

  test("§3.4 comment-skipping (no false-fire)", () => {
    const src = `<program>
    // createSignal(0) is Solid, scrml uses <x> = 0 instead
    <x> = 0
    <div>\${@x}</div>
</program>`;
    expect(lintCodes(src)).not.toContain("W-LINT-019");
  });
});

// ---------------------------------------------------------------------------
// §4 — Cross-framework: each lint stays in its lane
// ---------------------------------------------------------------------------

describe("§4 — codes don't cross-fire", () => {
  test("§4.1 Vue ref() doesn't fire W-LINT-018 or W-LINT-019", () => {
    const src = `<program>\${ const c = ref(0) }<div>x</div></program>`;
    const codes = lintCodes(src);
    expect(codes).toContain("W-LINT-017");
    expect(codes).not.toContain("W-LINT-018");
    expect(codes).not.toContain("W-LINT-019");
    // Also should NOT fire React-hook lint
    expect(codes).not.toContain("W-LINT-016");
  });

  test("§4.2 Svelte writable() doesn't fire W-LINT-017 or W-LINT-019", () => {
    const src = `<program>\${ const c = writable(0) }<div>x</div></program>`;
    const codes = lintCodes(src);
    expect(codes).toContain("W-LINT-018");
    expect(codes).not.toContain("W-LINT-017");
    expect(codes).not.toContain("W-LINT-019");
  });

  test("§4.3 Solid createSignal() doesn't fire W-LINT-017 or W-LINT-018", () => {
    const src = `<program>\${ const [c, sc] = createSignal(0) }<div>x</div></program>`;
    const codes = lintCodes(src);
    expect(codes).toContain("W-LINT-019");
    expect(codes).not.toContain("W-LINT-017");
    expect(codes).not.toContain("W-LINT-018");
  });
});
