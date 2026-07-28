// Tests drive the real CLI as a subprocess: it is the actual interface, and a
// timeout turns a wrapping hang into a failure instead of an OOM.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../skills/colorito/colorito.mjs', import.meta.url));

function run(input, args = []) {
  return execFileSync(process.execPath, [CLI, ...args], {
    input, encoding: 'utf8', timeout: 10_000, maxBuffer: 8 << 20,
  });
}

const ESC = '\x1b';

test('semantic spans become ANSI', () => {
  const out = run('{ok:yes} {bad:no}\n');
  assert.match(out, /\x1b\[38;5;114myes\x1b\[0m/);
  assert.match(out, /\x1b\[38;5;203mno\x1b\[0m/);
});

test('spans nest and combine styles', () => {
  const out = run('{warn:outer {bold:inner}}\n');
  assert.match(out, /\x1b\[38;5;215;1minner/);
});

test('dotted style lists apply every part', () => {
  const out = run('{bold.red:crit}\n');
  assert.match(out, /\x1b\[1;38;5;203mcrit/);
});

test('one escape per span, not per word', () => {
  const out = run('{ok:three whole words}\n');
  assert.equal(out.split(ESC).length - 1, 2, 'expected exactly one open and one reset');
});

test('--no-color emits no escapes', () => {
  const out = run('{ok:yes} **b** `c`\n', ['--no-color']);
  assert.ok(!out.includes(ESC));
  assert.match(out, /yes b c/);
});

test('NO_COLOR env is honored', () => {
  const out = execFileSync(process.execPath, [CLI, '--demo'], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, NO_COLOR: '1' },
  });
  assert.ok(!out.includes(ESC));
});

test('unknown style names are left verbatim, not parsed as spans', () => {
  const out = run('{nosuchstyle:kept}\n', ['--no-color']);
  assert.match(out, /\{nosuchstyle:kept\}/);
});

test('shell syntax inside a span survives', () => {
  const out = run('{cmd:${ssm:/path/to/key}}\n', ['--no-color']);
  assert.match(out, /\$\{ssm:\/path\/to\/key\}/);
});

test('a stray brace in prose is not swallowed', () => {
  const out = run('use ${VAR:-default} in the script\n', ['--no-color']);
  assert.match(out, /\$\{VAR:-default\}/);
});

test('unterminated span is emitted literally', () => {
  const out = run('a {ok:unclosed here\n', ['--no-color']);
  assert.match(out, /\{ok:unclosed here/);
});

test('backslash escapes braces', () => {
  const out = run('\\{literal\\}\n', ['--no-color']);
  assert.match(out, /\{literal\}/);
});

test('code spans are opaque to markup', () => {
  const out = run('`{ok:raw} **not bold**`\n', ['--no-color']);
  assert.match(out, /\{ok:raw\} \*\*not bold\*\*/);
});

test('long words hard-break instead of hanging', () => {
  const long = 'A'.repeat(300);
  const out = run(`xx ${long} yy\n`, ['--no-color', '--width', '20']);
  for (const line of out.split('\n')) assert.ok(line.length <= 20, `line too long: ${line.length}`);
  assert.equal((out.match(/A/g) || []).length, 300, 'no characters lost');
});

test('paragraphs wrap to width', () => {
  const out = run(`${'word '.repeat(60)}\n`, ['--no-color', '--width', '40']);
  for (const line of out.split('\n')) assert.ok(line.length <= 40);
});

test('tables align and keep every cell', () => {
  const out = run('| a | bb |\n| --- | --- |\n| ccc | d |\n', ['--no-color']);
  assert.match(out, /a\s+│ bb/);
  assert.match(out, /ccc │ d/);
});

test('diff fences color add and remove lines', () => {
  const out = run('```diff\n+ added\n- gone\n```\n');
  assert.match(out, /\x1b\[38;5;114m\+ added/);
  assert.match(out, /\x1b\[38;5;203m- gone/);
});

test('callouts draw a titled bar', () => {
  const out = run(':::warn Heads up\nbody text\n:::\n', ['--no-color']);
  assert.match(out, /▌ Heads up/);
  assert.match(out, /▌ body text/);
});

test('callout falls back to a default label', () => {
  const out = run(':::bad\nboom\n:::\n', ['--no-color']);
  assert.match(out, /▌ ERROR/);
});

test('empty input produces no crash', () => {
  assert.doesNotThrow(() => run(''));
});

test('demo renders end to end', () => {
  const out = run('', ['--demo']);
  assert.ok(out.includes('colorito'));
  assert.ok(out.includes(ESC));
});
