// @zaal/core — the parts of Zaal that no target owns: the grammar, the design system, the
// project pipeline. A target package (@zaal/react, …) supplies the code generation.

export { tokens } from './lex.mjs';
export { here, fail, located, inFile } from './diagnostics.mjs';
export { parse, lineNode, attrList, selector, memberTags, hookNode, splitAssign,
  IDENT, setter, RAW_BODY } from './parse.mjs';
export { EV, ALIAS, tmpl, interp, splitStmts, rewrite, stmts, fnBody, handler, unbrace,
  attrParts } from './expr.mjs';
export { parseUI, uiCss, PROP, tokenRef } from './ui.mjs';
export { editDistance, nearest } from './suggest.mjs';
export { CDN, isRel, isAsset, splitSpec, pkgRef, syncDeps } from './deps.mjs';
export { parseApp, storeOrder } from './app.mjs';
export { warn, pkgLine } from './log.mjs';
export { project, build, serve, watchAndServe } from './pipeline.mjs';
export { SRC_DIR, APP_FILE, APP_DIR, DEV_DIR, OUT_SRC, OUT_CSS, posix, rel } from './layout.mjs';
