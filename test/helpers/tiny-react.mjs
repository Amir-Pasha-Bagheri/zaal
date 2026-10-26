// A ~200-line React stand-in: enough of the real contract (hooks, context, memo, class error
// boundaries) to *run* the modules Zal generates and assert on what they render. The compiler's
// output imports 'react' / 'react-dom/client'; loader.mjs points those specifiers here.
//
// Render model: one synchronous pass over the whole tree per flush, hook state kept per tree
// path, effects run after the pass, a setState during the pass schedules another one.

export const Fragment = Symbol.for('zal.test.Fragment');
export const StrictMode = Symbol.for('zal.test.StrictMode');
export const Profiler = Symbol.for('zal.test.Profiler');
export const Suspense = Symbol.for('zal.test.Suspense');

export function createElement(type, props, ...kids) {
  const p = { ...(props || {}) };
  if (kids.length) p.children = kids.length === 1 ? kids[0] : kids;
  return { $$: 'el', type, props: p, key: p.key ?? null };
}

export const memo = fn => {
  const wrapped = props => fn(props);
  Object.defineProperty(wrapped, 'name', { value: fn.name });
  wrapped.$$memo = fn;
  return wrapped;
};

export const lazy = load => {
  const c = props => c.$$loaded ? c.$$loaded(props) : null;
  c.$$lazy = load;
  return c;
};

export function createContext(def) {
  const ctx = { $$context: true, def, stack: [] };
  ctx.Provider = function Provider(props) { return props.children; };
  ctx.Provider.$$ctx = ctx;
  ctx.Consumer = function Consumer(props) { return props.children(current(ctx)); };
  return ctx;
}

const current = ctx => (ctx.stack.length ? ctx.stack.at(-1) : ctx.def);

export class Component {
  constructor(props) { this.props = props; this.state = {}; }
  setState(next) {
    this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state) : next) };
    schedule();
  }
}
Component.prototype.isReactComponent = true;

/* ---------- the renderer ---------- */

let slots = new Map();        // path -> hook slot array (survives passes: that is the state)
let instances = new Map();    // path -> class component instance
let effects = [];             // [{ path, i, fn, deps }] collected during a pass
let cleanups = new Map();     // `path:i` -> teardown
let memos = new Map();        // `path:i` -> { deps, value }
let hooks = null;             // the component being rendered: { path, i }
let typeIds = new WeakMap(), nextType = 0;  // a different component at the same position is new

// Hook state is keyed by position *and* component, so swapping the component at one spot (what
// the router does on navigation) starts that component with fresh state, as React does.
const typeKey = (key, type) => {
  if (!typeIds.has(type)) typeIds.set(type, ++nextType);
  return `${key}@${typeIds.get(type)}`;
};
let dirty = false, rendering = false, root = null;
export let nodes = [];        // every host element rendered in the last pass

// React batches every update made inside one event handler into a single re-render. Without
// that, two setStates in one handler render twice — and the pass in between can see a state
// half-updated (a boundary's `reset(); onReset()` would re-throw on the intermediate render).
let batching = false;
const schedule = () => { dirty = true; if (!rendering && !batching && root) flush(); };

export function batch(fn) {
  const was = batching;
  batching = true;
  try { fn(); } finally { batching = was; }
  if (!was && dirty && root) flush();
}

const slotsFor = path => {
  if (!slots.has(path)) slots.set(path, []);
  return slots.get(path);
};

function slot(init) {
  const list = slotsFor(hooks.path), i = hooks.i++;
  if (!(i in list)) list[i] = typeof init === 'function' ? init() : init;
  return [list, i];
}

export function useState(init) {
  const [list, i] = slot(init);
  const path = hooks.path;
  const set = next => {
    const prev = slotsFor(path)[i];
    const value = typeof next === 'function' ? next(prev) : next;
    if (value === prev) return;
    slotsFor(path)[i] = value;
    schedule();
  };
  return [list[i], set];
}

export const useReducer = (reduce, init) => {
  const [state, set] = useState(init);
  return [state, action => set(prev => reduce(prev, action))];
};

export function useRef(init) {
  const [list, i] = slot(() => ({ current: init }));
  return list[i];
}

const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

function cached(fn, deps) {
  const key = `${hooks.path}:${hooks.i++}`;
  const prev = memos.get(key);
  if (prev && deps && same(prev.deps, deps)) return prev.value;
  const value = fn();
  memos.set(key, { deps, value });
  return value;
}

export const useMemo = (fn, deps) => cached(fn, deps);
export const useCallback = (fn, deps) => cached(() => fn, deps);

export function useEffect(fn, deps) {
  effects.push({ key: `${hooks.path}:${hooks.i++}`, fn, deps });
}
export const useLayoutEffect = useEffect;

export const useContext = ctx => current(ctx);
export const useId = () => { const [list, i] = slot(() => `id-${i_counter++}`); return list[i]; };
let i_counter = 0;
export const useSyncExternalStore = (sub, get) => { useEffect(() => sub(() => schedule()), []); return get(); };
export const useTransition = () => [false, fn => fn()];
export const useDebugValue = () => {};
export const useImperativeHandle = (ref, fn) => { if (ref) ref.current = fn(); };
export const useOptimistic = v => [v, () => {}];
export const useActionState = (fn, init) => [init, () => {}, false];
export const useInsertionEffect = useEffect;
export const useDeferredValue = v => v;
export const startTransition = fn => fn();

/* ---------- rendering ---------- */

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const VOID = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);

