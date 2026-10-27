# zaal

The Zaal language, the build pipeline and the `zaal` command — with **no dependencies**, and no
framework in it. Every framework is a plugin on top.

```
npm i -g zaal           # the command, anywhere
npm i -D @zaal/react    # and a target for it to compile with
```

`zaal` on its own has no code generator, the way `postcss` on its own has no plugins. Which
target an app uses is a line in its `app.zaal`:

```
A Demo
  target react      # -> @zaal/react. the default, so this line is optional
```

`react` means `@zaal/react`; a name with a slash is taken as written, so a target published
outside the scope works too (`target my-org/zaal-svelte`). The package is resolved at runtime —
from your project first, then from `zaal`'s own install — so adding a target is an `npm i` and a
line, with nothing in `zaal` to change.

```
zaal build           write the React app to application/
zaal dev [port]      preview and live-reload on change          (no install needed)
zaal dev --vite      build application/ and run it through Vite (installs there)
zaal serve [port]    serve the preview without watching
zaal <file.zaal>     compile a single file
```

Sources live in `zaal/` — `app.zaal` and `ui.zaal` included. `zaal build` writes `application/`: a
standalone React app with its own `package.json`, `vite.config.js`, `index.html` and `src/` tree,
which is the folder to commit, install and deploy. `zaal dev` previews it without installing
anything, from `.zaal-dev/`, and leaves `application/` untouched.

What this package holds: the lexer and parser, the expression and statement forms, diagnostics,
and the pipeline that reads a project, compiles every source against it, writes the output,
serves it and rebuilds on change. What it does not hold: anything about React, CSS or routing.
The design system and app model are
[`@zaal/web`](https://github.com/Amir-Pasha-Bagheri/zaal/tree/main/packages/web); the code generation
is a target such as
[`@zaal/react`](https://github.com/Amir-Pasha-Bagheri/zaal/tree/main/packages/react).

The language itself is **[SPEC.md](https://github.com/Amir-Pasha-Bagheri/zaal/blob/main/SPEC.md)**.
