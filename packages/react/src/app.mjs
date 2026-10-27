// app.zaal: the routes, the title, the design system, the package pins. An app declaration
// says what the app *is*, not what it compiles to, so none of this is target-specific.
import { parse, fail, splitSpec, CDN, SRC_DIR } from 'zaal';

function parseApp(src) {
  const node = parse(src).kids.find(n => n.kind === 'app');
  if (!node) throw new Error('app file has no `A <Name>` block');
  const app = { name: node.name, ln: node.ln, title: node.name, mount: 'root', ui: null, css: [], routes: [],
    target: 'react',
    pins: new Map(), cdn: CDN, storeOrder: [] };
  for (const k of node.kids) {
    if (k.kind === 'route') {
      // A second route for one path never runs: the router takes the first that matches, so
      // the later line is dead markup rather than an override.
      if (!k.component) fail(k, `app: ${k.path} names no component — write \`${k.path} <Component>\``);
      const twice = app.routes.find(r => r.path === k.path);
      if (twice) {
        fail(k, k.path === '/*'
          ? `app: a second \`/*\` never runs — ${twice.component} is already the catch-all`
          : `app: the route ${k.path} is declared twice — only ${twice.component} would ever render`);
      }
      app.routes.push({ path: k.path, component: k.component, lazy: k.lazy, ln: k.ln });
      continue;
    }
    const [key, ...rest] = k.raw;
    const val = rest.join(' ').replace(/^"|"$/g, '');
    if (key === 't') app.title = val;
    else if (key === 'm') {
      // The id is written into an HTML attribute and into getElementById('…'): a quote in it
      // would end one or the other.
      app.mount = val.replace(/^#/, '');
      if (!/^[A-Za-z][\w:.-]*$/.test(app.mount)) {
        fail(k, `app: \`m ${val}\` is not an element id — letters, digits, \`-\`, \`_\`, \`:\` and \`.\``);
      }
    }
    else if (key === 'ui') app.ui = val;
    else if (key === 'css') app.css.push(val);
    else if (key === 'store') app.storeOrder.push(...rest);
    else if (key === 'pkg') {
      const { pkg, version } = splitSpec(val);
      const pinned = app.pins.get(pkg);
      if (pinned && pinned !== version) {
        fail(k, `app: ${pkg} is pinned twice, to ${pinned} and ${version} — keep one`);
      }
      app.pins.set(pkg, version);
    }
    else if (key === 'cdn') app.cdn = val.replace(/\/$/, '');
    // `target react` — which target package compiles this app. The CLI reads it before any of
    // this runs (it has to, to know whose parseApp to call), so here it only has to be legal.
    else if (key === 'target') app.target = val;
    else fail(k, `app: unknown directive \`${key}\``);
  }
  return app;
}

// Providers listed in app.zaal (`store A B`) wrap outermost-first, the rest follow by name —
// but a store that reads another needs that one's provider *outside* its own, or the hook
// throws on the first render. That order is not a preference, so it is derived rather than
// trusted: `deps` says which stores each store reads.
function storeOrder(app, stores, deps = new Map()) {
  const named = app.storeOrder.filter(n => stores.has(n));
  for (const n of app.storeOrder) if (!stores.has(n)) fail(app.ln, `store ${n}: no \`S ${n}\` in ${SRC_DIR}/`);
  // An explicit list that contradicts what the stores read is a mistake worth naming.
  for (const n of named) {
    for (const d of deps.get(n) || []) {
      if (named.includes(d) && named.indexOf(d) > named.indexOf(n)) {
        fail(app.ln, `store ${named.join(' ')}: ${n} reads ${d}, so ${d}'s provider has to be`
          + ` outside it — write \`store ${d} ${n}\``);
      }
    }
  }
  const out = [], state = new Map();
  const visit = (n, trail) => {
    if (state.get(n) === 'done') return;
    if (state.get(n) === 'open') {
      fail(app.ln, `${trail.slice(trail.indexOf(n)).join(' and ')} read each other,`
        + ` so neither provider can be the outer one`);
    }
    state.set(n, 'open');
    for (const d of [...(deps.get(n) || [])].sort()) if (stores.has(d)) visit(d, [...trail, n]);
    state.set(n, 'done');
    out.push(n);
  };
  for (const n of [...named, ...[...stores.keys()].filter(x => !named.includes(x)).sort()]) visit(n, []);
  return out;
}

export { parseApp, storeOrder };
