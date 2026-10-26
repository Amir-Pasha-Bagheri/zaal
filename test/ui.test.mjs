// ui.zal -> tokens, schemes, base elements, the kit and its variants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUI, uiCss } from '../zal.mjs';

const css = src => uiCss(parseUI(src));

test('token groups become custom properties on :root', () => {
  const out = css('D Zal\nt color\n  accent #3b5bfd\n  on-accent #fff\nt space\n  1 .25rem\n');
  assert.match(out, /:root \{\n\s*color-scheme: light dark;\n\s*--color-accent: #3b5bfd;\n\s*--color-on-accent: #fff;\n\s*--space-1: \.25rem;\n\}/);
  assert.match(out, /^\/\* Zal — tokens/);
});

test('$group.name becomes var(--group-name), in tokens too', () => {
  const out = css('t color\n  fg #000\n  ink $color.fg\nk card\n  bg $color.fg\n');
  assert.match(out, /--color-ink: var\(--color-fg\);/);
  assert.match(out, /\.card \{\n\s*background: var\(--color-fg\);\n\}/);
});

test('a scheme emits both the media query and the [data-theme] rule', () => {
  const out = css('t color\n  bg #fff\nscheme dark\n  color.bg #000\n');
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{\n\s*:root:not\(\[data-theme="light"\]\) \{\n\s*--color-bg: #000;/);
  assert.match(out, /:root\[data-theme="dark"\] \{\n\s*--color-bg: #000;\n\}/);
});

test('e <selector> styles bare elements, several selectors at once', () => {
  const out = css('e *, *::before\n  box-sizing border-box\ne body\n  m 0\n  bg #fff\n');
  assert.match(out, /\*, \*::before \{\n\s*box-sizing: border-box;\n\}/);
  assert.match(out, /body \{\n\s*margin: 0;\n\s*background: #fff;\n\}/);
});

test('k <class> [tag] records the tag %class expands to', () => {
  const ui = parseUI('k btn button\n  p 1px\nk card section\n  p 2px\nk box\n  p 3px\n');
  assert.equal(ui.kit.btn.el, 'button');
  assert.equal(ui.kit.card.el, 'section');
  assert.equal(ui.kit.box.el, 'div', 'the tag defaults to div');
});

test('property aliases expand, unknown properties pass through', () => {
  const out = css('k b\n  bg red\n  fg blue\n  radius 2px\n  size 1rem\n  weight 600\n  leading 1.5\n'
    + '  font serif\n  shadow none\n  w 1px\n  h 2px\n  maxw 3px\n  minw 4px\n  z 9\n'
    + '  p 1px\n  px 2px\n  py 3px\n  mt 4px\n  mx auto\n  grid-template-columns 1fr\n');
  for (const [k, v] of [['background', 'red'], ['color', 'blue'], ['border-radius', '2px'],
    ['font-size', '1rem'], ['font-weight', '600'], ['line-height', '1.5'], ['font-family', 'serif'],
    ['box-shadow', 'none'], ['width', '1px'], ['height', '2px'], ['max-width', '3px'],
    ['min-width', '4px'], ['z-index', '9'], ['padding', '1px'], ['padding-inline', '2px'],
    ['padding-block', '3px'], ['margin-top', '4px'], ['margin-inline', 'auto'],
    ['grid-template-columns', '1fr']]) {
    assert.match(out, new RegExp(`\\s${k}: ${v.replace('.', '\\.')};`), `${k}: ${v}`);
  }
});

test('nested selectors: :hover, & child, [attr] and >', () => {
  const out = css('k row form\n  display flex\n  :hover\n    outline 1px\n  & input\n    flex 1\n'
    + '  & input:focus-visible\n    outline 2px\n  [data-x]\n    color red\n  > p\n    margin 0\n');
  assert.match(out, /\.row:hover \{\n\s*outline: 1px;\n\}/);
  assert.match(out, /\.row input \{\n\s*flex: 1;\n\}/);
  assert.match(out, /\.row input:focus-visible \{\n\s*outline: 2px;\n\}/);
  assert.match(out, /\.row\[data-x\] \{\n\s*color: red;\n\}/);
  assert.match(out, /\.row> p \{\n\s*margin: 0;\n\}/);
});

test('v variants emit .class.variant, with their own nested selectors', () => {
  const out = css('k btn button\n  bg none\n  v primary\n    bg blue\n    :hover\n      filter brightness(1.1)\n');
  assert.match(out, /\.btn \{\n\s*background: none;\n\}/);
  assert.match(out, /\.btn\.primary \{\n\s*background: blue;\n\}/);
  assert.match(out, /\.btn\.primary:hover \{\n\s*filter: brightness\(1\.1\);\n\}/);
  assert.doesNotMatch(out, /\.btn \{[^}]*background: blue/, 'a variant does not leak into the base rule');
});

test('known classes cover kit entries, variants and classes named in `e`', () => {
  const ui = parseUI('k btn button\n  v primary\n    bg blue\ne .legacy\n  color red\n');
  assert.ok(ui.known.has('btn') && ui.known.has('primary') && ui.known.has('legacy'));
  assert.ok(!ui.known.has('nope'));
});

test('css passthrough is emitted verbatim, at the end', () => {
  const out = css('k a\n  p 0\ncss @keyframes spin { to { rotate: 360deg } }\n');
  assert.match(out, /@keyframes spin \{ to \{ rotate: 360deg \} \}\n$/);
});

test('comments are stripped, blank lines ignored', () => {
  const ui = parseUI('// head\nD X\n\nt color // trailing\n  bg #fff // here\n');
  assert.equal(ui.name, 'X');
  assert.deepEqual(ui.tokens[0].vars, [['bg', '#fff']]);
});

test('an unknown directive is an error naming the line', () => {
  assert.throws(() => parseUI('D X\nnope foo\n'), /unknown directive `nope`/);
});

test('a recipe with no declarations emits no empty rule', () => {
  const out = css('k wrap\n  :hover\n    color red\n');
  assert.doesNotMatch(out, /\.wrap \{\s*\}/);
  assert.match(out, /\.wrap:hover \{/);
});

test('the real example design system compiles', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../example/zal/ui.zal', import.meta.url), 'utf8');
  const ui = parseUI(src);
  const out = uiCss(ui);
  assert.equal(ui.name, 'Zal');
  for (const k of ['page', 'nav', 'card', 'row', 'btn', 'list', 'item', 'hint', 'counter']) {
    assert.ok(ui.kit[k], `kit entry ${k}`);
    assert.match(out, new RegExp(`\\.${k} \\{`));
  }
  assert.match(out, /\.btn\.primary \{/);
  assert.match(out, /\.btn\.icon \{/);
  assert.doesNotMatch(out, /\$[a-z]+\./, 'every $token reference is resolved');
  assert.equal((out.match(/\{/g) || []).length, (out.match(/\}/g) || []).length, 'braces balance');
});

/* ---------- deeper design-system cases ---------- */

test('two schemes each exclude the opposite explicit theme', () => {
  const out = css('t color\n  bg #fff\nscheme dark\n  color.bg #000\nscheme light\n  color.bg #eee\n');
  assert.match(out, /@media \(prefers-color-scheme: dark\) \{\n\s*:root:not\(\[data-theme="light"\]\)/);
  assert.match(out, /@media \(prefers-color-scheme: light\) \{\n\s*:root:not\(\[data-theme="dark"\]\)/);
  assert.match(out, /:root\[data-theme="dark"\] \{\n\s*--color-bg: #000;/);
  assert.match(out, /:root\[data-theme="light"\] \{\n\s*--color-bg: #eee;/);
});

test('a scheme may override tokens from several groups', () => {
  const out = css('t color\n  bg #fff\nt space\n  1 1px\nscheme dark\n  color.bg #000\n  space.1 2px\n');
  assert.match(out, /:root\[data-theme="dark"\] \{\n\s*--color-bg: #000;\n\s*--space-1: 2px;\n\}/);
});

test('a kit entry with only variants emits no base rule', () => {
  const out = css('k btn button\n  v primary\n    bg blue\n');
  assert.doesNotMatch(out, /\.btn \{/);
  assert.match(out, /\.btn\.primary \{/);
});

test('several variants on one entry, each with nested selectors', () => {
  const out = css('k btn button\n  p 0\n  v a\n    bg red\n    :hover\n      bg darkred\n  v b\n    bg blue\n    & svg\n      fill white\n');
  assert.match(out, /\.btn\.a:hover \{\n\s*background: darkred;/);
  assert.match(out, /\.btn\.b svg \{\n\s*fill: white;/);
});

test('nested selectors nest further', () => {
  const out = css('k row div\n  display flex\n  & input\n    flex 1\n    :focus\n      outline 1px\n');
  assert.match(out, /\.row input \{/);
  assert.match(out, /\.row input:focus \{\n\s*outline: 1px;/);
});

test('`&` may appear anywhere in a nested selector, and `.class` nests too', () => {
  const out = css('k card section\n  p 0\n  .dark &\n    bg black\n  & > p\n    m 0\n  .wide\n    maxw 60rem\n');
  assert.match(out, /\.dark \.card \{\n\s*background: black;/);
  assert.match(out, /\.card > p \{\n\s*margin: 0;/);
  assert.match(out, /\.card\.wide \{\n\s*max-width: 60rem;/);
});

test('an `e` block nests the same way', () => {
  const out = css('e body\n  m 0\n  & .modal-open\n    overflow hidden\n  :has(dialog[open])\n    overflow hidden\n');
  assert.match(out, /body \.modal-open \{/);
  assert.match(out, /body:has\(dialog\[open\]\) \{/);
});

test('a token may be defined in terms of another token', () => {
  const out = css('t color\n  base #123\n  fg $color.base\nt space\n  pad calc($space.unit * 2)\n  unit 4px\n');
  assert.match(out, /--color-fg: var\(--color-base\);/);
  assert.match(out, /--space-pad: calc\(var\(--space-unit\) \* 2\);/);
});

test('token group and name may hold digits and dashes', () => {
  const out = css('t size-2\n  x-1 1px\n  2 2px\n');
  assert.match(out, /--size-2-x-1: 1px;/);
  assert.match(out, /--size-2-2: 2px;/);
});

test('a value with commas, quotes and functions passes through', () => {
  const out = css('t font\n  sans ui-sans-serif, "Segoe UI", sans-serif\nk a\n  shadow 0 1px 2px rgba(0,0,0,.2), 0 0 0 1px #eee\n');
  assert.match(out, /--font-sans: ui-sans-serif, "Segoe UI", sans-serif;/);
  assert.match(out, /box-shadow: 0 1px 2px rgba\(0,0,0,\.2\), 0 0 0 1px #eee;/);
});

test('several css passthrough lines keep their order, at the end', () => {
  const out = css('css @layer base, app;\nk a\n  p 0\ncss @media print { .a { display: none } }\n');
  const first = out.indexOf('@layer'), rule = out.indexOf('.a {'), last = out.indexOf('@media print');
  assert.ok(rule < first && first < last, 'kit rules come before the passthrough block');
});

test('`e` selectors may be pseudo-elements and attribute selectors', () => {
  const out = css('e [hidden]\n  display none\ne a::after\n  content ""\n');
  assert.match(out, /\[hidden\] \{\n\s*display: none;/);
  assert.match(out, /a::after \{\n\s*content: "";/);
});

test('the output is one rule per block, in a stable order', () => {
  const out = css('D S\nt color\n  bg #fff\nscheme dark\n  color.bg #000\ne body\n  m 0\nk page main\n  p 0\ncss /* end */\n');
  const order = [':root {', '@media', ':root[data-theme', 'body {', '.page {', '/* end */'].map(x => out.indexOf(x));
  assert.ok(order.every(i => i >= 0), out);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('uiCss is deterministic for the same source', () => {
  const src = 'D S\nt color\n  bg #fff\nk page main\n  p 0\n  v wide\n    maxw 60rem\n';
  assert.equal(css(src), css(src));
});

// At-rules: a `@media` nested in a recipe wraps that rule, and a top-level one holds whole
// rules — `k` and `e` keep their meaning inside it, and a keyframe step is its own selector.
test('an at-rule nested in a kit entry wraps that rule', () => {
  const out = css('D X\nk card section\n  p 1rem\n  @media (max-width: 40rem)\n    p 0\n    :hover\n      color blue\n');
  assert.match(out, /@media \(max-width: 40rem\) \{\n  \.card \{\n    padding: 0;\n  \}\n\n  \.card:hover \{\n    color: blue;\n  \}\n\}/);
});

test('a top-level at-rule holds k and e blocks', () => {
  const out = css('D X\nk card\n  p 1rem\n@media (max-width: 40rem)\n  k card\n    radius 0\n  e body\n    size 14px\n');
  assert.match(out, /@media \(max-width: 40rem\) \{\n  \.card \{\n    border-radius: 0;\n  \}\n\n  body \{\n    font-size: 14px;\n  \}\n\}/);
});

test('@keyframes steps are selectors of their own', () => {
  const out = css('D X\n@keyframes spin\n  from\n    transform rotate(0)\n  to\n    transform rotate(1turn)\n');
  assert.match(out, /@keyframes spin \{\n  from \{\n    transform: rotate\(0\);\n  \}\n\n  to \{\n    transform: rotate\(1turn\);\n  \}\n\}/);
});

test('a kit entry declared only inside an at-rule is still a known class', () => {
  assert.ok(parseUI('D X\n@media print\n  k sheet\n    p 0\n').known.has('sheet'));
});
