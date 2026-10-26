// zaal — the language itself, the pipeline that walks a project, and the `zaal` command. It
// depends on nothing, and knows nothing about any framework, about CSS or about routing:
// @zaal/web owns the web layer, and a target package (@zaal/react, @zaal/vue, …) supplies the
// code generation. Every target is a plugin on top of this.

export { tokens } from './lex.mjs';
export { here, fail, located, inFile } from './diagnostics.mjs';
export { parse, lineNode, attrList, selector, memberTags, hookNode, splitAssign,
  IDENT, setter, RAW_BODY } from './parse.mjs';
export { EV, ALIAS, tmpl, interp, splitStmts, rewrite, stmts, fnBody, handler, unbrace,
  attrParts } from './expr.mjs';
export { editDistance, nearest } from './suggest.mjs';
export { CDN, isRel, isAsset, splitSpec, pkgRef, syncDeps } from './deps.mjs';
export { warn, pkgLine } from './log.mjs';
export { project, build, serve, watchAndServe } from './pipeline.mjs';
export { SRC_DIR, APP_FILE, APP_DIR, DEV_DIR, OUT_SRC, OUT_CSS, posix, rel } from './layout.mjs';
export { cli, loadTarget } from './cli.mjs';
