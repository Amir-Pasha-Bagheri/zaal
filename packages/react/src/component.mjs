// `C Name` -> a function component, its hooks and (with `catch`) the one class React still
// needs for an error boundary.
import { fail, here, isName, nameError, setter, interp, stmts, fnBody, splitStmts, isRel, splitSpec,
  rel, ID, IDC, escRe } from 'zaal';
import { jsxNode, esmNode } from './markup.mjs';

// Names the generated module writes for itself. A source name that lands on one of them is a
// second `const` of that name — a syntax error in a file the author never wrote, so it is
// reported here, against the line that chose the name.
function taken(node, names, reserved) {
  for (const n of names) {
    if (reserved[n]) fail(node, `\`${n}\` is ${reserved[n]} — pick another name`);
  }
}

// One name, declared twice on the same block: `p:a p:a` is a duplicate binding in the
// parameter list, and `p:n` beside `s:n=0` redeclares `n` inside the body. Both are syntax
// errors in the generated module.
function uniqueNames(node, props, state) {
  const seen = new Map();
  for (const [kind, list] of [['p', props], ['s', state]]) {
    for (const { name } of list) {
      if (seen.has(name)) fail(node, `${seen.get(name)}:${name} and ${kind}:${name} are the same name`);
      seen.set(name, kind);
    }
  }
}

// Two states whose setters collide (`s:n` beside `s:N` both want `setN`).
function setterClash(node, state, props = []) {
  const seen = new Map();
  for (const st of state) {
    const fn = setter(st.name);
    if (seen.has(fn)) fail(node, `s:${st.name} and s:${seen.get(fn)} both need \`${fn}\``);
    seen.set(fn, st.name);
    const p = props.find(x => x.name === fn);
    if (p) fail(node, `p:${fn} is also the setter that s:${st.name} needs — pick another name`);
  }
}

function component(node, target, opts = {}) {
  const ctx = { props: [], state: [], globals: new Set(), needs: new Set(), spread: new Map(),
    ctxs: opts.ctxs || new Map(), ctxNeeds: new Set(),
    scope: new Set(opts.scope || []), stores: opts.stores || new Map() };
  for (const p of node.parts) {
    if (p.startsWith('p:')) {
      const [name, ...d] = p.slice(2).split('=');
      if (!isName(name)) fail(node, `${p}: ${nameError(name)}`);
      ctx.props.push({ name, def: d.join('=') || null });
    } else if (p.startsWith('s:')) {
      const [name, ...v] = p.slice(2).split('=');
      if (!isName(name)) fail(node, `${p}: ${nameError(name)}`);
      ctx.state.push({ name, init: v.join('=') || 'null' });
    } else if (p !== 'memo' && !p.startsWith('memo=')) {
      fail(node, `C ${node.name}: unknown \`${p}\` — a \`C\` line takes p:, s:, memo and catch`);
    }
  }
  uniqueNames(node, ctx.props, ctx.state);
  setterClash(node, ctx.state, ctx.props);
  // Hook and `js` lines become the component body, in source order; the rest is markup.
  const lines = ctx.state.map(s => `  const [${s.name}, ${setter(s.name)}] = useState(${s.init});`);
  const markup = [], declared = [];
  const reactive = new Set([...ctx.props.map(p => p.name), ...ctx.state.map(s => s.name)]);
  const below = laterNames(node.kids);
  for (const [i, k] of node.kids.entries()) {
    if (k.kind === 'hook' || k.kind === 'js') lines.push(...hookCode(ctx, k, reactive, declared, below(i)));
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
  if (n.kind === 'el' && n.dyn) out.push(n.tag);          // `{Tag}` — the tag is an expression
  if (n.kind === 'portal' && n.to) out.push(n.target);    // `portal box.current` — so is a target
  // `provide Tabs = { active }` — the value is code, read the way an attribute value is.
  if (n.kind === 'provide') out.push(...(n.expr.startsWith('"') ? interpOf(n.expr.slice(1, -1)) : [n.expr]));
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
    ? [...reactive].filter(n => new RegExp(`(?<!${IDC})(?<!(?<!\\.\\.)\\.)${escRe(n)}(?!${IDC})`, 'u').test(code))
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
    const m = new RegExp(`^(?:\\.\\.\\.)?(?:${ID}\\s*:\\s*)?(${ID})`, 'u').exec(seg.trim());
    if (m) out.push(m[1]);
  }
  return out;
}

