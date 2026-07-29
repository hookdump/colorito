#!/usr/bin/env node
// colorito — renders Colorito markup to a self-contained HTML page.
// Zero dependencies. Reads a file argument or stdin, writes HTML, opens it.
//
// The distinguishing feature is concept coloring: you declare a concept once
// with its vocabulary, and every mention of that vocabulary is tinted the same
// hue throughout the document. Color tracks meaning rather than decorating.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------- palette ---

// Hues only. Foreground, background and border are derived per scheme below, so
// a concept stays legible in light and dark without being defined twice.
// Ordered by how well they separate from each other at a glance.
const HUES = [
  { name: 'azure', h: 212 },
  { name: 'rose', h: 348 },
  { name: 'teal', h: 172 },
  { name: 'amber', h: 36 },
  { name: 'violet', h: 274 },
  { name: 'lime', h: 96 },
  { name: 'orange', h: 18 },
  { name: 'cyan', h: 194 },
];

const HUE_BY_NAME = new Map(HUES.map((x) => [x.name, x.h]));

// ------------------------------------------------------------------ args ---

const HELP = `colorito — render Colorito markup to a styled HTML page

  colorito <file.co> [--open]
  colorito < file.co --open
  colorito --demo --open

Options:
  --open          open the rendered page in the default browser
  --out <path>    write here instead of a temp file
  --title <text>  page title (default: first heading)
  --demo          render a demo document
`;

function parseArgs(argv) {
  const o = { file: null, out: null, title: null, open: false, demo: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--open') o.open = true;
    else if (a === '--demo') o.demo = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--title') o.title = argv[++i];
    else if (!a.startsWith('-')) o.file = a;
  }
  return o;
}

// --------------------------------------------------------------- concepts ---

// `@name: word, other word` — or `@name rose: word` to pin the hue.
const CONCEPT = /^@([\w-]+)(?:\s+([\w-]+))?\s*:\s*(.+)$/;

function extractConcepts(lines) {
  const concepts = [];
  const body = [];
  let taken = 0;

  for (const line of lines) {
    const m = CONCEPT.exec(line.trim());
    if (m) {
      const [, name, hueName, words] = m;
      const hue = hueName && HUE_BY_NAME.has(hueName)
        ? HUE_BY_NAME.get(hueName)
        : HUES[taken++ % HUES.length].h;
      concepts.push({
        id: name.toLowerCase().replace(/[^\w-]/g, ''),
        name,
        hue,
        // The concept's own name is always part of its vocabulary.
        words: [name, ...words.split(',').map((w) => w.trim())].filter(Boolean),
      });
    } else {
      body.push(line);
    }
  }
  return { concepts, body };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(concepts) {
  const map = new Map();
  const words = [];
  for (const c of concepts) {
    for (const w of c.words) {
      const key = w.toLowerCase();
      if (map.has(key)) continue; // first concept to claim a word keeps it
      map.set(key, c);
      words.push(w);
    }
  }
  if (words.length === 0) return { re: null, map };
  // Longest first so "access key" wins over "key".
  words.sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![\\w-])(?:${words.map(escapeRe).join('|')})(?![\\w-])`, 'gi');
  return { re, map };
}

// ---------------------------------------------------------------- inline ---

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Concept vocabulary is matched on prose only. Code spans, code blocks, URLs and
// headings are left alone — highlighting inside them adds noise, not signal.
function highlight(raw, ctx) {
  if (!ctx.re) return esc(raw);
  let out = '';
  let last = 0;
  ctx.re.lastIndex = 0;
  let m;
  while ((m = ctx.re.exec(raw)) !== null) {
    const concept = ctx.map.get(m[0].toLowerCase());
    out += esc(raw.slice(last, m.index));
    out += `<mark class="k k-${concept.id}">${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return out + esc(raw.slice(last));
}

function inline(s, ctx, { plain = false } = {}) {
  let out = '';
  let text = '';
  const flush = () => {
    if (!text) return;
    out += plain ? esc(text) : highlight(text, ctx);
    text = '';
  };

  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);

    if (s[i] === '\\' && i + 1 < s.length) { text += s[i + 1]; i += 2; continue; }

    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out += `<code>${esc(s.slice(i + 1, end))}</code>`;
        i = end + 1;
        continue;
      }
    }

    let handled = false;
    for (const [mark, tag] of [['**', 'strong'], ['~~', 'del']]) {
      if (!rest.startsWith(mark)) continue;
      const end = s.indexOf(mark, i + 2);
      if (end !== -1) {
        flush();
        out += `<${tag}>${inline(s.slice(i + 2, end), ctx, { plain })}</${tag}>`;
        i = end + 2;
      } else {
        text += s[i++];
      }
      handled = true;
      break;
    }
    if (handled) continue;

    if (s[i] === '*' && s[i + 1] !== '*') {
      const end = s.indexOf('*', i + 1);
      if (end > i + 1) {
        flush();
        out += `<em>${inline(s.slice(i + 1, end), ctx, { plain })}</em>`;
        i = end + 1;
        continue;
      }
    }

    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flush();
      out += `<a href="${esc(link[2])}" rel="noreferrer">${inline(link[1], ctx, { plain })}</a>`;
      i += link[0].length;
      continue;
    }

    text += s[i++];
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- blocks ---

