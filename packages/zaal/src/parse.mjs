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
  // `{expr}` — an expression child, or a **dynamic tag** when the line carries anything else:
  // `{Tag} c="row" "hi"` is the element whose tag the expression names. Without this the rest of
  // the line (and any children under it) were dropped without a word.
  if (head.startsWith('{') && head.endsWith('}')) {
    const code = head.slice(1, -1);
    if (t.length > 1) return dynEl(code, attrList(t.slice(1)));
    return { kind: 'expr', code };
  }
  // `portal` — markup that renders somewhere else in the document: a modal, a tooltip, a
  // toast. The target is optional (`document.body`), a selector string, or any expression.
  if (head === 'portal') {
    const rest = attrList(t.slice(1));
    if (rest.length > 1) {
      throw new Error('portal: one target — `portal`, `portal box.current` or `portal "#overlay"`');
    }
    return { kind: 'portal', to: rest[0] ?? null, target: portalTarget(rest[0]) };
  }
  // `provide Name = value` — a context declared and filled right where it is used: everything
  // under the line reads the value. `S` is app-wide state with one provider at the root; this
  // is the other half, a value a component *instance* hands its own descendants — which is what
  // a <Tabs> telling its panels which one is open needs, and what `S` cannot say.
  if (head === 'provide') {
    const [lhs, rhs] = splitAssign(t.slice(1).join(' '));
    if (!lhs) throw new Error('provide: expected `provide <Name> = <value>`');
    // The name becomes `<Name>Context` and `use<Name>()`, and React reads a lower-case name as
    // neither — the same rule a `C` block's name follows, for the same reason.
    if (!CAPITAL.test(lhs)) {
      throw new Error(`provide ${lhs}: a context's name has to start with a capital letter`
        + ' and be a name');
    }
    if (!rhs) {
      throw new Error(`provide ${lhs}: expected \`provide ${lhs} = <value>\``
        + ' — the value its descendants read');
    }
    return { kind: 'provide', name: lhs, expr: rhs };
  }
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

// A dynamic tag: the tag is an expression rather than a name, so no selector was read and
// there are no classes to carry. `dyn` is what both backends key off — JSX can only name a tag.
const dynEl = (code, attrs) => ({ kind: 'el', tag: code.trim(), dyn: true, classes: [], id: null, attrs });

// JSX can write `<Tag>` and `<icons.Star>`; anything else — a lower-case name, a ternary, a
// call — is not a tag JSX can name, and has to go through `createElement`.
const JSX_TAG = /^(?:\p{Lu}[\p{L}\p{N}_$]*|[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}\p{N}_$]+)+)$/u;
// A literal tag name, as `as=` may give one: `section`, `my-widget`. Lower-case, the way a tag
// is everywhere else in Zaal.
const TAG_NAME = /^\p{Ll}[\p{L}\p{N}_$]*(?:-[\p{L}\p{N}_$]+)*$/u;

// `k={expr}` is the JSX habit; take either. (expr.mjs does the same for attribute values, but
// it imports from here, so this stays its own three lines.)
function unwrap(v) {
  if (!v.startsWith('{') || !v.endsWith('}')) return v;
  let depth = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '{') depth++;
    else if (v[i] === '}' && --depth === 0 && i !== v.length - 1) return v;
  }
  return v.slice(1, -1).trim();
}

// `as=` names the tag, not a prop: `.card as=section`, `%btn as=a`, `.row as={Tag}`. On a
// component (or on a tag that is already an expression) `as` stays an ordinary prop — that is
// the name styled-components, Radix and most of npm read it under, and taking it would break
// them. Case decides a bare value, as it does everywhere else: `as=section` is the tag
// `<section>`, `as=Link` is the component, and a variable holding either is `as={tag}`.
function asTag(node) {
  const i = node.attrs.findIndex(a => a.startsWith('as='));
  if (i < 0) return;
  if (node.dyn || /^\p{Lu}/u.test(node.tag) || node.tag.includes('.')) return;
  const v = node.attrs[i].slice(3).trim();
  if (!v) fail(node, 'as=: nothing to be — write `as=section`, `as=Link` or `as={expr}`');
  // One tag per element: a second `as=` would be dropped, the way any repeated attribute is.
  if (node.attrs.some((a, j) => j > i && a.startsWith('as='))) {
    fail(node, `as is set twice on <${node.tag}> — an element has one tag`);
  }
  node.attrs.splice(i, 1);
  if (v.startsWith('"')) {
    const name = v.slice(1, -1);
    if (!TAG_NAME.test(name)) fail(node, `as="${name}": not a tag name`);
    node.tag = name;
    return;
  }
  if (TAG_NAME.test(v) || JSX_TAG.test(v)) { node.tag = v; return; }
  node.tag = unwrap(v);
  node.dyn = true;
  if (!node.tag) fail(node, 'as=: nothing to be — write `as=section`, `as=Link` or `as={expr}`');
}

// Where a `portal` renders. No target is `document.body` — the one node every page has. A
// quoted target is a CSS selector, the way React code reaches a `#modal-root`; anything else is
// an expression, so a ref (`portal box.current`) or a prop is written as it stands.
function portalTarget(to) {
  if (!to) return 'document.body';
  if (!to.startsWith('"')) return unwrap(to);
  const sel = to.slice(1, -1);
  if (!sel.trim()) throw new Error('portal "": a target selector, or nothing for document.body');
  return `document.querySelector(${JSON.stringify(sel)})`;
}

// After the kit is linked: resolve `as=`, and turn a `{expr}` line that has children under it
// into the dynamic element it reads as (the head alone could not know — the children arrive
// after it). A dynamic tag with no expression is a build error rather than an empty `{}`.
function polyTags(node) {
  if (node.kind === 'expr' && node.kids.length) {
    const code = node.code;
    delete node.code;
    Object.assign(node, dynEl(code, []), { kids: node.kids, ln: node.ln, raw: node.raw });
  }
  if (node.kind === 'el') {
    asTag(node);
    if (node.dyn && !node.tag) fail(node, '`{}` is not a tag — a dynamic tag needs an expression');
  }
  for (const k of node.kids || []) polyTags(k);
  return node;
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

export { parse, lineNode, attrList, selector, memberTags, polyTags, JSX_TAG, hookNode, splitAssign,
  IDENT, ID, IDC, escRe, isName, nameError, setter, RAW_BODY, isState };
