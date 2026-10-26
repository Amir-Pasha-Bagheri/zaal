#!/usr/bin/env node
// zal — the Zal framework: a token-dense DSL that compiles to a runnable React app.
// Two backends: `jsx` (Vite/bundler) and `esm` (createElement, zero install).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { basename, dirname, join, extname, resolve, sep } from 'node:path';

/* ---------- project layout ---------- */

// A Zal project has two directories: `zal/` is everything hand-written (`app.zal`, `ui.zal`
// and the sources, foldered however the app reads best), and `application/` is a complete,
// standalone React app — package.json, vite.config.js, index.html and a `src/` tree mirroring
// the sources. Nothing in it names the compiler, so a developer can `git init` inside
// `application/`, `npm install` and run it like any React project they wrote by hand.
const SRC_DIR = 'zal';                 // hand-written sources
const APP_FILE = `${SRC_DIR}/app.zal`; // the app declaration
const APP_DIR = 'application';         // the generated React app — the deliverable
const DEV_DIR = '.zal-dev';            // `zal dev`'s zero-install preview, ephemeral
const OUT_SRC = 'src';                 // where modules land inside the output
const OUT_CSS = `${OUT_SRC}/styles`;   // where stylesheets land inside the output

const posix = p => p.split(sep).join('/');

/* ---------- lex ---------- */

// Split a line on spaces, ignoring spaces inside "" or ()[]{}. A `{…}` inside a string is an
// interpolated expression, and the quotes in it belong to that expression, not to the string:
// `"{mode == "dark" ? "a" : "b"}"` is one token.
function tokens(line) {
  const out = [];
  let buf = '', depth = 0, q = false, brace = 0, inner = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const lit = line[i - 1] === '\\';
    if (q) {
      buf += c;
      if (inner) { if (c === '"' && !lit) inner = false; continue; }
      if (c === '{' && !lit) brace++;
      else if (c === '}' && !lit) brace = Math.max(0, brace - 1);
      else if (c === '"' && !lit) { if (brace) inner = true; else q = false; }
      continue;
    }
    if (c === '"') { q = true; brace = 0; buf += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ' ' && depth === 0) { if (buf) out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

/* ---------- diagnostics ---------- */

// Every error names the line that caused it — `zal/Home.zal:7  message` plus the line itself —
// so the message alone is enough to fix the mistake, without reopening the file to hunt for it.
let AT = null;                         // the node being compiled, for throws deep inside codegen
const here = n => { AT = n; return n; };
const fail = (n, msg) => {
  const e = new Error(msg);
  e.ln = (typeof n === 'number' ? n : n?.ln) ?? AT?.ln;
  throw e;
};

// Stamp file and line onto an error on its way out of a source file.
function located(e, src, file) {
  if (e.at) return e;
  e.at = [file, e.ln].filter(Boolean).join(':');
  const line = e.ln && src.split('\n')[e.ln - 1];
  e.message = (e.at ? `${e.at}  ` : '') + e.message + (line ? `\n         ${e.ln} | ${line.trim()}` : '');
  return e;
}

// Run a compiler pass over one source file, so anything it throws points into that file.
const inFile = (src, file, f) => { try { return f(); } catch (e) { throw located(e, src, file); } };

/* ---------- parse: indentation -> tree ---------- */

function parse(src) {
  const root = { kind: 'root', kids: [] };
  const stack = [{ indent: -1, node: root }];
  for (const [i, raw] of src.split('\n').entries()) {
    if (!raw.trim() || raw.trim().startsWith('//')) continue;
    const ln = i + 1;
    const indent = raw.length - raw.trimStart().length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const tk = tokens(raw.trim());
    // A trailing comment — `store Theme Todos  // outermost first`. tokens() keeps a quoted
    // string in one piece, so a `//` inside text or a URL is never the start of one.
    const cut = tk.findIndex(t => t.startsWith('//'));
    if (cut === 0) continue;
    if (cut > 0) tk.length = cut;
    const parent = stack.at(-1).node;
    // Children of a hook line are raw JS statements, not markup — don't parse them as elements.
    let node;
    try {
      node = RAW_BODY.has(parent.kind)
        ? { kind: 'line', raw: tk, kids: [] }
        : { ...lineNode(tk), raw: tk, kids: [] };
    } catch (e) { e.ln ??= ln; throw e; }      // a bad head line is reported where it was written
    node.ln = ln;
    parent.kids.push(node);
    stack.push({ indent, node });
  }
  return root;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

const isState = (c, n) => c.state.some(s => s.name === n);
const setter = n => 'set' + n[0].toUpperCase() + n.slice(1);

const RAW_BODY = new Set(['hook', 'line', 'js']);

// `fx` / `memo n = …` / `cb f(x) = …` / `ref el` / `ctx theme = Ctx` / `use [a, b] = useReducer(…)`.
// The suffix pins the dependency array: none = inferred, `!` = mount only, `*` = every render,
// `[a b]` = exactly these.
const HOOK = /^(fx|memo|cb|ref|ctx|use)([!*]|\[[^\]]*\])?$/;

function lineNode(t) {
  const head = t[0];
  const hk = HOOK.exec(head);
  if (hk) return hookNode(hk[1], hk[2], t.slice(1));
  if (head === 'C') return { kind: 'comp', name: t[1], parts: t.slice(2) };
  if (head === 'S') return { kind: 'store', name: t[1], parts: t.slice(2) };
  if (head === 'A') return { kind: 'app', name: t[1] };
  // `i X ./X` · `i {a,b} from pkg` · `i pkg/x.css` — but `i "text"` / `i c="em"` is the <i> element
  if (head === 'i' && t.length > 1 && !t[1].startsWith('"') && !t[1].includes('=')) {
    const r = t.slice(1).filter(x => x !== 'from' && x !== 'lazy');
    const lazy = t.includes('lazy');                 // `i Heavy ./Heavy lazy` — split out of the bundle
    return r.length > 1 ? { kind: 'import', what: r[0], from: r[1], lazy } : { kind: 'import', spec: r[0] };
  }
  if (head === 'js') return { kind: 'js', code: t.slice(1).join(' ') };
  if (head.startsWith('/')) return { kind: 'route', path: head, component: t[1], lazy: t.includes('lazy') };
  // The test is the rest of the line, so `?a.length > 2` reads the way it is written.
  if (head.startsWith('?')) return { kind: 'if', test: [head.slice(1), ...t.slice(1)].join(' ').trim() };
  if (head === ':' || head.startsWith(':?')) {
    return { kind: 'else', test: [head.slice(2), ...t.slice(1)].join(' ').trim() || null };
  }
  if (head.startsWith('*')) {
    const list = head.slice(1) || t[1];
    const rest = t.slice(head.slice(1) ? 1 : 2);
    const asI = rest.indexOf('as');
    const key = rest.find(x => x.startsWith('k='));
    return { kind: 'map', list, item: asI >= 0 ? rest[asI + 1] : 'it', key: key ? key.slice(2) : null };
  }
  if (head.startsWith('"')) return { kind: 'text', value: head.slice(1, -1) };
  if (head.startsWith('{') && head.endsWith('}')) return { kind: 'expr', code: head.slice(1, -1) };
  if (head === 'slot') {                            // markup passed as a prop, not as a child
    if (!/^[a-zA-Z_$][\w$]*$/.test(t[1] || '')) throw new Error('slot: expected `slot <propName>`');
    return { kind: 'slot', name: t[1] };
  }
  if (head.startsWith('%')) {                       // %btn.primary -> kit entry `btn` + its tag
    const s = selector(head.slice(1));
    return { kind: 'el', tag: '%' + s.tag, classes: [s.tag, ...s.classes], id: s.id, attrs: attrList(t.slice(1)) };
  }
  return { kind: 'el', ...selector(head), attrs: attrList(t.slice(1)) };
}

// What can begin an attribute: a quoted text node, a spread, an event, or `name`/`name=value`.
const ATTR_START = /^(?:\.\.\.|@|")|^[A-Za-z_$][\w$:.-]*(?:=|$)/;

// Is this attribute still mid-expression — an open bracket or quote, or a trailing operator?
const incomplete = s => {
  let depth = 0, q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i - 1] !== '\\') q = false; continue; }
    if (c === '"') { q = true; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
  }
  return q || depth > 0 || (/[-+*/%<>!&|^,?:=]$/.test(s) && !/(?:\+\+|--)$/.test(s));
};

// `button @click=n++; log("hi") "x"` — tokens() splits on spaces, so a handler written with
// spaces in it arrived in pieces. A piece that cannot begin an attribute, or that continues an
// expression the piece before it left open, belongs to that attribute.
function attrList(t) {
  const out = [];
  for (const tk of t) {
    const prev = out.at(-1);
    if (prev !== undefined && (incomplete(prev) || !ATTR_START.test(tk))) out[out.length - 1] = `${prev} ${tk}`;
    else out.push(tk);
  }
  return out;
}