// `memo o = { a, b }` — an arrow whose body starts with `{` reads as a block, so the object
// has to be parenthesised. (`fnBody` wraps several statements in a block on purpose.)
const arrowBody = code => /^\{/.test(code.trim()) ? `(${code.trim()})` : code;

// The hook names declared after position i — what a body at i is not allowed to reach for.
// A `use` line's name may be a whole pattern (`[pending, start]`), so it contributes each of
// the names it binds.
function laterNames(kids) {
  const names = kids.map(k => (k.kind === 'hook' && k.name
    ? (/^[[{]/.test(k.name) ? bindNames(k.name) : [k.name]) : []));
  return i => names.slice(i + 1).flat();
}

// `memo`, `use`, `ctx` and a `ref` initial value are evaluated while the component renders, so
// naming something declared further down is a ReferenceError on the first paint — the generated
// `const` is still in its temporal dead zone. (An `fx` or `cb` body runs later, so it is legal,
// though its dependency array cannot see the name either.)
function notYet(n, code, later) {
  for (const name of later) {
    if (new RegExp(`(?<!(?:${IDC}|\\.))${escRe(name)}(?!${IDC})`, 'u').test(code)) {
      fail(n, `${name} is declared below this line, so \`${n.hook}\` would read it before it`
        + ` exists — move this line under ${name}`);
    }
  }
}

// `fx[zzz]` with nothing called zzz in the component emits `}, [zzz])`, which is a
// ReferenceError the moment the component mounts.
function checkDeps(ctx, n, reactive, declared) {
  if (!Array.isArray(n.deps)) return;
  for (const d of n.deps) {
    const base = d.split(/[.?[(]/)[0];
    const known = reactive.has(base) || declared.includes(base) || ctx.scope?.has(base)
      || ctx.props.some(p => p.name === base)
      || ctx.state.some(st => st.name === base || setter(st.name) === base);
    if (!known) {
      fail(n, `${n.hook}[${n.deps.join(' ')}]: ${base} is not a prop, a state, or a value`
        + ` this component declares`);
    }
  }
}

function hookCode(ctx, n, reactive, declared = [], later = []) {
  here(n);
  checkDeps(ctx, n, reactive, declared);
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
  if (n.hook === 'ref') {
    notYet(n, n.init, later);
    declared.push(claim(n.name));
    return [`  const ${n.name} = useRef(${interp(n.init)});`];
  }
  if (n.hook === 'ctx') { notYet(n, n.expr, later); bind(n.name); return [`  const ${n.name} = useContext(${n.expr});`]; }
  if (n.hook === 'use') {
    notYet(n, n.expr, later);
    if (!n.name) return [`  ${interp(n.expr)};`];      // `use useLayoutEffect(…)` — binds nothing
    const ids = bindNames(n.name);
    // `use { items, add } = Cart` — a bare capitalized name reads a context, imported for you:
    // an `S` store, or one a `provide` line hands out. Both are read the same way, because from
    // here they are the same thing — a value some provider above this component put there.
    if (/^\p{Lu}[\p{L}\p{N}_$]*$/u.test(n.expr)) {
      const store = ctx.stores.has(n.expr), given = ctx.ctxs?.has(n.expr);
      if (!store && !given) {
        fail(n, `use …= ${n.expr}: no store \`S ${n.expr}\` and no \`provide ${n.expr}\` in this app`);
      }
      // A store's provider is mounted around the whole app, outside every component — so it is
      // outside any `provide` too, and the hook would throw on the first render.
      if (!store && ctx.store) {
        fail(n, `use …= ${n.expr}: \`provide ${n.expr}\` is inside a component, and a store's`
          + ` provider wraps the whole app from outside it — a store cannot read one`);
      }
      (store ? ctx.needs : ctx.ctxNeeds).add(n.expr);
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
    notYet(n, n.expr, later);
    const code = interp(n.expr), deps = depsOf(n.deps, code, reactive);
    bind(n.name);
    return [`  const ${n.name} = useMemo(() => ${arrowBody(code)}${deps});`];
  }
  if (n.hook === 'cb') {
    const { body, cleanup } = fxParts(ctx, n);
    noHooks(n, [...body, ...cleanup].join('; '));
    const deps = depsOf(n.deps, [...body, ...cleanup].join('; '), reactive);
    bind(n.name);
    const one = body.length === 1 ? arrowBody(body[0]) : null;
    return [`  const ${n.name} = useCallback(${n.params} => ${one ?? fnBody(body)}${deps});`];
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

const BOUNDARY_OWN = { error: 'the error the boundary caught', reset: 'the boundary\'s own reset',
  children: 'what the boundary wraps' };

// An error boundary is the one thing React still needs a class for — no hook catches a render
// error. `C Oops catch` generates that class: the children render while nothing has thrown, and
// the markup is the fallback, with `error` and `reset` in scope.
function boundary(node, target, opts = {}) {
  const ctx = { props: [], state: [], globals: new Set(), needs: new Set(), spread: new Map(),
    ctxs: opts.ctxs || new Map(), ctxNeeds: new Set(), stores: opts.stores || new Map() };
  for (const p of node.parts) {
    if (p === 'catch') continue;
    if (p.startsWith('s:')) fail(node, `C ${node.name} catch: an error boundary is a class, so it`
      + ` has no \`s:\` state — keep state in a child component`);
    if (p.startsWith('p:')) {
      const [name, ...d] = p.slice(2).split('=');
      if (!isName(name)) fail(node, `${p}: ${nameError(name)}`);
      taken(node, [name], BOUNDARY_OWN);
      ctx.props.push({ name, def: d.join('=') || null });
      continue;
    }
    fail(node, `C ${node.name} catch: unknown \`${p}\` — a boundary takes p: props only`);
  }
  uniqueNames(node, ctx.props, []);
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

export { component, boundary, hookCode, exportKeyword, codeOf, lineText, interpOf, reactNames,
  taken, setterClash, uniqueNames, laterNames };
