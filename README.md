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

The language is one thing, the framework it targets is another, and the kind of thing it builds
is a third. They are layered so that each can grow without the others: `@zaal/core` is the
language, `@zaal/web` is what every *web* target shares, and a target package owns the code
generation.

| Package | What it is |
| --- | --- |
| [`zaal`](packages/cli) | The `zaal` command — build, preview, live-reload. **This is the one you install.** |
| [`@zaal/react`](packages/react) | The React target. Two backends: `jsx` for a bundler, `esm` for a zero-install preview. |
| [`@zaal/web`](packages/web) | The web layer every frontend target shares: the `ui.zaal` design system, the `app.zaal` project model. |
| [`@zaal/core`](packages/core) | The language: lexer, parser, expressions, diagnostics, build pipeline. No framework, no CSS, no routing. |

```
npm i -g zaal       # or: npm i -D zaal
zaal build
```

Each layer depends only on the one below it:

```
zaal          the command
  └─ @zaal/react      React codegen     ← @zaal/next, @zaal/vue, @zaal/angular join here
       └─ @zaal/web   design system + app model   ← every *web* target shares this
            └─ @zaal/core   the language    ← a backend or non-JS target starts here instead
```

A target is an object that says which backends it has and how it writes each file of the output.
`@zaal/core`'s `build` asks it those questions and never names React — or CSS, or routing, which
is why a target that compiles to a backend service, or to Python or .NET, can sit beside
`@zaal/web` rather than underneath it.

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
