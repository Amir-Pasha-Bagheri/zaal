// `C Name` -> a function component, its hooks and (with `catch`) the one class React still
// needs for an error boundary.
import { fail, here, IDENT, setter, interp, stmts, fnBody, splitStmts, isRel, splitSpec,
  rel } from 'zaal';
import { jsxNode, esmNode } from './markup.mjs';

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

export { component, boundary, hookCode, exportKeyword, codeOf, lineText, interpOf, reactNames };
