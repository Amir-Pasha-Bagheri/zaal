// Compile one source both ways, render both with the same React, and compare. The two
// backends are meant to be two spellings of one program: any difference in what they put on
// the page is a bug in one of them, and the only way to see it is to run both.
import { buildSync, transformSync } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dropDir } from './scratch.mjs';
import { join } from 'node:path';
import { compile } from '../../zaal.mjs';

let esbuildOk = true, server = null, react = null;
try {
  server = await import('react-dom/server');
  react = await import('react');
} catch { esbuildOk = false; }
export const diffAvailable = Boolean(esbuildOk && server && react);

// One directory per process: test files run in parallel, and three of them use this helper.
// A shared directory means one file's `after` removing modules another is still writing (an
// ENOTEMPTY, or a vanished import), and `m0.mjs` written twice at once.
const DIR = new URL(`../../node_modules/.zaal-diff/p${process.pid}/`, import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
export const cleanupDiff = () => dropDir(DIR);

let n = 0;

const load = async (code, ext) => {
  const file = join(DIR, `m${n++}.mjs`);
  writeFileSync(file, ext === 'jsx' ? transformSync(code, { loader: 'jsx', jsx: 'automatic' }).code : code);
  return import(file);
};

const render = async (code, kind, props) => {
  const out = { html: null, threw: null, warnings: [] };
  const real = console.error;
  console.error = (...a) => out.warnings.push(a.map(String).join(' ').split('\n')[0]);
  try {
    const mod = await load(code, kind);
    out.html = server.renderToStaticMarkup(react.createElement(mod.default, props));
  } catch (e) { out.threw = e.message.split('\n')[0]; } finally { console.error = real; }
  return out;
};

// Render two modules that are meant to be the same program, and say how they differ.
export async function renderBoth(jsxCode, esmCode, props = {}) {
  const a = await render(jsxCode, 'jsx', props);
  const b = await render(esmCode, 'esm', props);
  if (a.threw || b.threw) {
    return a.threw === b.threw ? null : { why: 'one backend threw', jsx: a.threw ?? a.html, esm: b.threw ?? b.html };
  }
  if (a.html !== b.html) return { why: 'different markup', jsx: a.html, esm: b.html };
  const aw = a.warnings.join('|'), bw = b.warnings.join('|');
  if (aw !== bw) return { why: 'different warnings', jsx: aw, esm: bw };
  return null;
}

// -> null when the two agree, or a report of how they differ
export async function differs(src, props = {}, opts = {}) {
  let jsx, esm;
  try {
    jsx = compile(src, 'jsx', opts);
    esm = compile(src, 'esm', opts);
  } catch (e) {
    return null;                      // a source both backends reject is not a difference
  }
  const d = await renderBoth(jsx, esm, props);
  return d && { ...d, src, jsxCode: jsx, esmCode: esm };
}

export const report = d => `${d.why}\n  source:\n${d.src.replace(/^/gm, '    ')}`
  + `\n  jsx: ${JSON.stringify(d.jsx)}\n  esm: ${JSON.stringify(d.esm)}`;
