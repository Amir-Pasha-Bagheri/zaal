// The oracles the suite cannot write for itself: esbuild parses the jsx the compiler emits,
// and React renders it. A hand-written checker only knows the mistakes its author thought of
// — React knows all of them, and says so on console.error (or by throwing).
//
// Both are devDependencies, so every export here degrades to `available: false` and the specs
// that need them skip: the compiler has no dependencies and `npm test` must not grow any.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../../zaal.mjs';

let esbuild = null, server = null, react = null;
try {
  esbuild = await import('esbuild');
  server = await import('react-dom/server');
  react = await import('react');
} catch { /* not installed: the specs that need them skip */ }

export const available = Boolean(esbuild && server && react);

// Modules land inside node_modules/ so that `import 'react'` resolves the way it would in an
// app, and so a stray file never ends up in the repo.
const DIR = new URL('../../node_modules/.zaal-test/', import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
export const cleanupReal = () => rmSync(DIR, { recursive: true, force: true });

let n = 0;

// Parse as real JSX. Returns the error esbuild reports, or null.
export function parseJsx(code, name = 'module') {
  if (!esbuild) return null;
  try {
    esbuild.transformSync(code, { loader: 'jsx', jsx: 'automatic' });
    return null;
  } catch (e) { return `${name}: ${e.errors?.[0]?.text ?? e.message}`; }
}

// Compile a source, transform it, and render it through React. Any console.error React writes
// — "Invalid DOM property", a missing key, an invalid nesting — comes back in `warnings`.
export async function renderZaal(src, props = {}, opts = {}) {
  const jsx = compile(src, 'jsx', opts);
  const js = esbuild.transformSync(jsx, { loader: 'jsx', jsx: 'automatic' }).code;
  const file = join(DIR, `m${n++}.mjs`);
  writeFileSync(file, js);
  const mod = await import(file);
  const warnings = [];
  const real = console.error;
  console.error = (...a) => warnings.push(a.map(String).join(' ').split('\n')[0]);
  let html = null, threw = null;
  // React has to call the component, not us: calling it here renders the same markup but with
  // no dispatcher, so every hook throws and no render-time warning is ever produced.
  try { html = server.renderToStaticMarkup(react.createElement(mod.default, props)); }
  catch (e) { threw = e.message.split('\n')[0]; }
  finally { console.error = real; }
  return { jsx, html, warnings, threw };
}
