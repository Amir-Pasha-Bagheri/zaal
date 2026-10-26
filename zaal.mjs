#!/usr/bin/env node
// zaal — the compatibility entry point. The compiler itself now lives in packages/:
//
//   @zaal/core   the language — lex, parse, expressions, diagnostics, the build pipeline
//   @zaal/web    the web layer — the ui.zaal design system and the app.zaal project model
//   @zaal/react  the React target — the jsx and esm backends, hooks, stores, the router
//   zaal         the `zaal` command
//
// This file keeps `import … from 'zaal.mjs'` and `node zaal.mjs build` working while the repo
// grows targets beside React. New code should import the package it means.
export { serve, parse, tokens, inFile,
  SRC_DIR, APP_FILE, APP_DIR, DEV_DIR, OUT_SRC, OUT_CSS } from '@zaal/core';
export { parseApp, parseUI, uiCss } from '@zaal/web';
export { default as react, compile, build, project, watchAndServe,
  router, mainFile, html, scaffold } from '@zaal/react';
export { cli } from 'zaal';

import { cli as run } from 'zaal';

if (import.meta.url === `file://${process.argv[1]}`) {
  try { run(process.argv.slice(2)); }
  catch (e) { console.error(`  error  ${e.message}`); process.exit(1); }
}
