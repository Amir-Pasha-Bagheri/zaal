// Expressions, statements and attributes: the parts of a line that are JavaScript, plus the
// attribute list a markup line carries. `EV`/`ALIAS` are the one target-flavoured piece —
// a target spelling events or the class attribute differently passes its own tables.
import { here, fail } from './diagnostics.mjs';
import { splitAssign, setter, isState, ID, IDC } from './parse.mjs';

// `"{children}"` is the element, not its text: a string that is one whole `{…}` stays an expression.
// `\{` is a literal brace.
const tmpl = s => /^\{[^{}]+\}$/.test(s) ? s.slice(1, -1)
  : '`' + s.replace(/`/g, '\\`')
      .replace(/\\([{}])|\{([^}]+)\}/g, (_, lit, expr) => lit ?? '${' + expr + '}') + '`';

// The short names Zaal adds, then every DOM event React spells differently from the HTML name.
// Without the second table `@keyup` becomes `onKeyup`, which React never attaches: the handler
// is silently dead, and nothing says so.
// Interpolated text, as React reads it: every `{expr}` is a child of its own. A template
// literal would print `true`, `null` or `[object Object]` where JSX renders nothing at all —
// the two backends have to put the same thing on the page.
function textParts(s) {
  const parts = [];
  let buf = '';
  const flush = () => { if (buf) { parts.push({ lit: true, code: JSON.stringify(buf) }); buf = ''; } };
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && (s[i + 1] === '{' || s[i + 1] === '}')) { buf += s[++i]; continue; }
    if (s[i] === '{') {
      const end = s.indexOf('}', i);
      if (end < 0) { buf += s[i]; continue; }                 // a lone brace is text
      flush();
      parts.push({ lit: false, code: s.slice(i + 1, end) });  // the expression itself
      i = end;
      continue;
    }
    buf += s[i];
  }
  flush();
  return parts.length ? parts : [{ lit: true, code: '""' }];
}

const EV = { click: 'onClick', input: 'onInput', change: 'onChange', submit: 'onSubmit',
  focus: 'onFocus', blur: 'onBlur', key: 'onKeyDown', over: 'onMouseOver', out: 'onMouseLeave' };

const DOM_EV = {};
for (const name of [
  'doubleClick', 'mouseDown', 'mouseUp', 'mouseMove', 'mouseEnter', 'mouseLeave', 'mouseOver',
  'mouseOut', 'contextMenu', 'keyDown', 'keyUp', 'keyPress', 'focusCapture', 'beforeInput',
  'compositionStart', 'compositionEnd', 'compositionUpdate', 'dragStart', 'dragEnd', 'dragEnter',
  'dragLeave', 'dragOver', 'dragExit', 'touchStart', 'touchMove', 'touchEnd', 'touchCancel',
  'pointerDown', 'pointerUp', 'pointerMove', 'pointerEnter', 'pointerLeave', 'pointerCancel',
  'pointerOver', 'pointerOut', 'gotPointerCapture', 'lostPointerCapture', 'animationStart',
  'animationEnd', 'animationIteration', 'transitionEnd', 'scrollEnd', 'canPlay',
  'canPlayThrough', 'durationChange', 'loadedData', 'loadedMetadata', 'loadStart', 'rateChange',
  'timeUpdate', 'volumeChange', 'auxClick', 'toggle', 'select', 'wheel', 'scroll', 'drag',
  'drop', 'load', 'error', 'abort', 'reset', 'invalid', 'copy', 'cut', 'paste', 'play',
  'playing', 'pause', 'ended', 'seeked', 'seeking', 'stalled', 'suspend', 'waiting', 'progress',
  'emptied', 'encrypted', 'resize', 'close', 'cancel',
]) DOM_EV[name.toLowerCase()] = 'on' + name[0].toUpperCase() + name.slice(1);
DOM_EV.dblclick = DOM_EV.doubleclick;        // the HTML spelling of the same event

// `@ev` -> the React prop. An unknown name still becomes `onXxx`: that is a prop on a
// component, not a DOM event, and a component may call its callback anything.
const eventProp = ev => EV[ev] || DOM_EV[ev.toLowerCase()] || 'on' + ev[0].toUpperCase() + ev.slice(1);
const ALIAS = { c: 'className', val: 'value', ph: 'placeholder' };

// The HTML spelling of a DOM attribute, which React does not accept: `tabindex=0` is dropped
// with a console warning, `for=` never reaches the label. Markup here looks like HTML, so
// these are the spellings people (and agents) write — they are translated, not reported.
const DOM_ATTR = {};
for (const name of ['className', 'htmlFor', 'tabIndex', 'readOnly', 'maxLength', 'minLength',
  'autoFocus', 'autoComplete', 'autoPlay', 'spellCheck', 'contentEditable', 'crossOrigin',
  'dateTime', 'encType', 'formAction', 'formMethod', 'formNoValidate', 'inputMode',
  'noValidate', 'srcSet', 'srcDoc', 'colSpan', 'rowSpan', 'useMap', 'accessKey',
  'allowFullScreen', 'playsInline', 'referrerPolicy', 'frameBorder', 'marginWidth',
  'marginHeight', 'cellPadding', 'cellSpacing', 'charSet', 'httpEquiv', 'viewBox',
  'preserveAspectRatio', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'fillRule',
  'clipPath', 'clipRule', 'stopColor', 'stopOpacity', 'textAnchor', 'dominantBaseline',
]) DOM_ATTR[name.toLowerCase()] = name;
DOM_ATTR.class = 'className';
DOM_ATTR.for = 'htmlFor';

