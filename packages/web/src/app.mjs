// app.zaal: the routes, the title, the design system, the package pins. An app declaration
// says what the app *is*, not what it compiles to, so none of this is target-specific.
import { parse, fail, splitSpec, CDN, SRC_DIR } from '@zaal/core';

function parseApp(src) {
  const node = parse(src).kids.find(n => n.kind === 'app');
  if (!node) throw new Error('app file has no `A <Name>` block');
  const app = { name: node.name, ln: node.ln, title: node.name, mount: 'root', ui: null, css: [], routes: [],
    pins: new Map(), cdn: CDN, storeOrder: [] };
  for (const k of node.kids) {
    if (k.kind === 'route') { app.routes.push({ path: k.path, component: k.component, lazy: k.lazy, ln: k.ln }); continue; }
    const [key, ...rest] = k.raw;
    const val = rest.join(' ').replace(/^"|"$/g, '');
    if (key === 't') app.title = val;
    else if (key === 'm') app.mount = val.replace(/^#/, '');
    else if (key === 'ui') app.ui = val;
    else if (key === 'css') app.css.push(val);
    else if (key === 'store') app.storeOrder.push(...rest);
    else if (key === 'pkg') { const { pkg, version } = splitSpec(val); app.pins.set(pkg, version); }
    else if (key === 'cdn') app.cdn = val.replace(/\/$/, '');
    else fail(k, `app: unknown directive \`${key}\``);
  }
  return app;
}

// Providers listed in app.zaal (`store A B`) wrap outermost-first, the rest follow by name.
function storeOrder(app, stores) {
  const named = app.storeOrder.filter(n => stores.has(n));
  for (const n of app.storeOrder) if (!stores.has(n)) fail(app.ln, `store ${n}: no \`S ${n}\` in ${SRC_DIR}/`);
  return [...named, ...[...stores.keys()].filter(n => !named.includes(n)).sort()];
}

export { parseApp, storeOrder };
