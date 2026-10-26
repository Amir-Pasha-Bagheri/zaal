# @zal/react

The React target for Zal: compiles `.zal` sources into a standalone React app. The language it
compiles is [`@zal/core`](../core)'s; see **[SPEC.md](../../SPEC.md)** for it.

Most people want [`@zal/cli`](../cli) instead — this package is the compiler, not the command.

```js
import { build, compile } from '@zal/react';

build({ target: 'jsx' });                 // write application/
const code = compile(src, 'jsx', opts);   // or compile one source
```

## Two backends

| | `jsx` | `esm` |
| --- | --- | --- |
| Output | JSX, for a bundler | `createElement` calls |
| Lands in | `application/` | `.zal-dev/` |
| Needs installing | yes (Vite + React) | nothing |
| What it is for | the deliverable you commit and deploy | `zal dev`'s preview |

`application/` is the point: a complete React project — `package.json`, `vite.config.js`,
`index.html`, a `src/` tree mirroring your sources — that names Zal nowhere. Hand edits to the
project files survive every rebuild.

## What it generates

`C` blocks become function components with real hooks (`use`, `memo`, `cb`, `fx`, `ref`, `ctx`
map onto `useState`, `useMemo`, `useCallback`, `useEffect`, `useRef`, `useContext`); `C … catch`
becomes the one class React still needs for an error boundary; `S` blocks become a context, a
provider and a `use<Name>()` hook; `ui.zal` becomes plain CSS; routes become a small hash router
shipped beside your modules. Imports are resolved and versioned for you, React's own hooks and
components are in scope on sight, and a component referenced but not in scope is a build error
with the `i` line that would fix it.
