// `S Name` -> a context, a provider and a use<Name>() hook.
import { fail, IDENT, setter } from '@zaal/core';
import { hookCode, lineText } from './component.mjs';
import { EL } from './markup.mjs';

// A store is a component with no markup: its state and hooks become the context value, so
// `s:`, `memo`, `cb`, `fx`, `ref` and `use` all mean exactly what they mean in a `C` block.
function store(node, target, opts = {}) {
  const codes = node.kids.map(lineText).join(' ');
  const persist = node.parts.find(p => p === 'persist' || p.startsWith('persist='));
  const key = persist?.includes('=') ? persist.slice(8) : `zaal:${node.name.toLowerCase()}`;
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
    : `  return ${EL}(${node.name}Context.Provider, { value }, children);`;
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

export { store };
