# @zal/cli

The `zal` command: compile `.zal` sources into a React app, preview it, rebuild on change.

```
npm install -D @zal/cli
```

```
zal build           write the React app to application/
zal dev [port]      preview and live-reload on change          (no install needed)
zal dev --vite      build application/ and run it through Vite (installs there)
zal serve [port]    serve the preview without watching
zal <file.zal>      compile a single file
```

Sources live in `zal/` — `app.zal` and `ui.zal` included. `zal build` writes `application/`: a
standalone React app with its own `package.json`, `vite.config.js`, `index.html` and `src/` tree,
which is the folder to commit, install and deploy. `zal dev` previews it without installing
anything, from `.zal-dev/`, and leaves `application/` untouched.

The language is **[SPEC.md](../../SPEC.md)**. The compiler is [`@zal/core`](../core) plus a
target — [`@zal/react`](../react) today.