const FENCE = /^```(\S*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const RULE = /^(---+|\*\*\*+)\s*$/;
const LIST = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const BLOCK_OPEN = /^:::\s*([\w-]+)\s*(.*)$/;
const BLOCK_CLOSE = /^:::\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;

function parseList(lines, i) {
  const first = LIST.exec(lines[i]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];

  while (i < lines.length) {
    const m = LIST.exec(lines[i]);
    if (!m) break;
    const indent = m[1].length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      const [sub, next] = parseList(lines, i);
      if (items.length) items[items.length - 1].children.push(sub);
      i = next;
      continue;
    }
    items.push({ text: m[3], children: [] });
    i++;
  }
  return [{ ordered, items }, i];
}

function renderList(list, ctx) {
  const tag = list.ordered ? 'ol' : 'ul';
  const items = list.items.map((it) => {
    const kids = it.children.map((c) => renderList(c, ctx)).join('');
    return `<li>${inline(it.text, ctx)}${kids}</li>`;
  }).join('');
  return `<${tag}>${items}</${tag}>`;
}

function renderTable(lines, i, ctx, out) {
  const rows = [];
  while (i < lines.length && TABLE_ROW.test(lines[i])) {
    if (!TABLE_SEP.test(lines[i])) {
      rows.push(TABLE_ROW.exec(lines[i])[1].split('|').map((c) => c.trim()));
    }
    i++;
  }
  if (!rows.length) return i;

  const head = rows[0].map((c) => `<th>${inline(c, ctx)}</th>`).join('');
  const body = rows.slice(1)
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join('')}</tr>`)
    .join('');
  out.push(`<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`);
  return i;
}

function renderBlocks(src, ctx) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      i++;
      const body = [];
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      const lang = fence[1] ? ` data-lang="${esc(fence[1])}"` : '';
      out.push(`<pre${lang}><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const open = BLOCK_OPEN.exec(line);
    if (open && !BLOCK_CLOSE.test(line)) {
      const id = open[1].toLowerCase();
      const title = open[2].trim();
      i++;
      const body = [];
      while (i < lines.length && !BLOCK_CLOSE.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      const known = ctx.concepts.some((c) => c.id === id);
      const cls = known ? `note n-${id}` : 'note';
      const heading = title ? `<p class="note-title">${inline(title, ctx)}</p>` : '';
      out.push(`<aside class="${cls}">${heading}${renderBlocks(body.join('\n'), ctx)}</aside>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6); // reserve h1 for the page title
      out.push(`<h${level}>${inline(heading[2], ctx, { plain: true })}</h${level}>`);
      i++;
      continue;
    }

    if (RULE.test(line)) { out.push('<hr>'); i++; continue; }

    if (TABLE_ROW.test(line)) { i = renderTable(lines, i, ctx, out); continue; }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(QUOTE.exec(lines[i++])[1]);
      out.push(`<blockquote>${renderBlocks(body.join('\n'), ctx)}</blockquote>`);
      continue;
    }

    if (LIST.test(line)) {
      const [list, next] = parseList(lines, i);
      out.push(renderList(list, ctx));
      i = next;
      continue;
    }

    const para = [line.trim()];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== ''
           && !FENCE.test(lines[j]) && !HEADING.test(lines[j]) && !RULE.test(lines[j])
           && !LIST.test(lines[j]) && !QUOTE.test(lines[j]) && !TABLE_ROW.test(lines[j])
           && !BLOCK_OPEN.test(lines[j])) {
      para.push(lines[j].trim());
      j++;
    }
    out.push(`<p>${inline(para.join(' '), ctx)}</p>`);
    i = j;
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ page ---

