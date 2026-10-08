// harness.js — compile + load the bootstrap with the §57 codec's compile-time
// half (codec.scrml) on top of the M2 front end, all through impl#1.

import { join } from "node:path";
import { loadBundle, SELF_HOST_V2 } from "../slice-m1/harness.js";
import { M2_MODULES } from "../slice-m2/harness.js";

// s451: codec.scrml is in the M1 module set (check + print import it, U5).
export const CODEC_MODULES = M2_MODULES;

export function loadCodec() {
  return loadBundle(join(SELF_HOST_V2, "slice-codec", "bundle.scrml"), CODEC_MODULES);
}

/**
 * Build the wire descriptor for Core type `ty` of program `core` and turn the
 * printed JS literal (`wireTableJs`, what a printer embeds) back into a value.
 * Returns { table, text, why } — `table`/`text` are null when refused.
 */
export function descriptor(mods, core, ty) {
  const b = mods.codec.wireBuild(core, ty);
  if (b.table === null || b.table === undefined) return { table: null, text: null, why: b.why };
  const text = mods.codec.wireTableText(b.table);
  // The literal is a JS expression made only of object/array/string/number
  // literals (codec.scrml `wireTableJs`); evaluating it is how emitted code
  // will see it.
  const table = new Function("return (" + text + ");")();
  return { table, text, why: b.why };
}
