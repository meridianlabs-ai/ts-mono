# Scanner view glob matching

`ViewerConfig.scanner_result_view` maps scanner-name patterns to sidebar
configuration. A bare view is equivalent to a `"*"` entry.

Patterns match the entire name, case-sensitively. The matcher preserves the
existing picomatch path and leading-dot rules, even though the inputs are
scanner names:

| Syntax | Meaning |
| --- | --- |
| `*` | Zero or more characters within a slash-delimited segment |
| `?` | One UTF-16 code unit other than `/` |
| `**` as a whole segment | Zero or more segments, including their separators |
| `[abc]`, `[a-z]` | One listed character or character in the inclusive range |
| `[^abc]` | One character outside the class, excluding `/` |
| `[!abc]` | One of `!`, `a`, `b`, or `c` (picomatch's default, not shell negation) |
| `\*`, `\?`, `\[` | Literal escaped punctuation (escape the backslash again in JSON) |

At the start of a segment, `*` and `?` do not match a leading dot; `**` also
skips hidden segments. An explicit dot or character class can match one.
Stars embedded within a segment, such as `audit_**`, behave like `*`.

Examples retained from the previous implementation:

- `*` matches `scanner`, but not `package/scanner` or `.scanner`.
- `package/*` matches `package/scanner`, but not `package/nested/scanner`.
- `**/scanner` matches both `scanner` and `package/scanner`.
- `package/**/scanner` matches `package/scanner` and
  `package/nested/scanner`, but not `package/.hidden/scanner`.
- `package/**` also matches `package`; `*/**` requires a slash.
- `package/*` accepts an optional trailing slash, as before.

The most specific matching pattern supplies fields, with insertion order
breaking ties. Specificity counts characters other than `*` and `?`, as before.
Exclusions are unioned across every matching pattern. Unmatched names keep
the default display, including when the configuration uses the bare shorthand.

Matching is iterative and bounded across all patterns in a single scanner-view
resolution: at most 1,024 patterns, 4,096 UTF-16 code units per pattern/name,
and 4,000,000 units of parsing/matching work. Character-class scanning and
globstar traversal share the same budget. Exceeding a limit throws a descriptive
error for the application's error boundary; no partial field or exclusion
configuration is applied. Empty patterns are rejected and empty names do not
match, as before.

## Compatibility boundaries

This is a bounded replacement for the existing matcher, not a new scanner-name
pattern language. Tests cover 3,712 ordinary name/pattern pairs against fixed
expectations captured from picomatch 4.0.7 with the previous options (`nobrace`,
`nonegate`, and `noextglob`). These fixtures preserve the verified compatibility
baseline without retaining a direct picomatch dependency in production or tests.

Some less common picomatch behavior is intentionally not reproduced:

- Parenthesized regex alternatives such as `(a|b)` are literal. Braces and
  leading exclamation marks remain literal under the previous options.
- Character classes do not additionally match their literal bracketed spelling
  inside a larger wildcard expression, and POSIX classes are not supported.
  An exact pattern/name equality still matches, including literal brackets.
- Classes cannot consume a slash. A leading `]` in a class is treated as a
  member; malformed classes and reversed ranges may differ from picomatch.
- Picomatch's parser-specific edge cases for empty path segments, `.`/`..`,
  and optional trailing slashes are not fully reproduced.

An unmatched opening bracket and a trailing backslash are literal. New syntax
should not be added without retaining the work bound and extending compatibility
and adversarial tests.
