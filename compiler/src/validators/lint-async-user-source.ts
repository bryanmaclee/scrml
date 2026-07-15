/**
 * async/await reject validator — §19.9.8 language-wide standing rule.
 *
 * Fires the three hard-error codes on user-source `async` / `await` /
 * `for await`, matching the native parser (`compiler/native-parser/`):
 *
 *   - `E-ASYNC-NOT-IN-SCRML`     — `async function`, `async fn`, or `async () =>`
 *   - `E-AWAIT-NOT-IN-SCRML`     — an `await` expression
 *   - `E-FOR-AWAIT-NOT-IN-SCRML` — a `for await ... of` head
 *
 * Per SPEC §19.9.8 (S114, user-voice verbatim: *"I have intentionally left
 * async/await out of the language, because I hate leaky abstractions and
 * colored functions"*) scrml has NO `async`/`await`. The canonical async
 * surface is the compiler body-split / CPS (§19.9.3) — developer code stays
 * flat and synchronous-looking; the compiler emits the async infrastructure.
 *
 * **Migration note (2026-07 — reverses S89 Q5).** This validator previously
 * fired the non-fatal `I-ASYNC-USER-SOURCE` INFO nudge and let user-source
 * `async function` compile (the S89 §13.2 Sub-Phase B carve-out). That nudge is
 * RETIRED: bryan-ratified §19.9.8 + the user-voice "no colored functions" line
 * are normative stated intent, so user-source async/await is now a HARD ERROR
 * on the default parse path — parity with the native parser, which already
 * hard-errors.
 *
 * **Two LOAD-BEARING carve-outs are preserved:**
 *
 *   1. **stdlib carve-out (§13.1).** A `scrml:*` stdlib file (under
 *      `<repo>/stdlib/`) MAY declare `async function` — its `async` signals the
 *      `Promise<T>` return shape to the auto-await classifier (§13.2.1), and
 *      stdlib bodies MAY use `await` at the JS-host boundary (e.g. `await
 *      import(...)`, `await crypto.subtle.*`). The whole file is exempt
 *      (`isStdlibFile`). Only USER source errors.
 *
 *   2. **`^{}` meta + `_{}` foreign JS-host boundary (§19.9.8).** A `^{}` meta
 *      block is host-JS-adjacent — a JS Promise legitimately crosses there
 *      (`await import(...)` in emitted/meta paths); its body is parsed as logic
 *      statements, so we must NOT descend into it. A `_{}` foreign block is
 *      OPAQUE (§23.2.3 — TAB never tokenizes its interior), so an `await` there
 *      never becomes a parsed node; we skip its subtree too, belt-and-suspenders.
 *
 * **Pipeline placement:** runs post-TAB / post-Gauntlet (api.js Stage 3.008),
 * same shelf as `lint-try-catch.ts`. No NR / SYM / TS dependency — the walker
 * needs only the parsed AST (`function-decl.isAsync`, `lambda.isAsync`,
 * `unary.op === "await"`, `for-stmt.isAwait`) and the file path.
 *
 * **SPEC anchors:** §19.9.8 (no `async`/`await` standing rule + the three
 * codes); §13.1 stdlib carve-out; §13.2.1 auto-await classifier; §34 catalog
 * (the three `E-*-NOT-IN-SCRML` rows).
 *
 * @module lint-async-user-source
 */
import { isMetaKind } from "../types/ast.ts";
import type { FileAST, Span } from "../types/ast.ts";
import { resolve } from "path";
import { isStdlibFilePath } from "../module-resolver.js";

export type AsyncAwaitRejectCode =
  | "E-ASYNC-NOT-IN-SCRML"
  | "E-AWAIT-NOT-IN-SCRML"
  | "E-FOR-AWAIT-NOT-IN-SCRML";

export interface AsyncAwaitRejectDiagnostic {
  code: AsyncAwaitRejectCode;
  message: string;
  span: Span;
  severity: "error";
}

