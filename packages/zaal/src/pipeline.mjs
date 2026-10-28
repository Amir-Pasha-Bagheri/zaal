// Read a project, compile every source against it, write the deliverable, serve it, rebuild on
// change. The only target-specific step is the code itself: the caller hands in `framework`,
// an object saying which backends the target has and how it emits each file of the output.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, unlinkSync,
  rmdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { basename, dirname, join, extname, resolve, sep } from 'node:path';
import { SRC_DIR, APP_FILE, OUT_SRC, OUT_CSS, posix } from './layout.mjs';
import { fail, inFile } from './diagnostics.mjs';
import { syncDeps } from './deps.mjs';
import { readManifest, writeManifest } from './manifest.mjs';
import { warn, pkgLine } from './log.mjs';

// app.zaal, the design system and every block in zaal/ — the context a source file compiles
// against. Shared, so compiling one file alone means exactly what compiling the app means.
//
// `parseApp` and `parseUI` are injected rather than imported: what an app declaration and a
// design system *are* belongs to the layer above (@zaal/web, for a frontend target), so that a
// target compiling to something other than a web page is not forced to have either.
function project({ root = '.', appFile = APP_FILE, srcDir = SRC_DIR, parseApp, parseUI } = {}) {
  if (!parseApp || !parseUI) {
    throw new Error('project: needs `parseApp` and `parseUI` — a web target passes @zaal/web\'s');
  }
  if (!existsSync(join(root, appFile))) {
    // Point at the layout, rather than leaving an ENOENT to be decoded. An earlier Zaal kept
    // sources in src/ with app.zaal at the root, so name the move when either is what is there.
    const name = basename(appFile);
    const stray = existsSync(join(root, 'src', name)) ? ` — rename src/ to ${srcDir}/`
      : existsSync(join(root, name)) ? ` — move ${name} into ${srcDir}/`
      : existsSync(join(root, 'src')) ? ` — rename src/ to ${srcDir}/ and put ${name} in it`
      : '';
    throw new Error(`no ${appFile}: a Zaal project keeps its sources in ${srcDir}/${stray}`);
  }
  const appSrc = readFileSync(join(root, appFile), 'utf8');
  const app = inFile(appSrc, appFile, () => parseApp(appSrc));
  // `ui ./ui.zaal` and `css ./app.css` are written the way the app file reads them, so they
  // resolve against its directory; from here on both are paths from the project root.
  const near = p => /^https?:/.test(p) ? p : posix(join(dirname(appFile), p));
  if (app.ui) app.ui = near(app.ui);
  app.css = app.css.map(near);
  // A `ui` line pointing at nothing means the app has no design system — say so, rather than
  // linking a stylesheet the build never wrote.
  const uiSrc = app.ui && existsSync(join(root, app.ui)) ? readFileSync(join(root, app.ui), 'utf8') : null;
  if (app.ui && uiSrc === null) { app.uiMissing = app.ui; app.ui = null; }
  const ui = uiSrc === null ? null : inFile(uiSrc, app.ui, () => parseUI(uiSrc));
  // Read every source first: a store has to be known before the files that consume it compile.
  // Subdirectories come along — the output mirrors the tree, so `i Btn ./ui/Btn` resolves itself.
  // The app file and the design system live in zaal/ too, and are config, not modules.
  const config = new Set([appFile, app.ui].filter(Boolean).map(posix));
  const sources = new Map(readdirSync(join(root, srcDir), { recursive: true })
    .map(f => String(f).split(sep).join('/')).filter(f => /\.zaal$/.test(f)).sort()
    .filter(f => !config.has(posix(join(srcDir, f))))
    .map(f => [f, readFileSync(join(root, srcDir, f), 'utf8')]));
  // Every block in zaal/, so a file referencing a component can be told which `i` line it needs.
  const stores = new Map(), comps = new Map(), hooks = new Map(), clashes = [];
  // Where each `provide <Name>` line lives, so a file that reads the context knows which module
  // to import `use<Name>` from. A `provide` sits inside markup rather than at the top of a file,
  // so it is matched on its own rather than against the block the scan is in.
  const ctxs = new Map();
  // What each store reads (`use { … } = Other`) and where it persists: the provider order has
  // to follow the first, and two stores may not share the second.
  const storeDeps = new Map(), storeKeys = new Map();
  for (const [f, src] of sources) {
    const file = f.replace(/\.zaal$/, '');
    let current = null;
    // Which block of this file is its default export, and so how an `i` line reaches each one.
    // The rule the code generator follows: the block named after the file, or the first one if
    // none matches. Recorded in order, then resolved once the whole file has been read.
    const order = [];
    for (const line of src.split('\n')) {
      // `C`/`S` name a component or a store and are capitalised; `H` names a hook, which React
      // requires be `use` + a capital. Three heads, so two shapes.
      const block = /^([CS])[ \t]+(\p{Lu}[\p{L}\p{N}_$]*)([ \t].*)?$/u.exec(line)
        || /^(H)[ \t]+(use\p{Lu}[\p{L}\p{N}_$]*)([ \t].*)?$/u.exec(line);
      if (block) {
        const [, head, name, rest = ''] = block;
        // One name, two files: a reference to it would resolve to whichever came last.
        const prev = head === 'S' ? stores.get(name)
          : head === 'H' ? hooks.get(name)?.file : comps.get(name)?.file;
        if (prev && prev !== file) clashes.push(`${head} ${name} is declared in both ${prev}.zaal and ${file}.zaal`);
        if (head === 'H') {
          // A hook is called, never rendered, so it takes no part in provider order.
          order.push(['H', name]);
          hooks.set(name, { file, named: true });
          current = null;
        } else if (head === 'S') {
          stores.set(name, file);
          storeDeps.set(name, new Set());
          const persist = /(?:^|[ \t])persist(?:=(\S+))?(?=[ \t]|$)/.exec(rest);
          if (persist) storeKeys.set(name, persist[1] || `zaal:${name.toLowerCase()}`);
          current = name;
        } else {
          order.push(['C', name]);
          comps.set(name, { file, named: true });
          current = null;
        }
        continue;
      }
      const gives = /^[ \t]+provide[ \t]+(\p{Lu}[\p{L}\p{N}_$]*)[ \t]*=/u.exec(line);
      if (gives) {
        const name = gives[1], prev = ctxs.get(name);
        // One context, two files: a `use … = Name` would resolve to whichever came last, and
        // the two `createContext` calls are two different contexts, so the hook reads null.
        if (prev && prev !== file) {
          clashes.push(`provide ${name} is in both ${prev}.zaal and ${file}.zaal`
            + ` — two contexts of one name, and a consumer can only read one of them`);
        }
        ctxs.set(name, prev && prev !== file ? prev : file);
      }
      if (!current || !/^[ \t]/.test(line)) { if (!/^[ \t]/.test(line) && line.trim()) current = null; continue; }
      const reads = /^[ \t]+use\b.*=[ \t]*(\p{Lu}[\p{L}\p{N}_$]*)[ \t]*$/u.exec(line);
      if (reads) storeDeps.get(current).add(reads[1]);
    }
    // `S` is always reached as `use<Name>`, a named export either way, so only C and H care.
    const def = order.find(([, n]) => n === basename(file)) ?? order[0];
    if (def) (def[0] === 'H' ? hooks : comps).get(def[1]).named = false;
  }
  const sharing = new Map();
  for (const [name, key] of storeKeys) {
    if (sharing.has(key)) {
      clashes.push(`S ${sharing.get(key)} and S ${name} both persist to \`${key}\``
        + ` — one would overwrite the other`);
    }
    sharing.set(key, name);
  }
  return { app, appSrc, ui, sources, stores, comps, hooks, ctxs, clashes, storeDeps, storeKeys };
}

