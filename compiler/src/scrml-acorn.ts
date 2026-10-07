// scrml-acorn.ts
// ---------------------------------------------------------------------------
// The scrml-extended acorn parser — acorn plus the two LEXICAL extensions scrml
// expression text needs before any rewriting: the `@` reactive sigil (`@count`,
// `@.field`) read as an identifier, and `Type::Variant` read as one token.
//
// A leaf module (imports only acorn) so that BOTH the expression parser
// (`expression-parser.ts`) and the SQL slot reader (`codegen/sql-lex.ts`
// `jsInterpolationEnd`) use the SAME parser: where a `?{}` `${…}` slot ends is
// decided by this parser reading the payload (S457, §8.1.2 "One reader of a
// slot's extent"), not by a second hand-written scanner. Moved verbatim from
// expression-parser.ts (S457); behaviour unchanged.
// ---------------------------------------------------------------------------

// @ts-ignore — acorn ships its own types but the plugin API is untyped
import * as acorn from "acorn";

// ---------------------------------------------------------------------------
// Acorn plugin: handle @ sigil as part of identifiers
// ---------------------------------------------------------------------------

/**
 * Acorn plugin that makes `@` a valid identifier-start character.
 * `@count` parses as Identifier { name: "@count" }.
 */
// @ts-ignore — acorn plugin API uses dynamic class extension not captured in types
function scrmlAtPlugin(Parser: typeof acorn.Parser) {
  // @ts-ignore
  return class extends Parser {
    readToken(code: number) {
      // 64 = '@'
      if (code === 64) {
        // Peek ahead: only consume @ as identifier if followed by a valid
        // identifier start char (letter, _, $). Otherwise let acorn handle it
        // (it will likely error, which is correct for bare @ or @123).
        // @ts-ignore
        const next = this.input.charCodeAt(this.pos + 1);
        // §17.7.3 — the `@.` contextual iteration sigil ("the current iteration
        // value"). `@` followed by `.` is NOT an identifier-start, so the bare
        // peek below would let acorn choke on it (escape-hatch ParseError for
        // `@.` / `@.field` fed to parseExprToNode — the ExprNode layer could not
        // structure the sigil; the each-body markup path lowers `@.` via a
        // separate string-rewrite in emit-lift, and E-SYNTAX-064 is enforced by
        // the type-system token scan — both independent of this parse). Consume
        // `@.` plus an optional immediately-following field name as ONE name
        // token: `@.` → "@.", `@.field` → "@.field", chained `@.a.b` → "@.a"
        // here then acorn handles `.b` as member access, `@.items[0]` → "@.items"
        // then computed member. Whether `@.` is legal at this locus (inside an
        // `<each>` body) is decided downstream by E-SYNTAX-064 — this layer's job
        // is only to STRUCTURE the valid-scrml sigil instead of escape-hatching.
        //
        // INLINE-WS-tolerant: the block-splitter join path emits expression text
        // with whitespace around tokens, so a source `@.name` reaches here as
        // `@ . name`. Non-destructive lookahead from just after `@` skips inline
        // ws (space/tab only — never a newline) to find the `.`; if present this
        // is the sigil and `this.pos` is advanced past the `.` + trailing ws to
        // the field. (readToken never fires inside string/comment interiors —
        // acorn handles those separately — so this absorbs only real code ws.)
        // @ts-ignore
        let _look = this.pos + 1;
        // @ts-ignore
        while (this.input.charCodeAt(_look) === 32 || this.input.charCodeAt(_look) === 9) _look++;
        // @ts-ignore
        if (this.input.charCodeAt(_look) === 46) { // '.'
          _look++; // past '.'
          // @ts-ignore
          while (this.input.charCodeAt(_look) === 32 || this.input.charCodeAt(_look) === 9) _look++;
          // @ts-ignore
          this.pos = _look;
          // @ts-ignore
          const after = this.input.charCodeAt(this.pos);
          const fieldStart = (after >= 65 && after <= 90)   // A-Z
            || (after >= 97 && after <= 122)                 // a-z
            || after === 95 || after === 36;                 // _ or $
          let field = "";
          if (fieldStart) {
            // @ts-ignore
            field = this.readWord1();
          }
          // @ts-ignore
          return this.finishToken(acorn.tokTypes.name, "@." + field);
        }
        const isIdentStart = (next >= 65 && next <= 90)  // A-Z
          || (next >= 97 && next <= 122)                   // a-z
          || next === 95 || next === 36;                   // _ or $
        if (isIdentStart) {
          // @ts-ignore
          this.pos++;
          // @ts-ignore
          const word = this.readWord1();
          // @ts-ignore
          return this.finishToken(acorn.tokTypes.name, "@" + word);
        }
      }
      // @ts-ignore
      return super.readToken(code);
    }
  };
}

/**
 * Acorn plugin that handles `::` enum variant access.
 * Transforms `Type::Variant` by reading it as a single string token.
 * Without this, acorn would choke on `::` which is not valid JS.
 */
// @ts-ignore — acorn plugin API uses dynamic class extension not captured in types
function scrmlEnumPlugin(Parser: typeof acorn.Parser) {
  // @ts-ignore
  return class extends Parser {
    readToken(code: number) {
      // 58 = ':'
      // @ts-ignore
      if (code === 58 && this.input.charCodeAt(this.pos + 1) === 58) {
        // Read Type::Variant as a special identifier
        // @ts-ignore
        this.pos += 2; // skip ::
        // @ts-ignore
        const variant = this.readWord1();
        // Emit as a string literal containing the variant name
        // @ts-ignore
        return this.finishToken(acorn.tokTypes.string, variant);
      }
      // @ts-ignore
      return super.readToken(code);
    }
  };
}

// @ts-ignore
export const ScrmlParser = acorn.Parser.extend(scrmlAtPlugin, scrmlEnumPlugin);
