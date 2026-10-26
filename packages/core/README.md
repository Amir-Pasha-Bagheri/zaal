# @zaal/core

The Zaal language, and nothing above it: the lexer, the parser, the expression and statement
forms, diagnostics, and the pipeline that reads a project, compiles every source against it and
writes the output. See **[SPEC.md](https://github.com/YOUR-USERNAME/zaal/blob/main/SPEC.md)** for
the language itself.

It knows nothing about any framework, and nothing about CSS or routing either — the `ui.zaal`
design system and the `app.zaal` project model belong to
[`@zaal/web`](https://github.com/YOUR-USERNAME/zaal/tree/main/packages/web), the layer every web
target shares. The pipeline *asks* a target for those rather than importing them, so a target
that compiles to a backend service, or to another language, is not forced to have them.

This package generates no code. That is a target's job — [`@zaal/react`](https://github.com/YOUR-USERNAME/zaal/tree/main/packages/react) is the first
one. If you are building an app, install a target (or [`zaal`](https://github.com/YOUR-USERNAME/zaal/tree/main/packages/cli)); install `@zaal/core`
directly only to write a target of your own, or to use the parser on its own.

## A target

A target is an object. `build` asks it which backends it has and how to write each file, and
never names a framework itself:

```js
import { build } from '@zaal/core';
import react from '@zaal/react';

build({ framework: react, backend: 'jsx' });
```

```js
const target = {
  name: 'react',
  default: 'jsx',          // the backend `zaal build` writes
  preview: 'esm',          // the backend `zaal dev` serves
  backends: {
    jsx: { ext: '.jsx', outDir: 'application', scaffold: true },
    esm: { ext: '.js', outDir: '.zaal-dev', scaffold: false },
  },
  compile(src, backend, opts),              // one .zaal source -> one module
  mainFile(app, backend, stores, comps),    // the entry that mounts the app
  html(app, backend, pkgs),                 // index.html
  scaffold(dir, app),                       // project files the deliverable needs
  runtime: backend => ({ 'router.jsx': … }), // anything shipped beside the app's modules
  parseApp, parseUI, uiCss,                 // from @zaal/web, for a web target
};
```

What core gives a target to work with: `parse` (a `.zaal` source to a tree), `attrParts` (a
markup line's attributes), `stmts`/`interp`/`handler` (the JavaScript parts of a line), `pkgRef`
(npm specifiers), `nearest` ("did you mean"), and `fail` (an error that names the line it came
from).

Two things in here are still not as language-neutral as the name suggests, and are the next
seams if Zaal ever targets something that is not JavaScript:

- `expr.mjs` turns a line's expressions into **JavaScript** — `count++` into `setCount(count + 1)`,
  `"hi {name}"` into a template literal. Its `EV`/`ALIAS` tables also map `@click` to `onClick`
  and `c=` to `className`, which is DOM-flavoured; they are exported so a target can swap them.
- `deps.mjs` speaks **npm**: specifiers, version pins, a CDN url.

A Python or .NET target would need its own equivalents of both. Splitting them out is cheap when
there is a second non-JS target to check the seam against, and guesswork before that.
