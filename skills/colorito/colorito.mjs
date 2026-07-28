#!/usr/bin/env node
// colorito — renders Colorito markup (markdown + semantic color spans) to ANSI.
// Zero dependencies. Reads a file argument or stdin, writes to stdout.

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------- palette ---

// 256-color indices. Chosen to stay legible on both dark and light terminals,
// and to survive tmux, which is where this usually runs.
const COLORS = {
  red: 203, green: 114, yellow: 221, orange: 215, blue: 75,
  cyan: 80, teal: 73, purple: 141, magenta: 176, pink: 211,
  lime: 149, gold: 178, sky: 111, rose: 168,
  gray: 245, grey: 245, dimgray: 240, white: 253, black: 235,
};

const MODIFIERS = {
  bold: 1, dim: 2, italic: 3, under: 4, underline: 4, inv: 7, strike: 9,
};

// Semantic names are what the model should reach for. Remapping a semantic
// name here restyles every document at once; raw color names don't get that.
const SEMANTIC = {
  ok: ['green'], good: ['green'], pass: ['green'],
  warn: ['orange'], caution: ['orange'],
  bad: ['red'], err: ['red'], error: ['red'], fail: ['red'],
  info: ['sky'], note: ['cyan'],
  muted: ['gray'], subtle: ['dimgray'],
  accent: ['purple'], key: ['cyan'], val: ['white'],
  num: ['gold'], str: ['lime'], path: ['teal'], cmd: ['cyan'],
  new: ['green'], old: ['red'],
};

const THEME = {
  h1: ['bold', 'purple'],
  h2: ['bold', 'sky'],
  h3: ['bold', 'gray'],
  rule: ['dimgray'],
  bullet: ['purple'],
  index: ['gold'],
  code: ['cyan'],
  codeblock: ['gray'],
  fenceLabel: ['dimgray'],
  quoteBar: ['dimgray'],
  quoteText: ['gray', 'italic'],
  link: ['sky', 'underline'],
  linkUrl: ['dimgray'],
  tableHead: ['bold', 'purple'],
  tableRule: ['dimgray'],
};

const CALLOUTS = {
  warn: { color: 'orange', label: 'WARNING' },
  bad: { color: 'red', label: 'ERROR' },
  err: { color: 'red', label: 'ERROR' },
  ok: { color: 'green', label: 'OK' },
  info: { color: 'sky', label: 'NOTE' },
  note: { color: 'cyan', label: 'NOTE' },
  tip: { color: 'lime', label: 'TIP' },
  key: { color: 'purple', label: 'KEY' },
};

// ------------------------------------------------------------------ args ---

function parseArgs(argv) {
  const opts = { file: null, width: null, color: true, demo: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-color') opts.color = false;
    else if (a === '--demo') opts.demo = true;
    else if (a === '--width') opts.width = parseInt(argv[++i], 10);
    else if (a.startsWith('--width=')) opts.width = parseInt(a.slice(8), 10);
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (!a.startsWith('-')) opts.file = a;
  }
  return opts;
}

const HELP = `colorito — render Colorito markup to ANSI

  colorito <file.co>
  colorito < file.co
  colorito --demo

Options:
  --width <n>   wrap width (default: terminal width, capped at 100)
  --no-color    plain text output
  --demo        print a demo document
`;

// Color is forced ON by default even without a TTY: output is captured by the
// host and replayed into a terminal, so isatty() would guess wrong here.
// NO_COLOR is still honored — https://no-color.org
const opts = parseArgs(process.argv.slice(2));
const useColor = opts.color && !process.env.NO_COLOR;
const WIDTH = Math.max(20, opts.width || Math.min(process.stdout.columns || 90, 100));

// ------------------------------------------------------------------ style ---

function codesFor(names) {
  const out = [];
  const seen = new Set();
  const walk = (list, depth) => {
    if (depth > 4) return;
    for (const raw of list) {
      const name = raw.toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      if (MODIFIERS[name] !== undefined) out.push(MODIFIERS[name]);
      else if (COLORS[name] !== undefined) out.push(`38;5;${COLORS[name]}`);
      else if (SEMANTIC[name]) walk(SEMANTIC[name], depth + 1);
    }
  };
  walk(names, 0);
  return out;
}

