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
| [`zaal`](packages/zaal) | The language, the build pipeline and the `zaal` command. **Depends on nothing.** |
| [`@zaal/web`](packages/web) | The web layer every frontend target shares: the `ui.zaal` design system, the `app.zaal` project model. |
| [`@zaal/react`](packages/react) | The React target. Two backends: `jsx` for a bundler, `esm` for a zero-install preview. |

```
npm i -g zaal           # the command
npm i -D @zaal/react    # and a target for it to compile with
zaal build
```

`zaal` has no framework in it. Which target compiles an app is a line in `app.zaal` —
`target react` — resolved at runtime, so `@zaal/vue` or `@zaal/next` drops in beside
`@zaal/react` without `zaal` knowing either exists.

Every target is a plugin, and the arrows point inward — nothing in `zaal` names a framework:

```
zaal                      the language, the pipeline, the CLI. no dependencies.
 ├─ @zaal/web             design system + app model    ← every *web* target shares this
 │    ├─ @zaal/react      React codegen
 │    ├─ @zaal/next       ┐
 │    ├─ @zaal/vue        ├─ later, as equals beside React
 │    └─ @zaal/angular    ┘
 └─ @zaal/python          ┐ a backend or non-web target sits HERE instead:
    @zaal/dotnet          ┘ on the language alone, with no CSS and no mount node
```

A target is an object that says which backends it has and how it writes each file of the output.
`zaal`'s `build` asks it those questions — including what an app declaration and a design system
even *are* — and never names React, or CSS, or routing. That is what lets a target compiling to
a backend service, or to Python or .NET, sit beside `@zaal/web` rather than underneath it.

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

v0.1, 746 passing tests. The language is settled enough to write real apps in and not settled
enough to promise it will not move.
