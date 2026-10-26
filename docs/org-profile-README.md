<!--
  This file is NOT rendered from this repo. Copy it to a repository named exactly `.github`
  inside the `zal` GitHub org, at the path `profile/README.md`. GitHub renders that one file as
  the org's landing page — github.com/zal — which is the "standalone Zal is an introduction"
  page. Nothing else in that repo matters.
-->

# Zal

**A token-dense DSL that compiles to a runnable app.**

Zal exists for one reason: fewer tokens for the agent that writes the app. A `.zal` file says
what a component is in the fewest characters that still read as a language, and the compiler
writes out a complete, idiomatic project a developer can take over at any time.

```
C Counter s:count=0
  button @click=count++ "clicked {count} times"
```

Nothing in the output names Zal. The build hands you a real project with its own `package.json`
and config, and you can delete the compiler and keep working.

### The language, and the frameworks it targets

The language is one thing; the framework it compiles to is another. One grammar, one design
system, one build pipeline — and a target package per framework.

| | | |
| --- | --- | --- |
| **[zal/framework](https://github.com/zal/framework)** | the repo | every package below |
| `@zal/core` | the language | lexer, parser, `ui.zal` design system, build pipeline |
| `@zal/react` | the React target | ships today |
| `@zal/cli` | the `zal` command | build, preview, live-reload |

Targets for other frameworks are the next step. A target is an object that says which backends it
has and how it writes each file of the output; `@zal/core` asks it those questions and never
names a framework itself.

### Start here

- **[The spec](https://github.com/zal/framework/blob/main/SPEC.md)** — the whole language. Everything
  in it is implemented and tested.
- **[The roadmap](https://github.com/zal/framework/blob/main/ROADMAP.md)** — what Zal cannot say yet.
- **[The example](https://github.com/zal/framework/tree/main/example)** — a small app with routes,
  stores, a design system and two npm packages.
