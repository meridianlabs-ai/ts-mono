# Scanner view glob matching

`ViewerConfig.scanner_result_view` maps scanner-name patterns to sidebar
configuration. A bare view is equivalent to a `"*"` entry.

Patterns match the entire name, case-sensitively:

| Syntax | Meaning |
| --- | --- |
| `*` | Zero or more characters |
| `?` | One UTF-16 code unit |
| `[abc]`, `[a-z]` | One listed character or character in the inclusive range |
| `[!abc]`, `[^abc]` | One character outside the class |
| `\*`, `\?`, `\[` | Literal escaped punctuation (escape the backslash again in JSON) |

A closing bracket first in a class is literal (`[]a]` matches `]` or `a`).
An unmatched opening bracket is literal. A trailing backslash is literal.
Dots and slashes are ordinary scanner-name characters; `**` is equivalent to
`*`. Parentheses, pipes, braces, and leading exclamation marks are literal.
There is no regex grouping, extglob, brace expansion, or path globstar syntax.

The most specific matching pattern supplies fields, with insertion order
breaking ties. Specificity counts characters other than `*` and `?`, as before.
Exclusions are unioned across every matching pattern.

Matching is iterative and bounded across the entire configuration: at most
1,024 patterns, 4,096 UTF-16 code units per pattern/name, and 4,000,000 units
of parsing/matching work. Character-class scanning is included in the work
budget. Exceeding a limit throws a descriptive error for the application's
error boundary; no partial field or exclusion configuration is applied.

This replaces picomatch's filesystem/regex interpretation. Existing ordinary
exact names, `*`, `?`, character ranges, and escaped wildcards retain their
meaning. Deliberate changes: wildcards now include leading dots and slashes,
parenthesized alternatives are literal, bracket classes follow the syntax
above rather than picomatch's optional literal-bracket/POSIX-class behavior,
and a pattern or name may be empty. These rules follow scanner-name glob
semantics rather than filesystem paths.
