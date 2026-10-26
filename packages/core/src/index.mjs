// @zaal/core — the language itself, and nothing above it: the grammar, the expression and
// statement forms, diagnostics, and the pipeline that walks a project. It knows nothing about
// any framework, and nothing about CSS or routing — @zaal/web owns those, and a target package
// (@zaal/react, …) supplies the code generation.

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
