// `zaal` — the command line. It picks a target and hands it to the pipeline; the pipeline
// does the work.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { project, serve, inFile, warn, pkgLine, APP_FILE } from '@zaal/core';
import react, { build, watchAndServe, compile } from '@zaal/react';

// Which of the app's packages are not unpacked in the app's node_modules yet.
const notInstalled = (dir, pkgs) => [...pkgs.values()].filter(p => !existsSync(join(dir, 'node_modules', p.pkg)));

function cli(argv) {
  const cmd = argv[0] ?? 'help';
  const vite = argv.includes('--vite');
  const port = Number(argv.find(a => /^\d+$/.test(a))) || 5173;

  if (cmd === 'dev' && !vite) return watchAndServe({ port });

  if (cmd === 'dev' || cmd === 'build' || cmd === 'serve') {
    // A build writes the deliverable: a real React project in application/. The esm preview is
    // only what `zaal serve` needs to run without installing anything, so it stays out of the
    // way in .zaal-dev/ and never touches the folder the developer has under git.
    const target = cmd === 'serve' ? react.preview : react.default;
    const { app, made, outDir, ui, warnings, pkgs, deps, stale, scaffolded } = build({ target });
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
    const target = vite ? react.default : react.preview;
    const outDir = argv[1] && !argv[1].startsWith('--') ? argv[1] : 'out';
    mkdirSync(outDir, { recursive: true });
    const name = basename(cmd).replace(/\.zaal$/, '');
    const dest = join(outDir, name + react.backends[target].ext);
    const src = readFileSync(cmd, 'utf8');
    // One file still belongs to its app: the design system, the stores and the package pins come
    // from app.zaal, so `%entry` and `use … = Store` mean here what they mean in a full build.
    const p = existsSync(APP_FILE) ? project() : null;
    writeFileSync(dest, inFile(src, cmd, () => compile(src, target, { ui: p?.ui, stores: p?.stores,
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

export { cli };
