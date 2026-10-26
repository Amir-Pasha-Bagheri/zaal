// @zaal/react — the React target for Zaal. Everything React-specific about the compiler lives
// in this package; @zaal/core owns the grammar, the design system and the build pipeline.
//
// A target is an object: which code shapes ("backends") it can emit, and how it writes each
// file of the output. @zaal/core's `build` asks it those questions and never names React.
import { APP_DIR, DEV_DIR, build as coreBuild, watchAndServe as coreWatch,
  project as coreProject } from '@zaal/core';
import { parseApp, parseUI, uiCss } from '@zaal/web';
import { compile } from './compile.mjs';
import { router, mainFile, html } from './app.mjs';
import { scaffold } from './imports.mjs';

const react = {
  name: 'react',
  // `jsx` is the deliverable: a real Vite project in application/, which is what a developer
  // installs, runs and commits. `esm` is createElement calls served straight from disk, so
  // `zaal dev` can preview the app without installing anything.
  default: 'jsx',
  preview: 'esm',
  backends: {
    jsx: { ext: '.jsx', outDir: APP_DIR, scaffold: true },
    esm: { ext: '.js', outDir: DEV_DIR, scaffold: false },
  },
  compile,
  mainFile,
  html,
  scaffold,
  // React compiles to a web page, so the web layer answers what an app declaration and a design
  // system are. A target compiling to a backend service would answer these differently, or not
  // at all — which is why @zaal/core asks rather than imports.
  parseApp,
  parseUI,
  uiCss,
  // React's hash router ships beside the app's own modules.
  runtime: backend => ({ [`router${backend === 'jsx' ? '.jsx' : '.js'}`]: router(backend) }),
};

// `build({ target: 'jsx' })` — the target is already decided by the package you imported, so
// only the backend is left to name.
const build = ({ target, ...opts } = {}) =>
  coreBuild({ ...opts, framework: react, backend: target ?? react.default });

const watchAndServe = (opts = {}) => coreWatch({ ...opts, framework: react });

// Reading a project needs the web layer's parsers; bind them so callers need not know.
const project = (opts = {}) => coreProject({ ...opts, parseApp, parseUI });

export default react;
export { react, build, watchAndServe, project, compile, router, mainFile, html, scaffold };