function selector(s) {
  // A dash can only be a custom element (`my-widget`): no component or DOM tag has one, and a
  // class is always introduced by its own `.`.
  const m = /^([A-Za-z][\w$]*(?:-[\w$]+)*)?((?:[.#][\w$-]+)*)$/.exec(s);
  if (!m) throw new Error(`bad selector: ${s}`);
  const classes = [], ids = [];
  for (const part of (m[2] || '').match(/[.#][\w$-]+/g) || []) {
    (part[0] === '.' ? classes : ids).push(part.slice(1));
  }
  return { tag: m[1] || 'div', classes, id: ids[0] || null };
}

// `motion.div`, `Dialog.Panel` — a dotted tag whose first segment is a name the module has
// (an `i` line or a `js` declaration) is a member of it, not a tag with classes. Nothing else
// can tell the two apart: `div.card` and `motion.div` are the same shape. Case decides the rest,
// the way it decides everywhere else in Zal: `Card.wide` is still a class on <Card>, because a
// class is lower-case and a component is not.
const isMember = (tag, next) => /^[a-z]/.test(tag) || /^[A-Z]/.test(next);

function memberTags(node, scope) {
  if (node.kind === 'el' && node.classes?.length && scope.has(node.tag)
      && isMember(node.tag, node.classes[0])) {
    // The member is the segment after the base, plus any further capitalized ones
    // (`Dialog.Panel.Title`). What follows is classes again: `motion.div.sheet`.
    const path = [node.tag, node.classes.shift()];
    while (node.classes.length && /^[A-Z]/.test(node.classes[0])) path.push(node.classes.shift());
    node.tag = path.join('.');
  }
  for (const k of node.kids || []) memberTags(k, scope);
}

function hookNode(hook, mod, rest) {
  const deps = !mod ? 'auto' : mod === '!' ? [] : mod === '*' ? null : tokens(mod.slice(1, -1).replace(/,/g, ' '));
  const src = rest.join(' ');
  if (hook === 'fx') {
    if (/^[\w$]+$/.test(src)) throw new Error(`fx: \`fx ${src}\` is not a dep list — write \`fx[${src}]\``);
    return { kind: 'hook', hook, deps, body: src };
  }
  const [lhs, rhs] = splitAssign(src);
  // `ref`, `memo`, `cb` and `ctx` all declare one binding, so the name has to be an identifier —
  // without this `cb 1bad() = …` only surfaces as a syntax error in the generated module.
  const ident = x => /^[A-Za-z_$][\w$]*$/.test(x);
  if (hook === 'ref') {
    if (!ident(lhs)) throw new Error(`ref: bad name \`${lhs}\``);
    return { kind: 'hook', hook, name: lhs, init: rhs || 'null' };
  }
  // `use useLayoutEffect(…)` — a hook that hands nothing back still has to run on every render,
  // so it gets a line of its own, with no name to bind.
  if (hook === 'use' && !rhs) {
    if (!/\(/.test(lhs)) throw new Error(`use: expected \`use <name> = <expr>\` or \`use <call>\``);
    return { kind: 'hook', hook, name: null, expr: lhs, deps };
  }
  if (!rhs) throw new Error(`${hook}: expected \`${hook} <name> = <expr>\``);
  if (hook === 'cb') {
    const m = /^([A-Za-z_$][\w$]*)\s*(\([^)]*\))?$/.exec(lhs);
    if (!m) throw new Error(`cb: bad name \`${lhs}\``);
    return { kind: 'hook', hook, name: m[1], params: m[2] || '()', body: rhs, deps };
  }
  if (hook !== 'use' && !ident(lhs)) throw new Error(`${hook}: bad name \`${lhs}\``);
  return { kind: 'hook', hook, name: lhs, expr: rhs, deps };
}

// Split `lhs = rhs` on the first top-level `=` that is a plain assignment (not `==`, `=>`, `+=`).
function splitAssign(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '"') { while (++i < s.length && s[i] !== '"'); }
    else if (c === '=' && !depth && s[i + 1] !== '=' && s[i + 1] !== '>' && !'=!<>+-*/'.includes(s[i - 1] || '')) {
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }
  }
  return [s.trim(), ''];
}

/* ---------- shared: attributes & handlers ---------- */

const EV = { click: 'onClick', input: 'onInput', change: 'onChange', submit: 'onSubmit',
  focus: 'onFocus', blur: 'onBlur', key: 'onKeyDown', over: 'onMouseOver', out: 'onMouseLeave' };
const ALIAS = { c: 'className', val: 'value', ph: 'placeholder' };

// Split on `;` outside strings and brackets, so `for (i = 0; i < n; i++)` stays one statement.
function splitStmts(src) {
  const out = [];
  let buf = '', depth = 0, q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { buf += c; if (c === '"' && src[i - 1] !== '\\') q = false; continue; }
    if (c === '"') { q = true; buf += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ';' && !depth) { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

// `"n is {n}"` -> `` `n is ${n}` `` — strings interpolate in handler and hook bodies, as in text.
// Every literal is matched in turn, braces or not: looking only for the ones with a `{` in them
// lets the match start at the *closing* quote of one string and end inside the next.
const interp = s => s.replace(/"([^"\\]*)"/g, (m, inner) => /\{/.test(inner) ? tmpl(inner) : m);

// `n++` / `n+=x` / `n=x` on a state name become setter calls; anything else is passed through.
function rewrite(ctx, s) {
  let m = /^([\w$]+)(\+\+|--)$/.exec(s);
  if (m && isState(ctx, m[1])) return `${setter(m[1])}(${m[1]} ${m[2][0]} 1)`;
  m = /^([\w$]+)\s*([-+*/]?)=\s*(.+)$/.exec(s);
  if (m && isState(ctx, m[1])) return `${setter(m[1])}(${m[2] ? `${m[1]} ${m[2]} (${m[3]})` : m[3]})`;
  if (m && ctx.globals?.has(m[1])) {
    fail(null, `${m[1]} comes from a store — call one of its actions, or ${setter(m[1])}(…)`);
  }
  return s;
}

const stmts = (ctx, src) => splitStmts(src).map(s => rewrite(ctx, interp(s)));
const fnBody = list => list.length > 1 ? `{ ${list.join('; ')} }` : list[0] || '{}';

function handler(ctx, expr) {
  const list = stmts(ctx, expr);
  if (list.length === 1 && /^[\w$]+$/.test(list[0])) return list[0];  // bare fn reference
  const arg = /\be\b/.test(expr) ? 'e' : '';                          // event param only when used
  return `(${arg}) => ${fnBody(list)}`;
}

// `k={expr}` is how JSX writes it; Zal writes `k=expr`. Take either — the braces are the habit
// JSX leaves behind, and passing `{null}` through lands a syntax error in the generated module
// instead of here. An object literal (`style={color:"red"}`) is kept as the value it is.
function unbrace(v) {
  if (!v.startsWith('{') || !v.endsWith('}')) return v;
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '{') depth++;
    else if (v[i] === '}' && --depth === 0 && i !== v.length - 1) return v;   // `{a}+{b}`, not a wrap
  }
  const inner = v.slice(1, -1);
  return /^\s*(?:\.\.\.|["'\w$]+\s*:)/.test(inner) ? v : inner;
}

// -> { pairs: [{k, v, str}], spreads: [expr], text: [raw strings] }
function attrParts(ctx, node) {
  here(node);
  const pairs = [], spreads = [], text = [];
  if (node.id) pairs.push({ k: 'id', v: node.id, str: true });
  if (node.classes.length) pairs.push({ k: 'className', v: node.classes.join(' '), str: true });
  for (const a of node.attrs) {
    if (a.startsWith('"')) { text.push(a.slice(1, -1)); continue; }
    if (a.startsWith('...')) {
      const x = a.slice(3);
      if (/^[a-zA-Z_$][\w$]*$/.test(x) && !ctx.spread?.has(x)) ctx.spread?.set(x, node);
      spreads.push(x);
      continue;
    }
    if (a.startsWith('@')) {
      const [ev, ...rest] = a.slice(1).split('=');
      pairs.push({ k: EV[ev] || 'on' + ev[0].toUpperCase() + ev.slice(1), v: handler(ctx, unbrace(rest.join('='))) });
      continue;
    }
    const eq = a.indexOf('=');
    if (eq < 0) { pairs.push({ k: a, v: 'true' }); continue; }
    const k = a.slice(0, eq), v = a.slice(eq + 1);
    const key = ALIAS[k] || k;
    // `title="{n} items"` interpolates, the way a text node does; a string with no `{…}` in it
    // stays a plain string literal.
    if (v.startsWith('"')) {
      const inner = v.slice(1, -1);
      if (/(?<!\\)\{[^}]+\}/.test(inner)) pairs.push({ k: key, v: tmpl(inner) });
      else pairs.push({ k: key, v: inner.replace(/\\([{}])/g, '$1'), str: true });
    } else pairs.push({ k: key, v: unbrace(v) });
  }
  return { pairs, spreads, text };
}

/* ---------- design system: ui.zal -> tokens + UI kit ---------- */

// Dense property aliases. Anything not listed is passed through as plain CSS.
const PROP = { bg: 'background', fg: 'color', radius: 'border-radius', size: 'font-size',
  weight: 'font-weight', leading: 'line-height', font: 'font-family', shadow: 'box-shadow',
  w: 'width', h: 'height', maxw: 'max-width', minw: 'min-width', z: 'z-index',
  p: 'padding', px: 'padding-inline', py: 'padding-block',
  pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left',
  m: 'margin', mx: 'margin-inline', my: 'margin-block',
  mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left' };

// $group.name -> var(--group-name)
const tokenRef = v => v.replace(/\$([A-Za-z][\w-]*)\.([\w-]+)/g, (_, g, n) => `var(--${g}-${n})`);

const decl = (prop, value) => `  ${PROP[prop] || prop}: ${tokenRef(value)};`;

// indentation -> { head, rest, kids }, `//` comments stripped
function outline(src) {
  const root = { head: '', rest: [], kids: [] };
  const stack = [{ indent: -1, node: root }];
  for (const [i, raw] of src.split('\n').entries()) {
    const line = raw.replace(/(^|\s)\/\/.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const tk = line.trim().split(/\s+/);
    const node = { head: tk[0], rest: tk.slice(1), kids: [], ln: i + 1 };
    stack.at(-1).node.kids.push(node);
    stack.push({ indent, node });
  }
  return root;
}

// A nested selector, not a declaration: no CSS property starts with any of these, so a line
// like `.dark &` or `> p` can only be a selector.
const isSel = h => /^[:&\[>.#*]/.test(h);

// A recipe body: own declarations, nested selectors (`:hover`, `& input`, `[data-x]`) and
// nested at-rules (`@media (max-width: 40rem)`), which wrap the rule they sit in.
function recipe(node) {
  const decls = [], nested = [], at = [];
  for (const k of node.kids) {
    if (k.head === 'v') continue;                                  // variants handled by caller
    if (k.head.startsWith('@')) { at.push({ query: [k.head, ...k.rest].join(' '), ...recipe(k) }); continue; }
    if (isSel(k.head)) { nested.push({ sel: [k.head, ...k.rest].join(' '), ...recipe(k) }); continue; }
    decls.push([k.head, k.rest.join(' ')]);
  }
  return { decls, nested, at };
}

// `k <class> [tag]` + its `v` variants. Both the top level and an at-rule block hold these.
function kitEntry(n, ui) {
  const name = n.rest[0];
  const variants = n.kids.filter(k => k.head === 'v').map(k => ({ name: k.rest[0], ...recipe(k) }));
  ui.known.add(name);
  for (const v of variants) ui.known.add(v.name);
  return { name, el: n.rest[1] || 'div', ...recipe(n), variants };
}

// An at-rule holds rules rather than declarations: `k`/`e` keep their meaning inside it, and
// anything else is the selector it reads as — a keyframe step (`from`, `50%`) or a bare selector.
function atBlock(n, ui) {
  const parts = [];
  for (const k of n.kids) {
    if (k.head === 'k') { const e = kitEntry(k, ui); parts.push({ sel: '.' + e.name, body: e }); continue; }
    if (k.head === 'e') { parts.push({ sel: k.rest.join(' '), body: recipe(k) }); continue; }
    parts.push({ sel: [k.head, ...k.rest].join(' '), body: recipe(k) });
  }
  return { query: [n.head, ...n.rest].join(' '), parts };
}

export function parseUI(src) {
  const ui = { name: null, tokens: [], schemes: [], elements: [], kit: {}, at: [], raw: [], known: new Set() };
  for (const n of outline(src).kids) {
    if (n.head === 'D') { ui.name = n.rest[0] ?? 'design'; continue; }
    if (n.head === 't') {
      ui.tokens.push({ group: n.rest[0], vars: n.kids.map(k => [k.head, k.rest.join(' ')]) });
      continue;
    }
    if (n.head === 'scheme') {
      ui.schemes.push({ name: n.rest[0], vars: n.kids.map(k => [k.head.replace('.', '-'), k.rest.join(' ')]) });
      continue;
    }
    if (n.head === 'e') { ui.elements.push({ sel: n.rest.join(' '), ...recipe(n) }); continue; }
    if (n.head === 'k') { const k = kitEntry(n, ui); ui.kit[k.name] = k; continue; }
    // `@media …`, `@supports …`, `@keyframes …` — a block of whole rules, not of declarations.
    if (n.head.startsWith('@')) { ui.at.push(atBlock(n, ui)); continue; }
    if (n.head === 'css') { ui.raw.push([n.head, ...n.rest].join(' ').slice(4)); continue; }
    fail(n, `ui: unknown directive \`${n.head}\``);
  }
  for (const e of ui.elements) for (const c of e.sel.match(/\.[\w-]+/g) || []) ui.known.add(c.slice(1));
  return ui;
}

const rule = (sel, body) => body.decls.length
  ? [`${sel} {`, ...body.decls.map(([p, v]) => decl(p, v)), '}'].join('\n') : '';

const wrap = (query, inner) => `${query} {\n${inner.join('\n\n').replace(/^(?!$)/gm, '  ')}\n}`;

// A recipe's own rule plus every nested selector, `&` standing for the parent, plus every
// at-rule nested in it — which wraps the same selector in the query it names.
function rules(sel, body) {
  const out = [rule(sel, body)];
  for (const n of body.nested || []) {
    out.push(...rules(n.sel.includes('&') ? n.sel.replace(/&/g, sel) : sel + n.sel, n));
  }
  for (const a of body.at || []) {
    const inner = rules(sel, a);
    if (inner.length) out.push(wrap(a.query, inner));
  }
  return out.filter(Boolean);
}

export function uiCss(ui) {
  const out = [`/* ${ui.name || 'design system'} — tokens, base elements and the UI kit */`];
  const root = ui.tokens.flatMap(t => t.vars.map(([n, v]) => `  --${t.group}-${n}: ${tokenRef(v)};`));
  out.push([':root {', '  color-scheme: light dark;', ...root, '}'].join('\n'));
  for (const s of ui.schemes) {
    const vars = s.vars.map(([n, v]) => `  --${n}: ${tokenRef(v)};`).join('\n');
    // The OS preference applies unless the page asked for the other mode by hand.
    const other = s.name === 'dark' ? 'light' : 'dark';
    out.push(`@media (prefers-color-scheme: ${s.name}) {\n  :root:not([data-theme="${other}"]) {\n${vars.replace(/^/gm, '  ')}\n  }\n}`);
    out.push(`:root[data-theme="${s.name}"] {\n${vars}\n}`);
  }
  for (const e of ui.elements) out.push(...rules(e.sel, e));
  for (const k of Object.values(ui.kit)) {
    out.push(...rules('.' + k.name, k));
    for (const v of k.variants) out.push(...rules(`.${k.name}.${v.name}`, v));
  }
  for (const a of ui.at || []) {
    const inner = a.parts.flatMap(p => [...rules(p.sel, p.body),
      ...(p.body.variants || []).flatMap(v => rules(`${p.sel}.${v.name}`, v))]);
    if (inner.length) out.push(wrap(a.query, inner));
  }
  out.push(...ui.raw);
  return out.filter(Boolean).join('\n\n') + '\n';
}

/* ---------- backend: JSX ---------- */

// Kinds a fragment of one can collapse into; `if`/`map`/`slot` have to go through *Kids.
const PLAIN = new Set(['el', 'text', 'expr']);
const MARKUP = new Set(['el', 'text', 'expr', 'frag', 'if', 'map', 'slot']);

// `?a` · `:?b` · `:` — one chain of branches. Returns the chain and the index it consumed up to.
function chainOf(kids, i) {
  const chain = [kids[i]];
  while (kids[i + 1]?.kind === 'else') chain.push(kids[++i]);
  for (const [j, c] of chain.entries()) {
    if (!c.test && j !== chain.length - 1) fail(c, '`:` is the last branch — write `:?cond` to test again');
  }
  return [chain, i];
}

function checkMarkup(k) {
  if (MARKUP.has(k.kind)) return;
  if (k.kind === 'else') fail(k, `\`${k.test ? ':?' + k.test : ':'}\` needs a \`?\` branch directly above it`);
  if (k.kind === 'hook' || k.kind === 'line') fail(k, 'hook lines must be direct children of `C`');
  fail(k, `\`${k.raw?.[0]}\` is a top-level line — it can't appear inside markup`);
}

// `slot x` fills a prop with markup, so it only means something on a component.
function slots(n) {
  const list = n.kids.filter(k => k.kind === 'slot');
  for (const sl of list) {
    if (!/^[A-Z]/.test(n.tag)) fail(sl, `slot ${sl.name}: <${n.tag}> is not a component`);
    if (!sl.kids.length) fail(sl, `slot ${sl.name}: nothing to pass`);
  }
  return list;
}

// `\{` -> a literal brace, which JSX can only say as an expression.
const jsxText = s => s.replace(/\\([{}])/g, (_, c) => `{'${c}'}`);

function jsxKids(ctx, kids, ind) {
  const out = [], pad = ' '.repeat(ind);
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    checkMarkup(k);
    if (k.kind === 'if') {
      const [chain, j] = chainOf(kids, i);
      i = j;
      const arm = c => jsxNode(ctx, { kind: 'frag', kids: c.kids, root: true }, ind + 2);
      // `cond ? … : null`, never `cond && …`: React renders a falsy *number* (`?items.length`
      // with an empty list) as a stray `0`, and a test here is as often a count as a boolean.
      if (chain.length === 1) { out.push(`${pad}{${k.test} ? (\n${arm(k)}\n${pad}) : null}`); continue; }
      const tail = chain.at(-1).test ? null : chain.pop();
      let expr = tail ? `(\n${arm(tail)}\n${pad})` : 'null';
      for (const c of [...chain].reverse()) expr = `${c.test} ? (\n${arm(c)}\n${pad}) : ${expr}`;
      out.push(`${pad}{${expr}}`);
      continue;
    }
    if (k.kind === 'map') {
      const body = jsxNode(ctx, { kind: 'frag', kids: k.kids }, ind + 2, k.key ?? 'i');
      out.push(`${pad}{${k.list}.map((${k.item}, i) => (\n${body}\n${pad}))}`);
      continue;
    }
    out.push(jsxNode(ctx, k, ind));
  }
  return out.join('\n');
}

function jsxNode(ctx, n, ind, key) {
  const pad = ' '.repeat(ind);
  if (n.kind === 'text') return pad + jsxText(n.value);
  if (n.kind === 'expr') return `${pad}{${n.code}}`;
  if (n.kind === 'frag') {
    // One child collapses into itself — but a key has to land somewhere, and only an element
    // can carry one: `*rows as r k=r.id` over a bare `{r.label}` needs the fragment. The same
    // holds in an expression position (`n.root`): `return ( {x} )` is an object literal, not JSX.
    if (n.kids.length === 1 && (key || n.root ? n.kids[0].kind === 'el' : PLAIN.has(n.kids[0].kind))) {
      return jsxNode(ctx, n.kids[0], ind, key);
    }
    const [open, close] = key ? [`<Fragment key={${key}}>`, '</Fragment>'] : ['<>', '</>'];
    return `${pad}${open}\n${jsxKids(ctx, n.kids, ind + 2)}\n${pad}${close}`;
  }
  const { pairs, spreads, text } = attrParts(ctx, n);
  const fills = slots(n);
  const rest = n.kids.filter(k => k.kind !== 'slot');
  const props = [];
  if (key) props.push(`key={${key}}`);
  for (const p of pairs) props.push(p.str ? `${p.k}="${p.v}"` : `${p.k}={${p.v}}`);
  for (const sl of fills) {
    props.push(`${sl.name}={${jsxNode(ctx, { kind: 'frag', kids: sl.kids, root: true }, ind + 2).trimStart()}}`);
  }
  for (const s of spreads) props.push(`{...${s}}`);
  const head = `<${n.tag}${props.length ? ' ' + props.join(' ') : ''}`;
  const kids = text.map(t => pad + '  ' + jsxText(t));
  const sub = jsxKids(ctx, rest, ind + 2);
  if (sub) kids.push(sub);
  if (!kids.length) return `${pad}${head} />`;
  if (kids.length === 1 && !rest.length) return `${pad}${head}>${kids[0].trim()}</${n.tag}>`;
  return `${pad}${head}>\n${kids.join('\n')}\n${pad}</${n.tag}>`;
}

/* ---------- backend: ESM (React.createElement, no build step) ---------- */

// `"{children}"` is the element, not its text: a string that is one whole `{…}` stays an expression.
// `\{` is a literal brace.
const tmpl = s => /^\{[^{}]+\}$/.test(s) ? s.slice(1, -1)
  : '`' + s.replace(/`/g, '\\`')
      .replace(/\\([{}])|\{([^}]+)\}/g, (_, lit, expr) => lit ?? '${' + expr + '}') + '`';

function esmKids(ctx, kids) {
  const out = [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    checkMarkup(k);
    if (k.kind === 'if') {
      const [chain, j] = chainOf(kids, i);
      i = j;
      const arm = c => esmNode(ctx, { kind: 'frag', kids: c.kids });
      // A lone `?` is `cond ? … : null`, exactly as the jsx backend writes it — the two
      // backends have to agree, including on what a falsy non-boolean renders.
      if (chain.length === 1) { out.push(`${k.test} ? ${arm(k)} : null`); continue; }
      const tail = chain.at(-1).test ? null : chain.pop();
      let expr = tail ? arm(tail) : 'null';
      for (const c of [...chain].reverse()) expr = `${c.test} ? ${arm(c)} : ${expr}`;
      out.push(expr);
      continue;
    }
    if (k.kind === 'map') {
      out.push(`${k.list}.map((${k.item}, i) => ${esmNode(ctx, { kind: 'frag', kids: k.kids }, k.key ?? 'i')})`);
      continue;
    }
    out.push(esmNode(ctx, k));
  }
  return out;
}

function esmNode(ctx, n, key) {
  if (n.kind === 'text') return tmpl(n.value);
  if (n.kind === 'expr') return n.code;
  if (n.kind === 'frag') {
    const k = esmKids(ctx, n.kids);
    if (k.length === 1 && (!key || PLAIN.has(n.kids[0].kind))) return key ? withKey(k[0], key) : k[0];
    return `h(F, ${key ? `{ key: ${key} }` : 'null'}, ${k.join(', ')})`;
  }
  const { pairs, spreads, text } = attrParts(ctx, n);
  const fills = slots(n);
  const rest = n.kids.filter(k => k.kind !== 'slot');
  const entries = pairs.map(p => `${JSON.stringify(p.k)}: ${p.str ? JSON.stringify(p.v) : p.v}`);
  for (const sl of fills) entries.push(`${JSON.stringify(sl.name)}: ${esmNode(ctx, { kind: 'frag', kids: sl.kids })}`);
  if (key) entries.unshift(`key: ${key}`);
  const props = !spreads.length ? (entries.length ? `{ ${entries.join(', ')} }` : 'null')
    : !entries.length && spreads.length === 1 ? spreads[0]          // forwarding props, nothing else
    : `Object.assign({${entries.join(', ')}}, ${spreads.join(', ')})`;
  const tag = /^[a-z]/.test(n.tag) && !n.tag.includes('.') ? JSON.stringify(n.tag) : n.tag;
  const kids = [...text.map(tmpl), ...esmKids(ctx, rest)];
  return `h(${tag}, ${props}${kids.length ? ', ' + kids.join(', ') : ''})`;
}

// Put a key into an element the backend has already written, or wrap what cannot take one.
const withKey = (expr, key) => {
  const m = /^h\((.+?), (null|\{ ?)/.exec(expr);
  if (!m) return `h(F, { key: ${key} }, ${expr})`;
  const head = m[2] === 'null' ? `h(${m[1]}, { key: ${key} }` : `h(${m[1]}, { key: ${key}, `;
  return head + expr.slice(m[0].length);
};

/* ---------- packages ---------- */

const CDN = 'https://esm.sh';
const REACT_V = '19.1.0';
// React lives in the import map, so a package must borrow it rather than ship its own copy —
// two Reacts on a page means every hook throws.
const EXTERNAL = '?external=react,react-dom';

const isRel = s => /^[.\/]/.test(s);

// `./logo.png` names a file; `./Btn` and `./Btn.jsx` name a module.
const isAsset = s => /\.[A-Za-z0-9]+$/.test(s) && !/\.jsx?$/.test(s);

// `@scope/name@1.2.3/sub` -> { pkg, version, sub }
function splitSpec(spec) {
  const m = /^(@[\w.-]+\/[\w.-]+|[\w.-]+)(?:@([^/]+))?(\/.*)?$/.exec(spec);
  if (!m) throw new Error(`bad package specifier: ${spec}`);
  return { pkg: m[1], version: m[2] || null, sub: m[3] || '' };
}

// Record a bare import; returns the specifier the generated code should name. Versions are
// stripped from the code and kept in one place (the import map, or package.json).
// react and react-dom are already in the import map, at the version app.zal pins. Re-entering
// them as packages would overwrite that entry with an unpinned, `?external=react` one — a second
// React on the page, and every hook in the app throwing.
const BUILTIN = /^(react|react-dom)$/;

function pkgRef(spec, { pkgs, pins, cdn = CDN } = {}) {
  const { pkg, version, sub } = splitSpec(spec);
  if (BUILTIN.test(pkg)) return { pkg, version: null, css: false, id: pkg + sub };
  const pin = pins?.get(pkg) || null;                            // a pin in app.zal wins
  const v = pin || version;
  const id = pkg + sub, css = /\.css$/.test(sub);
  const entry = { pkg, version: v, css, url: `${cdn}/${pkg}${v ? '@' + v : ''}${sub}${css ? '' : EXTERNAL}` };
  if (pin && version && pin !== version) entry.clash = `${pkg}@${version} wanted, pinned ${pin}`;
  const prev = pkgs?.get(id);
  if (prev && prev.version !== v) prev.clash = `${id} imported as both ${prev.version || 'latest'} and ${v || 'latest'}`;
  else if (!prev) pkgs?.set(id, entry);
  return { ...entry, id };
}

function importLine(n, target, opts) {
  here(n);
  const ext = target === 'jsx' ? '.jsx' : '.js';
  if (n.spec !== undefined) {                                    // side-effect import
    if (isRel(n.spec)) fail(n, `i ${n.spec}: a local stylesheet belongs in app.zal (\`css …\`)`);
    const { id, css } = pkgRef(n.spec, opts);
    return css && target === 'esm' ? null : `import '${id}';`;   // esm links package css in <head>
  }
  // A local specifier that already names a file — `./logo.png`, `./data.json` — is an asset, not
  // a module: it keeps the extension it has, and the build copies it beside the module.
  // `i Heavy ./Heavy lazy` — fetched on first render instead of shipping in the main bundle.
  // The markup wraps it in `Suspense` itself, which is in scope for free.
  if (n.lazy) {
    if (!/^[A-Za-z_$][\w$]*$/.test(n.what)) {
      fail(n, `i ${n.what} ${n.from} lazy: a lazy import is one default name — \`i Heavy ./Heavy lazy\``);
    }
    const from = isRel(n.from) ? n.from.replace(/\.jsx?$/, '') + ext : pkgRef(n.from, opts).id;
    return `const ${n.what} = lazy(() => import('${from}'));`;
  }
  if (isRel(n.from)) {
    if (isAsset(n.from)) {
      opts?.assets?.add(posix(join(opts.dir || '', n.from)));
      // A bundler turns the import into a URL; the no-install preview has no bundler, so it
      // writes the URL itself — the same value, resolved against the module.
      return target === 'jsx' ? `import ${n.what} from '${n.from}';`
        : `const ${n.what} = new URL('${n.from}', import.meta.url).href;`;
    }
    return `import ${n.what} from '${n.from.replace(/\.jsx?$/, '') + ext}';`;
  }
  return `import ${n.what} from '${pkgRef(n.from, opts).id}';`;
}

// `application/` is handed to a developer, not to a bundler, so it needs the files any React
// project has. They are written once and then left alone: a hand edit — a Vite plugin, a dev
// proxy, an extra script — has to survive every rebuild. The only standing change the compiler
// makes to them afterwards is adding a package an `i` line named to `dependencies`.
const VITE_V = '^5.4.0', PLUGIN_V = '^4.3.1';

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';

function scaffold(dir, app) {
  const react = `^${app.pins.get('react') || REACT_V}`;
  const made = [];
  const once = (name, body) => {
    if (existsSync(join(dir, name))) return;
    writeFileSync(join(dir, name), body);
    made.push(name);
  };
  once('package.json', JSON.stringify({
    name: slug(app.name), private: true, version: '0.0.0', type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react, 'react-dom': `^${app.pins.get('react-dom') || REACT_V}` },
    devDependencies: { '@vitejs/plugin-react': PLUGIN_V, vite: VITE_V },
  }, null, 2) + '\n');
  once('vite.config.js',
    `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\n`
    + `export default defineConfig({ plugins: [react()] });\n`);
  once('.gitignore', 'node_modules/\ndist/\n');
  return made;
}

// Add every package an `i` line named to package.json, for the bundler path.
function syncDeps(root, pkgs) {
  const file = join(root, 'package.json');
  if (!existsSync(file) || !pkgs.size) return [];
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const deps = json.dependencies ?? {};
  const added = [];
  for (const { pkg, version } of pkgs.values()) {
    if (deps[pkg] || json.devDependencies?.[pkg]) continue;
    deps[pkg] = version ? (/^\d/.test(version) ? '^' + version : version) : 'latest';
    added.push(`${pkg}@${deps[pkg]}`);
  }
  if (!added.length) return [];
  json.dependencies = Object.fromEntries(Object.keys(deps).sort().map(k => [k, deps[k]]));
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return added;
}

/* ---------- component ---------- */

// React's own hooks are imported on sight, however they got into the body; a custom hook
// (anything not listed) still needs an `i` import line.
// React's own components, and the router's exports: in scope on sight, the way `Link` already is.
const REACT_COMPS = ['Suspense', 'StrictMode', 'Profiler'];
const ROUTER_EXPORTS = ['Link', 'go', 'useRoute'];

const REACT_HOOKS = ['useState', 'useEffect', 'useLayoutEffect', 'useMemo', 'useCallback', 'useRef',
  'useContext', 'useReducer', 'useId', 'useTransition', 'useDeferredValue', 'useOptimistic',
  'useActionState', 'useSyncExternalStore', 'useImperativeHandle', 'useDebugValue'];

function component(node, target, opts = {}) {
  const ctx = { props: [], state: [], globals: new Set(), needs: new Set(), spread: new Map(),
    stores: opts.stores || new Map() };
  for (const p of node.parts) {
    if (p.startsWith('p:')) {
      const [name, ...d] = p.slice(2).split('=');
      if (!IDENT.test(name)) fail(node, `${p}: \`${name}\` is not a name`);
      ctx.props.push({ name, def: d.join('=') || null });
    } else if (p.startsWith('s:')) {
      const [name, ...v] = p.slice(2).split('=');
      if (!IDENT.test(name)) fail(node, `${p}: \`${name}\` is not a name`);
      ctx.state.push({ name, init: v.join('=') || 'null' });
    } else if (p !== 'memo' && !p.startsWith('memo=')) {
      fail(node, `C ${node.name}: unknown \`${p}\` — a \`C\` line takes p:, s:, memo and catch`);
    }
  }
  // Hook and `js` lines become the component body, in source order; the rest is markup.
  const lines = ctx.state.map(s => `  const [${s.name}, ${setter(s.name)}] = useState(${s.init});`);
  const markup = [], declared = [];
  const reactive = new Set([...ctx.props.map(p => p.name), ...ctx.state.map(s => s.name)]);
  for (const k of node.kids) {
    if (k.kind === 'hook' || k.kind === 'js') lines.push(...hookCode(ctx, k, reactive, declared));
    else markup.push(k);
  }
  // Several root elements are a fragment — never two sibling expressions.
  const root = { kind: 'frag', kids: markup, root: true };
  const body = target === 'jsx'
    ? `  return (\n${jsxNode(ctx, root, 4)}\n  );`
    : `  return ${esmNode(ctx, root)};`;
  // `{children}` anywhere in the markup makes `children` a prop, no `p:children` needed —
  // read from the markup's code positions, so the word inside a literal string doesn't count.
  const takesKids = !ctx.props.some(p => p.name === 'children')
    && /(?<![\w$.])children(?![\w$])/.test(markup.flatMap(codeOf).join(' '));
  // `input ...rest` with nothing named `rest` in scope makes it the rest prop, the way `{children}`
  // makes `children` one: a component that forwards props says so by forwarding them.
  const scope = new Set([...ctx.props.map(p => p.name), ...ctx.state.map(s => s.name),
    ...declared, ...ctx.globals, ...takesKids ? ['children'] : [], ...opts.scope || []]);
  const rest = [...ctx.spread].filter(([x]) => !scope.has(x));
  if (rest.length > 1) {
    fail(rest[1][1], `...${rest[0][0]} and ...${rest[1][0]}: only one of them can be the rest prop`
      + ` — the other has to be in scope (a \`p:\` prop, a hook value or an \`i\` import)`);
  }
  const params = [...ctx.props.map(p => p.def ? `${p.name} = ${p.def}` : p.name),
    ...takesKids ? ['children'] : [], ...rest.map(([x]) => `...${x}`)];
  const codes = [...markup.flatMap(codeOf),
    ...node.kids.filter(k => k.kind === 'hook' || k.kind === 'js').map(lineText)].join(' ');
  // `C Row memo` — the component re-renders only when its props change. `memo=eq` hands React
  // the comparator to decide that with.
  const memoPart = node.parts.find(p => p === 'memo' || p.startsWith('memo='));
  const wrap = Boolean(memoPart), cmp = memoPart?.includes('=') ? ', ' + memoPart.slice(5) : '';
  const sig = `(${params.length ? `{ ${params.join(', ')} }` : ''}) {`
    + `\n${lines.join('\n')}${lines.length ? '\n' : ''}${body}\n}`;
  const kw = exportKeyword(node, opts);
  return { ctx, declared, codes, react: wrap ? ['memo'] : [],
    code: wrap
      ? (kw === 'export default'
        ? `const ${node.name} = memo(function ${node.name}${sig}${cmp});\nexport default ${node.name};`
        : `export const ${node.name} = memo(function ${node.name}${sig}${cmp});`)
      : `${kw} function ${node.name}${sig}` };
}

// Every expression a markup subtree evaluates: `{…}` children and interpolations, tests,
// lists, handlers and non-string attribute values. Escaped braces are text, not code.
const interpOf = s => [...s.matchAll(/\\[{}]|\{([^}]+)\}/g)].map(m => m[1]).filter(Boolean);

function codeOf(n) {
  const out = [];
  if (n.kind === 'expr') out.push(n.code);
  if (n.kind === 'text') out.push(...interpOf(n.value));
  if (n.kind === 'if') out.push(n.test);
  if (n.kind === 'map') out.push(n.list, n.key || '');
  for (const a of n.attrs || []) {
    const eq = a.indexOf('=');
    if (a.startsWith('"')) out.push(...interpOf(a.slice(1, -1)));
    else if (a.startsWith('...')) out.push(a.slice(3));
    else if (a.startsWith('@')) out.push(a.slice(a.indexOf('=') + 1));
    else if (eq >= 0) {
      const v = a.slice(eq + 1);
      out.push(...(v.startsWith('"') ? interpOf(v.slice(1, -1)) : [v]));
    }
  }
  for (const k of n.kids || []) out.push(...codeOf(k));
  return out;
}

// A local specifier as the importing module has to write it. The output mirrors zal/, so a module
// in a subdirectory reaches the root with `../` exactly as its source would.
const rel = (dir, path) => dir
  ? (path === dir || path.startsWith(dir + '/') ? './' + path.slice(dir.length + 1)
    : '../'.repeat(dir.split('/').length) + path)
  : './' + path;

// `i { Suspense } from react` names React's own exports: fold them into the import this module
// already writes, rather than emitting a second `from 'react'` line beside it.
function reactNames(n) {
  if (n.spec !== undefined || isRel(n.from)) return null;
  const { pkg, sub } = splitSpec(n.from);
  if (pkg + sub !== 'react') return null;
  const named = /\{([^}]*)\}/.exec(n.what);
  const dflt = n.what.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
  if (dflt) return null;                                   // `i React react` stays its own line
  return named ? named[1].split(',').map(x => x.trim()).filter(Boolean) : [];
}

// One default export per module: the block named after the file. The rest are named exports,
// so `i { Row } from ./Table` reaches them.
const exportKeyword = (node, opts) => opts.main === node.name ? 'export default' : 'export';

// React runs a hook on every render, so one cannot sit inside a memo, a callback or an effect:
// `memo path = useRoute()` has to be `use path = useRoute()`.
function noHooks(n, code) {
  const hit = /(?<![\w$.])(use[A-Z][\w$]*)\s*\(/.exec(code);
  if (hit) {
    fail(n, `${hit[1]}() is a hook, so it cannot run inside \`${n.hook}\` —`
      + ` put it on its own line: \`use <name> = ${hit[1]}(…)\``);
  }
}

// The dependency array. `auto` keeps every reactive value already in scope that the body names.
function depsOf(deps, code, reactive) {
  if (deps === null) return '';                                        // `*` — no array, every render
  const names = deps === 'auto'
    // the name, not a property of something else (`x.n`) — but `...n` spreads it, so it counts
    ? [...reactive].filter(n => new RegExp(`(?<![\\w$])(?<!(?<!\\.\\.)\\.)${n}(?![\\w$])`).test(code))
    : deps;
  return `, [${names.join(', ')}]`;
}

// A hook line's statements: the inline body plus one per child line (`off …` is the cleanup).
function fxParts(ctx, n) {
  const body = n.body ? stmts(ctx, n.body) : [], cleanup = [];
  for (const k of n.kids) {
    const src = lineText(k);
    if (k.raw[0] === 'off') cleanup.push(...stmts(ctx, src.slice(4)));
    else body.push(...stmts(ctx, src));
  }
  return { body, cleanup };
}

const lineText = n => [n.raw.join(' '), ...(n.kids || []).map(lineText)].join(' ');

// The names a destructuring pattern binds: `{ a, b: c, ...rest }` -> a, c, rest. The key side of
// a rename is a property, not a binding.
function bindNames(pattern) {
  const body = pattern.replace(/^[{[]/, '').replace(/[}\]]$/, '');
  const out = [];
  for (const seg of splitStmts(body.replace(/,/g, ';'))) {
    const m = /^(?:\.\.\.)?(?:[\w$]+\s*:\s*)?([A-Za-z_$][\w$]*)/.exec(seg.trim());
    if (m) out.push(m[1]);
  }
  return out;
}

function hookCode(ctx, n, reactive, declared = []) {
  here(n);
  // Two declarations of one name are a syntax error in the generated module, which is a long
  // way from the line that caused it — `cb setX()` beside `s:x` is the easy mistake.
  const claim = name => {
    const clash = ctx.props.some(p => p.name === name) ? 'a `p:` prop'
      : ctx.state.some(st => st.name === name) ? 'a `s:` state'
      : ctx.state.some(st => setter(st.name) === name) ? `the setter for \`s:${name[3].toLowerCase()}${name.slice(4)}\``
      : declared.includes(name) ? 'declared by an earlier line' : null;
    if (clash) fail(n, `${name} is already ${clash}`);
    return name;
  };
  const bind = name => { claim(name); declared.push(name); reactive.add(name); };
  if (n.kind === 'js') return ['  ' + [n.code, ...n.kids.map(lineText)].join(' ')];
  if (n.hook === 'ref') { declared.push(claim(n.name)); return [`  const ${n.name} = useRef(${interp(n.init)});`]; }
  if (n.hook === 'ctx') { bind(n.name); return [`  const ${n.name} = useContext(${n.expr});`]; }
  if (n.hook === 'use') {
    if (!n.name) return [`  ${interp(n.expr)};`];      // `use useLayoutEffect(…)` — binds nothing
    const ids = bindNames(n.name);
    // `use { items, add } = Cart` — a bare store name reads that store, imported for you.
    if (/^[A-Z][\w$]*$/.test(n.expr)) {
      if (!ctx.stores.has(n.expr)) fail(n, `use …= ${n.expr}: no store \`S ${n.expr}\` in this app`);
      ctx.needs.add(n.expr);
      for (const id of ids) { bind(id); ctx.globals.add(id); }
      return [`  const ${n.name} = use${n.expr}();`];
    }
    // useState/useReducer hand back a stable setter second — a value, not a dependency.
    for (const id of /^use(State|Reducer)\(/.test(n.expr) ? ids.slice(0, 1) : ids) reactive.add(id);
    declared.push(...ids.map(claim));
    return [`  const ${n.name} = ${interp(n.expr)};`];
  }
  if (n.hook === 'memo') {
    noHooks(n, n.expr);
    const code = interp(n.expr), deps = depsOf(n.deps, code, reactive);
    bind(n.name);
    return [`  const ${n.name} = useMemo(() => ${code}${deps});`];
  }
  if (n.hook === 'cb') {
    const { body, cleanup } = fxParts(ctx, n);
    noHooks(n, [...body, ...cleanup].join('; '));
    const deps = depsOf(n.deps, [...body, ...cleanup].join('; '), reactive);
    bind(n.name);
    return [`  const ${n.name} = useCallback(${n.params} => ${fnBody(body)}${deps});`];
  }
  const { body, cleanup } = fxParts(ctx, n);
  if (!body.length && !cleanup.length) fail(n, 'fx: empty effect body');
  noHooks(n, [...body, ...cleanup].join('; '));
  const deps = depsOf(n.deps, [...body, ...cleanup].join('; '), reactive);
  return ['  useEffect(() => {',
    ...body.map(st => `    ${st};`),
    ...(cleanup.length ? [`    return () => ${fnBody(cleanup)};`] : []),
    `  }${deps});`];
}

// An error boundary is the one thing React still needs a class for — no hook catches a render
// error. `C Oops catch` generates that class: the children render while nothing has thrown, and
// the markup is the fallback, with `error` and `reset` in scope.
function boundary(node, target, opts = {}) {
  const ctx = { props: [], state: [], globals: new Set(), needs: new Set(), spread: new Map(),
    stores: opts.stores || new Map() };
  for (const p of node.parts) {
    if (p === 'catch') continue;
    if (p.startsWith('s:')) fail(node, `C ${node.name} catch: an error boundary is a class, so it`
      + ` has no \`s:\` state — keep state in a child component`);
    if (p.startsWith('p:')) {
      const [name, ...d] = p.slice(2).split('=');
      if (!IDENT.test(name)) fail(node, `${p}: \`${name}\` is not a name`);
      ctx.props.push({ name, def: d.join('=') || null });
      continue;
    }
    fail(node, `C ${node.name} catch: unknown \`${p}\` — a boundary takes p: props only`);
  }
  for (const k of node.kids) {
    if (k.kind === 'hook' || k.kind === 'js') fail(k, `C ${node.name} catch: an error boundary is a`
      + ` class, so it has no hooks — keep them in a child component`);
  }
  const root = { kind: 'frag', kids: node.kids, root: true };
  const fallback = target === 'jsx'
    ? `    return (\n${jsxNode(ctx, root, 6)}\n    );`
    : `    return ${esmNode(ctx, root)};`;
  const props = ['children', ...ctx.props.map(p => p.def ? `${p.name} = ${p.def}` : p.name)];
  return { ctx, declared: [], react: ['Component'],
    codes: node.kids.flatMap(codeOf).join(' '),
    code: [`${exportKeyword(node, opts)} class ${node.name} extends Component {`,
      `  state = { error: null };`,
      `  static getDerivedStateFromError(error) { return { error }; }`,
      `  render() {`,
      `    const { ${props.join(', ')} } = this.props;`,
      `    const { error } = this.state;`,
      `    const reset = () => this.setState({ error: null });`,
      `    if (!error) return children;`,
      fallback,
      `  }`,
      `}`].join('\n') };
}

/* ---------- store: `S Name` -> a context + provider + use<Name>() ---------- */

// A store is a component with no markup: its state and hooks become the context value, so
// `s:`, `memo`, `cb`, `fx`, `ref` and `use` all mean exactly what they mean in a `C` block.
function store(node, target, opts = {}) {
  const codes = node.kids.map(lineText).join(' ');
  const persist = node.parts.find(p => p === 'persist' || p.startsWith('persist='));
  const key = persist?.includes('=') ? persist.slice(8) : `zal:${node.name.toLowerCase()}`;
  const ctx = { props: [], state: [], globals: new Set(), needs: new Set(), stores: opts.stores || new Map() };
  for (const p of node.parts) {
    if (!p.startsWith('s:')) {
      if (p !== 'persist' && !p.startsWith('persist=')) {
        fail(node, `S ${node.name}: unknown \`${p}\` — an \`S\` line takes s: and persist`);
      }
      continue;
    }
    const [name, ...v] = p.slice(2).split('=');
    if (!IDENT.test(name)) fail(node, `${p}: \`${name}\` is not a name`);
    ctx.state.push({ name, init: v.join('=') || 'null' });
  }
  const lines = ctx.state.map(st =>
    `  const [${st.name}, ${setter(st.name)}] = useState(${persist ? `saved.${st.name} ?? ${st.init}` : st.init});`);
  const reactive = new Set(ctx.state.map(st => st.name)), declared = [];
  for (const k of node.kids) {
    if (k.kind !== 'hook' && k.kind !== 'js') fail(k, `S ${node.name}: a store has no markup`);
    lines.push(...hookCode(ctx, k, reactive, declared));
  }
  if (persist) {
    const names = ctx.state.map(st => st.name);
    lines.push(`  useEffect(() => {`,
      `    try { localStorage.setItem(KEY, JSON.stringify({ ${names.join(', ')} })); } catch {}`,
      `  }, [${names.join(', ')}]);`);
  }
  // Everything the store declares, plus a setter per state, is what consumers see.
  const value = [...ctx.state.flatMap(st => [st.name, setter(st.name)]), ...declared];
  const deps = [...new Set([...ctx.state.map(st => st.name), ...declared.filter(n => reactive.has(n))])];
  lines.push(`  const value = useMemo(() => ({ ${value.join(', ')} }), [${deps.join(', ')}]);`);
  const provider = target === 'jsx'
    ? `  return <${node.name}Context.Provider value={value}>{children}</${node.name}Context.Provider>;`
    : `  return h(${node.name}Context.Provider, { value }, children);`;
  const head = persist
    ? [`const KEY = ${JSON.stringify(key)};`,
       `const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; } })();`, '']
    : [];
  return { ctx, code: [
    ...head,
    `export const ${node.name}Context = createContext(null);`,
    '',
    `export function ${node.name}Provider({ children }) {`,
    ...lines,
    provider,
    '}',
    '',
    `export function use${node.name}() {`,
    `  const value = useContext(${node.name}Context);`,
    `  if (!value) throw new Error('use${node.name}() used outside <${node.name}Provider>');`,
    '  return value;',
    '}',
    '',
    ...(!opts.main || opts.main === node.name ? [`export default use${node.name};`] : []),
  ].join('\n') };
}

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

// Damerau-Levenshtein (optimal string alignment): a transposition is one edit, not two, because
// that is the slip people actually make — `Lien` is one keystroke away from `Line`.
const editDistance = (a, b) => {
  let prev2 = [], prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], prev2[j - 2] + 1);
      }
    }
    prev2 = prev; prev = row;
  }
  return prev[b.length];
};

// The closest name worth suggesting — within a third of the name's length, or two edits.
function nearest(name, pool) {
  let best = null, score = Infinity;
  for (const c of pool) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d < score) { score = d; best = c; }
  }
  return score <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
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

export function compile(src, target = 'jsx',
  { ui = null, used = null, pkgs = null, pins = null, cdn = CDN, stores = new Map(),
    comps: known = new Map(), main = null, dir = '', assets = null } = {}) {
  if (target !== 'jsx' && target !== 'esm') throw new Error(`unknown backend: ${target}`);
  const ext = target === 'jsx' ? '.jsx' : '.js';
  const ast = parse(src);
  memberTags(ast, moduleScope(ast));
  linkUI(ast, ui, used);
  checkComponents(ast, known, dir);
  const imports = [], comps = [], raw = [], needs = new Set(), fromReact = new Set(), codes = [];
  // The default export is the block named after the file, or the first one if none matches.
  const blocks = ast.kids.filter(n => n.kind === 'comp' || n.kind === 'store').map(n => n.name);
  const def = blocks.includes(main) ? main : blocks[0];
  // Two blocks of one name would be two declarations of it in the module.
  const twice = new Set();
  for (const n of ast.kids) {
    if (n.kind !== 'comp' && n.kind !== 'store') continue;
    if (twice.has(n.name)) fail(n, `${n.kind === 'store' ? 'S' : 'C'} ${n.name} is declared twice in this file`);
    twice.add(n.name);
  }
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
    if (n.kind === 'comp' || n.kind === 'store') {
      const emit = n.kind === 'store' ? store : n.parts.includes('catch') ? boundary : component;
      const out = emit(n, target, { stores, main: def, scope: moduleScope(ast) });
      for (const name of out.ctx.needs) needs.add(name);
      for (const name of out.react || []) fromReact.add(name);
      codes.push(out.codes || '');
      comps.push(out.code);
    }
  }
  const body = comps.join('\n\n');
  for (const name of needs) imports.push(`import { use${name} } from '${rel(dir, stores.get(name))}${ext}';`);
  // `Link`, `go`, `useRoute`, `Suspense`… are free to use: a module that names one gets the import,
  // unless it binds that name itself. Read from tags and code positions, so the same word sitting
  // in a text node imports nothing.
  const own = new Set([...boundNames(ast), ...moduleScope(ast)]);
  const tags = compRefs(ast), code = codes.join(' ');
  const uses = n => !own.has(n)
    && (tags.has(n) || new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(code));
  const fromRouter = ROUTER_EXPORTS.filter(uses);
  if (fromRouter.length) imports.push(`import { ${fromRouter.join(', ')} } from '${rel(dir, 'router')}${ext}';`);
  for (const n of REACT_COMPS) if (!own.has(n) && tags.has(n)) fromReact.add(n);
  const react = [...new Set([...fromReact,
    ...[...REACT_HOOKS, 'createContext'].filter(h => new RegExp(`\\b${h}\\(`).test(body)),
    target === 'jsx' && /<Fragment[ >]/.test(body) && 'Fragment',
    target === 'esm' && 'createElement as h', target === 'esm' && 'Fragment as F'])]
    .filter(Boolean);
  const head = [react.length ? `import { ${react.join(', ')} } from 'react';` : null, ...imports].filter(Boolean);
  // (importLine returns null for package css in esm mode — the page links it instead)
  return [...head, '', ...raw, ...comps].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---------- app ---------- */

export function parseApp(src) {
  const node = parse(src).kids.find(n => n.kind === 'app');
  if (!node) throw new Error('app file has no `A <Name>` block');
  const app = { name: node.name, ln: node.ln, title: node.name, mount: 'root', ui: null, css: [], routes: [],
    pins: new Map(), cdn: CDN, storeOrder: [] };
  for (const k of node.kids) {
    if (k.kind === 'route') { app.routes.push({ path: k.path, component: k.component, lazy: k.lazy, ln: k.ln }); continue; }
    const [key, ...rest] = k.raw;
    const val = rest.join(' ').replace(/^"|"$/g, '');
    if (key === 't') app.title = val;
    else if (key === 'm') app.mount = val.replace(/^#/, '');
    else if (key === 'ui') app.ui = val;
    else if (key === 'css') app.css.push(val);
    else if (key === 'store') app.storeOrder.push(...rest);
    else if (key === 'pkg') { const { pkg, version } = splitSpec(val); app.pins.set(pkg, version); }
    else if (key === 'cdn') app.cdn = val.replace(/\/$/, '');
    else fail(k, `app: unknown directive \`${key}\``);
  }
  return app;
}

const router = target => `import { useState, useEffect, createElement } from 'react';

// Minimal hash router: zero dependencies, patterns may contain :params.
function match(pattern, path) {
  const p = pattern.split('/').filter(Boolean), q = path.split('/').filter(Boolean);
  if (p.length !== q.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(q[i]);
    else if (p[i] !== q[i]) return null;
  }
  return params;
}

export function useRoute() {
  const read = () => window.location.hash.slice(1) || '/';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}

// Navigate from code: go('/done')
export const go = to => { window.location.hash = to; };

export function Link({ to, children, ...rest }) {
  const path = useRoute();
  return createElement('a', { href: '#' + to, 'data-active': path === to || undefined, ...rest }, children);
}

export function Router({ routes, fallback }) {
  const path = useRoute();
  for (const r of routes) {
    const params = match(r.path, path);
    if (params) return createElement(r.component, params);
  }
  return fallback ?? createElement('p', null, 'Not found: ' + path);
}
`;

// Providers listed in app.zal (`store A B`) wrap outermost-first, the rest follow by name.
function storeOrder(app, stores) {
  const named = app.storeOrder.filter(n => stores.has(n));
  for (const n of app.storeOrder) if (!stores.has(n)) fail(app.ln, `store ${n}: no \`S ${n}\` in ${SRC_DIR}/`);
  return [...named, ...[...stores.keys()].filter(n => !named.includes(n)).sort()];
}

function mainFile(app, target, stores = new Map(), paths = new Map()) {
  const ext = target === 'jsx' ? '.jsx' : '.js';
  const comps = [...new Set(app.routes.map(r => r.component))];
  const routes = new Map(comps.map(c => [c, paths.get(c)?.file ?? c]));
  // `/* NotFound` is the catch-all: not a pattern to match, but what the router renders when
  // nothing matched, so it stays last however the routes are ordered.
  const miss = app.routes.find(r => r.path === '/*')?.component ?? null;
  const table_ = app.routes.filter(r => r.path !== '/*');
  const order = storeOrder(app, stores);
  // A `lazy` route is fetched on first visit instead of shipping inside the main bundle.
  const split = new Set(app.routes.filter(r => r.lazy).map(r => r.component));
  const imports = `import { createRoot } from 'react-dom/client';
import { Router } from './router${ext}';
${order.map(n => `import { ${n}Provider } from './${stores.get(n)}${ext}';`).join('\n')}
${comps.filter(c => !split.has(c)).map(c => `import ${c} from './${routes.get(c)}${ext}';`).join('\n')}
${[...split].map(c => `const ${c} = lazy(() => import('./${routes.get(c)}${ext}'));`).join('\n')}`
    .replace(/\n{2,}/g, '\n').trim();
  const table = `const routes = [\n${table_.map(r => `  { path: '${r.path}', component: ${r.component} },`).join('\n')}\n];`;
  if (target === 'jsx') {
    const wrap = [...order.map(n => [`<${n}Provider>`, `</${n}Provider>`]),
      ...split.size ? [['<Suspense fallback={null}>', '</Suspense>']] : []];
    const open = wrap.map(([o], i) => `${'  '.repeat(i + 2)}${o}`);
    const close = wrap.map(([, c], i) => `${'  '.repeat(i + 2)}${c}`).reverse();
    // (local stylesheets are linked by index.html — in both backends, so they load once)
    const router_ = `<Router routes={routes}${miss ? ` fallback={<${miss} />}` : ''} />`;
    return `import React${split.size ? ', { lazy, Suspense }' : ''} from 'react';\n${imports}\n
${table}

createRoot(document.getElementById('${app.mount}')).render(
  <React.StrictMode>
${[...open, `${'  '.repeat(wrap.length + 2)}${router_}`, ...close].join('\n')}
  </React.StrictMode>
);
`;
  }
  const args = `{ routes${miss ? `, fallback: createElement(${miss})` : ''} }`;
  const routed = split.size
    ? `createElement(Suspense, { fallback: null }, createElement(Router, ${args}))`
    : `createElement(Router, ${args})`;
  const tree = order.reduceRight((inner, n) => `createElement(${n}Provider, null, ${inner})`, routed);
  return `import { createElement, StrictMode${split.size ? ', lazy, Suspense' : ''} } from 'react';\n${imports}\n
${table}

createRoot(document.getElementById('${app.mount}')).render(
  createElement(StrictMode, null, ${tree})
);
`;
}

// react, react-dom and whatever the `i` lines named — every bare specifier the modules use.
function importMap(app, pkgs) {
  const v = n => app.pins.get(n) || REACT_V;                     // `pkg react@19.2.0` moves the app
  const react = `${app.cdn}/react@${v('react')}`, dom = `${app.cdn}/react-dom@${v('react-dom')}`;
  const imports = { react, 'react/jsx-runtime': `${react}/jsx-runtime`,
    'react-dom': dom, 'react-dom/client': `${dom}/client` };
  for (const [id, p] of pkgs || []) if (!p.css) imports[id] = p.url;
  return JSON.stringify({ imports }, null, 2).replace(/^/gm, '      ');
}

const html = (app, target, pkgs) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${app.title}</title>
${[
    ...[...(target === 'esm' ? [...pkgs || []].filter(([, p]) => p.css).map(([, p]) => p.url) : []),
      app.ui && `${OUT_CSS}/ui.css`,
      ...app.css.map(c => /^https?:/.test(c) ? c : `${OUT_CSS}/${basename(c)}`)].filter(Boolean)
      .map(c => `    <link rel="stylesheet" href="${/^https?:/.test(c) ? c : './' + c}" />`),
    // only the no-install preview resolves packages in the page; a bundler reads the imports
    target === 'esm' && `    <script type="importmap">\n${importMap(app, pkgs)}\n    </script>`,
  ].filter(Boolean).join('\n')}
  </head>
  <body>
    <div id="${app.mount}"></div>
    <script type="module" src="./${OUT_SRC}/main${target === 'jsx' ? '.jsx' : '.js'}"></script>
  </body>
</html>
`;

// app.zal, the design system and every block in zal/ — the context a source file compiles
// against. Shared, so compiling one file alone means exactly what compiling the app means.
export function project({ root = '.', appFile = APP_FILE, srcDir = SRC_DIR } = {}) {
  if (!existsSync(join(root, appFile))) {
    // Point at the layout, rather than leaving an ENOENT to be decoded. An earlier Zal kept
    // sources in src/ with app.zal at the root, so name the move when either is what is there.
    const name = basename(appFile);
    const stray = existsSync(join(root, 'src', name)) ? ` — rename src/ to ${srcDir}/`
      : existsSync(join(root, name)) ? ` — move ${name} into ${srcDir}/`
      : existsSync(join(root, 'src')) ? ` — rename src/ to ${srcDir}/ and put ${name} in it`
      : '';
    throw new Error(`no ${appFile}: a Zal project keeps its sources in ${srcDir}/${stray}`);
  }
  const appSrc = readFileSync(join(root, appFile), 'utf8');
  const app = inFile(appSrc, appFile, () => parseApp(appSrc));
  // `ui ./ui.zal` and `css ./app.css` are written the way the app file reads them, so they
  // resolve against its directory; from here on both are paths from the project root.
  const near = p => /^https?:/.test(p) ? p : posix(join(dirname(appFile), p));
  if (app.ui) app.ui = near(app.ui);
  app.css = app.css.map(near);
  // A `ui` line pointing at nothing means the app has no design system — say so, rather than
  // linking a stylesheet the build never wrote.
  const uiSrc = app.ui && existsSync(join(root, app.ui)) ? readFileSync(join(root, app.ui), 'utf8') : null;
  if (app.ui && uiSrc === null) { app.uiMissing = app.ui; app.ui = null; }
  const ui = uiSrc === null ? null : inFile(uiSrc, app.ui, () => parseUI(uiSrc));
  // Read every source first: a store has to be known before the files that consume it compile.
  // Subdirectories come along — the output mirrors the tree, so `i Btn ./ui/Btn` resolves itself.
  // The app file and the design system live in zal/ too, and are config, not modules.
  const config = new Set([appFile, app.ui].filter(Boolean).map(posix));
  const sources = new Map(readdirSync(join(root, srcDir), { recursive: true })
    .map(f => String(f).split(sep).join('/')).filter(f => /\.zal$/.test(f)).sort()
    .filter(f => !config.has(posix(join(srcDir, f))))
    .map(f => [f, readFileSync(join(root, srcDir, f), 'utf8')]));
  // Every block in zal/, so a file referencing a component can be told which `i` line it needs.
  const stores = new Map(), comps = new Map(), clashes = [];
  for (const [f, src] of sources) {
    const file = f.replace(/\.zal$/, '');
    for (const [, head, name] of src.matchAll(/^([CS])[ \t]+([A-Za-z][\w$]*)/gm)) {
      // One name, two files: a reference to it would resolve to whichever came last.
      const prev = head === 'S' ? stores.get(name) : comps.get(name)?.file;
      if (prev && prev !== file) clashes.push(`${head} ${name} is declared in both ${prev}.zal and ${file}.zal`);
      if (head === 'S') stores.set(name, file);
      else comps.set(name, { file, named: name !== basename(file) });
    }
  }
  return { app, appSrc, ui, sources, stores, comps, clashes };
}

export function build({ root = '.', appFile = APP_FILE, srcDir = SRC_DIR, target = 'jsx' } = {}) {
  const outDir = target === 'jsx' ? APP_DIR : DEV_DIR;
  const ext = target === 'jsx' ? '.jsx' : '.js';
  const { app, appSrc, ui, sources, stores, comps, clashes } = project({ root, appFile, srcDir });
  const made = [], used = new Map(), pkgs = new Map(), assets = new Set();
  inFile(appSrc, appFile, () => { for (const r of app.routes) {
    const c = comps.get(r.component);
    if (!c) fail(r, `route ${r.path}: no \`C ${r.component}\` in ${srcDir}/`);
    if (c.named) fail(r, `route ${r.path}: \`C ${r.component}\` is in ${srcDir}/${c.file}.zal — a route`
      + ` component is imported from its own file, so it belongs in a file named ${r.component}.zal`);
  } });
  // Compile the whole app before writing anything: a build that fails leaves the last good
  // output untouched, instead of a directory half-new and half-old that nothing can run.
  const files = new Map();
  for (const [f, src] of sources) {
    const seen = new Set();
    const path = f.replace(/\.zal$/, '');
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const code = inFile(src, join(srcDir, f), () => compile(src, target,
      { ui, used: seen, pkgs, pins: app.pins, cdn: app.cdn, stores, comps, dir, assets, main: basename(path) }));
    files.set(`${OUT_SRC}/${path}${ext}`, code);
    for (const c of seen) if (!used.has(c)) used.set(c, f);
    made.push(`${OUT_SRC}/${path}${ext}`);
  }
  const warnings = ui
    ? [...used].filter(([c]) => !ui.known.has(c)).map(([c, f]) => `${f}: class .${c} is not in the UI kit`)
    : [];
  if (app.uiMissing) warnings.push(`${appFile}: ui ${app.uiMissing} is not there — no design system`);
  warnings.push(...clashes);
  for (const [id, p] of pkgs) {
    if (p.clash) warnings.push(p.clash);
    if (!p.version) warnings.push(`${id} is unpinned — add \`pkg ${p.pkg}@<version>\` to ${appFile}`);
  }
  files.set(`${OUT_SRC}/router${ext}`, router(target));
  files.set(`${OUT_SRC}/main${ext}`, inFile(appSrc, appFile, () => mainFile(app, target, stores, comps)));
  files.set('index.html', html(app, target, pkgs));
  if (ui) files.set(`${OUT_CSS}/ui.css`, uiCss(ui));
  mkdirSync(join(root, outDir), { recursive: true });
  // The esm preview is served straight from disk and installs nothing, so it needs no project
  // files; `application/` is the one a developer runs, builds and commits.
  const scaffolded = target === 'jsx' ? scaffold(join(root, outDir), app) : [];
  const deps = target === 'jsx' ? syncDeps(join(root, outDir), pkgs) : [];
  for (const [name, code] of files) {
    if (name.includes('/')) mkdirSync(join(root, outDir, name.slice(0, name.lastIndexOf('/'))), { recursive: true });
    writeFileSync(join(root, outDir, name), code);
  }
  const copied = [];
  // An `i logo ./logo.png` line names a file in zal/: the output mirrors the tree, so the asset
  // lands at the same path beside the module that imports it.
  for (const a of assets) {
    const from = join(root, srcDir, a);
    if (!existsSync(from)) { warnings.push(`${a} is imported but not in ${srcDir}/`); continue; }
    const to = `${OUT_SRC}/${a}`;
    mkdirSync(join(root, outDir, to.slice(0, to.lastIndexOf('/'))), { recursive: true });
    writeFileSync(join(root, outDir, to), readFileSync(from));
    copied.push(to);
  }
  for (const c of app.css) {
    const from = join(root, c);
    if (!existsSync(from)) continue;
    const to = `${OUT_CSS}/${basename(c)}`;
    mkdirSync(join(root, outDir, OUT_CSS), { recursive: true });
    writeFileSync(join(root, outDir, to), readFileSync(from));
    copied.push(to);
  }
  // A deleted or renamed .zal must not leave a live module behind in the output. Only the
  // generated tree is swept: node_modules/, dist/ and anything else in `application/` belongs
  // to the developer, and a rebuild has no business reaching into it.
  const keep = new Set([...files.keys(), ...copied]);
  const genDir = join(root, outDir, OUT_SRC);
  const stale = (existsSync(genDir) ? readdirSync(genDir, { recursive: true }) : [])
    .map(f => `${OUT_SRC}/${String(f).split(sep).join('/')}`)
    .filter(f => /\.(jsx?|css)$/.test(f) && !keep.has(f))
    .filter(f => statSync(join(root, outDir, f)).isFile());        // assets are left alone
  for (const f of stale) unlinkSync(join(root, outDir, f));
  // A directory the output no longer mirrors goes with it; deepest first, and only if it is empty.
  // Every ancestor is a candidate: emptying src/pages/ may leave src/ empty too.
  const dirs = new Set();
  for (const f of stale) {
    const parts = f.split('/').slice(0, -1);
    for (let i = parts.length; i > 0; i--) dirs.add(parts.slice(0, i).join('/'));
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try { rmdirSync(join(root, outDir, d)); } catch {}            // not empty: something else lives there
  }
  return { app, made, outDir, ui, warnings, pkgs, deps, stores, stale, scaffolded };
}

