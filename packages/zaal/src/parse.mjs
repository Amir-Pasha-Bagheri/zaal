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

// JavaScript identifiers are not ASCII-only, and neither are the names people give their own
// components: `C Café p:prénom` is a name in both languages.
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const CAPITAL = /^\p{Lu}[\p{L}\p{N}_$]*$/u;
// The same two pieces as text, for the regexes that have to be built by hand.
const ID = '[\\p{L}_$][\\p{L}\\p{N}_$]*';     // an identifier
const IDC = '[\\p{L}\\p{N}_$]';                 // a character that may not touch one

// A name goes into a RegExp as text, and `$` is both a legal identifier character and an
// anchor: without this, `$ref` matched nothing and every hook that used it lost its dependency.
const escRe = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A name has to survive being written into the generated module. `p:class` reads fine in Zaal
// and lands as `function A({ class })`, which is a syntax error a long way from the line that
// caused it — so a keyword is rejected here, by name.
const RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let',
  'static', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'await',
  'arguments', 'eval']);

const isName = n => IDENT.test(n) && !RESERVED.has(n);
const nameError = n => RESERVED.has(n)
  ? `\`${n}\` is a JavaScript keyword — pick another name` : `\`${n}\` is not a name`;

const isState = (c, n) => c.state.some(s => s.name === n);
const setter = n => 'set' + n[0].toUpperCase() + n.slice(1);

const RAW_BODY = new Set(['hook', 'line', 'js', 'ret']);

// `fx` / `memo n = …` / `cb f(x) = …` / `ref el` / `ctx theme = Ctx` / `use [a, b] = useReducer(…)`.
// The suffix pins the dependency array: none = inferred, `!` = mount only, `*` = every render,
// `[a b]` = exactly these.
const HOOK = /^(fx|memo|cb|ref|ctx|use)([!*]|\[[^\]]*\])?$/;