// Compile a project and write it out. `framework` is the target (`@zaal/react`, `@zaal/vue`, …);
// `backend` names one of its code shapes — React's are `jsx` for a bundler and `esm` for the
// no-install preview. Everything below is the same for all of them.
function build({ root = '.', appFile = APP_FILE, srcDir = SRC_DIR,
    framework, backend = framework?.default } = {}) {
  if (!framework) throw new Error('build: no target — pass `framework`, e.g. the default export of @zaal/react');
  const be = framework.backends[backend];
  if (!be) {
    throw new Error(`unknown backend: ${backend} —`
      + ` ${framework.name} has ${Object.keys(framework.backends).join(', ')}`);
  }
  const { ext, outDir } = be;
  const { app, appSrc, ui, sources, stores, comps, hooks, ctxs, clashes, storeDeps = new Map() } =
    project({ root, appFile, srcDir, parseApp: framework.parseApp, parseUI: framework.parseUI });
  const made = [], used = new Map(), pkgs = new Map(), assets = new Set();
  inFile(appSrc, appFile, () => { for (const r of app.routes) {
    const c = comps.get(r.component);
    if (!c) fail(r, `route ${r.path}: no \`C ${r.component}\` in ${srcDir}/`);
    if (c.named) fail(r, `route ${r.path}: \`C ${r.component}\` is in ${srcDir}/${c.file}.zaal — a route`
      + ` component is imported from its own file, so it belongs in a file named ${r.component}.zaal`);
  } });
  // Compile the whole app before writing anything: a build that fails leaves the last good
  // output untouched, instead of a directory half-new and half-old that nothing can run.
  const files = new Map();
  for (const [f, src] of sources) {
    const seen = new Set();
    const path = f.replace(/\.zaal$/, '');
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const code = inFile(src, join(srcDir, f), () => framework.compile(src, backend,
      { ui, used: seen, pkgs, pins: app.pins, cdn: app.cdn, stores, comps, hooks, ctxs, dir,
        assets, main: basename(path) }));
    files.set(`${OUT_SRC}/${path}${ext}`, code);
    for (const c of seen) if (!used.has(c)) used.set(c, f);
    made.push(`${OUT_SRC}/${path}${ext}`);
  }
  const warnings = ui
    ? [...used].filter(([c]) => !ui.known.has(c)).map(([c, f]) => `${f}: class .${c} is not in the UI kit`)
    : [];
  if (app.uiMissing) warnings.push(`${appFile}: ui ${app.uiMissing} is not there — no design system`);
  warnings.push(...clashes);
  for (const [id, p] of pkgs) {
    if (p.clash) warnings.push(p.clash);
    if (!p.version) warnings.push(`${id} is unpinned — add \`pkg ${p.pkg}@<version>\` to ${appFile}`);
  }
  // Whatever the target ships beside the app's own modules — React's hash router, say.
  for (const [name, code] of Object.entries(framework.runtime?.(backend) || {})) {
    files.set(`${OUT_SRC}/${name}`, code);
  }
  files.set(`${OUT_SRC}/main${ext}`,
    inFile(appSrc, appFile, () => framework.mainFile(app, backend, stores, comps, storeDeps)));
  files.set('index.html', framework.html(app, backend, pkgs));
  if (ui) files.set(`${OUT_CSS}/ui.css`, framework.uiCss(ui));
  mkdirSync(join(root, outDir), { recursive: true });
  // The esm preview is served straight from disk and installs nothing, so it needs no project
  // files; `application/` is the one a developer runs, builds and commits.
  const scaffolded = be.scaffold ? framework.scaffold(join(root, outDir), app) : [];
  const deps = be.scaffold ? syncDeps(join(root, outDir), pkgs) : [];
  const prev = readManifest(root, posix(outDir));
  // index.html is generated from app.zaal every build, and it is also the one generated file a
  // developer edits by hand — a favicon, meta tags, an analytics snippet. Ask the target to
  // carry across whatever it did not write, before the new one lands on top of it. Only for an
  // output a developer owns: the preview is rebuilt from nothing every time.
  let head = null;
  if (be.scaffold && framework.mergeHead && files.has('index.html')) {
    const page = join(root, outDir, 'index.html');
    const merged = framework.mergeHead(files.get('index.html'),
      existsSync(page) ? readFileSync(page, 'utf8') : null, prev?.head);
    files.set('index.html', merged.html);
    head = merged.head;
  }
  for (const [name, code] of files) {
    if (name.includes('/')) mkdirSync(join(root, outDir, name.slice(0, name.lastIndexOf('/'))), { recursive: true });
    writeFileSync(join(root, outDir, name), code);
  }
  const copied = [];
  // An `i logo ./logo.png` line names a file in zaal/: the output mirrors the tree, so the asset
  // lands at the same path beside the module that imports it.
  for (const a of assets) {
    const from = join(root, srcDir, a);
    if (!existsSync(from)) { warnings.push(`${a} is imported but not in ${srcDir}/`); continue; }
    const to = `${OUT_SRC}/${a}`;
    mkdirSync(join(root, outDir, to.slice(0, to.lastIndexOf('/'))), { recursive: true });
    writeFileSync(join(root, outDir, to), readFileSync(from));
    copied.push(to);
  }
  for (const c of app.css) {
    const from = join(root, c);
    if (!existsSync(from)) continue;
    const to = `${OUT_CSS}/${basename(c)}`;
    mkdirSync(join(root, outDir, OUT_CSS), { recursive: true });
    writeFileSync(join(root, outDir, to), readFileSync(from));
    copied.push(to);
  }
  // A deleted or renamed .zaal must not leave a live module behind in the output. What is stale
  // is what the last build wrote and this one did not — read from the manifest, so a file the
  // developer added is never a candidate, whatever it is called. node_modules/, dist/ and
  // everything else in `application/` is theirs, and a rebuild has no business reaching into it.
  const keep = new Set([...files.keys(), ...copied]);
  const live = f => existsSync(join(root, outDir, f)) && statSync(join(root, outDir, f)).isFile();
  // No manifest means a project built by an older Zaal (or one whose state directory was
  // deleted): sweep the generated tree by extension this once, the way that Zaal did, so its
  // leftovers still go. From the next build on the manifest answers precisely.
  const genDir = join(root, outDir, OUT_SRC);
  const stale = prev?.files
    ? prev.files.filter(f => !keep.has(f) && live(f))
    : (existsSync(genDir) ? readdirSync(genDir, { recursive: true }) : [])
      .map(f => `${OUT_SRC}/${String(f).split(sep).join('/')}`)
      .filter(f => /\.(jsx?|css)$/.test(f) && !keep.has(f))
      .filter(f => statSync(join(root, outDir, f)).isFile());      // assets are left alone
  for (const f of stale) unlinkSync(join(root, outDir, f));
  // A directory the output no longer mirrors goes with it; deepest first, and only if it is empty.
  // Every ancestor is a candidate: emptying src/pages/ may leave src/ empty too.
  const dirs = new Set();
  for (const f of stale) {
    const parts = f.split('/').slice(0, -1);
    for (let i = parts.length; i > 0; i--) dirs.add(parts.slice(0, i).join('/'));
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try { rmdirSync(join(root, outDir, d)); } catch {}            // not empty: something else lives there
  }
  // What this build wrote, for the next one to sweep against.
  writeManifest(root, posix(outDir), { files: [...keep].sort(), ...(head ? { head } : {}) });
  return { app, made, outDir, ui, warnings, pkgs, deps, stores, hooks, stale, scaffolded };
}

