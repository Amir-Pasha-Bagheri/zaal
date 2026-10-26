# Publishing, and the names

## Where things live

GitHub and npm are separate namespaces, and the name landed differently in each:

- **GitHub:** `github.com/zaal` is taken, so the repo sits under a personal account —
  `github.com/YOUR-USERNAME/zaal`. Its own `README.md` is the landing page; no organization and
  no `.github` repo are involved. (`zaal-lang` is free if an org is ever wanted, and a repo can
  be transferred to one later — GitHub redirects the old URL automatically.)
- **npm:** `zaal` is free as a bare name *and* `@zaal` is free as a scope, so both are used —
  the command is the unscoped `zaal` (so `npm i -g zaal` works), and the libraries under it are
  scoped. This is the usual shape: `vite` and `@vitejs/plugin-react`, `next` and `@next/font`.

Every URL in the manifests and the READMEs says `YOUR-USERNAME` — replace it once the account
name is settled, or the npm pages will link nowhere.

## The names

The project was renamed from `zal` to `zaal` because `zal` was taken everywhere it mattered: the
bare npm name (an unrelated `zal@0.0.0` placeholder), the `@zal` npm scope, and `github.com/zal`.
`zaal` is free on npm, which is what the packages are named after:

| | |
| --- | --- |
| `zaal` | the command — unscoped, so `npm i -g zaal` gives you `zaal` |
| `@zaal/react` | the React target |
| `@zaal/web` | the web layer: `ui.zaal` design system, `app.zaal` project model |
| `@zaal/core` | the language |
| `@zaal/next`, `@zaal/vue`, … | as they arrive, beside `@zaal/react` |

Claiming the `zaal` **org** is what reserves `@zaal/anything`. The bare `zaal` package is a
separate claim, made by publishing it.

The scope has to be claimed as an npm **organization** before any of this publishes: npmjs.com →
*Add Organization* → `zaal`. Free for public packages.

A scoped package defaults to private, and publishing a private package fails on a free account.
That is why every manifest here carries:

```json
"publishConfig": { "access": "public" }
```

The unscoped `zaal` package needs no `publishConfig` — only scoped packages default to private.
Its `bin` is `zaal`, so `npm i -g zaal` puts the command on the PATH directly.

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
npm publish -w @zaal/core         # bottom of the stack first
npm publish -w @zaal/web
npm publish -w @zaal/react
npm publish -w zaal               # the command last: it depends on all three
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
example, and `packages/core/README.md` documents the shape.

**Another web framework** (`@zaal/next`, `@zaal/vue`, `@zaal/angular`) depends on `@zaal/core`
*and* `@zaal/web`, and writes only `compile`, `mainFile`, `html`, `scaffold`, `runtime` and a
`backends` table. It inherits the grammar, the design system, the app model, imports and
versioning, the project pipeline, the dev server, live reload and the CLI.

**A backend or non-JavaScript target** (`@zaal/express`, `@zaal/python`, `@zaal/dotnet`) depends
on `@zaal/core` only, and sits *beside* `@zaal/web` rather than on top of it — no design system,
no mount node, no `index.html`. That is why `@zaal/core`'s pipeline asks a target for `parseApp`,
`parseUI` and `uiCss` instead of importing them.

Two things in `@zaal/core` are still JavaScript-specific and would need equivalents for a non-JS
target: `expr.mjs` (it rewrites expressions into JavaScript) and `deps.mjs` (it speaks npm).
Splitting those out is worth doing when there is a real second language to check the seam
against, and is guesswork before that.