/**
 * Test whether a file path is inside the stdlib carve-out region (§13.1, Q5
 * ratified S89). Exact stdlib-root match counts as inside; child paths also count.
 *
 * Delegates to `module-resolver.js`'s `isStdlibFilePath` — the SINGLE canonical
 * carve-out predicate (the #26 auth-bypass gate). S254 review: this was a
 * hand-maintained second copy; two copies of a security predicate must stay
 * bit-identical forever, so there is now exactly one. `resolve()` first because
 * `isStdlibFilePath` expects an absolute path and the carve-out must also accept
 * a relative input.
 *
 * Exported for unit testing — callers should use `runAsyncAwaitReject`.
 */
export function isStdlibFile(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  return isStdlibFilePath(resolve(filePath));
}

// The canonical steer shared by all three messages — points to the body-split
// / CPS surface (§19.9.3) that replaces source-level async/await. Mirrors the
// native parser's phrasing (parse-stmt.js / parse-expr.js) for parity.
const CANONICAL_STEER =
  "The canonical async surface is the compiler body-split (server functions, " +
  "reactive state) — no source-level async/await is needed (§19.9.3).";

type MutableNode = Record<string, unknown> & { kind?: string; span?: Span };

/**
 * Walk EVERY node reachable from the FileAST — statements AND their expression
 * subtrees (unlike `validators/ast-walk.ts`, which only descends statement
 * bodies). `async`/`await` live in expression position (`unary`, `lambda`), so
 * a statement-only walk would miss them. Skips the `^{}` meta and `_{}` foreign
 * subtrees (the §19.9.8 JS-host boundary — see module docstring).
 *
 * `seen` is a cycle guard: the parsed AST is a tree, but a defensive WeakSet
 * keeps the walk total even if a downstream stage backfills a parent pointer.
 */
function walkDeep(
  node: unknown,
  visit: (n: MutableNode) => void,
  seen: WeakSet<object>,
): void {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const c of node) walkDeep(c, visit, seen);
    return;
  }

  const n = node as MutableNode;

  // §19.9.8 JS-host interop boundary — do NOT descend into a `^{}` meta block
  // (`await import(...)` is legitimate host JS there) or a `_{}` foreign block
  // (opaque interior). Neither the node nor its subtree is checked.
  if (isMetaKind(n.kind) || n.kind === "foreign" || n.kind === "Foreign") return;

  visit(n);

  for (const key of Object.keys(n)) {
    // `span` is a position record (no nodes); `parent` would cycle upward.
    if (key === "span" || key === "parent") continue;
    walkDeep(n[key], visit, seen);
  }
}

function spanOf(n: MutableNode, filePath: string): Span {
  return (
    n.span ?? {
      file: filePath,
      start: 0,
      end: 0,
      line: 1,
      col: 1,
    }
  );
}

/**
 * Walk a FileAST and collect the three §19.9.8 hard-error diagnostics on
 * user-source `async` / `await` / `for await`. Returns `[]` for stdlib files
 * (the §13.1 carve-out) and never enters `^{}` / `_{}` subtrees.
 */
