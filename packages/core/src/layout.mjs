// The on-disk shape of a Zal project, and how one generated module names another. Target
// independent: every target reads sources from the same place and mirrors the same tree.
import { sep } from 'node:path';

// A Zal project has two directories: `zal/` is everything hand-written (`app.zal`, `ui.zal`
// and the sources, foldered however the app reads best), and `application/` is a complete,
// standalone React app — package.json, vite.config.js, index.html and a `src/` tree mirroring
// the sources. Nothing in it names the compiler, so a developer can `git init` inside
// `application/`, `npm install` and run it like any React project they wrote by hand.
const SRC_DIR = 'zal';                 // hand-written sources
const APP_FILE = `${SRC_DIR}/app.zal`; // the app declaration
const APP_DIR = 'application';         // the generated React app — the deliverable
const DEV_DIR = '.zal-dev';            // `zal dev`'s zero-install preview, ephemeral
const OUT_SRC = 'src';                 // where modules land inside the output
const OUT_CSS = `${OUT_SRC}/styles`;   // where stylesheets land inside the output

const posix = p => p.split(sep).join('/');

// A local specifier as the importing module has to write it. The output mirrors zal/, so a module
// in a subdirectory reaches the root with `../` exactly as its source would.
const rel = (dir, path) => dir
  ? (path === dir || path.startsWith(dir + '/') ? './' + path.slice(dir.length + 1)
    : '../'.repeat(dir.split('/').length) + path)
  : './' + path;

export { SRC_DIR, APP_FILE, APP_DIR, DEV_DIR, OUT_SRC, OUT_CSS, posix, rel };
