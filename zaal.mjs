#!/usr/bin/env node
// zaal — the compatibility entry point. The compiler itself now lives in packages/:
//
//   @zaal/core   the language — lex, parse, the ui.zaal design system, the build pipeline
//   @zaal/react  the React target — the jsx and esm backends, hooks, stores, the router
//   @zaal/cli    the `zaal` command
//
// This file keeps `import … from 'zaal.mjs'` and `node zaal.mjs build` working while the repo
// grows targets beside React. New code should import the package it means.
export { project, serve, parseApp, parseUI, uiCss, parse, tokens, inFile,
  SRC_DIR, APP_FILE, APP_DIR, DEV_DIR, OUT_SRC, OUT_CSS } from '@zaal/core';
export { default as react, compile, build, watchAndServe,
  router, mainFile, html, scaffold } from '@zaal/react';
export { cli } from '@zaal/cli';

import { cli as run } from '@zaal/cli';

if (import.meta.url === `file://${process.argv[1]}`) {
  try { run(process.argv.slice(2)); }
  catch (e) { console.error(`  error  ${e.message}`); process.exit(1); }
}
