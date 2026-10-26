# Zaal

A token-dense DSL that compiles to a runnable app.

Zaal exists for one reason: **fewer tokens for the agent that writes the app.** A `.zaal` file says
what a component is in the fewest characters that still read as a language, and the compiler
writes out a complete, idiomatic project a developer can take over at any time. Nothing in the
output names Zaal — `zaal build` hands you a React app with its own `package.json` and
`vite.config.js`, and you can delete the compiler and keep working.

```
C Counter s:count=0
  button @click=count++ "clicked {count} times"
```

```jsx
import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button onClick={() => setCount(count + 1)}>clicked {count} times</button>
  );
}
```

## Packages

The language is one thing and the framework it targets is another. `@zaal/core` owns the grammar,
the `ui.zaal` design system and the build pipeline; a target package owns the code generation.

| Package | What it is |
| --- | --- |
| [`@zaal/core`](packages/core) | The language: lexer, parser, design system, build pipeline. No framework of its own. |
| [`@zaal/react`](packages/react) | The React target. Two backends: `jsx` for a bundler, `esm` for a zero-install preview. |
| [`@zaal/cli`](packages/cli) | The `zaal` command — build, preview, live-reload. |

Targets for other frameworks are the next step, and the seam is already there: a target is an
object that says which backends it has and how it writes each file of the output. `@zaal/core`'s
`build` asks it those questions and never names React.

## Getting started

```
npm install                # links the workspace packages and puts `zaal` on the path
cd example && npx zaal dev # preview + live reload on http://localhost:5173
npm test                   # the compiler's own suite (no dependencies)
```

A Zaal project is two directories: `zaal/` is everything hand-written, `application/` is the app
`zaal build` writes. `example/` is one — a small app with routes, stores, a design system and two
npm packages.

- **[SPEC.md](SPEC.md)** — the language, in full. Everything in it is implemented and tested.
- **[ROADMAP.md](ROADMAP.md)** — what Zaal cannot say yet, and why each item is worth closing.

## Status

v0.1, 446 passing tests. The language is settled enough to write real apps in and not settled
enough to promise it will not move.