// `style="color: red"` — React wants an object, and throws on a string. The text says exactly
// what the object should be, so it is written out rather than rejected.
const styleObject = css => {
  const props = css.split(';').map(d => d.trim()).filter(Boolean).map(d => {
    const i = d.indexOf(':');
    if (i < 0) return null;
    // a custom property keeps its name exactly; everything else camel-cases
    const raw = d.slice(0, i).trim();
    const key = raw.startsWith('--') ? raw : raw.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = d.slice(i + 1).trim();
    // a value interpolates like any other attribute: `style="width: {w}px"`
    const code = /(?<!\\)\{[^}]+\}/.test(val) ? tmpl(val) : JSON.stringify(val);
    return `${/^[A-Za-z][\w]*$/.test(key) ? key : JSON.stringify(key)}: ${code}`;
  });
  return props.some(p => p === null) ? null : `{ ${props.join(', ')} }`;
};

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

// React state is replaced, never edited in place: `o.a = 1` or `xs.push(x)` changes the object
// the component is already holding, so nothing re-renders and the bug shows up as a screen that
// will not update. Both are typed often enough to be worth catching by name.
const MUTATORS = /^(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)$/;

function noMutation(ctx, s) {
  const own = n => isState(ctx, n) || ctx.globals?.has(n);
  const how = n => isState(ctx, n)
    ? `pass a new value to ${setter(n)}(…)` : `call one of its store's actions`;
  const say = (what, n) => fail(null,
    `${what} edits ${n} in place, so nothing re-renders — ${how(n)}`);
  let m = new RegExp(`^(${ID})\\s*(?:\\.${ID}|\\[[^\\]]*\\])+\\s*(?:[-+*/]?)=(?!=)`, 'u').exec(s);
  if (m && own(m[1])) say(s.trim(), m[1]);
  m = new RegExp(`^(${ID})\\.(${ID})\\(`, 'u').exec(s);
  if (m && own(m[1]) && MUTATORS.test(m[2])) say(`${m[1]}.${m[2]}(…)`, m[1]);
}

// `n++` / `n+=x` / `n=x` on a state name become setter calls; anything else is passed through.
function rewrite(ctx, s) {
  noMutation(ctx, s);
  let m = new RegExp(`^(${ID})(\\+\\+|--)$`, 'u').exec(s);
  if (m && isState(ctx, m[1])) return `${setter(m[1])}(${m[1]} ${m[2][0]} 1)`;
  m = new RegExp(`^(${ID})\\s*([-+*/]?)=\\s*(.+)$`, 'u').exec(s);
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
  if (list.length === 1 && new RegExp(`^${ID}$`, 'u').test(list[0])) return list[0];  // bare fn
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

// Two values for one attribute: JSX keeps the last and drops the first without a word, so
// `%card c="wide"` would quietly lose the kit's own classes. Classes are the one pair worth
// joining — that is what the author meant — and everything else is a mistake worth reporting.
const classPart = p => (p.str ? p.v : '${' + p.v + '}');

function addPair(node, pairs, pair) {
  const prev = pairs.find(p => p.k === pair.k);
  if (!prev) { pairs.push(pair); return; }
  if (pair.k !== 'className') {
    fail(node, `${pair.k} is set twice on <${node.tag}> — one of the two would be dropped`);
  }
  if (prev.str && pair.str) { prev.v = `${prev.v} ${pair.v}`; return; }
  prev.v = '`' + classPart(prev) + ' ' + classPart(pair) + '`';
  prev.str = false;
}

// -> { pairs: [{k, v, str}], spreads: [expr], text: [raw strings] }
function attrParts(ctx, node) {
  here(node);
  const pairs = [], spreads = [], text = [];
  const push = pair => addPair(node, pairs, pair);
  if (node.id) push({ k: 'id', v: node.id, str: true });
  if (node.classes.length) push({ k: 'className', v: node.classes.join(' '), str: true });
  for (const a of node.attrs) {
    if (a.startsWith('"')) { text.push(a.slice(1, -1)); continue; }
    if (a.startsWith('...')) {
      const x = a.slice(3);
      if (new RegExp(`^${ID}$`, 'u').test(x) && !ctx.spread?.has(x)) ctx.spread?.set(x, node);
      spreads.push(x);
      continue;
    }
    if (a.startsWith('@')) {
      const [ev, ...rest] = a.slice(1).split('=');
      push({ k: eventProp(ev), v: handler(ctx, unbrace(rest.join('='))) });
      continue;
    }
    const eq = a.indexOf('=');
    const dom = /^\p{Ll}/u.test(node.tag) && !node.tag.includes('.');   // a DOM element, not a component
    if (eq < 0) { push({ k: dom && DOM_ATTR[a] || a, v: 'true' }); continue; }
    const k = a.slice(0, eq), v = a.slice(eq + 1);
    const key = ALIAS[k] || (dom && DOM_ATTR[k.toLowerCase()]) || k;
    if (key === 'style' && v.startsWith('"')) {
      const obj = styleObject(v.slice(1, -1));
      if (!obj) fail(node, `style="${v.slice(1, -1)}": not a list of CSS declarations`);
      push({ k: 'style', v: obj });
      continue;
    }
    // `title="{n} items"` interpolates, the way a text node does; a string with no `{…}` in it
    // stays a plain string literal.
    if (v.startsWith('"')) {
      const inner = v.slice(1, -1);
      if (/(?<!\\)\{[^}]+\}/.test(inner)) push({ k: key, v: tmpl(inner) });
      else push({ k: key, v: inner.replace(/\\([{}])/g, '$1'), str: true });
    } else push({ k: key, v: unbrace(v) });
  }
  return { pairs, spreads, text };
}

export { EV, ALIAS, DOM_ATTR, tmpl, textParts, interp, splitStmts, rewrite, stmts, fnBody, handler, unbrace, attrParts };
