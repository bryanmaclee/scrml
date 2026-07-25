import { describe, it, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

/**
 * Reactive assignment inside error handler (!{}) arm bodies.
 * Bug: @var = expr inside !{ | ::Type -> { @var = expr } } emitted as
 * _scrml_reactive_get("var") = expr (invalid assignment target).
 * Fix: route block bodies through rewriteBlockBody() like match arms.
 */
describe("Reactive assignment in error handler arm bodies", () => {
  const tmp = join(tmpdir(), `scrml-err-arm-${Date.now()}`);

  it("@var = expr in !{} arm body emits _scrml_reactive_set()", () => {
    mkdirSync(tmp, { recursive: true });
    const src = [
      '<program>',
      '${',
      '  type AppError:enum = {',
      '    NetworkError(msg: string)',
      '    NotFound',
      '  }',
      '',
      '  @loading = false',
      '  @errorMsg = ""',
      '',
      '  server function fetchData()! -> AppError {',
      '    lift "data"',
      '  }',
      '',
      '  function doFetch() {',
      '    @loading = true',
      '    let result = fetchData() !{',
      '      | ::NetworkError e -> { @loading = false; @errorMsg = e.msg }',
      '      | ::NotFound -> { @loading = false; @errorMsg = "Not found" }',
      '    }',
      '    @loading = false',
      '  }',
      '}',
      '</program>',
    ].join('\n');
    const srcFile = join(tmp, "err-arm.scrml");
    writeFileSync(srcFile, src);
    const outDir = join(tmp, "dist");
    mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);

    // Read the client JS and verify no invalid _scrml_reactive_get on LHS of assignment
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(require("fs").readFileSync(join(outDir, "err-arm.client.js"), "utf8")));
    const invalidAssignments = clientJs.match(/_scrml_reactive_get\([^)]+\)\s*=[^=]/g);
    expect(invalidAssignments).toBeNull();

    // Verify _scrml_reactive_set is used instead
    expect(clientJs).toContain('_scrml_reactive_set("loading", false)');

    rmSync(tmp, { recursive: true, force: true });
  });
  it("return on new line after @var = expr is not swallowed by reactive assignment", () => {
    const tmp2 = require("os").tmpdir() + "/scrml-err-arm-return-" + Date.now();
    require("fs").mkdirSync(tmp2, { recursive: true });
    // Bug: parseErrorTokens joins handler tokens with " " (space), discarding newlines.
    // rewriteBlockBody splits on ";" and "\n" only. When return follows @var = expr on
    // a new source line, the newline is lost and the reactive assignment regex greedily
    // captures "return" as part of the value expression.
    const src = [
      '<program>',
      '${',
      '  type DBError:enum = {',
      '    DBError(msg: string)',
      '  }',
      '  @formError = ""',
      '  server function save()! -> DBError { lift "ok" }',
      '  function handleSubmit() {',
      '    let result = save() !{',
      '      | ::DBError e -> {',
      '        @formError = e.message',
      '        return',
      '      }',
      '    }',
      '  }',
      '}',
      '</program>',
    ].join("\n");

    const srcFile = require("path").join(tmp2, "err-return.scrml");
    require("fs").writeFileSync(srcFile, src);
    const outDir = require("path").join(tmp2, "dist");
    require("fs").mkdirSync(outDir, { recursive: true });

    const result = compileScrml({ inputFiles: [srcFile], outputDir: outDir });
    expect(result.errors).toHaveLength(0);

    const clientJs =foldChunkNamespacing( foldChunkNamespacing(require("fs").readFileSync(require("path").join(outDir, "err-return.client.js"), "utf8")));

    // The reactive set must NOT include "return" as part of the value expression
    const badPattern = /_scrml_reactive_set\([^,]*,\s*[^)]*return[^)]*\)/;
    expect(badPattern.test(clientJs)).toBe(false);

    // The reactive set must be present with only the correct value
    expect(clientJs).toContain('_scrml_reactive_set("formError", e . message)');

    require("fs").rmSync(tmp2, { recursive: true, force: true });
  });

});