/* ---------- static server (esm mode) ---------- */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const RELOAD = `<script>new EventSource('/__zal').onmessage = () => location.reload();</script>`;

export function serve(dir, port = 5173, { live = false } = {}) {
  const clients = new Set();
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/__zal') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (file !== root && !file.startsWith(root + sep)) {   // `..` must not reach outside the build
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      // A route falls back to the page — the hash router takes it from there. A missing *asset*
      // is a 404 that says so: HTML answered to an `import` only ever surfaces as a parse error
      // somewhere else, which costs a debugging round trip to trace back to here.
      if (extname(path)) {
        console.error(`  404  ${path}`);
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end(`zal: ${path} is not in ${dir}/ — the last build did not generate it`);
        return;
      }
      file = join(root, 'index.html');
    }
    let body = readFileSync(file);
    if (live && file.endsWith('index.html')) body = body.toString().replace('</body>', `  ${RELOAD}\n  </body>`);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'text/plain', 'cache-control': 'no-store' });
    res.end(body);
  });
  server.listen(port, () => console.log(`  \u279c  http://localhost:${port}`));
  return {
    server,
    reload: () => { for (const c of clients) c.write('data: reload\n\n'); },
    close: () => { for (const c of clients) c.end(); server.closeAllConnections?.(); server.close(); },
  };
}