function paint(text, styles) {
  if (!useColor || !styles || styles.length === 0 || text === '') return text;
  const codes = codesFor(styles);
  if (codes.length === 0) return text;
  return `\x1b[${codes.join(';')}m${text}\x1b[0m`;
}

// ---------------------------------------------------------- inline parser ---

// Produces a flat list of { text, styles } runs. Keeping styles as names rather
// than escape codes lets the wrapper split runs without breaking sequences.

const SPAN_OPEN = /^\{([a-zA-Z][\w.]*):/;

function findClose(s, from) {
  let depth = 1;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function parseInline(s, styles = []) {
  const runs = [];
  let buf = '';
  const flush = () => {
    if (buf) { runs.push({ text: buf, styles: styles.slice() }); buf = ''; }
  };
  const nest = (inner, extra) => {
    flush();
    runs.push(...parseInline(inner, styles.concat(extra)));
  };

  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);

    if (s[i] === '\\' && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }

    const span = SPAN_OPEN.exec(rest);
    if (span) {
      const start = i + span[0].length;
      const close = findClose(s, start);
      if (close !== -1) {
        nest(s.slice(start, close), span[1].split('.'));
        i = close + 1;
        continue;
      }
    }

    // Code spans are opaque: no markup is interpreted inside them.
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        runs.push({ text: s.slice(i + 1, end), styles: styles.concat(THEME.code) });
        i = end + 1;
        continue;
      }
    }

    let paired = false;
    for (const [mark, extra] of [['**', ['bold']], ['~~', ['strike']]]) {
      if (!rest.startsWith(mark)) continue;
      const end = s.indexOf(mark, i + 2);
      if (end !== -1) {
        nest(s.slice(i + 2, end), extra);
        i = end + 2;
      } else {
        buf += s[i++]; // unterminated marker — emit it literally
      }
      paired = true;
      break;
    }
    if (paired) continue;

    if (s[i] === '*' && s[i + 1] !== '*') {
      const end = s.indexOf('*', i + 1);
      if (end !== -1 && end > i + 1) {
        nest(s.slice(i + 1, end), ['italic']);
        i = end + 1;
        continue;
      }
    }

    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (link) {
      nest(link[1], THEME.link);
      runs.push({ text: ` ${link[2]}`, styles: styles.concat(THEME.linkUrl) });
      i += link[0].length;
      continue;
    }

    buf += s[i++];
  }
  flush();
  return runs;
}

// -------------------------------------------------------------- wrapping ---

function runsWidth(runs) {
  return runs.reduce((n, r) => n + r.text.length, 0);
}

function wrapRuns(runs, width) {
  const lines = [[]];
  let len = 0;
  const push = (text, styles) => { lines[lines.length - 1].push({ text, styles }); len += text.length; };
  const newline = () => { lines.push([]); len = 0; };

  for (const run of runs) {
    for (const part of run.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (len === 0) continue;            // never start a line with padding
        if (len + part.length > width) { newline(); continue; }
        push(part, run.styles);
        continue;
      }
      if (len + part.length > width && len > 0) newline();
      // Hard-break words longer than the line (URLs, hashes). `take` must be
      // captured before push(), which mutates len.
      let word = part;
      while (word.length > width - len) {
        const take = width - len;
        if (take <= 0) { newline(); continue; }
        push(word.slice(0, take), run.styles);
        word = word.slice(take);
        newline();
      }
      push(word, run.styles);
    }
  }
  return lines;
}

// Word-splitting during wrapping leaves many adjacent runs sharing one style.
// Coalescing them before painting keeps the escape sequences to one per span.
function renderLine(runs) {
  const merged = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.key === String(run.styles)) prev.text += run.text;
    else merged.push({ text: run.text, styles: run.styles, key: String(run.styles) });
  }
  return merged.map((r) => paint(r.text, r.styles)).join('');
}

