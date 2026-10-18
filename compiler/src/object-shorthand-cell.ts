/**
 * S469 — E-OBJECT-SHORTHAND-CELL (provisional name — owner's call).
 *
 * `{ @count }` is refused: a shorthand property takes its key from the variable
 * it reads, and `@count` is the canonical ACCESS form of a cell (§6.1.2), not a
 * name. The front-end check lives in gauntlet-phase1-checks.js (Stage 3.005);
 * codegen's `emitProp` keeps a backstop for a tree that reaches it anyway. One
 * message for both.
 */
export const OBJECT_SHORTHAND_CELL = "E-OBJECT-SHORTHAND-CELL";

/** True when a shorthand property's name is a cell read (`@x`). */
export function isCellShorthandName(name: unknown): name is string {
  return typeof name === "string" && name.startsWith("@");
}

/**
 * S469 — a cell read used as a DESTRUCTURING TARGET (`const { @count } = o`,
 * `const [ @count ] = xs`, `{ a: @count }`). The pattern parser used to drop the
 * token silently (`const {  } = o;` — the binding vanished). Same code: the same
 * root (`@x` used where a name is required); the fix is to bind a local and write
 * the cell.
 */
export function destructureCellMessage(name: string, isArray: boolean, fieldName?: string): string {
  const key = name.slice(1);
  const pattern = isArray ? `[ ${name} ]` : fieldName ? `{ ${fieldName}: ${name} }` : `{ ${name} }`;
  const local = isArray ? `[ ${key} ]` : fieldName ? `{ ${fieldName}: ${key} }` : `{ ${key} }`;
  return `E-OBJECT-SHORTHAND-CELL: \`${name}\` cannot be a destructuring target in \`${pattern}\` — a pattern binds ` +
    `NAMES, and \`${name}\` is a read in the canonical \`@\` access form (§6.1.2), not a name. Bind a local and ` +
    `write the cell: \`const ${local} = …\` then \`${name} = ${key}\`.`;
}

export function objectShorthandCellMessage(name: string): string {
  const key = name.slice(1);
  return `E-OBJECT-SHORTHAND-CELL: \`{ ${name} }\` is not an object property — a shorthand takes its key ` +
    `from the variable it reads, and \`${name}\` is a read in the canonical \`@\` access form (§6.1.2), not a ` +
    `name a key can take. Write the key explicitly: \`{ ${key}: ${name} }\`.`;
}