/* ---------- static server (esm mode) ---------- */

// Enough of the web's media types for the preview to serve what a build can copy into it:
// a stylesheet as text/plain would not apply, an SVG would not render, a font would not load.
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.wasm': 'application/wasm', '.pdf': 'application/pdf',
};

const RELOAD = `<script>new EventSource('/__zaal').onmessage = () => location.reload();</script>`;

function serve(dir, port = 5173, { live = false } = {}) {
  const clients = new Set();
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/__zaal') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (file !== root && !file.startsWith(root + sep)) {   // `..` must not reach outside the build
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      // A route falls back to the page — the hash router takes it from there. A missing *asset*
      // is a 404 that says so: HTML answered to an `import` only ever surfaces as a parse error
      // somewhere else, which costs a debugging round trip to trace back to here.
      if (extname(path)) {
        console.error(`  404  ${path}`);
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end(`zaal: ${path} is not in ${dir}/ — the last build did not generate it`);
        return;
      }
      file = join(root, 'index.html');
    }
    let body = readFileSync(file);
    if (live && file.endsWith('index.html')) body = body.toString().replace('</body>', `  ${RELOAD}\n  </body>`);
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  });
  server.listen(port, () => console.log(`  \u279c  http://localhost:${port}`));
  return {
    server,
    reload: () => { for (const c of clients) c.write('data: reload\n\n'); },
    close: () => { for (const c of clients) c.end(); server.closeAllConnections?.(); server.close(); },
  };
}

