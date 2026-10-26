#!/usr/bin/env node
// zal — the compatibility entry point. The compiler itself now lives in packages/:
//
//   @zal/core   the language — lex, parse, the ui.zal design system, the build pipeline
//   @zal/react  the React target — the jsx and esm backends, hooks, stores, the router
//   @zal/cli    the `zal` command
//
// This file keeps `import … from 'zal.mjs'` and `node zal.mjs build` working while the repo
// grows targets beside React. New code should import the package it means.
export { project, serve, parseApp, parseUI, uiCss, parse, tokens, inFile,
  SRC_DIR, APP_FILE, APP_DIR, DEV_DIR, OUT_SRC, OUT_CSS } from '@zal/core';
export { default as react, compile, build, watchAndServe,
  router, mainFile, html, scaffold } from '@zal/react';
export { cli } from '@zal/cli';

import { cli as run } from '@zal/cli';

if (import.meta.url === `file://${process.argv[1]}`) {
  try { run(process.argv.slice(2)); }
  catch (e) { console.error(`  error  ${e.message}`); process.exit(1); }
}
