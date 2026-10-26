# Publishing, and the names

## The names

`zal` on npm is **taken** — an unrelated `zal@0.0.0` placeholder — so every package is scoped:
`@zal/core`, `@zal/react`, `@zal/cli`, and `@zal/vue`, `@zal/next`, `@zal/angular` as they
arrive. The scope has to be claimed as an npm **organization** before any of this publishes:
npmjs.com → *Add Organization* → `zal`. Free for public packages.

A scoped package defaults to private and a publish of one fails on a free account, which is why
every manifest here carries:

```json
"publishConfig": { "access": "public" }
```

(The CLI's `bin` is still `zal`, so `npx zal build` works regardless of the package name. If the
`zal` placeholder is still unused later, npm's dispute policy is worth a try — not a blocker.)

## One repo, many packages

Package names do not have to match repo layout. Everything publishes from this one repo, and
splitting a target into its own repo later renames nothing. The reason to keep one repo: a change
to the parser plus every target that consumes it is one commit, one test run, one CI job. Vite,
Babel, Vue and Angular are all laid out this way.

## Publishing

Workspaces publish one at a time, in dependency order — `@zal/react` names `@zal/core@^0.1.0`, so
core has to exist on the registry first.

```
npm test
npm whoami                        # expect to be in the zal org
npm publish -w @zal/core
npm publish -w @zal/react
npm publish -w @zal/cli
```

Bumping versions together keeps the dependency ranges honest:

```
npm version patch --workspaces --include-workspace-root
```

Before the first publish, two things are still open:

- **A license.** No package carries a `license` field yet, so npm will warn and the code is
  "all rights reserved" by default. Pick one (MIT is the usual choice for this kind of tool),
  add a `LICENSE` file, and add `"license": "MIT"` to all three manifests.
- **`repository` fields.** Add one per package once the GitHub remote exists, so each npm page
  links back to its own directory:

  ```json
  "repository": { "type": "git", "url": "git+https://github.com/zal/zal.git", "directory": "packages/core" }
  ```

## Adding a target

A target is one package exporting one object. `packages/react/src/index.mjs` is the worked
example, and `packages/core/README.md` documents the shape. What a new target has to write:
`compile`, `mainFile`, `html`, `scaffold`, `runtime`, and a `backends` table. What it gets for
free: the grammar, the design system, imports and versioning, the project pipeline, the dev
server, live reload, and the CLI.
