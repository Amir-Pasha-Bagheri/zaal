# @zal/core

The Zal language, with no framework of its own: the lexer, the parser, the `ui.zal` design
system, and the pipeline that reads a project, compiles every source against it and writes the
output. See **[SPEC.md](../../SPEC.md)** for the language itself.

This package generates no code. That is a target's job — [`@zal/react`](../react) is the first
one. If you are building an app, install a target (or [`@zal/cli`](../cli)); install `@zal/core`
directly only to write a target of your own, or to use the parser on its own.

## A target

A target is an object. `build` asks it which backends it has and how to write each file, and
never names a framework itself:

```js
import { build } from '@zal/core';
import react from '@zal/react';

build({ framework: react, backend: 'jsx' });
```

```js
const target = {
  name: 'react',
  default: 'jsx',          // the backend `zal build` writes
  preview: 'esm',          // the backend `zal dev` serves
  backends: {
    jsx: { ext: '.jsx', outDir: 'application', scaffold: true },
    esm: { ext: '.js', outDir: '.zal-dev', scaffold: false },
  },
  compile(src, backend, opts),              // one .zal source -> one module
  mainFile(app, backend, stores, comps),    // the entry that mounts the app
  html(app, backend, pkgs),                 // index.html
  scaffold(dir, app),                       // project files the deliverable needs
  runtime: backend => ({ 'router.jsx': … }) // anything shipped beside the app's modules
};
```

What core gives a target to work with: `parse` (a `.zal` source to a tree), `attrParts` (a markup
line's attributes), `stmts`/`interp`/`handler` (the JavaScript parts of a line), `parseUI` and
`uiCss` (the design system, as plain CSS), `parseApp` (app.zal), `pkgRef` (npm specifiers),
`nearest` ("did you mean"), and `fail` (an error that names the line it came from).

`EV` and `ALIAS` are the one target-flavoured piece in core: they map `@click` to `onClick` and
`c=` to `className`. A target that spells those differently passes its own tables.
