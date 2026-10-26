// Expressions, statements and attributes: the parts of a line that are JavaScript, plus the
// attribute list a markup line carries. `EV`/`ALIAS` are the one target-flavoured piece —
// a target spelling events or the class attribute differently passes its own tables.
import { here, fail } from './diagnostics.mjs';
import { splitAssign, setter, isState } from './parse.mjs';

// `"{children}"` is the element, not its text: a string that is one whole `{…}` stays an expression.
// `\{` is a literal brace.
const tmpl = s => /^\{[^{}]+\}$/.test(s) ? s.slice(1, -1)
  : '`' + s.replace(/`/g, '\\`')
      .replace(/\\([{}])|\{([^}]+)\}/g, (_, lit, expr) => lit ?? '${' + expr + '}') + '`';

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

// `k={expr}` is how JSX writes it; Zaal writes `k=expr`. Take either — the braces are the habit
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

export { EV, ALIAS, tmpl, interp, splitStmts, rewrite, stmts, fnBody, handler, unbrace, attrParts };