// Rebuild on any .zal/.css change, then tell open browsers to reload.
export function watchAndServe({ port = 5173, srcDir = SRC_DIR } = {}) {
  const first = build({ target: 'esm' });
  console.log(`\n  Zal  ${first.app.name}  \u2014 ${first.made.length} modules, ${first.app.routes.length} routes`
    + (first.ui ? `, design system ${first.ui.name}` : '') + pkgLine(first.pkgs));
  warn(first.warnings);
  const { reload } = serve(first.outDir, port, { live: true });
  console.log('  watching for changes...\n');
  let timer;
  const onChange = f => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const next = build({ target: 'esm' });
        warn(next.warnings);
        console.log(`  rebuilt (${f})` + (next.stale.length ? `, removed ${next.stale.join(', ')}` : ''));
        reload();
      } catch (e) { console.error(`  error: ${e.message}`); }
    }, 60);
  };
  watch(srcDir, { recursive: true }, (_, f) => f && /\.(zal|css)$/.test(String(f)) && onChange(f));
  for (const f of first.app.css.filter(c => !posix(c).startsWith(srcDir + '/'))) {
    if (existsSync(f)) watch(f, () => onChange(f));
  }
}

/* ---------- cli ---------- */

const warn = list => { for (const w of list || []) console.error(`  warn  ${w}`); };

