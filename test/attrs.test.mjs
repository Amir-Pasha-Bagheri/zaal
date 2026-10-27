// Markup here looks like HTML, so HTML spellings get written — and React drops most of them
// with nothing but a console warning (`tabindex`, `for`, `readonly`) or throws outright
// (`style` as a string). They are translated into what React takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';

const jsx = src => compile(src, 'jsx');
const esm = src => compile(src, 'esm');
const tag = src => jsx(src).match(/<[a-zA-Z][^>]*>/)[0];

test('the HTML spelling of a DOM attribute becomes the React one', () => {
  assert.equal(tag('C A\n  label class="f" for="email" "Email"\n'),
    '<label className="f" htmlFor="email">');
  assert.equal(tag('C A\n  input tabindex=0 readonly maxlength=5\n'),
    '<input tabIndex={0} readOnly={true} maxLength={5} />');
  assert.equal(tag('C A\n  img srcset="a.png 1x" crossorigin="anonymous"\n'),
    '<img srcSet="a.png 1x" crossOrigin="anonymous" />');
  assert.equal(tag('C A\n  td colspan=2 rowspan=3\n'), '<td colSpan={2} rowSpan={3} />');
  assert.equal(tag('C A\n  svg viewbox="0 0 1 1"\n'), '<svg viewBox="0 0 1 1" />');
});

test('a component keeps the prop name it was given', () => {
  assert.equal(tag('i B ./B\nC A\n  B tabindex=1\n'), '<B tabindex={1} />');
});

test('data-* and aria-* are left exactly as written', () => {
  assert.equal(tag('C A\n  div data-x="1" aria-label="y" "z"\n'), '<div data-x="1" aria-label="y">');
});

// React throws on a string style: "The `style` prop expects a mapping from style properties
// to values, not a string."
test('a string style becomes the object React wants', () => {
  assert.equal(tag('C A\n  div style="color: red; font-size: 12px" "x"\n'),
    '<div style={{ color: "red", fontSize: "12px" }}>');
  assert.match(esm('C A\n  div style="color: red" "x"\n'), /"style": \{ color: "red" \}/);
});

test('a style value interpolates, and a custom property keeps its name', () => {
  assert.equal(tag('C A p:c p:w\n  div style="color: {c}; width: {w}px" "x"\n'),
    '<div style={{ color: c, width: `${w}px` }}>');
  assert.equal(tag('C A p:c\n  div style="--accent: {c}" "x"\n'), '<div style={{ "--accent": c }}>');
});

test('an object style is still passed through untouched', () => {
  assert.equal(tag('C A\n  div style={color:"red"} "x"\n'), '<div style={{color:"red"}}>');
});

test('something that is not a declaration list is reported', () => {
  assert.throws(() => jsx('C A\n  div style="red" "x"\n'), /not a list of CSS declarations/);
});
