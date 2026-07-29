// Tests drive the real CLI as a subprocess and inspect the HTML it writes.
// --open is never passed, so nothing launches a browser during a test run.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../skills/colorito/colorito.mjs', import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), 'colorito-test-'));
let n = 0;

function render(input, args = []) {
  const out = join(DIR, `t${n++}.html`);
  execFileSync(process.execPath, [CLI, '--out', out, ...args], {
    input, encoding: 'utf8', timeout: 15_000,
  });
  return readFileSync(out, 'utf8');
}

// The rendered <body>, so assertions can't accidentally match the stylesheet.
function body(html) {
  return html.slice(html.indexOf('<body>'));
}

test('a declared concept highlights its vocabulary', () => {
  const html = body(render('@risk: exposure\nThe exposure is real.\n'));
  assert.match(html, /<mark class="k k-risk">exposure<\/mark>/);
});

test('the concept name is part of its own vocabulary', () => {
  const html = body(render('@risk: exposure\nThe risk is real.\n'));
  assert.match(html, /<mark class="k k-risk">risk<\/mark>/);
});

test('the same word gets the same class everywhere', () => {
  const html = body(render('@risk: exposure\nexposure here.\n\nAnd exposure there.\n'));
  assert.equal((html.match(/k-risk/g) || []).length, 2);
});

test('matching is case-insensitive and preserves the original casing', () => {
  const html = body(render('@risk: exposure\nExposure and EXPOSURE.\n'));
  assert.match(html, />Exposure</);
  assert.match(html, />EXPOSURE</);
});

test('matching is whole-word', () => {
  const html = body(render('@risk: key\nThe monkey escaped.\n'));
  assert.ok(!html.includes('k-risk'), 'should not match inside "monkey"');
});

test('longer vocabulary wins over shorter', () => {
  const html = body(render('@a: key\n@b: access key\nAn access key here.\n'));
  assert.match(html, /<mark class="k k-b">access key<\/mark>/);
});

test('two concepts get different classes', () => {
  const html = body(render('@one: alpha\n@two: beta\nalpha and beta.\n'));
  assert.match(html, /k-one/);
  assert.match(html, /k-two/);
});

test('code spans are never highlighted', () => {
  const html = body(render('@risk: exposure\nSee `exposure` here.\n'));
  assert.match(html, /<code>exposure<\/code>/);
  assert.ok(!html.includes('k-risk'));
});

test('fenced blocks are never highlighted', () => {
  const html = body(render('@risk: exposure\n```js\nconst exposure = 1;\n```\n'));
  assert.ok(!html.includes('k-risk'));
  assert.match(html, /<pre data-lang="js">/);
});

test('headings are never highlighted', () => {
  const html = body(render('@risk: exposure\n# Doc\n## exposure section\n'));
  assert.ok(!html.includes('k-risk'));
});

test('concept blocks carry the concept class', () => {
  const html = body(render('@risk: exposure\n:::risk Title here\nbody\n:::\n'));
  assert.match(html, /<aside class="note n-risk">/);
  assert.match(html, /<p class="note-title">Title here<\/p>/);
});

test('an undeclared block name renders as a neutral card', () => {
  const html = body(render(':::nope Heads up\nbody\n:::\n'));
  assert.match(html, /<aside class="note">/);
});

test('the legend lists one swatch per concept', () => {
  const html = body(render('@one: a\n@two: b\ntext\n'));
  assert.match(html, /class="legend"/);
  assert.match(html, /class="sw-one"/);
  assert.match(html, /class="sw-two"/);
});

test('no concepts means no legend', () => {
  const html = body(render('Just prose.\n'));
  assert.ok(!html.includes('class="legend"'));
  assert.match(html, /<p>Just prose\.<\/p>/);
});

test('the first heading becomes the title and is not repeated', () => {
  const html = render('# The Title\nBody.\n');
  assert.match(html, /<title>The Title<\/title>/);
  assert.equal((body(html).match(/The Title/g) || []).length, 1);
});

test('--title overrides the heading', () => {
  const html = render('# Ignored\nBody.\n', ['--title', 'Chosen']);
  assert.match(html, /<title>Chosen<\/title>/);
});

test('an explicit hue name is accepted', () => {
  const html = render('@risk teal: exposure\nexposure\n');
  assert.match(html, /\.k-risk\{background:hsl\(172 /);
});

test('html in the source is escaped', () => {
  const html = body(render('A <script>alert(1)</script> and 5 < 6 & 7.\n'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /5 &lt; 6 &amp; 7/);
});

test('markdown inlines render', () => {
  const html = body(render('**b** *i* `c` ~~s~~ [t](https://e.com)\n'));
  assert.match(html, /<strong>b<\/strong>/);
  assert.match(html, /<em>i<\/em>/);
  assert.match(html, /<code>c<\/code>/);
  assert.match(html, /<del>s<\/del>/);
  assert.match(html, /<a href="https:\/\/e\.com"[^>]*>t<\/a>/);
});

test('tables render inside a scroll wrapper', () => {
  const html = body(render('| a | b |\n| --- | --- |\n| 1 | 2 |\n'));
  assert.match(html, /<div class="tw"><table>/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td>1<\/td>/);
});

test('lists nest by indentation', () => {
  const html = body(render('- one\n  - deep\n- two\n'));
  assert.match(html, /<ul><li>one<ul><li>deep<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
});

test('blockquotes and rules render', () => {
  const html = body(render('> quoted\n\n---\n'));
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
});

test('the page is self-contained: no external references', () => {
  const html = render('@risk: exposure\n# T\nexposure\n');
  assert.ok(!/<link\b/.test(html), 'no external stylesheets');
  assert.ok(!/<script\b/.test(html), 'no scripts');
  assert.ok(!/src=/.test(html), 'no remote assets');
});

test('empty input still produces a valid page', () => {
  const html = render('');
  assert.match(html, /<!doctype html>/);
  assert.match(html, /<\/html>/);
});

test('the demo renders end to end', () => {
  const html = render('', ['--demo']);
  assert.match(html, /k-secrets/);
  assert.match(html, /k-flags/);
  assert.match(html, /<title>Config audit<\/title>/);
});

test('the output path is printed to stdout', () => {
  const out = join(DIR, 'printed.html');
  const stdout = execFileSync(process.execPath, [CLI, '--out', out, '--demo'], {
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(stdout.trim(), out);
});
