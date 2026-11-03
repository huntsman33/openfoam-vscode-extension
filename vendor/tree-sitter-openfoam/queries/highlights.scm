(line_comment) @comment
(block_comment) @comment
(string) @string
(number) @number
(dollar_reference) @variable
(directive_name) @keyword.directive
["#include" "#sinclude" "#includeIfPresent" "#includeEtc" "#includeFunc" "#remove"
 "#eval" "#calc" "#codeStream"] @keyword.directive
(function_spec) @function
(expression_body) @embedded
(verbatim) @embedded
(inline_expression) @embedded
(dimension_term) @number
(block name: (identifier) @type)
(entry key: (identifier) @property)
