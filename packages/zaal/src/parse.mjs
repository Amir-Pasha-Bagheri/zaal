// Indentation -> a tree of nodes. Nothing here knows what framework the tree compiles to:
// `C`, `S`, `use`, `fx` and the markup selectors are Zaal's own grammar.
import { tokens } from './lex.mjs';
import { here, fail } from './diagnostics.mjs';

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
// the way it decides everywhere else in Zaal: `Card.wide` is still a class on <Card>, because a
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

export { parse, lineNode, attrList, selector, memberTags, hookNode, splitAssign, IDENT, setter, RAW_BODY, isState };
