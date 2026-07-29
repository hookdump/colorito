---
name: colorito
description: >-
  Render an answer as a styled HTML page and open it in the browser, with color assigned to
  concepts rather than to emphasis. Use when the user asks to "make that pretty", "colorize
  that", "render that nicely", "turn that into a page", or invokes /colorito — and for dense
  material (audits, comparisons, risk breakdowns, research notes) where one idea recurs
  across many paragraphs and the reader needs to track it. Opt-in per response; never apply
  it to ordinary replies.
---

# colorito

Writes Colorito markup to a self-contained HTML page and opens it in the browser.

```bash
node "<skill-directory>/colorito.mjs" --open <<'CO'
@risk: risk, exposure, blast radius
# Title
Body prose. Every mention of risk is tinted, everywhere, automatically.
CO
```

Use the base directory announced when this skill loaded. The `'CO'` must be quoted so the
shell leaves `$`, backticks and braces alone. The command prints the file path; the page
opens on its own. Options: `--out <path>`, `--title <text>`, `--demo`.

After rendering, **say almost nothing**. The page is the answer. One sentence at most —
something the page doesn't already carry. Never summarize what you just rendered.

## Concept coloring — the whole point

Most tools color *emphasis*: red for bad, green for good, bold for important. That decays
fast, because emphasis is subjective and every writer applies it differently on every
paragraph.

colorito colors *concepts* instead. You declare the two to four ideas a document is actually
about, along with the words that refer to each one. Every mention of those words is then
tinted the same hue, everywhere on the page, with no further markup. The reader learns the
mapping once from the legend and can then track an idea across ten paragraphs at a glance —
which sections discuss it, where two concepts collide, which one dominates the argument.

```
@secrets: secret, secrets, plaintext, credentials, MONGO_URI
@flags: flag, flags, feature flag, sendOrSkipSms
```

Syntax is `@name: word, word, word`, one per line at the top of the document. The concept's
own name is automatically part of its vocabulary — no need to repeat it. Colors are assigned
from a curated palette in declaration order, so **never pick colors yourself**; the palette
is designed to stay distinguishable and legible in both light and dark themes. Pin one only
if you have a real reason: `@secrets rose: ...` (`azure`, `rose`, `teal`, `amber`, `violet`,
`lime`, `orange`, `cyan`).

Matching is case-insensitive and whole-word. Longer phrases win over shorter ones, so
`access key` beats `key`. Code spans, fenced blocks, headings and URLs are never highlighted
— tinting an identifier inside code adds noise rather than signal.

### Concept blocks

When a whole passage is about one concept, wrap it — it gets a tinted background and a
colored edge in that concept's hue, which makes the page's structure visible while scrolling.

```
:::secrets Where they actually live
Anyone with `lambda:GetFunctionConfiguration` reads them in plaintext.
:::
```

The title is optional. `:::name` with an undeclared name renders as a neutral card, which is
a fine way to set a passage apart without claiming it belongs to a concept.

### Choosing concepts well

This is the judgment the skill exists for. Get it wrong and the page is confetti.

1. **Concepts are the nouns the document is about** — the recurring subjects, systems,
   actors, or forces in tension. Not "important" and "warning". If you can't name it as a
   thing, it isn't a concept.
2. **Two to four. Never more.** A fifth hue means the distinctions have gone fuzzy and the
   legend stops being learnable. Two is often better than four.
3. **Earn it with recurrence.** A concept must appear across multiple paragraphs. Something
   mentioned once gets no color; it isn't a thread the reader needs to follow.
4. **Prefer tension.** Color is most useful when concepts interact — old system vs. new,
   cost vs. benefit, what's secret vs. what merely looks it. A page where each concept sits
   in its own section barely needs color at all.
5. **Vocabulary means synonyms, not variants.** List the different words the document uses
   for one idea, including identifiers and shorthand. Plurals and inflections need listing
   only when they differ (`is`/`are` won't match from `be`).
6. **Watch for greedy words.** Avoid vocabulary so common it hits every other line — `data`,
   `code`, `system`, `time`. Highlighting that appears constantly reads as decoration, and
   it drowns the concepts that matter.

The failure mode is a page where most words are tinted: it reads exactly like a page where
none are, and it costs the reader more to scan.

## Markup

Plain markdown: `#`/`##`/`###` headings, `-` and `1.` lists (nestable by two-space indent),
`**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `> blockquote`, `---` rules, pipe tables,
fenced code blocks with a language tag, and `[links](url)`. The first `#` heading becomes the
page title and is not repeated in the body.

Structure carries at least as much as color. A table, a heading, or a list frequently does
the job you were about to do with a hue — reach for color once the structure is right.

## When not to use it

- Short answers. A page is heavier than the content justifies.
- Code-heavy answers — nothing gets highlighted inside code anyway.
- Anything the user wants to copy into a terminal, a commit message, or a chat.
- Material with no recurring concepts. Without threads to trace, this is just a stylesheet.
