// `H useName` -> a custom hook: an ordinary function whose body is the same hook lines a `C`
// block takes. What it does not have is markup — it hands back a value instead, so a component
// can call it and keep its own body about what it renders.
import { fail, isName, nameError, setter } from 'zaal';
import { hookCode, lineText, taken, setterClash, uniqueNames, laterNames,
  exportKeyword } from './component.mjs';

// A hook's parameters are positional, unlike a component's props: `useCounter(10)` is how React
// code calls one, and `p:` lines keep their source order to match.
function hookdef(node, target, opts = {}) {
  const ctx = { props: [], state: [], globals: new Set(), needs: new Set(), ctxs: opts.ctxs || new Map(),
    ctxNeeds: new Set(), spread: new Map(),
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
    } else {
      fail(node, `H ${node.name}: unknown \`${p}\` — an \`H\` line takes p: and s:`);
    }
  }
  uniqueNames(node, ctx.props, ctx.state);
  setterClash(node, ctx.state, ctx.props);
  const lines = ctx.state.map(s => `  const [${s.name}, ${setter(s.name)}] = useState(${s.init});`);
  const reactive = new Set([...ctx.props.map(p => p.name), ...ctx.state.map(s => s.name)]);
  const declared = [];
  const below = laterNames(node.kids);
  // A `ret` after a hook line would leave that hook unreachable — and a hook that does not run
  // on every render is the one thing React does not allow. So it goes last, and says so.
  const ret = node.kids.find(k => k.kind === 'ret');
  if (ret) {
    const twice = node.kids.filter(k => k.kind === 'ret');
    if (twice.length > 1) fail(twice[1], `H ${node.name}: two \`ret\` lines — a hook hands back one value`);
    if (ret !== node.kids.at(-1)) {
      fail(ret, `H ${node.name}: \`ret\` is the last line of a hook — everything below it would`
        + ` never run, and a hook has to run every render`);
    }
    if (!ret.code.trim() && !ret.kids.length) fail(ret, `H ${node.name}: \`ret\` with nothing to return`);
  }
  for (const [i, k] of node.kids.entries()) {
    if (k.kind === 'ret') continue;
    if (k.kind !== 'hook' && k.kind !== 'js') {
      fail(k, `H ${node.name}: a hook has no markup — it hands a value back with \`ret\``);
    }
    lines.push(...hookCode(ctx, k, reactive, declared, below(i)));
  }
  // Everything it declares, the way a store builds its context value — so `H` and `S` mean the
  // same thing by the same lines. `useMemo` keeps the object stable, so a caller may put it in
  // a dependency array without re-running on every render.
  const value = [...ctx.state.flatMap(s => [s.name, setter(s.name)]), ...declared];
  const implicit = !ret && value.length;
  if (implicit) taken(node, [...ctx.state.map(s => s.name), ...declared], { value: 'what the hook hands back' });
  if (ret) {
    lines.push(`  return ${[ret.code.trim(), ...ret.kids.map(lineText)].join('\n').trim()};`);
  } else if (implicit) {
    const deps = [...new Set([...ctx.state.map(s => s.name), ...declared.filter(n => reactive.has(n))])];
    lines.push(`  const value = useMemo(() => ({ ${value.join(', ')} }), [${deps.join(', ')}]);`,
      '  return value;');
  }
  // A hook with nothing to hand back is all side effect — `useDocumentTitle(t)` is a real shape,
  // so no `ret` and nothing declared is a void hook rather than a mistake.
  const params = ctx.props.map(p => p.def ? `${p.name} = ${p.def}` : p.name);
  const codes = [...node.kids.filter(k => k.kind !== 'ret').map(lineText),
    ...ret ? [ret.code, ...ret.kids.map(lineText)] : []].join(' ');
  return { ctx, declared, codes,
    code: `${exportKeyword(node, opts)} function ${node.name}(${params.join(', ')}) {`
      + `${lines.length ? '\n' + lines.join('\n') : ''}\n}` };
}

export { hookdef };