function lineNode(t) {
  const head = t[0];
  const hk = HOOK.exec(head);
  if (hk) return hookNode(hk[1], hk[2], t.slice(1));
  // A block's name becomes a React component (or a provider), and React reads a lower-case tag
  // as a DOM element: `C card` would render `<card>` and never call the function.
  if (head === 'C' || head === 'S') {
    const name = t[1];
    if (!name || !CAPITAL.test(name)) {
      throw new Error(`${head} ${name ?? ''}`.trim()
        + `: a block's name has to start with a capital letter and be a name`);
    }
    return { kind: head === 'C' ? 'comp' : 'store', name, parts: t.slice(2) };
  }
  // `H useThing` — a custom hook: the hook lines a `C` block takes, in a function a component
  // can call. React decides what is a hook by the name, so the name is not a free choice: the
  // rules of hooks, every lint rule and React's own DevTools all key off `use` + a capital.
  if (head === 'H') {
    const name = t[1];
    if (!name || !IDENT.test(name) || !/^use\p{Lu}/u.test(name)) {
      throw new Error(`H ${name ?? ''}`.trim()
        + ': a hook\'s name has to start with `use` and a capital — `H useCounter`');
    }
    return { kind: 'hookdef', name, parts: t.slice(2) };
  }
  if (head === 'A') return { kind: 'app', name: t[1] };
  // `i X ./X` · `i {a,b} from pkg` · `i pkg/x.css` — but `i "text"` / `i c="em"` is the <i> element
  if (head === 'i' && t.length > 1 && !t[1].startsWith('"') && !t[1].includes('=')) {
    const r = t.slice(1).filter(x => x !== 'from' && x !== 'lazy');
    const lazy = t.includes('lazy');                 // `i Heavy ./Heavy lazy` — split out of the bundle
    return r.length > 1 ? { kind: 'import', what: r[0], from: r[1], lazy } : { kind: 'import', spec: r[0] };
  }
  if (head === 'js') return { kind: 'js', code: t.slice(1).join(' ') };
  // `ret <expr>` — what an `H` block hands back. Only an `H` block has anything to return; the
  // `C` and `S` compilers say so, rather than leaving a stray `<ret>` element in the markup.
  if (head === 'ret') return { kind: 'ret', code: t.slice(1).join(' ') };
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
    const item = asI >= 0 ? rest[asI + 1] : 'it';
    // `*xs as x` binds the item: a destructuring pattern is fine, a keyword is not.
    if (!/^[[{]/.test(item) && !isName(item)) throw new Error(`* … as ${nameError(item)}`);
    return { kind: 'map', list, item, key: key ? key.slice(2) : null };
  }
  if (head.startsWith('"')) return { kind: 'text', value: head.slice(1, -1) };
  if (head.startsWith('{') && head.endsWith('}')) return { kind: 'expr', code: head.slice(1, -1) };
  if (head === 'slot') {                            // markup passed as a prop, not as a child
    if (!IDENT.test(t[1] || '')) throw new Error('slot: expected `slot <propName>`');
    return { kind: 'slot', name: t[1] };
  }
  if (head.startsWith('%')) {                       // %btn.primary -> kit entry `btn` + its tag
    const s = selector(head.slice(1));
    return { kind: 'el', tag: '%' + s.tag, classes: [s.tag, ...s.classes], id: s.id, attrs: attrList(t.slice(1)) };
  }
  return { kind: 'el', ...selector(head), attrs: attrList(t.slice(1)) };
}

// What can begin an attribute: a quoted text node, a spread, an event, or `name`/`name=value`.
const ATTR_START = /^(?:\.\.\.|@|")|^[\p{L}_$][\p{L}\p{N}_$:.-]*(?:=|$)/u;

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
  const m = /^(\p{L}[\p{L}\p{N}_$]*(?:-[\p{L}\p{N}_$]+)*)?((?:[.#][\p{L}\p{N}_$-]+)*)$/u.exec(s);
  if (!m) throw new Error(`bad selector: ${s}`);
  const classes = [], ids = [];
  for (const part of (m[2] || '').match(/[.#][\p{L}\p{N}_$-]+/gu) || []) {
    (part[0] === '.' ? classes : ids).push(part.slice(1));
  }
  return { tag: m[1] || 'div', classes, id: ids[0] || null };
}

// `motion.div`, `Dialog.Panel` — a dotted tag whose first segment is a name the module has
// (an `i` line or a `js` declaration) is a member of it, not a tag with classes. Nothing else
// can tell the two apart: `div.card` and `motion.div` are the same shape. Case decides the rest,
// the way it decides everywhere else in Zaal: `Card.wide` is still a class on <Card>, because a
// class is lower-case and a component is not.
const isMember = (tag, next) => /^\p{Ll}/u.test(tag) || /^\p{Lu}/u.test(next);

function memberTags(node, scope) {
  if (node.kind === 'el' && node.classes?.length && scope.has(node.tag)
      && isMember(node.tag, node.classes[0])) {
    // The member is the segment after the base, plus any further capitalized ones
    // (`Dialog.Panel.Title`). What follows is classes again: `motion.div.sheet`.
    const path = [node.tag, node.classes.shift()];
    while (node.classes.length && /^\p{Lu}/u.test(node.classes[0])) path.push(node.classes.shift());
    node.tag = path.join('.');
  }
  for (const k of node.kids || []) memberTags(k, scope);
}

function hookNode(hook, mod, rest) {
  const deps = !mod ? 'auto' : mod === '!' ? [] : mod === '*' ? null : tokens(mod.slice(1, -1).replace(/,/g, ' '));
  const src = rest.join(' ');
  if (hook === 'fx') {
    if (IDENT.test(src)) throw new Error(`fx: \`fx ${src}\` is not a dep list — write \`fx[${src}]\``);
    return { kind: 'hook', hook, deps, body: src };
  }
  // Only the hooks that *have* a dependency array can carry a suffix: `ref! box` and
  // `use[a] x = …` read as if they pinned something, and silently pinned nothing.
  if (mod && (hook === 'ref' || hook === 'ctx' || hook === 'use')) {
    throw new Error(`${hook}${mod}: \`${hook}\` has no dependencies — the suffix belongs on fx, memo or cb`);
  }
  const [lhs, rhs] = splitAssign(src);
  // `ref`, `memo`, `cb` and `ctx` all declare one binding, so the name has to be an identifier —
  // without this `cb 1bad() = …` only surfaces as a syntax error in the generated module.
  const ident = isName;
  if (hook === 'ref') {
    if (!ident(lhs)) throw new Error(`ref: ${nameError(lhs)}`);
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
    const m = new RegExp(`^(${ID})\\s*(\\([^)]*\\))?$`, 'u').exec(lhs);
    if (!m) throw new Error(`cb: bad name \`${lhs}\``);
    if (!isName(m[1])) throw new Error(`cb: ${nameError(m[1])}`);
    return { kind: 'hook', hook, name: m[1], params: m[2] || '()', body: rhs, deps };
  }
  if (hook !== 'use' && !ident(lhs)) throw new Error(`${hook}: ${nameError(lhs)}`);
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

export { parse, lineNode, attrList, selector, memberTags, hookNode, splitAssign, IDENT, ID, IDC, escRe, isName,
  nameError, setter, RAW_BODY, isState };