function conceptCss(concepts) {
  const light = concepts.map((c) => `
    .k-${c.id}{background:hsl(${c.hue} 82% 91%);color:hsl(${c.hue} 62% 28%);box-shadow:inset 0 -1px 0 hsl(${c.hue} 55% 76%)}
    .n-${c.id}{background:hsl(${c.hue} 70% 97%);border-color:hsl(${c.hue} 58% 70%)}
    .n-${c.id} .note-title{color:hsl(${c.hue} 62% 32%)}
    .sw-${c.id}{background:hsl(${c.hue} 62% 48%)}`).join('');

  const dark = concepts.map((c) => `
    .k-${c.id}{background:hsl(${c.hue} 42% 22%);color:hsl(${c.hue} 72% 78%);box-shadow:inset 0 -1px 0 hsl(${c.hue} 40% 38%)}
    .n-${c.id}{background:hsl(${c.hue} 34% 14%);border-color:hsl(${c.hue} 45% 44%)}
    .n-${c.id} .note-title{color:hsl(${c.hue} 70% 76%)}
    .sw-${c.id}{background:hsl(${c.hue} 60% 60%)}`).join('');

  return `${light}\n@media (prefers-color-scheme:dark){${dark}}`;
}

const BASE_CSS = `
*{box-sizing:border-box}
:root{
  --bg:#fbfaf8; --fg:#23201c; --dim:#6c665e; --line:#e2ded6; --card:#fff;
  --code-bg:#f2efe9;
}
@media (prefers-color-scheme:dark){
  :root{ --bg:#141519; --fg:#dcd8d1; --dim:#8f8a83; --line:#2a2c32; --card:#1a1c21;
         --code-bg:#20232a; }
}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--bg); color:var(--fg);
  font:400 18px/1.68 ui-serif,Georgia,'Iowan Old Style',Palatino,serif;
  padding:clamp(28px,6vw,72px) clamp(20px,6vw,48px);
}
main{max-width:70ch;margin:0 auto}
h1,h2,h3,h4,h5,h6{
  font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
  line-height:1.25; letter-spacing:-.018em; margin:2.2em 0 .6em;
}
h1{font-size:2.15rem;font-weight:650;margin:0 0 .1em;letter-spacing:-.03em}
h2{font-size:1.42rem;font-weight:620}
h3{font-size:1.2rem;font-weight:630;margin-top:2.4em}
h4{font-size:1rem;font-weight:620;color:var(--dim)}
p{margin:0 0 1.15em}
a{color:inherit;text-decoration:underline;text-underline-offset:2px;text-decoration-color:var(--dim)}
strong{font-weight:640}
hr{border:0;border-top:1px solid var(--line);margin:2.6em 0}
ul,ol{margin:0 0 1.15em;padding-left:1.35em}
li{margin:.3em 0}
li>ul,li>ol{margin:.3em 0}
blockquote{
  margin:1.6em 0;padding:.1em 0 .1em 1.15em;
  border-left:2px solid var(--line);color:var(--dim);font-style:italic;
}
blockquote p:last-child{margin-bottom:0}
code{
  font:0.86em/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:var(--code-bg);padding:.12em .34em;border-radius:4px;
}
pre{
  background:var(--code-bg);border:1px solid var(--line);border-radius:8px;
  padding:14px 16px;overflow-x:auto;margin:1.5em 0;position:relative;
}
pre code{background:none;padding:0;font-size:.82rem;line-height:1.6}
pre[data-lang]::before{
  content:attr(data-lang);position:absolute;top:8px;right:12px;
  font:500 10px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.09em;
  text-transform:uppercase;color:var(--dim);
}
.tw{overflow-x:auto;margin:1.6em 0}
table{
  width:100%;border-collapse:collapse;
  font-family:ui-sans-serif,system-ui,sans-serif;font-size:.9rem;
}
th,td{text-align:left;padding:.55em .8em;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:620;font-size:.76rem;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
tbody tr:last-child td{border-bottom:0}
/* Negative margin cancels most of the padding so a highlight does not shove
   adjacent punctuation away from the word it belongs to. */
.k{border-radius:3px;padding:.1em .24em;margin:0 -.14em;color:inherit}
.note{
  margin:1.7em 0;padding:1em 1.2em;border-left:3px solid var(--line);
  border-radius:0 8px 8px 0;background:var(--card);
}
.note>*:last-child{margin-bottom:0}
.note-title{
  font-family:ui-sans-serif,system-ui,sans-serif;font-weight:640;font-size:.92rem;
  letter-spacing:-.01em;margin:0 0 .5em;
}
.legend{
  display:flex;flex-wrap:wrap;gap:.5em .95em;margin:1.6em 0 2.6em;
  padding-bottom:1.5em;border-bottom:1px solid var(--line);
  font-family:ui-sans-serif,system-ui,sans-serif;font-size:.78rem;color:var(--dim);
}
.legend span{display:inline-flex;align-items:center;gap:.42em}
.legend i{width:9px;height:9px;border-radius:2px;display:inline-block}
.meta{
  font-family:ui-sans-serif,system-ui,sans-serif;font-size:.75rem;color:var(--dim);
  letter-spacing:.05em;text-transform:uppercase;margin:3.5em 0 0;
  padding-top:1.2em;border-top:1px solid var(--line);
}
@media print{body{padding:0}.legend{break-inside:avoid}}
`;

