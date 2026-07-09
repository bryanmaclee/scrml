" Vim/Neovim syntax highlighting for scrml — region-aware.
"
" scrml is a mixed language; this grammar scopes each context so keywords do
" not bleed into markup text and `>` only highlights when it closes a tag:
"   markup  <tag>…</>   ·  logic ${…}  ·  sql ?{…}  ·  css #{…}
"   meta ^{…}  ·  test ~{…}  ·  error !{…}
"
" Install:  cp editors/neovim/syntax/scrml.vim ~/.config/nvim/syntax/scrml.vim
"           (pair with editors/neovim/scrml.vim as ftdetect/scrml.vim)
"
" This is a REGEX approximation — vim syntax cannot fully parse scrml's nested
" contexts. Once the LSP ships semantic tokens (compiler-as-oracle), Neovim
" 0.9+ layers context-exact highlighting on top of this baseline; this file
" remains the fallback when the LSP is not attached.

if exists('b:current_syntax')
  finish
endif

syn case match
syn sync minlines=250

" ─────────────────────────────── Comments ───────────────────────────────
syn keyword scrmlTodo contained TODO FIXME XXX NOTE HACK
syn match   scrmlLineComment  "//.*$"        contains=scrmlTodo,@Spell
syn region  scrmlBlockComment start="/\*" end="\*/" contains=scrmlTodo,@Spell

" ─────────────────────────────── Literals ───────────────────────────────
syn match   scrmlNumber  "\<\d\+\%(\.\d\+\)\?\%([eE][-+]\?\d\+\)\?\>"
syn keyword scrmlBoolean true false
syn keyword scrmlAbsence not
syn region  scrmlStringD start=/"/ skip=/\\./ end=/"/  contains=@Spell
syn region  scrmlStringS start=/'/ skip=/\\./ end=/'/  contains=@Spell
syn region  scrmlTemplate start=/`/ skip=/\\./ end=/`/ contains=scrmlInterp,@Spell
syn region  scrmlInterp matchgroup=scrmlSigil start="\${" end="}" contained contains=@scrmlCode

" ───────────────────────── Reactive variables ───────────────────────────
syn match scrmlReactive "@[a-zA-Z_]\w*"

" ─────────────────────────────── Keywords ───────────────────────────────
" Distinctive declaration / control keywords — safe to match globally (they
" rarely appear as prose inside markup text).
syn keyword scrmlDecl    import export from enum struct type fn pure lin const
syn keyword scrmlDecl    engine channel schema program component snippet slot
syn keyword scrmlControl match return await async navigate lift renders render emit
syn keyword scrmlControl if else while req fail server
syn keyword scrmlEngine  onTransition onTimeout onIdle onchange errors watches
syn keyword scrmlEngine  authority initial derived protect

" Multi-word predicate forms — unambiguous, match globally.
syn match scrmlPredicate "\<is\s\+some\>"
syn match scrmlPredicate "\<is\s\+not\>"
syn match scrmlPredicate "\<is\>"

" Short English-like words — ONLY inside code contexts, so prose doesn't bleed.
syn keyword scrmlWord contained some of in as when given for use reflect

" ────────────────────────────── Operators ───────────────────────────────
syn match scrmlArrow "=>"
syn match scrmlPipe  "|>"

" ───────────────────────── Sigil code contexts ──────────────────────────
syn cluster scrmlCode contains=scrmlReactive,scrmlDecl,scrmlControl,scrmlEngine,scrmlPredicate,scrmlWord,scrmlNumber,scrmlBoolean,scrmlAbsence,scrmlStringD,scrmlStringS,scrmlTemplate,scrmlLineComment,scrmlBlockComment,scrmlArrow,scrmlPipe,scrmlBraceNest

" balanced nested { } inside a code context
syn region scrmlBraceNest matchgroup=scrmlDelim start="{" end="}" contained transparent contains=@scrmlCode

syn region scrmlLogic matchgroup=scrmlSigil start="\${" end="}" contains=@scrmlCode
syn region scrmlSql   matchgroup=scrmlSigil start="?{"  end="}" contains=@scrmlCode,scrmlSqlKw
syn region scrmlMeta  matchgroup=scrmlSigil start="\^{" end="}" contains=@scrmlCode
syn region scrmlTest  matchgroup=scrmlSigil start="\~{" end="}" contains=@scrmlCode
syn region scrmlError matchgroup=scrmlSigil start="!{"  end="}" contains=@scrmlCode

syn keyword scrmlSqlKw contained select from where insert into update delete set
syn keyword scrmlSqlKw contained values join left right inner outer on group order
syn keyword scrmlSqlKw contained by limit offset returning and or distinct count
syn keyword scrmlSqlKw contained sum avg min max having union null

" ─────────────────────────────── CSS #{…} ───────────────────────────────
syn region scrmlCss matchgroup=scrmlSigil start="#{" end="}" contains=scrmlCssProp,scrmlNumber,scrmlStringD,scrmlLineComment,scrmlBlockComment,scrmlReactive,scrmlBraceNest
syn match  scrmlCssProp "\<[a-zA-Z-]\+\ze\s*:" contained

" ─────────────────────────────── Markup ─────────────────────────────────
" Bare close </>
syn match scrmlTagBare "</>"
" Element tag — `>` only closes here (fixes every-`>`-is-a-tag).
syn region scrmlTag matchgroup=scrmlTagDelim start="</\=\w\@=" end="/\=>"
      \ keepend contains=scrmlTagName,scrmlAttribute,scrmlEquals,scrmlStringD,scrmlStringS,scrmlReactive,scrmlLogic
syn match scrmlTagName   "\w[-.:0-9A-Za-z]*" contained
syn match scrmlAttribute "\<[a-zA-Z][a-zA-Z0-9-]*\%(:[a-zA-Z][a-zA-Z0-9-]*\)\=\ze=" contained
syn match scrmlEquals    "=" contained

" ────────────────────────── Highlight links ─────────────────────────────
hi def link scrmlLineComment  Comment
hi def link scrmlBlockComment Comment
hi def link scrmlTodo         Todo
hi def link scrmlNumber       Number
hi def link scrmlBoolean      Boolean
hi def link scrmlAbsence      Constant
hi def link scrmlStringD      String
hi def link scrmlStringS      String
hi def link scrmlTemplate     String
hi def link scrmlReactive     Identifier
hi def link scrmlDecl         Keyword
hi def link scrmlControl      Statement
hi def link scrmlEngine       Keyword
hi def link scrmlPredicate    Operator
hi def link scrmlWord         Keyword
hi def link scrmlSigil        Special
hi def link scrmlDelim        Delimiter
hi def link scrmlArrow        Operator
hi def link scrmlPipe         Operator
hi def link scrmlSqlKw        Statement
hi def link scrmlCssProp      Identifier
hi def link scrmlTagDelim     Delimiter
hi def link scrmlTagName      Tag
hi def link scrmlTagBare      Tag
hi def link scrmlAttribute    Type
hi def link scrmlEquals       Operator

let b:current_syntax = 'scrml'