// Emits one wrapped block with an optional decorated first-line prefix and a
// hanging indent for continuation lines.
function emitWrapped(out, runs, { prefix = '', hang = '', width }) {
  const lines = wrapRuns(runs, width);
  lines.forEach((line, idx) => {
    const lead = idx === 0 ? prefix : hang;
    const body = renderLine(line);
    out.push(body ? lead + body : lead.trimEnd());
  });
}

// --------------------------------------------------------- block renderer ---

const FENCE = /^```(\S*)\s*$/;
const CALLOUT_OPEN = /^:::(\w+)\s*(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const RULE = /^(---+|\*\*\*+)\s*$/;
const LIST = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;

function render(src, width = WIDTH) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      if (out.length && out[out.length - 1] !== '') out.push('');
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) { i = renderFence(lines, i, fence[1], out, width); continue; }

    const callout = CALLOUT_OPEN.exec(line);
    if (callout && CALLOUTS[callout[1]]) { i = renderCallout(lines, i, callout, out, width); continue; }

    const heading = HEADING.exec(line);
    if (heading) { renderHeading(heading, out, width); i++; continue; }

    if (RULE.test(line)) {
      out.push(paint('─'.repeat(width), THEME.rule));
      i++;
      continue;
    }

    if (TABLE_ROW.test(line)) { i = renderTable(lines, i, out, width); continue; }

    if (QUOTE.test(line)) { i = renderQuote(lines, i, out, width); continue; }

    const list = LIST.exec(line);
    if (list) { renderListItem(list, out, width); i++; continue; }

    // Paragraph: absorb following non-blank, non-structural lines.
    const para = [line.trim()];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== ''
           && !FENCE.test(lines[j]) && !HEADING.test(lines[j]) && !RULE.test(lines[j])
           && !LIST.test(lines[j]) && !QUOTE.test(lines[j]) && !TABLE_ROW.test(lines[j])
           && !CALLOUT_OPEN.test(lines[j])) {
      para.push(lines[j].trim());
      j++;
    }
    emitWrapped(out, parseInline(para.join(' ')), { width });
    i = j;
  }

  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function renderHeading(m, out, width) {
  const level = m[1].length;
  const style = THEME[`h${level}`];
  if (out.length && out[out.length - 1] !== '') out.push('');
  const runs = parseInline(m[2]).map((r) => ({ text: r.text, styles: style.concat(r.styles) }));
  emitWrapped(out, runs, { width });
  if (level === 1) out.push(paint('─'.repeat(Math.min(width, Math.max(12, runsWidth(runs)))), THEME.rule));
}

function renderListItem(m, out, width) {
  const depth = Math.floor(m[1].length / 2);
  const indent = '  '.repeat(depth);
  const ordered = /\d/.test(m[2]);
  const marker = ordered ? m[2] : '•';
  const prefix = indent + paint(marker, ordered ? THEME.index : THEME.bullet) + ' ';
  const hang = indent + ' '.repeat(marker.length + 1);
  emitWrapped(out, parseInline(m[3]), { prefix, hang, width: width - hang.length });
}

function renderQuote(lines, i, out, width) {
  const body = [];
  while (i < lines.length && QUOTE.test(lines[i])) {
    body.push(QUOTE.exec(lines[i])[1]);
    i++;
  }
  const bar = paint('│ ', THEME.quoteBar);
  const runs = parseInline(body.join(' ')).map((r) => ({ text: r.text, styles: THEME.quoteText.concat(r.styles) }));
  emitWrapped(out, runs, { prefix: bar, hang: bar, width: width - 2 });
  return i;
}

function renderFence(lines, i, lang, out, width) {
  i++;
  const body = [];
  while (i < lines.length && !FENCE.test(lines[i])) { body.push(lines[i]); i++; }
  if (i < lines.length) i++; // closing fence

  if (lang) out.push('  ' + paint(lang, THEME.fenceLabel));
  for (const raw of body) {
    let styles = THEME.codeblock;
    if (lang === 'diff') {
      if (raw.startsWith('+')) styles = ['green'];
      else if (raw.startsWith('-')) styles = ['red'];
      else if (raw.startsWith('@')) styles = ['cyan'];
    }
    out.push('  ' + paint(raw.slice(0, width - 2), styles));
  }
  return i;
}

function renderCallout(lines, i, m, out, width) {
  const spec = CALLOUTS[m[1]];
  const title = m[2].trim() || spec.label;
  i++;
  const body = [];
  while (i < lines.length && lines[i].trim() !== ':::') { body.push(lines[i]); i++; }
  if (i < lines.length) i++; // closing :::

  if (out.length && out[out.length - 1] !== '') out.push('');
  const bar = paint('▌', [spec.color]);
  out.push(bar + ' ' + paint(title, ['bold', spec.color]));
  const inner = render(body.join('\n'), width - 2);
  for (const line of inner.split('\n')) out.push(bar + ' ' + line);
  out.push('');
  return i;
}

function splitRow(line) {
  return TABLE_ROW.exec(line)[1].split('|').map((c) => c.trim());
}

function renderTable(lines, i, out, width) {
  const rows = [];
  while (i < lines.length && TABLE_ROW.test(lines[i])) {
    if (!TABLE_SEP.test(lines[i])) rows.push(splitRow(lines[i]));
    i++;
  }
  if (rows.length === 0) return i;

  const cols = Math.max(...rows.map((r) => r.length));
  const parsed = rows.map((r) => Array.from({ length: cols }, (_, c) => parseInline(r[c] ?? '')));
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(...parsed.map((r) => runsWidth(r[c]))));

  // Shrink proportionally if the table would overflow the terminal.
  const total = widths.reduce((a, b) => a + b, 0) + (cols - 1) * 3;
  if (total > width) {
    const scale = (width - (cols - 1) * 3) / widths.reduce((a, b) => a + b, 0);
    for (let c = 0; c < cols; c++) widths[c] = Math.max(3, Math.floor(widths[c] * scale));
  }

  parsed.forEach((row, r) => {
    const cells = row.map((runs, c) => {
      const styled = r === 0
        ? runs.map((x) => ({ text: x.text, styles: THEME.tableHead.concat(x.styles) }))
        : runs;
      const clipped = [];
      let used = 0;
      for (const run of styled) {
        if (used >= widths[c]) break;
        const text = run.text.slice(0, widths[c] - used);
        clipped.push({ text, styles: run.styles });
        used += text.length;
      }
      return renderLine(clipped) + ' '.repeat(Math.max(0, widths[c] - used));
    });
    out.push(cells.join(paint(' │ ', THEME.tableRule)).trimEnd());
    if (r === 0) out.push(paint(widths.map((w) => '─'.repeat(w)).join('─┼─'), THEME.tableRule));
  });
  return i;
}

// ------------------------------------------------------------------- main ---

const DEMO = `# colorito

