---
name: colorito
description: >-
  Render an answer as colored, formatted terminal output instead of plain text. Use when the
  user asks to "make that pretty", "colorize that", "show that with colors", "render that
  nicely", or invokes /colorito — and when a dense answer (a comparison, a risk breakdown, a
  status summary, a table of findings) would read faster with color carrying the meaning.
  Never apply this automatically to ordinary replies; it is opt-in per response.
---

# colorito

Claude Code renders assistant text as markdown, which gives bold and italic but no color
control. This skill routes the answer through a renderer instead: you write **Colorito
markup**, pipe it to `colorito.mjs`, and the ANSI-colored result appears as command output
in the user's terminal.

## When to use it

Only when asked, or when the user has said they want a stretch of work rendered this way.
Good fits: risk breakdowns, before/after comparisons, checklists with pass/fail, tables of
findings, anything where a reader needs to spot the important line at a glance.

Bad fits: short answers, code-heavy answers (a fenced block already gets syntax highlighting
in the normal renderer), and anything the user will copy-paste elsewhere — escape codes
travel with the copied text.

## How to render

Pipe markup into the renderer with a heredoc. The `'CO'` must be quoted so the shell leaves
`$`, backticks, and braces alone.

```bash
node "<skill-directory>/colorito.mjs" <<'CO'
# Title
Body with {ok:one} colored span.
CO
```

Substitute the base directory announced when this skill loaded. Options: `--width <n>` to
force a wrap width, `--no-color` for plain text, `--demo` to print a sample document.

Two things to know before you use it:

- The markup is visible to the user once as the command, then again rendered. Keep it
  compact — sprawling markup makes for an ugly tool call above a pretty result.
- Don't restate the rendered content in your reply afterward. The output *is* the answer.
  Add at most a sentence that the rendered version doesn't already carry.

## The markup

Plain markdown works: `#`/`##`/`###` headings, `-` and `1.` lists, `**bold**`, `*italic*`,
`` `code` ``, `~~strike~~`, `> quotes`, `---` rules, pipe tables, and fenced code blocks.
A ` ```diff ` fence colors `+` lines green and `-` lines red.

On top of that, spans: `{style:text}`.

| Span | Use it for |
| --- | --- |
| `{ok:...}` | passing, safe, done, the good branch |
| `{warn:...}` | needs attention, risky but not broken |
| `{bad:...}` | failing, dangerous, the thing to fix |
| `{info:...}` `{note:...}` | neutral asides |
| `{muted:...}` | de-emphasis, counts, timestamps |
| `{accent:...}` | the one phrase the eye should land on |
| `{key:...}` `{path:...}` `{cmd:...}` `{num:...}` `{str:...}` | identifiers, file paths, commands, numbers, literals |

Prefer these semantic names over raw colors (`red`, `green`, `cyan`, `orange`, `purple`,
`sky`, `gold`, `lime`, `teal`, `pink`, `gray`…), which also work but don't restyle with the
theme. Combine with dots — `{bold.red:critical}`, `{under.cyan:linked}`, `{dim:aside}` — and
nest freely: `{warn:mostly fine, {bad:except this}}`.

Callout blocks:

```
:::warn Secrets in env vars
Anyone with {cmd:lambda:GetFunctionConfiguration} reads them in {bad:plaintext}.
:::
```

Types: `warn`, `bad`, `ok`, `info`, `note`, `tip`, `key`. The title is optional; omit it and
the type's default label is used.

Only real style names are treated as spans, so shell syntax survives verbatim —
`${ssm:/prod/key}` and `${VAR:-default}` need no escaping. Use `\{` to force a literal
brace where you do want one.

## Restraint

This is the part that matters. Color is a signal, and signal only works if it's scarce.

1. **Color must mean something.** If a span could be any color without changing the reader's
   understanding, leave it plain.
2. **Three colors per document, plus muted.** A fourth hue almost always means the semantic
   distinctions have gone fuzzy.
3. **Color words, not sentences.** Wrapping a whole paragraph in `{warn:...}` conveys nothing
   and makes the text harder to read. Wrap the noun that's at risk.
4. **Most lines stay plain.** If more than roughly a quarter of the visible text is colored,
   nothing stands out. Plain text is the background that makes color legible.
5. **Structure before color.** A heading, a table, or a list often does the work you were
   about to do with a hue. Reach for color once the structure is right.
6. **Never color for decoration.** No rainbow headings, no alternating hues, no coloring
   something just because it's been a while since the last color.

The failure mode to avoid is a document where everything is colored, which reads exactly like
a document where nothing is.
