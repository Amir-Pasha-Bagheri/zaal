# Publishing, and the names

## Where things live

GitHub and npm are separate namespaces, and the name landed differently in each:

- **GitHub:** `github.com/zaal` is taken, so the repo sits under a personal account —
  `github.com/YOUR-USERNAME/zaal`. Its own `README.md` is the landing page; no organization and
  no `.github` repo are involved. (`zaal-lang` is free if an org is ever wanted, and a repo can
  be transferred to one later — GitHub redirects the old URL automatically.)
- **npm:** the `@zaal` scope is free, so the packages keep the `@scope/name` shape.

Every URL in the manifests and the READMEs says `YOUR-USERNAME` — replace it once the account
name is settled, or the npm pages will link nowhere.

## The names

The project was renamed from `zal` to `zaal` because `zal` was taken everywhere it mattered: the
bare npm name (an unrelated `zal@0.0.0` placeholder), the `@zal` npm scope, and `github.com/zal`.
`zaal` is free on npm, which is what the packages are named after:

| | |
| --- | --- |
| `@zaal/core` | the language |
| `@zaal/react` | the React target |
| `@zaal/cli` | the `zaal` command |
| `@zaal/next`, `@zaal/vue`, … | as they arrive |

The scope has to be claimed as an npm **organization** before any of this publishes: npmjs.com →
*Add Organization* → `zaal`. Free for public packages.

A scoped package defaults to private, and publishing a private package fails on a free account.
That is why every manifest here carries:

```json
"publishConfig": { "access": "public" }
```

The CLI's `bin` is `zaal` regardless of the package name, so `npx zaal build` works either way.

## One repo, many packages

Everything publishes from one repo. The packages are what carry the names — npm spells a scoped
package `@zaal/react`, so `packages/react/` is published as `@zaal/react` and read as
"zaal/react" wherever it is installed.

Package names do not have to match repo layout, and splitting a target into its own repo later
would rename nothing. The reason to keep one repo: a change to the parser plus every target that
consumes it is one commit, one test run, one CI job. Vite, Babel, Vue and Angular are all laid
out this way.

## Publishing

Workspaces publish one at a time, in dependency order — `@zaal/react` names `@zaal/core@^0.1.0`,
so core has to exist on the registry first.

```
npm test
npm whoami                        # expect to be in the zaal org
npm publish -w @zaal/core
npm publish -w @zaal/react
npm publish -w @zaal/cli
```

Bumping versions together keeps the dependency ranges honest:

```
npm version patch --workspaces --include-workspace-root
```

Before the first publish, one thing is still open:

- **A license.** No package carries a `license` field yet, so npm will warn and the code is
  "all rights reserved" by default. Pick one (MIT is the usual choice for this kind of tool),
  add a `LICENSE` file, and add `"license": "MIT"` to all four manifests.

`repository`, `homepage` and `bugs` are already set on all three packages, each pointing at its
own directory, so every npm page links back to the right place.

## Adding a target

A target is one package exporting one object. `packages/react/src/index.mjs` is the worked
example, and `packages/core/README.md` documents the shape. What a new target has to write:
`compile`, `mainFile`, `html`, `scaffold`, `runtime`, and a `backends` table. What it gets for
free: the grammar, the design system, imports and versioning, the project pipeline, the dev
server, live reload, and the CLI.