// `, 2 packages (canvas-confetti@1.9.3, framer-motion@latest)`
const pkgLine = pkgs => pkgs?.size
  ? `, ${pkgs.size} package${pkgs.size > 1 ? 's' : ''} (`
    + [...pkgs].map(([id, p]) => p.css ? id : `${id}@${p.version || 'latest'}`).join(', ') + ')'
  : '';

// Which of the app's packages are not unpacked in the app's node_modules yet.
const notInstalled = (dir, pkgs) => [...pkgs.values()].filter(p => !existsSync(join(dir, 'node_modules', p.pkg)));

export function cli(argv) {
  const cmd = argv[0] ?? 'help';
  const vite = argv.includes('--vite');
  const port = Number(argv.find(a => /^\d+$/.test(a))) || 5173;

  if (cmd === 'dev' && !vite) return watchAndServe({ port });

  if (cmd === 'dev' || cmd === 'build' || cmd === 'serve') {
    // A build writes the deliverable: a real React project in application/. The esm preview is
    // only what `zal serve` needs to run without installing anything, so it stays out of the
    // way in .zal-dev/ and never touches the folder the developer has under git.
    const target = cmd === 'serve' ? 'esm' : 'jsx';
    const { app, made, outDir, ui, warnings, pkgs, deps, stale, scaffolded } = build({ target });
    console.log(`Zal ${app.name}: ${made.length} modules -> ${outDir}/, ${app.routes.length} routes`
      + (ui ? `, ui ${ui.name}` : '') + pkgLine(pkgs));
    if (scaffolded?.length) console.log(`  + ${outDir}/${scaffolded.join(`, ${outDir}/`)}`);
    if (deps?.length) console.log(`  + ${outDir}/package.json: ${deps.join(', ')}`);
    if (stale.length) console.log(`  - removed ${stale.length} stale file(s): ${stale.join(', ')}`);
    warn(warnings);
    if (cmd === 'build') console.log(`  ${outDir}/ is a standalone React app — \`cd ${outDir} && npm install && npm run dev\``);
    if (cmd === 'serve') serve(outDir, port, { live: false });
    else if (cmd === 'dev') {                       // --vite path: run the real app
      if (!existsSync(join(outDir, 'node_modules', 'vite')) || notInstalled(outDir, pkgs).length) {
        console.log(`installing deps in ${outDir}/...`);
        spawnSync('npm', ['install', '--no-audit', '--no-fund'], { stdio: 'inherit', cwd: outDir });
      }
      spawnSync('npx', ['vite'], { stdio: 'inherit', cwd: outDir });
    }
    return;
  }

  if (/\.zal$/.test(cmd)) {                    // single file
    const target = vite ? 'jsx' : 'esm';
    const outDir = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'out';
    mkdirSync(outDir, { recursive: true });
    const name = basename(cmd).replace(/\.zal$/, '');
    const dest = join(outDir, name + (target === 'jsx' ? '.jsx' : '.js'));
    const src = readFileSync(cmd, 'utf8');
    // One file still belongs to its app: the design system, the stores and the package pins come
    // from app.zal, so `%entry` and `use … = Store` mean here what they mean in a full build.
    const p = existsSync(APP_FILE) ? project() : null;
    writeFileSync(dest, inFile(src, cmd, () => compile(src, target, { ui: p?.ui, stores: p?.stores,
      comps: p?.comps, pins: p?.app.pins, cdn: p?.app.cdn, main: name })));
    console.log(`${cmd} -> ${dest}`);
    return;
  }

  console.error(`zal — compile .zal sources into a React app

  zal build           write the React app to application/
  zal dev [port]      preview and live-reload on change          (no install needed)
  zal dev --vite      build application/ and run it through Vite (installs there)
  zal serve [port]    serve the preview without watching
  zal <file.zal>      compile a single file

sources live in zal/ (app.zal and ui.zal included). \`zal build\` writes application/ — a
standalone React app with its own package.json, vite.config.js, index.html and src/ tree —
which is the folder to commit, install and deploy. \`zal dev\` previews it without installing
anything, from .zal-dev/, and leaves application/ untouched.`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { cli(process.argv.slice(2)); }
  catch (e) { console.error(`  error  ${e.message}`); process.exit(1); }
}
