/**
 * @module codegen/build-identity
 *
 * SPEC §20.8.2 step 0 — the BUILD IDENTITY (g-soft-nav-cross-build-handler-id-collision-s469).
 *
 * Handler / placeholder ids (`_scrml_attr_onclick_N`) come from a per-compile
 * counter, so two builds reuse the same ids for different handlers. A tab left
 * open across a deploy runs build A's shell; if it soft-navigated into build B's
 * route and swapped B's markup in, A's delegated listener resolved B's button ids
 * against A's handler table — a click on B's "Add row" ran A's `dangerDelete()`.
 *
 * Every compile therefore carries one identity, a deterministic content hash of
 * the build's client CODE: the shared runtime + every file's client chunk. HTML and
 * CSS are deliberately NOT hashed: the property being protected is "every id a page
 * carries resolves to the same handler in the code that is running", and ids live in
 * the chunk's tables, so two builds whose client code is byte-identical cannot
 * mis-resolve each other's markup (a static-text or stylesheet-only change soft-
 * navigates and shows the new page). Keeping them out also means a markup-only or
 * CSS-only change does not re-key every chunk. It is written as a placeholder during per-file emission and
 * substituted once the whole build is assembled (the same two-step the runtime's
 * content-hashed filename uses), into:
 *
 *   - every page: `<html … data-scrml-build="ID">`;
 *   - every classic client chunk: `if (… !_scrml_build_admit("ID")) return;` as
 *     the first statement of the chunk scope (esm: a plain `_scrml_build_admit`
 *     registration — a module has no function body to return from);
 *   - every delegated listener / `_scrml_nav_rewire`: `_scrml_build_owns(el, "ID")`.
 *
 * Reproducible by construction: no clock, no path, no RNG — the hash input is the
 * set of emitted client chunks with the placeholder still in place, sorted so neither
 * file order nor absolute paths participate. Two identical builds produce the same
 * identity; any change to the client code that ships changes it.
 */

import { fnv1aHash } from "./fnv1a-hash.ts";

/** Written wherever the identity appears, substituted by `substituteBuildIdentity`. */
export const BUILD_ID_PLACEHOLDER = "__SCRML_BUILD_ID_PLACEHOLDER__";

/**
 * The first statement of a classic chunk's scope: refuse to run under another build.
 *
 * A runtime with NO `_scrml_build_admit` is one that predates build identity (a tab
 * still running a pre-identity build) or a no-runtime test harness probing pure
 * lowering. Refusing there protects nothing — a pre-identity shell has no same-build
 * check, and its own listeners are what would mis-resolve — so the gate admits only
 * where an identity-aware runtime can answer.
 */
export const CLASSIC_CHUNK_BUILD_GATE =
  `if (typeof _scrml_build_admit === "function" && !_scrml_build_admit(${JSON.stringify(BUILD_ID_PLACEHOLDER)})) return;`;

/** The esm form — registration only (no function body to return from at module top). */
export const ESM_CHUNK_BUILD_ADMIT = `_scrml_build_admit(${JSON.stringify(BUILD_ID_PLACEHOLDER)});`;

/** `_scrml_build_owns(<elExpr>, "<id>")` — the chunk-local region check. */
export function buildOwnsExpr(elExpr: string): string {
  return `_scrml_build_owns(${elExpr}, ${JSON.stringify(BUILD_ID_PLACEHOLDER)})`;
}

export interface BuildIdentityArtifact {
  clientJs?: string | null;
}

/**
 * The build's identity: fnv1a over the sorted per-file client chunks plus the
 * runtime. Sorting the chunk strings (not the paths) keeps absolute paths and file
 * order out of the hash.
 */
export function computeBuildIdentity(
  artifacts: Iterable<BuildIdentityArtifact>,
  runtimeJs: string | null,
): string {
  const parts: string[] = [];
  for (const a of artifacts) {
    if (!a || !a.clientJs) continue;
    parts.push(a.clientJs);
  }
  parts.sort();
  return fnv1aHash(`${runtimeJs ?? ""}\u0001${parts.join("\u0001")}`);
}

/** Replace every placeholder occurrence in `text` with `id` (null passes through). */
export function substituteBuildIdentity<T extends string | null | undefined>(text: T, id: string): T {
  if (typeof text !== "string" || !text.includes(BUILD_ID_PLACEHOLDER)) return text;
  return text.split(BUILD_ID_PLACEHOLDER).join(id) as T;
}

/**
 * Fold a substituted build identity back to the placeholder, for tools that compare
 * two compiles' artifacts (`scrml fix` verify, emit diffs). The identity hashes the
 * whole build, so two compiles that differ ANYWHERE differ in every identity
 * occurrence; a comparison that tolerates a known client delta must not be tripped
 * by the identity riding along. Touches only the three emitted shapes.
 */
export function foldBuildIdentity(text: string): string {
  const ph = JSON.stringify(BUILD_ID_PLACEHOLDER);
  return String(text ?? "")
    .replace(/(data-scrml-build=)"[0-9a-z]{8}"/g, `$1${ph}`)
    .replace(/(_scrml_build_admit\()"[0-9a-z]{8}"\)/g, `$1${ph})`)
    .replace(/(_scrml_build_owns\([A-Za-z_$][\w$.]*, )"[0-9a-z]{8}"\)/g, `$1${ph})`);
}
