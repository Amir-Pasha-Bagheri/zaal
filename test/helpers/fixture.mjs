// Build a Zal project in a scratch directory, then (optionally) import and run what it wrote.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build, project } from '../../zal.mjs';
import { installEnv } from './env.mjs';

const roots = [];

export function projectDir(files) {
  const root = mkdtempSync(join(tmpdir(), 'zal-test-'));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

export const read = (root, path) => readFileSync(join(root, path), 'utf8');
export const has = (root, path) => existsSync(join(root, path));

export const buildIn = (root, target = 'jsx') => build({ root, target });
export const inspect = root => project({ root });

export const cleanup = () => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); };

// Build the esm backend and run `src/main.js` against the tiny React: the generated app, live.
export async function runProject(root, { hash = '#/', fetch } = {}) {
  const out = buildIn(root, 'esm');
  const env = installEnv({ hash, ...(fetch ? { fetch } : {}) });
  await import(join(root, out.outDir, 'src/main.js'));
  return { env, out, app: env.app };
}

// The example/ project that ships with the compiler, copied so a build cannot disturb it.
export function exampleDir() {
  const src = new URL('../../example/zal/', import.meta.url).pathname;
  const files = {};
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory()) walk(join(dir, name.name), `${prefix}${name.name}/`);
      // text for sources, bytes for assets: the example ships a .png
      else files[`zal/${prefix}${name.name}`] = /\.(zal|css|json|txt|md)$/.test(name.name)
        ? readFileSync(join(dir, name.name), 'utf8') : readFileSync(join(dir, name.name));
    }
  };
  walk(src, '');
  return projectDir(files);
}
