// scrml:data/transform — runtime shim (submodule)
//
// Hand-written ES module mirroring stdlib/data/transform.scrml, so a subpath import
// `import { pick } from 'scrml:data/transform'` resolves at run time (SPEC §41.4).
// The implementation lives once, in the `scrml:data` shim; this file re-exports it.
//
// Surface (must match stdlib/data/transform.scrml exports — pinned by
// compiler/tests/unit/stdlib-shim-export-parity.test.js).

export {
  pick,
  omit,
  mapKeys,
  mapValues,
  groupBy,
  indexBy,
  sortBy,
  unique,
  union,
  intersection,
  difference,
  member,
  flatten,
  flattenDeep,
  chunk,
  toSnakeCase,
  toCamelCase,
  camelizeKeys,
  snakifyKeys,
  deepMerge,
  clamp,
  paginate,
} from "../data.js";