function page({ title, concepts, bodyHtml }) {
  const legend = concepts.length
    ? `<div class="legend">${concepts
        .map((c) => `<span><i class="sw-${c.id}"></i>${esc(c.name)}</span>`)
        .join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>${BASE_CSS}${conceptCss(concepts)}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${legend}
${bodyHtml}
</main>
</body>
</html>
`;
}

// ------------------------------------------------------------------ main ---

const DEMO = `@secrets: secret, secrets, plaintext, credentials, MONGO_URI
@flags: flag, flags, feature flag, sendOrSkipSms, testOrLiveMode

# Config audit

Of the seventeen keys in the deploy bundle, only seven are actually secrets. The
other ten are identifiers and feature flags, and they are the ones that change.

:::secrets Where they live
Anyone with \`lambda:GetFunctionConfiguration\` reads the secrets in plaintext.
Encryption at rest does not gate IAM.
:::

:::flags The part nobody tracks
Nobody casually rotates a MONGO_URI, but people flip sendOrSkipSms under
pressure — and untracked flags leave no answer to "who changed this, and when?"
:::

## What to do

1. Move the flags into version control. Cheap, and it kills most of the drift.
2. Fetch the remaining secrets at runtime.

| Key | Kind | Churn |
| --- | --- | --- |
| MONGO_URI | secret | rare |
| sendOrSkipSms | flag | weekly |

> The drift risk lives almost entirely in the flags.
`;

function openInBrowser(path) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    execFileSync(cmd, [path], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP); return; }

  const src = opts.demo ? DEMO
    : opts.file ? readFileSync(opts.file, 'utf8')
    : readFileSync(0, 'utf8');

  const { concepts, body } = extractConcepts(src.replace(/\r\n/g, '\n').split('\n'));
  const ctx = { concepts, ...buildMatcher(concepts) };

  // The first heading names the page and is then dropped, so it isn't repeated
  // under the <h1> the template already emits.
  let rest = body;
  let title = opts.title;
  const firstHeading = body.findIndex((l) => /^#\s+/.test(l));
  if (!title && firstHeading !== -1) {
    title = body[firstHeading].replace(/^#\s+/, '').trim();
    rest = body.filter((_, idx) => idx !== firstHeading);
  }

  const html = page({
    title: title || 'colorito',
    concepts,
    bodyHtml: renderBlocks(rest.join('\n'), ctx),
  });

  let out;
  if (opts.out) {
    out = resolve(opts.out);
  } else {
    const dir = join(tmpdir(), 'colorito');
    mkdirSync(dir, { recursive: true });
    const slug = (title || 'page').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    out = join(dir, `${slug || 'page'}-${Date.now()}.html`);
  }

  writeFileSync(out, html);
  if (opts.open && !openInBrowser(out)) process.stderr.write('could not open a browser\n');
  process.stdout.write(out + '\n');
}

main();
