// What names a module has, and whether every component it references is one of them. Without
// this the compiler happily emits a call to a component with no import to match, and the
// mistake only surfaces as a ReferenceError in the browser.
import { fail, nearest, rel, RAW_BODY, SRC_DIR } from '@zal/core';
import { ROUTER_EXPORTS, REACT_COMPS } from './names.mjs';

// Resolve `%name` tags against the kit and record every class the file uses.
// The names an `i` line brings into scope: `Panel`, `{ Row, Cell }`, `Chart,{ Line }`, `a as b`.
function importBinds(n) {
  if (n.spec !== undefined) return [];                   // a side-effect import binds nothing
  const named = /\{([^}]*)\}/.exec(n.what);
  const out = named ? named[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()) : [];
  const dflt = n.what.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
  return [...out, dflt].filter(Boolean);
}

// Every capitalized tag in the markup — i.e. every component the file references.
function compRefs(node, out = new Map()) {
  if (RAW_BODY.has(node.kind)) return out;               // a hook body is JS, not markup
  // `Dialog.Panel` is a reference to `Dialog`: that is the name an `i` line has to bring in.
  const base = node.kind === 'el' ? node.tag.split('.')[0] : null;
  if (base && /^[A-Z]/.test(base) && !out.has(base)) out.set(base, node);
  for (const k of node.kids || []) compRefs(k, out);
  return out;
}

// Names a module already has: an `i` import, or anything a top-level `js` line declares. A spread
// of one of these is ordinary code, not a component taking rest props.
function moduleScope(ast) {
  const out = new Set();
  for (const n of ast.kids) {
    if (n.kind === 'import') for (const b of importBinds(n)) out.add(b);
    if (n.kind !== 'js') continue;
    const code = [n.code, ...(n.kids || []).map(k => (k.raw || []).join(' '))].join('\n');
    for (const [, one, many] of code.matchAll(/\b(?:const|let|var|function|class)\s+(?:([\w$]+)|[{[]([^}\]]*)[}\]])/g)) {
      if (one) out.add(one);
      for (const [, id] of (many || '').matchAll(/([\w$]+)\s*(?::\s*[\w$]+)?/g)) if (id) out.add(id);
    }
  }
  return out;
}

// A component may also be declared by a `js` line instead of imported.
function jsNames(node, out = new Set(), inJs = false) {
  const here = inJs || node.kind === 'js';
  if (here && node.raw) {
    for (const [, n] of node.raw.join(' ').matchAll(/\b(?:const|let|var|function|class)\s+([A-Z][\w$]*)/g)) out.add(n);
  }
  for (const k of node.kids || []) jsNames(k, out, here);
  return out;
}

// The `i` line that would bring a component declared in zal/ into scope. One block per file is
// the default export, so anything else in that file is a named one.
const importHint = (name, c, dir) => c.named
  ? `i { ${name} } from ${rel(dir, c.file)}` : `i ${name} ${rel(dir, c.file)}`;

// Every name the module itself binds: an `i` import, a `C`/`S` block, or a `js` declaration.
function boundNames(ast) {
  const out = jsNames(ast);
  for (const n of ast.kids) {
    if (n.kind === 'import') for (const b of importBinds(n)) out.add(b);
    else if (n.kind === 'comp' || n.kind === 'store') out.add(n.name);
  }
  return out;
}

// A capitalized tag is a component, and a component has to be in scope: imported, declared in
// this file, or auto-imported (`Link`). Without this the compiler happily emits `h(Pannel, …)`
// with no import to match, and the mistake only surfaces as a ReferenceError in the browser.
function checkComponents(ast, comps, dir = '') {
  const bound = boundNames(ast);
  for (const n of [...ROUTER_EXPORTS, ...REACT_COMPS]) bound.add(n);   // auto-imported on sight
  for (const [name, at] of compRefs(ast)) {
    if (bound.has(name)) continue;
    const hit = comps.has(name) ? name : nearest(name, [...comps.keys(), ...bound]);
    const fix = hit && comps.has(hit) ? `add \`${importHint(hit, comps.get(hit), dir)}\``
      : hit ? `did you mean ${hit}?`
      : `no \`C ${name}\` in ${SRC_DIR}/, and no \`i\` line for it`;
    fail(at, `<${name}> is not in scope — ${fix}`);
  }
}

function linkUI(node, ui, used) {
  for (const c of node.classes || []) used?.add(c);
  if (node.kind === 'el' && node.tag.startsWith('%')) {
    const name = node.tag.slice(1), entry = ui?.kit[name];
    if (!entry) fail(node, `%${name} is not in the UI kit`);
    node.tag = entry.el;
  }
  for (const k of node.kids || []) linkUI(k, ui, used);
}

export { importBinds, compRefs, moduleScope, jsNames, importHint, boundNames, checkComponents, linkUI };
