# Changelog

## 0.1.1

- Fix an infinite loop in the lexer when a label contains `//` (for example a URL such as `http://example.com`, or an inline comment).
- Fix an infinite loop in style-block parsing when a `{...}` block contains a nested `{` or any unexpected token.
- Comment rule: `//` starts a comment only at the beginning of a line or after whitespace. `//` inside a token (for example `http://example.com` or `a//b`) stays part of the label. Tokenizer and parser loops that make no progress now advance or throw a bounded parse error.

