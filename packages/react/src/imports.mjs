// `i` lines -> import statements, and the project files `application/` needs to be a React
// app a developer can run without ever hearing about Zaal.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail, here, isRel, isAsset, pkgRef, posix, CDN } from 'zaal';
import { REACT_V, EXTERNAL, BUILTIN, VITE_V, PLUGIN_V } from './names.mjs';

// react and react-dom are React's to provide: they are already in the import map at the version
// app.zaal pins, and re-entering them as packages would overwrite that with an unpinned copy.
// Every other package is told to borrow them rather than ship a React of its own.
const ref = (spec, opts) => pkgRef(spec, { ...opts, builtin: BUILTIN, external: EXTERNAL });

function importLine(n, target, opts) {
  here(n);
  const ext = target === 'jsx' ? '.jsx' : '.js';
  if (n.spec !== undefined) {                                    // side-effect import
    if (isRel(n.spec)) fail(n, `i ${n.spec}: a local stylesheet belongs in app.zaal (\`css …\`)`);
    const { id, css } = ref(n.spec, opts);
    return css && target === 'esm' ? null : `import '${id}';`;   // esm links package css in <head>
  }
  // A local specifier that already names a file — `./logo.png`, `./data.json` — is an asset, not
  // a module: it keeps the extension it has, and the build copies it beside the module.
  // `i Heavy ./Heavy lazy` — fetched on first render instead of shipping in the main bundle.
  // The markup wraps it in `Suspense` itself, which is in scope for free.
  if (n.lazy) {
    if (!/^[A-Za-z_$][\w$]*$/.test(n.what)) {
      fail(n, `i ${n.what} ${n.from} lazy: a lazy import is one default name — \`i Heavy ./Heavy lazy\``);
    }
    const from = isRel(n.from) ? n.from.replace(/\.jsx?$/, '') + ext : ref(n.from, opts).id;
    return `const ${n.what} = lazy(() => import('${from}'));`;
  }
  if (isRel(n.from)) {
    if (isAsset(n.from)) {
      opts?.assets?.add(posix(join(opts.dir || '', n.from)));
      // A bundler turns the import into a URL; the no-install preview has no bundler, so it
      // writes the URL itself — the same value, resolved against the module.
      return target === 'jsx' ? `import ${n.what} from '${n.from}';`
        : `const ${n.what} = new URL('${n.from}', import.meta.url).href;`;
    }
    return `import ${n.what} from '${n.from.replace(/\.jsx?$/, '') + ext}';`;
  }
  return `import ${n.what} from '${ref(n.from, opts).id}';`;
}

// `application/` is handed to a developer, not to a bundler, so it needs the files any React
// project has. They are written once and then left alone: a hand edit — a Vite plugin, a dev
// proxy, an extra script — has to survive every rebuild. The only standing change the compiler
// makes to them afterwards is adding a package an `i` line named to `dependencies`.

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';

function scaffold(dir, app) {
  const react = `^${app.pins.get('react') || REACT_V}`;
  const made = [];
  const once = (name, body) => {
    if (existsSync(join(dir, name))) return;
    writeFileSync(join(dir, name), body);
    made.push(name);
  };
  once('package.json', JSON.stringify({
    name: slug(app.name), private: true, version: '0.0.0', type: 'module',
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react, 'react-dom': `^${app.pins.get('react-dom') || REACT_V}` },
    devDependencies: { '@vitejs/plugin-react': PLUGIN_V, vite: VITE_V },
  }, null, 2) + '\n');
  once('vite.config.js',
    `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\n`
    // `base: './'` keeps the built page relocatable: Vite's default writes absolute `/assets/…`
    // URLs, which only work when the site is served from a domain root. The app routes on the
    // hash, so a relative base costs nothing and `dist/` can be dropped anywhere — a project
    // page, a subdirectory, even opened from disk.
    + `export default defineConfig({ base: './', plugins: [react()] });\n`);
  once('.gitignore', 'node_modules/\ndist/\n');
  return made;
}

export { importLine, scaffold, slug };
