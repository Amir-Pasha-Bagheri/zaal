// One .zaal source -> one React module.
import { parse, memberTags, fail, rel, escRe, CDN } from 'zaal';
import { aliases, EL, FRAG } from './markup.mjs';
import { component, boundary, reactNames, lineText } from './component.mjs';
import { store } from './store.mjs';
import { hookdef } from './hook.mjs';
import { moduleScope, linkUI, checkComponents, checkHooks, compRefs, boundNames,
  declaredOnce } from './scope.mjs';
import { importLine } from './imports.mjs';
import { REACT_COMPS, ROUTER_EXPORTS, REACT_HOOKS } from './names.mjs';

// The three block heads, and the letter each one is written with.
const HEAD = { comp: 'C', store: 'S', hookdef: 'H' };
const BLOCK = new Set(Object.keys(HEAD));

function compile(src, target = 'jsx',
  { ui = null, used = null, pkgs = null, pins = null, cdn = CDN, stores = new Map(),
    comps: known = new Map(), hooks = new Map(), main = null, dir = '', assets = null } = {}) {
  if (target !== 'jsx' && target !== 'esm') throw new Error(`unknown backend: ${target}`);
  const ext = target === 'jsx' ? '.jsx' : '.js';
  const ast = parse(src);
  aliases(src);
  memberTags(ast, moduleScope(ast));
  linkUI(ast, ui, used);
  checkComponents(ast, known, dir);
  const imports = [], comps = [], raw = [], needs = new Set(), fromReact = new Set(), codes = [];
  // The default export is the block named after the file, or the first one if none matches.
  const blocks = ast.kids.filter(n => BLOCK.has(n.kind)).map(n => n.name);
  const def = blocks.includes(main) ? main : blocks[0];
  // Two blocks of one name would be two declarations of it in the module — and so would a
  // block and an import, or two imports.
  const twice = new Set();
  for (const n of ast.kids) {
    if (!BLOCK.has(n.kind)) continue;
    if (twice.has(n.name)) fail(n, `${HEAD[n.kind]} ${n.name} is declared twice in this file`);
    twice.add(n.name);
  }
  declaredOnce(ast);
  for (const n of ast.kids) {
    if (n.kind === 'import') {
      const own = reactNames(n);
      if (own) { for (const x of own) fromReact.add(x); continue; }
      imports.push(importLine(n, target, { pkgs, pins, cdn, assets, dir }));
      if (n.lazy) fromReact.add('lazy');
      continue;
    }
    // A `js` block's child lines are part of it — one statement per line, as written.
    if (n.kind === 'js') { raw.push([n.code, ...(n.kids || []).map(lineText)].join('\n')); continue; }
    // `ret` only means something in an `H` block; anywhere else it would be a `<ret>` element.
    if (n.kind === 'ret') fail(n, '`ret` belongs in an `H` block — it is what a hook hands back');
    if (BLOCK.has(n.kind)) {
      const emit = n.kind === 'hookdef' ? hookdef
        : n.kind === 'store' ? store : n.parts.includes('catch') ? boundary : component;
      const out = emit(n, target, { stores, main: def, scope: moduleScope(ast) });
      for (const name of out.ctx.needs) needs.add(name);
      for (const name of out.react || []) fromReact.add(name);
      codes.push(out.codes || '');
      comps.push(out.code);
    }
  }
  // After the blocks: a hook called where a hook may not run is the better complaint, and the
  // block compilers make it.
  checkHooks(ast, hooks, stores, dir);
  const body = comps.join('\n\n');
  // A file may declare a store and consume it: `S Theme` writes `use Theme()` into this very
  // module, so importing it as well would declare the name twice and the module would not parse.
  const here = new Set(ast.kids.filter(n => n.kind === 'store').map(n => n.name));
  for (const name of needs) {
    if (here.has(name)) continue;
    imports.push(`import { use${name} } from '${rel(dir, stores.get(name))}${ext}';`);
  }
  // `Link`, `go`, `useRoute`, `Suspense`… are free to use: a module that names one gets the import,
  // unless it binds that name itself. Read from tags and code positions, so the same word sitting
  // in a text node imports nothing.
  const own = new Set([...boundNames(ast), ...moduleScope(ast)]);
  const tags = compRefs(ast), code = codes.join(' ');
  const uses = n => !own.has(n)
    && (tags.has(n) || new RegExp(`(?<![\\p{L}\\p{N}_$.])${escRe(n)}(?![\\p{L}\\p{N}_$])`, 'u').test(code));
  const fromRouter = ROUTER_EXPORTS.filter(uses);
  if (fromRouter.length) imports.push(`import { ${fromRouter.join(', ')} } from '${rel(dir, 'router')}${ext}';`);
  for (const n of REACT_COMPS) if (!own.has(n) && tags.has(n)) fromReact.add(n);
  const react = [...new Set([...fromReact,
    ...[...REACT_HOOKS, 'createContext'].filter(h => new RegExp(`\\b${h}\\(`).test(body)),
    target === 'jsx' && /<Fragment[ >]/.test(body) && 'Fragment',
    target === 'esm' && `createElement as ${EL}`, target === 'esm' && `Fragment as ${FRAG}`])]
    .filter(Boolean);
  const head = [react.length ? `import { ${react.join(', ')} } from 'react';` : null, ...imports].filter(Boolean);
  // (importLine returns null for package css in esm mode — the page links it instead)
  return [...head, '', ...raw, ...comps].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export { compile };
