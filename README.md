# colorito

Colored terminal output for Claude Code answers, on demand.

Claude Code renders assistant text as markdown. That gives you bold, italic, and inline
code — but no control over color. Long analytical answers come out as an undifferentiated
wall of grey, where the one line that matters looks exactly like the forty that don't.

colorito is two pieces that solve that together:

1. **A markup language** — plain markdown plus semantic color spans, `{warn:like this}`.
2. **A renderer** — a zero-dependency Node script that turns the markup into ANSI and
   prints it, so the color arrives as *command output* rather than as assistant text.

Wrapped in a skill, so it only happens when you ask for it.

```
                         ┌──────────────────────────┐
you: "make that pretty"  │  # Findings              │
        │                │  {bad:3 blockers} found  │  markup Claude writes
        ▼                └────────────┬─────────────┘
   skill loads                        │ heredoc
                                      ▼
                            colorito.mjs ──▶ ANSI ──▶ your terminal
```

## Why not just emit ANSI directly?

Because assistant text goes through a markdown renderer that Claude doesn't control, and
escape codes in that text are not reliably passed through to the terminal. Command output
is. Routing through a script makes the behavior predictable instead of hopeful, and it
gives you a real color vocabulary — 18 hues, modifiers, callouts, tables — rather than the
four or five constructs the markdown theme happens to colorize.

## Install

As a skill (recommended):

```bash
npx skills add hookdump/colorito@colorito
```

Or drop `skills/colorito/` into `~/.claude/skills/`. Then just ask:

> make that pretty

As a plain CLI, no Claude involved:

```bash
npx colorito file.co
echo '{ok:hello}' | npx colorito
npx colorito --demo
```

## The markup

All of markdown you'd expect — headings, lists, `**bold**`, `` `code` ``, `> quotes`,
tables, `---` rules, fenced blocks (with `diff` fences colored red/green) — plus spans:

```
{ok:passing}  {warn:needs attention}  {bad:broken}
{info:aside}  {muted:de-emphasized}   {accent:look here}
{key:IDENT}   {path:src/app.js}       {cmd:npm test}   {num:17}

{bold.red:combined}   {warn:nested {bad:spans} work}
```

Semantic names (`ok`, `warn`, `bad`, `info`, `note`, `muted`, `accent`, `key`, `path`,
`cmd`, `num`, `str`) are preferred — restyling one name restyles every document. Raw color
names work too: `red`, `green`, `yellow`, `orange`, `blue`, `cyan`, `teal`, `purple`,
`magenta`, `pink`, `lime`, `gold`, `sky`, `rose`, `gray`, `white`. Modifiers: `bold`,
`dim`, `italic`, `under`, `inv`, `strike`.

Callout blocks:

```
:::warn Secrets in env vars
Anyone with {cmd:lambda:GetFunctionConfiguration} reads them in {bad:plaintext}.
:::
```

Types: `warn`, `bad`, `ok`, `info`, `note`, `tip`, `key`.

Escape a literal brace with `\{`. Unknown style names degrade to plain text rather than
erroring. Unterminated spans are printed literally.

## Options

| Flag | Effect |
| --- | --- |
| `--width <n>` | Wrap width. Default: terminal width, capped at 100 |
| `--no-color` | Plain text, structure preserved |
| `--demo` | Print a sample document |

`NO_COLOR=1` is honored ([no-color.org](https://no-color.org)). Color is otherwise forced
**on** even without a TTY, because the output is captured by the agent host and replayed
into a terminal — `isatty()` guesses wrong in exactly this situation.

## On restraint

The skill spends more words on when *not* to use color than on syntax, and that's
deliberate. Color is a signal; signal only works when it's scarce. The rules it enforces:
color must change what the reader understands, three hues per document, color words rather
than sentences, most lines stay plain, structure before color.

A document where everything is colored reads exactly like a document where nothing is.

## Limitations

- Rendered output contains escape codes, so copy-paste carries them along.
- Width is measured in code points; wide CJK glyphs and emoji may wrap a column early.
- The markup is visible once as the command that produced it, then again rendered.
- 256-color palette, chosen to survive tmux and to stay legible on light and dark themes.

## Development

```bash
npm test        # 18 subprocess tests, no dependencies
npm run demo
```

## License

MIT