// Rebuild on any .zaal/.css change, then tell open browsers to reload.
function watchAndServe({ port = 5173, srcDir = SRC_DIR, framework } = {}) {
  const preview = { framework, backend: framework.preview };
  const first = build(preview);
  console.log(`\n  Zaal  ${first.app.name}  \u2014 ${first.made.length} modules, ${first.app.routes.length} routes`
    + (first.ui ? `, design system ${first.ui.name}` : '') + pkgLine(first.pkgs));
  warn(first.warnings);
  const { reload } = serve(first.outDir, port, { live: true });
  console.log('  watching for changes...\n');
  let timer;
  const onChange = f => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const next = build(preview);
        warn(next.warnings);
        console.log(`  rebuilt (${f})` + (next.stale.length ? `, removed ${next.stale.join(', ')}` : ''));
        reload();
      } catch (e) { console.error(`  error: ${e.message}`); }
    }, 60);
  };
  // Anything under zaal/ is a source, assets included — a changed logo has to be copied over
  // too. Editor scratch files (`.swp`, `foo~`, dotfiles) are not worth a rebuild.
  const watched = f => !/(^|[\\/])\.|~$|\.(swp|swx|tmp)$/.test(String(f));
  watch(srcDir, { recursive: true }, (_, f) => f && watched(f) && onChange(f));
  for (const f of first.app.css.filter(c => !posix(c).startsWith(srcDir + '/'))) {
    if (existsSync(f)) watch(f, () => onChange(f));
  }
}

export { project, build, serve, watchAndServe };
