// Identifiers are not ASCII in JavaScript, and an app written in German, French or Russian
// names its props and state the same way. Every place the compiler recognises a name has to
// agree — a setter rewrite that silently skipped `zählung++` left an assignment to a const.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';

const jsx = (src, opts) => compile(src, 'jsx', opts);

test('state, its setter and its rewrite', () => {
  const out = jsx('C A s:zählung=0\n  button @click=zählung++ "{zählung}"\n');
  assert.match(out, /const \[zählung, setZählung\] = useState\(0\)/);
  assert.match(out, /onClick=\{\(\) => setZählung\(zählung \+ 1\)\}/);
  assert.match(jsx('C A s:größe=1\n  button @click=größe+=2 "x"\n'), /setGröße\(größe \+ \(2\)\)/);
});

test('props, interpolation and inferred dependencies', () => {
  const out = jsx('C A p:prénom\n  memo gruß = "Hallo {prénom}"\n  p "{gruß}"\n');
  assert.match(out, /function A\(\{ prénom \}\)/);
  assert.match(out, /const gruß = useMemo\(\(\) => `Hallo \$\{prénom\}`, \[prénom\]\)/);
  assert.match(out, /<p>\{gruß\}<\/p>/);
});

test('a unicode component is a component, not a DOM tag', () => {
  assert.match(jsx('i Café ./Café\nC A\n  Café größe=2\n'), /<Café größe=\{2\} \/>/);
  assert.match(compile('i Café ./Café\nC A\n  Café\n', 'esm'), /h\(Café, null\)/);
  assert.throws(() => jsx('C A\n  Café\n'), /<Café> is not in scope/);
});

test('a unicode store, and the in-place guard', () => {
  const opts = { stores: new Map([['Café', 'stores/Café']]) };
  assert.match(jsx('C A\n  use { größe } = Café\n  p "{größe}"\n', opts), /const \{ größe \} = useCafé\(\)/);
  assert.throws(() => jsx('C A s:läufer={}\n  cb bad() = läufer.a = 1\n  p "x"\n'),
    /edits läufer in place/);
});

// `$` is a legal identifier character and a regex anchor. Names holding one go into the
// dependency scan as text, so they have to be escaped — `$ref` used to infer no dependency
// at all, leaving a memo that never recomputed.
test('a $-prefixed name is still a dependency', () => {
  const out = jsx('C A p:$ref s:$n=0\n  memo t = $ref + $n\n  fx log($n)\n  button @click=$n++ "{t}"\n');
  assert.match(out, /const t = useMemo\(\(\) => \$ref \+ \$n, \[\$ref, \$n\]\)/);
  assert.match(out, /\}, \[\$n\]\)/, 'the effect depends on it too');
  assert.match(out, /onClick=\{\(\) => set\$n\(\$n \+ 1\)\}/);
});

test('an underscore name behaves the same', () => {
  assert.match(jsx('C A p:_a s:_b=0\n  memo t = _a + _b\n  p "{t}"\n'),
    /useMemo\(\(\) => _a \+ _b, \[_a, _b\]\)/);
});