export function runAsyncAwaitReject(
  ast: FileAST | null | undefined,
): AsyncAwaitRejectDiagnostic[] {
  const diagnostics: AsyncAwaitRejectDiagnostic[] = [];
  if (!ast) return diagnostics;

  const filePath = ast.filePath ?? "";

  // stdlib carve-out (§13.1): a stdlib file's `async function` is canonical
  // (Promise<T> signal to the auto-await classifier) and its `await` is the
  // JS-host boundary — the whole file is exempt.
  if (isStdlibFile(filePath)) return diagnostics;

  const seen = new WeakSet<object>();
  const visit = (n: MutableNode) => {
      const kind = n.kind;

      // `async function` / `async fn` — E-ASYNC-NOT-IN-SCRML.
      if (kind === "function-decl" && n.isAsync === true) {
        const fnName =
          typeof n.name === "string" && n.name.length > 0 ? n.name : "<anonymous>";
        diagnostics.push({
          code: "E-ASYNC-NOT-IN-SCRML",
          severity: "error",
          span: spanOf(n, filePath),
          message:
            `E-ASYNC-NOT-IN-SCRML: \`async function ${fnName}\` — scrml has no ` +
            `\`async\` keyword (§19.9.8). ${CANONICAL_STEER} Remove \`async\` ` +
            `(the compiler auto-awaits statically-known \`Promise<T>\` callees ` +
            `per §13.2.1). \`async\` is reserved for \`scrml:*\` stdlib declarations.`,
        });
        return;
      }

      // `async () =>` arrow (or an async function-expression) — E-ASYNC-NOT-IN-SCRML.
      if (kind === "lambda" && n.isAsync === true) {
        diagnostics.push({
          code: "E-ASYNC-NOT-IN-SCRML",
          severity: "error",
          span: spanOf(n, filePath),
          message:
            `E-ASYNC-NOT-IN-SCRML: an \`async\` arrow/function expression — scrml ` +
            `has no \`async\` keyword (§19.9.8). ${CANONICAL_STEER}`,
        });
        return;
      }

      // Backstop — a BLOCK-body async arrow (`async () => { ... }`) is not
      // structurally convertible by the default expression parser, so it falls
      // back to an `escape-hatch` node carrying the raw source text (rather than
      // a `lambda` with `isAsync`). A concise-body arrow (`async () => expr`) and
      // an async `function` expression ARE structured (caught above / by the
      // function-decl arm); only the block-body arrow reaches here. Match the
      // leading `async` keyword in the raw text — `\b` excludes an identifier
      // like `asyncHandler`. Parity with the native parser, which tokenizes
      // `async` at the expression head.
      if (kind === "escape-hatch" && typeof n.raw === "string" && /^\s*async\b/.test(n.raw)) {
        diagnostics.push({
          code: "E-ASYNC-NOT-IN-SCRML",
          severity: "error",
          span: spanOf(n, filePath),
          message:
            `E-ASYNC-NOT-IN-SCRML: an \`async\` arrow/function expression — scrml ` +
            `has no \`async\` keyword (§19.9.8). ${CANONICAL_STEER}`,
        });
        return;
      }

      // `await <expr>` — E-AWAIT-NOT-IN-SCRML.
      if (kind === "unary" && n.op === "await") {
        diagnostics.push({
          code: "E-AWAIT-NOT-IN-SCRML",
          severity: "error",
          span: spanOf(n, filePath),
          message:
            `E-AWAIT-NOT-IN-SCRML: an \`await\` expression — scrml has no ` +
            `\`await\` keyword (§19.9.8). ${CANONICAL_STEER} A JS Promise ` +
            `crossing the host boundary (\`^{}\` meta / \`_{}\` foreign / server-fn ` +
            `return) is resolved by the compiler at the boundary — the scrml-side ` +
            `read needs no \`await\`.`,
        });
        return;
      }

      // `for await ... of` — E-FOR-AWAIT-NOT-IN-SCRML (ast-builder records
      // `for-stmt.isAwait` at the retracted head; see ast-builder.js for-parse).
      if (kind === "for-stmt" && n.isAwait === true) {
        diagnostics.push({
          code: "E-FOR-AWAIT-NOT-IN-SCRML",
          severity: "error",
          span: spanOf(n, filePath),
          message:
            `E-FOR-AWAIT-NOT-IN-SCRML: a \`for await ... of\` loop — scrml has no ` +
            `\`for await\` (§19.9.8). ${CANONICAL_STEER}`,
        });
        return;
      }
    };

  for (const n of ast.nodes ?? []) walkDeep(n, visit, seen);

  return diagnostics;
}