Renders {accent:semantic color spans} on top of plain markdown, so a terminal
answer can carry {ok:emphasis} without carrying {muted:noise}.

## Inline vocabulary

- {ok:ok} {warn:warn} {bad:bad} {info:info} {note:note} {muted:muted} {accent:accent}
- Nest and combine: {bold.red:critical}, {under.cyan:linked}, {dim:whispered}
- Markdown still works: **bold**, *italic*, \`inline code\`, ~~struck~~

:::warn Secrets in env vars
Anyone with {cmd:lambda:GetFunctionConfiguration} reads them in {bad:plaintext}.
:::

## A table

| Key | Kind | Risk |
| --- | --- | --- |
| MONGO_URI | {bad:secret} | rotate rarely |
| sendOrSkipSms | {ok:flag} | flipped often |

\`\`\`diff
+ moved 10 flags into version control
- CONFIG_PROD_JSON as one blob
\`\`\`

> Only 7 of 17 keys are actually secrets.
`;

function main() {
  if (opts.help) { process.stdout.write(HELP); return; }
  let src;
  if (opts.demo) src = DEMO;
  else if (opts.file) src = readFileSync(opts.file, 'utf8');
  else src = readFileSync(0, 'utf8');
  process.stdout.write(render(src) + '\n');
}

main();
