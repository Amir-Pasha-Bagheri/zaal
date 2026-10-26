# @zaal/cli

The `zaal` command: compile `.zaal` sources into a React app, preview it, rebuild on change.

```
npm install -D @zaal/cli
```

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

The language is **[SPEC.md](https://github.com/YOUR-USERNAME/zaal/blob/main/SPEC.md)**. The compiler is [`@zaal/core`](https://github.com/YOUR-USERNAME/zaal/tree/main/packages/core) plus a
target — [`@zaal/react`](https://github.com/YOUR-USERNAME/zaal/tree/main/packages/react) today.