function attrs(props) {
  const out = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === 'children' || k === 'key' || k === 'ref' || typeof v === 'function') continue;
    if (v === false || v === null || v === undefined) continue;
    if (k === 'className') out.push(`class="${esc(v)}"`);
    // React stringifies data-*/aria-* values; other true props are bare boolean attributes.
    else if (v === true) out.push(/^(data|aria)-/.test(k) ? `${k}="true"` : k);
    else out.push(`${k}="${esc(typeof v === 'object' ? JSON.stringify(v) : v)}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

function renderKids(kids, path) {
  if (kids === undefined) return '';
  const list = Array.isArray(kids) ? kids : [kids];
  return list.map((k, i) => render(k, `${path}.${Array.isArray(k) ? 'a' : ''}${i}`)).join('');
}

function render(node, path) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (Array.isArray(node)) return node.map((n, i) => render(n, `${path}[${n?.key ?? i}]`)).join('');
  if (typeof node !== 'object') return esc(node);
  if (node.$$ !== 'el') throw new Error(`not a react element: ${JSON.stringify(node)}`);
  const { type, props } = node;
  const key = node.key == null ? path : `${path}#${node.key}`;

  if (type === Fragment || type === StrictMode || type === Profiler || type === Suspense) {
    return renderKids(props.children, key);
  }
  if (typeof type === 'string') {
    const el = { tag: type, props, text: '' };
    nodes.push(el);
    const inner = renderKids(props.children, key);
    el.text = inner.replace(/<[^>]*>/g, '');
    if (VOID.has(type)) return `<${type}${attrs(props)} />`;
    return `<${type}${attrs(props)}>${inner}</${type}>`;
  }
  if (typeof type !== 'function') throw new Error(`bad element type: ${String(type)}`);

  if (type.$$ctx) {                                   // <Ctx.Provider value={…}>
    type.$$ctx.stack.push(props.value);
    try { return renderKids(props.children, key); } finally { type.$$ctx.stack.pop(); }
  }
  if (type.prototype?.isReactComponent) {
    const slot = typeKey(key, type);
    let inst = instances.get(slot);
    if (!inst) { inst = new type(props); instances.set(slot, inst); }
    inst.props = props;
    try {
      return render(inst.render(), key + '/r');
    } catch (e) {
      if (!type.getDerivedStateFromError || inst.state.error) throw e;
      inst.state = { ...inst.state, ...type.getDerivedStateFromError(e) };
      return render(inst.render(), key + '/r');
    }
  }
  // A lazy component: kick off the import once, render nothing until it lands, then re-render.
  // (React suspends here; the generated code always wraps one in Suspense, so this is the same
  // observable behaviour — fallback first, the real tree on the next pass.)
  if (type.$$lazy && !type.$$loaded) {
    if (!type.$$pending) {
      type.$$pending = true;
      type.$$lazy().then(m => { type.$$loaded = m.default ?? m; schedule(); });
    }
    return '';
  }
  const prev = hooks;
  hooks = { path: typeKey(key, type), i: 0 };
  try {
    return render(type(props), key + '/r');
  } finally { hooks = prev; }
}

function runEffects() {
  const list = effects;
  effects = [];
  for (const { key, fn, deps } of list) {
    const prev = memos.get('fx:' + key);
    if (prev && deps && same(prev.deps, deps)) continue;
    cleanups.get(key)?.();
    memos.set('fx:' + key, { deps, value: true });
    const teardown = fn();
    cleanups.set(key, typeof teardown === 'function' ? teardown : null);
  }
}

let html = '';

function pass() {
  rendering = true;
  nodes = [];
  try { html = render(root, '0'); } finally { rendering = false; }
  runEffects();
}

function flush() {
  for (let i = 0; i < 25; i++) {
    dirty = false;
    pass();
    if (!dirty) return;
  }
  throw new Error('render did not settle after 25 passes (infinite loop?)');
}

/* ---------- the test-facing API ---------- */

export function mount(element) {
  reset();
  root = element;
  flush();
  return handle();
}

const handle = () => ({
  get html() { return html; },
  get nodes() { return nodes; },
  find: pred => nodes.find(typeof pred === 'function' ? pred : n => n.text.trim() === pred),
  all: pred => nodes.filter(typeof pred === 'function' ? pred : n => n.text.trim() === pred),
  byClass: c => nodes.filter(n => (n.props.className || '').split(' ').includes(c)),
  fire(target, ev = 'onClick', payload = {}) {
    const node = typeof target === 'object' && target.props ? target : this.find(target);
    if (!node) throw new Error(`no node matching ${String(target)} — have: ${nodes.map(n => n.tag + ':' + n.text).join(' | ')}`);
    const fn = node.props[ev];
    if (!fn) throw new Error(`<${node.tag}> has no ${ev}`);
    batch(() => fn({ preventDefault() {}, stopPropagation() {}, target: { value: '' }, ...payload }));
    return this;
  },
  act(fn) { batch(fn); return this; },
});

export function reset() {
  slots = new Map(); instances = new Map(); memos = new Map();
  typeIds = new WeakMap(); nextType = 0;
  for (const c of cleanups.values()) c?.();
  cleanups = new Map();
  effects = []; nodes = []; html = ''; root = null; dirty = false;
}

/* ---------- react-dom/client ---------- */

export const createRoot = container => ({
  render(element) { container.__render(element); },
});

export default { createElement, Fragment, memo, createContext, Component, StrictMode, Suspense };
