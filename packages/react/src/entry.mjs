// The files that are the app rather than a part of it: the entry module that mounts it, the
// hash router it ships with, and index.html.
import { basename } from 'node:path';
import { OUT_SRC, OUT_CSS } from 'zaal';
import { storeOrder } from './app.mjs';
import { REACT_V } from './names.mjs';

const router = target => `import { useState, useEffect, createElement } from 'react';

// Minimal hash router: zero dependencies, patterns may contain :params.
// '#/items/7?tab=stats' -> ['/items/7', 'tab=stats']: the query is not part of the path, so it
// neither breaks a match nor ends up inside a :param.
const split = hash => {
  const raw = hash.slice(1) || '/';
  const q = raw.indexOf('?');
  return q < 0 ? [raw, ''] : [raw.slice(0, q) || '/', raw.slice(q + 1)];
};

// A half-written escape (%zz) is a bad URL, not a reason to throw while rendering.
const decode = s => { try { return decodeURIComponent(s); } catch { return s; } };

function match(pattern, path) {
  const p = pattern.split('/').filter(Boolean), q = path.split('/').filter(Boolean);
  if (p.length !== q.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decode(q[i]);
    else if (p[i] !== q[i]) return null;
  }
  return params;
}

function useHash() {
  const read = () => window.location.hash;
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const on = () => setHash(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

// The current path, without the query: useRoute() -> '/items/7'
export function useRoute() {
  return split(useHash())[0];
}

// The query as a plain object: useQuery() -> { tab: 'stats' }
export function useQuery() {
  const query = split(useHash())[1];
  const out = {};
  for (const [k, v] of new URLSearchParams(query)) out[k] = v;
  return out;
}

// Navigate from code: go('/done'), go('/items?tab=stats')
export const go = to => { window.location.hash = to; };

export function Link({ to, children, ...rest }) {
  const [path, query] = split(useHash());
  const here = query ? path + '?' + query : path;
  const active = to === here || to === path || undefined;
  return createElement('a', { href: '#' + to, 'data-active': active, ...rest }, children);
}

export function Router({ routes, fallback }) {
  const path = useRoute();
  for (const r of routes) {
    const params = match(r.path, path);
    if (params) return createElement(r.component, params);
  }
  return fallback ?? createElement('p', null, 'Not found: ' + path);
}
`;

function mainFile(app, target, stores = new Map(), paths = new Map(), deps = new Map()) {
  const ext = target === 'jsx' ? '.jsx' : '.js';
  const comps = [...new Set(app.routes.map(r => r.component))];
  const routes = new Map(comps.map(c => [c, paths.get(c)?.file ?? c]));
  // `/* NotFound` is the catch-all: not a pattern to match, but what the router renders when
  // nothing matched, so it stays last however the routes are ordered.
  const miss = app.routes.find(r => r.path === '/*')?.component ?? null;
  const table_ = app.routes.filter(r => r.path !== '/*');
  const order = storeOrder(app, stores, deps);
  // A `lazy` route is fetched on first visit instead of shipping inside the main bundle.
  const split = new Set(app.routes.filter(r => r.lazy).map(r => r.component));
  const imports = `import { createRoot } from 'react-dom/client';
import { Router } from './router${ext}';
${order.map(n => `import { ${n}Provider } from './${stores.get(n)}${ext}';`).join('\n')}
${comps.filter(c => !split.has(c)).map(c => `import ${c} from './${routes.get(c)}${ext}';`).join('\n')}
${[...split].map(c => `const ${c} = lazy(() => import('./${routes.get(c)}${ext}'));`).join('\n')}`
    .replace(/\n{2,}/g, '\n').trim();
  const table = `const routes = [\n${table_.map(r => `  { path: '${r.path}', component: ${r.component} },`).join('\n')}\n];`;
  if (target === 'jsx') {
    const wrap = [...order.map(n => [`<${n}Provider>`, `</${n}Provider>`]),
      ...split.size ? [['<Suspense fallback={null}>', '</Suspense>']] : []];
    const open = wrap.map(([o], i) => `${'  '.repeat(i + 2)}${o}`);
    const close = wrap.map(([, c], i) => `${'  '.repeat(i + 2)}${c}`).reverse();
    // (local stylesheets are linked by index.html — in both backends, so they load once)
    const router_ = `<Router routes={routes}${miss ? ` fallback={<${miss} />}` : ''} />`;
    return `import React${split.size ? ', { lazy, Suspense }' : ''} from 'react';\n${imports}\n
${table}

createRoot(document.getElementById('${app.mount}')).render(
  <React.StrictMode>
${[...open, `${'  '.repeat(wrap.length + 2)}${router_}`, ...close].join('\n')}
  </React.StrictMode>
);
`;
  }
  const args = `{ routes${miss ? `, fallback: createElement(${miss})` : ''} }`;
  const routed = split.size
    ? `createElement(Suspense, { fallback: null }, createElement(Router, ${args}))`
    : `createElement(Router, ${args})`;
  const tree = order.reduceRight((inner, n) => `createElement(${n}Provider, null, ${inner})`, routed);
  return `import { createElement, StrictMode${split.size ? ', lazy, Suspense' : ''} } from 'react';\n${imports}\n
${table}

createRoot(document.getElementById('${app.mount}')).render(
  createElement(StrictMode, null, ${tree})
);
`;
}

// react, react-dom and whatever the `i` lines named — every bare specifier the modules use.
function importMap(app, pkgs) {
  const v = n => app.pins.get(n) || REACT_V;                     // `pkg react@19.2.0` moves the app
  const react = `${app.cdn}/react@${v('react')}`, dom = `${app.cdn}/react-dom@${v('react-dom')}`;
  const imports = { react, 'react/jsx-runtime': `${react}/jsx-runtime`,
    'react-dom': dom, 'react-dom/client': `${dom}/client` };
  for (const [id, p] of pkgs || []) if (!p.css) imports[id] = p.url;
  return JSON.stringify({ imports }, null, 2).replace(/^/gm, '      ');
}

// The title is text the author wrote, and it lands in markup: `Tom & Jerry` has to survive,
// and `</title>` must not end the element early.
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const html = (app, target, pkgs) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(app.title)}</title>
${[
    ...[...(target === 'esm' ? [...pkgs || []].filter(([, p]) => p.css).map(([, p]) => p.url) : []),
      app.ui && `${OUT_CSS}/ui.css`,
      ...app.css.map(c => /^https?:/.test(c) ? c : `${OUT_CSS}/${basename(c)}`)].filter(Boolean)
      .map(c => `    <link rel="stylesheet" href="${/^https?:/.test(c) ? c : './' + c}" />`),
    // only the no-install preview resolves packages in the page; a bundler reads the imports
    target === 'esm' && `    <script type="importmap">\n${importMap(app, pkgs)}\n    </script>`,
  ].filter(Boolean).join('\n')}
  </head>
  <body>
    <div id="${app.mount}"></div>
    <script type="module" src="./${OUT_SRC}/main${target === 'jsx' ? '.jsx' : '.js'}"></script>
  </body>
</html>
`;

export { router, mainFile, importMap, html };
