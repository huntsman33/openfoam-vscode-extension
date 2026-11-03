/**
 * @file OpenFOAM/Helyx dictionary grammar for tree-sitter
 * @license MIT
 *
 * Models the OpenFOAM dictionary file format: a sequence of blocks,
 * key/value entries, and preprocessor-style directives. Comments are
 * extras and never affect brace/paren nesting; quoted strings absorb
 * any embedded delimiter characters.
 */

module.exports = grammar({
  name: "openfoam",

  extras: ($) => [/\s/, $.line_comment, $.block_comment],

  // `identifier '{'` is ambiguous between "named block" and "a bare
  // identifier value immediately followed by a separate anonymous
  // block list element" — resolved via dynamic precedence on `block`
  // below (named-block reading always wins).
  conflicts: ($) => [[$._name, $.value]],

  rules: {
    source_file: ($) => repeat($._item),

    _item: ($) =>
      choice($.directive, $.block, $.entry, $.merge_entry, $.sized_list, $.list),

    // block: identifier|dotted-identifier|quoted-string '{' entry* '}',
    // or an anonymous `{ ... }` block (used as a bare list element, e.g.
    // `features ( { file "x.eMesh"; levels ((0.0 7)); } ... )`).
    // A trailing ';' after the closing '}' is tolerated (seen in real
    // Helyx dicts, e.g. `functions { ... };`) even though it's redundant.
    block: ($) =>
      choice(
        prec.dynamic(
          1,
          seq(field("name", $._name), "{", repeat($._item), "}", optional(";")),
        ),
        seq("{", repeat($._item), "}", optional(";")),
      ),

    // entry: key value* ';' — most entries have one or more values, but
    // a bare `keyword;` with no data is valid OpenFOAM dictionary syntax
    // (e.g. `cuttingPatches();`, where the whole thing including the
    // empty parens is one atomic keyword per OpenFOAM's own word
    // tokenizer, which treats `(`/`)`/`,` as ordinary word characters).
    //
    // A value list may also end in a sub-dictionary, as in fvSchemes'
    // `div(phi,Yi_h) Gauss multivariateSelection { Yi limitedLinear01 1; };`
    // (at least one plain value first, so this never competes with a
    // named block).
    entry: ($) =>
      choice(
        seq(field("key", $._name), field("value", repeat($.value)), ";"),
        seq(
          field("key", $._name),
          field("value", repeat1($.value)),
          field("dict", $.dict_value),
          optional(";"),
        ),
      ),

    dict_value: ($) => seq("{", repeat($._item), "}"),

    // `$ref;` on its own — merges/includes a referenced sub-dict in
    // place (e.g. `$p_rghFinal;` inside an fvSolution solver block).
    // OpenFOAM doesn't require the ';' (`{ $_newFromPatch }`).
    merge_entry: ($) => prec.right(seq($.dollar_reference, optional(";"))),

    // (A bare top-level `( ... )` list, without the count, is also accepted:
    // e.g. a vectorField of cloud positions.)
    //
    // A count-prefixed top-level list, as used by whole-file list
    // formats like `constant/polyMesh/boundary`, `points`, `faces`:
    // `6\n(\n    patchName { ... }\n    ...\n)`. No trailing ';'.
    sized_list: ($) => seq(field("count", $.number), $.list),

    _name: ($) => choice($.identifier, $.string),

    value: ($) =>
      choice(
        $.number,
        $.dollar_reference,
        $.inline_expression,
        $.expression_directive,
        $.verbatim,
        $.string,
        $.list,
        $.dimension_set,
        $.uniform_list,
        $.code_stream_directive,
        $.identifier,
      ),

    // `3{(64 64 1)}`: a list of 3 copies of the value in braces.
    uniform_list: ($) =>
      prec(2, seq(field("count", $.number), token.immediate("{"), field("element", $.value), "}")),

    // `#eval{ 1/$x }`, `#eval "1/$x"`, `#eval #{ 1/$x #}`, `#calc "1/$x"`:
    // an expression evaluated while the dictionary is read, usable
    // anywhere a value is (`nu #eval{ $U*$L/$Re };`, `($x0 #eval{ -$b } 0)`).
    expression_directive: ($) =>
      seq(
        field("name", choice("#eval", "#calc")),
        field("body", choice($.expression_body, $.string, $.verbatim)),
      ),

    // The `{ ... }` of `#eval{ ... }`: one token, with one level of
    // nested braces allowed.
    expression_body: (_$) => token(seq("{", /([^{}]|\{[^{}]*\})*/, "}")),

    // `#{ ... #}` verbatim text (C++ for coded conditions and #codeStream,
    // or an expression): any characters up to the closing `#}`.
    verbatim: (_$) => token(seq("#{", /([^#]|#[^}])*/, "#}")),

    // `${{ 5*$x }}`: inline expression, evaluated where it appears.
    inline_expression: (_$) => token(prec(1, seq("${{", /([^}]|\}[^}])*/, "}}"))),

    // A parenthesized list of values and/or nested blocks (e.g. a
    // vector `(0 0 0)`, a list of scalars, or `6 ( patchName { ... } ... )`).
    // Directives are allowed too: `polyLine 4 8 ( #include "points" )`.
    // (#codeStream inside a list is a value.)
    list: ($) =>
      seq("(", repeat(choice($.value, $.block, $.include_directive, $.conditional_directive)), ")"),

    // OpenFOAM dimension set, e.g. `[0 1 -1 0 0 0 0]`, `[kg m s]` or
    // `[m^2 s^-1]`, `[ m^-1 ]`.
    dimension_set: ($) => seq("[", repeat($.dimension_term), "]"),

    dimension_term: (_$) => /[^\[\]\s;]+/,

    // #include "file"; #inputMode merge; #if 0 ... #else ... #endif;
    // #codeStream { ... }; etc. Modeled as flat, first-class directive
    // nodes rather than nesting conditional bodies structurally —
    // OpenFOAM's own preprocessor doesn't require matching #if/#endif
    // to be balanced within a single file scope in a way that's useful
    // to model here, and callers needing to walk "the tree" don't need
    // conditional-body nesting for hover/completion/diagnostics
    // purposes. Each directive kind takes a fixed (0 or 1 token) arity
    // so the grammar never has to guess whether a following token
    // belongs to the directive or starts the next top-level item.
    directive: ($) =>
      choice(
        $.include_directive,
        $.include_func_directive,
        $.remove_directive,
        $.input_mode_directive,
        $.conditional_directive,
        $.code_stream_directive,
        $.message_directive,
        $.bare_directive,
      ),

    include_directive: ($) =>
      seq(
        field(
          "name",
          choice("#include", "#sinclude", "#includeIfPresent", "#includeEtc"),
        ),
        field("path", $.string),
        optional(";"),
      ),

    // `#includeFunc solverInfo`, `#includeFunc "streamlines"`,
    // `#includeFunc singleGraph(start=(0 0 0), end=(1 0 0), fields=(U p))`:
    // a function object name, not a file path.
    include_func_directive: ($) =>
      seq(
        field("name", "#includeFunc"),
        field("function", choice($.string, $.function_spec)),
        optional(";"),
      ),

    // A name with an optional, immediately adjacent argument list (two
    // levels of nested parentheses).
    function_spec: (_$) =>
      token(/[A-Za-z_][A-Za-z0-9_.:\-]*(\(([^()]|\(([^()]|\([^()]*\))*\))*\))?/),

    // `#remove name`, `#remove "regex"`, `#remove (a b)`.
    remove_directive: ($) =>
      seq(field("name", "#remove"), field("target", choice($.identifier, $.string, $.list))),

    input_mode_directive: ($) =>
      seq("#inputMode", field("mode", $.identifier)),

    conditional_directive: ($) =>
      choice(
        seq(field("name", choice("#if", "#ifeq", "#elif")), field("condition", $.value)),
        "#else",
        "#endif",
      ),

    // Also usable as a value: `vertices #codeStream { code #{ ... #}; };`
    code_stream_directive: ($) => seq("#codeStream", field("body", $.dict_value)),

    message_directive: ($) =>
      seq(field("name", choice("#error", "#warning")), field("message", $.string)),

    // Fallback for any other directive (#remove, #eval, etc.). Zero-arity
    // by design: an "optional" trailing value here would be genuinely
    // ambiguous with the next top-level item (nothing marks where a
    // directive's argument list ends other than a fixed arity).
    bare_directive: ($) => field("name", $.directive_name),

    directive_name: (_$) => /#[A-Za-z]+/,

    // Plain bareword (alpha.water, p_rgh, List<vector>, symGaussSeidel),
    // or a call-like composite key/scheme token (div(phi,U), grad(U),
    // arbitrarily nested as in `div(((rho*nuEff)*dev2(T(grad(U)))))`).
    // The call form is a real recursive rule (not a single regex) so
    // nested parens balance correctly and a `)` closing an *enclosing*
    // list is never ambiguous with one belonging to the call.
    identifier: ($) => choice($._bare_word, $.call_key),

    _bare_word: (_$) => /[A-Za-z_][A-Za-z0-9_.:<>+\-]*/,

    // `div(phi,U)`, `grad(U)`, and arbitrarily-nested arithmetic-
    // expression scheme keys like `div(((rho*nuEff)*dev2(T(grad(U)))))`.
    // The opening `(` must be immediately adjacent (no whitespace) —
    // otherwise `phases          (water air);` (a plain key followed by
    // a separate parenthesized list value) would wrongly merge into a
    // single call-key with no value.
    call_key: ($) =>
      prec(1, seq($._bare_word, token.immediate("("), repeat($._call_arg), ")")),

    paren_group: ($) => seq("(", repeat($._call_arg), ")"),

    // `.` is included standalone to support member-call chains like
    // `grad(U).T()` (call_key "grad(U)", literal ".", call_key "T()").
    _call_arg: ($) =>
      choice($.call_key, $.paren_group, $._bare_word, $.number, $.operator, ",", "."),

    operator: (_$) => /[*/+\-|]/,

    // `1`, `-2.5e-3`, `+1`, `-.01`.
    number: (_$) => /[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?/,

    // `$name`, negated `-$name`, scoped `$/a/b`, `$../a`, `$:a.b`, `$name-SIMPLE`, and braced
    // `${name}`, `${../../master/patchFields}`, `${_${FOAM_EXECUTABLE}}`
    // (one level of nesting).
    dollar_reference: (_$) =>
      token(
        choice(
          /-?\$[A-Za-z_./:~][A-Za-z0-9_.:\/\-]*/,
          /-?\$\{([^{}]|\{[^{}]*\})*\}/,
        ),
      ),

    string: (_$) => /"([^"\\]|\\.)*"/,

    line_comment: (_$) => /\/\/[^\n]*/,

    block_comment: (_$) => /\/\*([^*]|\*+[^*/])*\*+\//,
  },
});
