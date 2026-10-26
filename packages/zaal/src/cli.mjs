// `zaal` — the command line. It picks a target and hands it to the pipeline; the pipeline
// does the work.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { APP_FILE } from './layout.mjs';
import { inFile } from './diagnostics.mjs';
import { warn, pkgLine } from './log.mjs';
import { project, build, serve, watchAndServe } from './pipeline.mjs';

// ---------- target resolution ----------

// A target is a separate package — `@zaal/react`, `@zaal/vue`, … — so `zaal` itself depends on
// nothing and every framework is an equal plugin on top of it. Which one an app wants is a
// `target` line in app.zaal, read here with a text scan rather than the parser: parsing app.zaal
// is itself a target's job (@zaal/web's, for a web target), so it cannot run before this does.
const DEFAULT_TARGET = 'react';

const targetName = (root, appFile) => {
  const path = join(root, appFile);
  if (!existsSync(path)) return DEFAULT_TARGET;
  const m = /^[ \t]*target[ \t]+([\w@/-]+)[ \t]*$/m.exec(readFileSync(path, 'utf8'));
  return m ? m[1] : DEFAULT_TARGET;
};

// `react` means `@zaal/react`; a name with a slash is taken as written, so a target outside the
// scope works too (`target my-org/zaal-svelte`).
const packageFor = name => name.includes('/') ? name : `@zaal/${name}`;

// Resolved from the project first — a globally installed `zaal` has to find the target in the
// project that asked for it, not next to itself — then from `zaal`'s own location, which is what
// a local install and this repo's own workspace both look like.
async function loadTarget(root = '.', appFile = APP_FILE) {
  const name = targetName(root, appFile);
  const pkg = packageFor(name);
  const tried = [];
  for (const from of [join(resolve(root), 'package.json'), import.meta.url]) {
    try {
      const resolved = createRequire(from).resolve(pkg);
      const mod = await import(pathToFileURL(resolved).href);
      const target = mod.default ?? mod.target;
      if (!target?.backends) throw new Error(`${pkg} does not export a Zaal target`);
      return target;
    } catch (e) {
      tried.push(e);
    }
  }
  throw new Error(`no target \`${name}\`: install it with \`npm i -D ${pkg}\``
    + `\n         (app.zaal picks one with a \`target\` line; the default is \`${DEFAULT_TARGET}\`)`);
}

// Which of the app's packages are not unpacked in the app's node_modules yet.
const notInstalled = (dir, pkgs) => [...pkgs.values()].filter(p => !existsSync(join(dir, 'node_modules', p.pkg)));

async function cli(argv) {
  const target_ = () => loadTarget();
  const cmd = argv[0] ?? 'help';
  const vite = argv.includes('--vite');
  const port = Number(argv.find(a => /^\d+$/.test(a))) || 5173;

  if (cmd === 'dev' && !vite) return watchAndServe({ port, framework: await target_() });

  if (cmd === 'dev' || cmd === 'build' || cmd === 'serve') {
    // A build writes the deliverable: a real React project in application/. The esm preview is
    // only what `zaal serve` needs to run without installing anything, so it stays out of the
    // way in .zaal-dev/ and never touches the folder the developer has under git.
    const framework = await target_();
    const target = cmd === 'serve' ? framework.preview : framework.default;
    const { app, made, outDir, ui, warnings, pkgs, deps, stale, scaffolded } =
      build({ framework, backend: target });
    console.log(`Zaal ${app.name}: ${made.length} modules -> ${outDir}/, ${app.routes.length} routes`
      + (ui ? `, ui ${ui.name}` : '') + pkgLine(pkgs));
    if (scaffolded?.length) console.log(`  + ${outDir}/${scaffolded.join(`, ${outDir}/`)}`);
    if (deps?.length) console.log(`  + ${outDir}/package.json: ${deps.join(', ')}`);
    if (stale.length) console.log(`  - removed ${stale.length} stale file(s): ${stale.join(', ')}`);
    warn(warnings);
    if (cmd === 'build') console.log(`  ${outDir}/ is a standalone React app — \`cd ${outDir} && npm install && npm run dev\``);
    if (cmd === 'serve') serve(outDir, port, { live: false });
    else if (cmd === 'dev') {                       // --vite path: run the real app
      if (!existsSync(join(outDir, 'node_modules', 'vite')) || notInstalled(outDir, pkgs).length) {
        console.log(`installing deps in ${outDir}/...`);
        spawnSync('npm', ['install', '--no-audit', '--no-fund'], { stdio: 'inherit', cwd: outDir });
      }
      spawnSync('npx', ['vite'], { stdio: 'inherit', cwd: outDir });
    }
    return;
  }

  if (/\.zaal$/.test(cmd)) {                    // single file
    const framework = await target_();
    const target = vite ? framework.default : framework.preview;
    const outDir = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'out';
    mkdirSync(outDir, { recursive: true });
    const name = basename(cmd).replace(/\.zaal$/, '');
    const dest = join(outDir, name + framework.backends[target].ext);
    const src = readFileSync(cmd, 'utf8');
    // One file still belongs to its app: the design system, the stores and the package pins come
    // from app.zaal, so `%entry` and `use … = Store` mean here what they mean in a full build.
    const p = existsSync(APP_FILE)
      ? project({ parseApp: framework.parseApp, parseUI: framework.parseUI }) : null;
    writeFileSync(dest, inFile(src, cmd, () => framework.compile(src, target, { ui: p?.ui, stores: p?.stores,
      comps: p?.comps, pins: p?.app.pins, cdn: p?.app.cdn, main: name })));
    console.log(`${cmd} -> ${dest}`);
    return;
  }

  console.error(`zaal — compile .zaal sources into a React app

  zaal build           write the React app to application/
  zaal dev [port]      preview and live-reload on change          (no install needed)
  zaal dev --vite      build application/ and run it through Vite (installs there)
  zaal serve [port]    serve the preview without watching
  zaal <file.zaal>     compile a single file

sources live in zaal/ (app.zaal and ui.zaal included). \`zaal build\` writes application/ — a
standalone React app with its own package.json, vite.config.js, index.html and src/ tree —
which is the folder to commit, install and deploy. \`zaal dev\` previews it without installing
anything, from .zaal-dev/, and leaves application/ untouched.`);
  process.exit(1);
}

export { cli, loadTarget };
