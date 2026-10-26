# Zal roadmap — gaps, then features

**The goal behind every item here: fewer tokens for the agent that writes the app.** A gap is
worth closing when closing it removes an escape hatch (`js …`, hand-written JSX, a workaround an
agent has to be told about); a feature is worth adding when the Zal form is materially shorter
than the React it replaces and needs no explanation. Anything that makes a `.zal` file longer
than the JSX it compiles to is the wrong answer.

Status: SPEC.md is fully implemented (397 tests pass). Everything below is beyond the spec.

## Part 1 — gaps (wrong or missing in what Zal already claims) — **done**

All eight are fixed, tested (422 passing) and documented in SPEC.md.

- [x] **G1. A lone expression root emits invalid JS.** `C A` whose only root line is `{x}` (or a
  lone text line) compiles to `return ( {x} );` — an object literal, not JSX. Same bug in a `?`
  branch arm (`cond && ( {x} )`) and in a `slot` fill (`actions={ {x} }`). The fragment collapse
  in `jsxNode` (`zal.mjs:502`) is only safe in a JSX *children* position; in an expression
  position the result has to be an element or a fragment. Blocks every `createPortal` wrapper.
- [x] **G2. Namespaced component tags silently miscompile.** `motion.div "hi"` →
  `<motion className="div">hi</motion>`; the selector regex (`zal.mjs:185`) reads `.div` as a
  class. Breaks `framer-motion`, `Dialog.Panel`, `Tab.List` — the way much of npm ships
  components. Planned rule: a dotted head whose first segment is bound in module scope (an `i`
  line or a `js` declaration) is a member tag; everything else stays `tag.class`.
- [x] **G3. Local asset imports break.** `i logo ./logo.png` → `import logo from './logo.png.jsx'`
  (`importLine`, `zal.mjs:637` appends the extension unconditionally), and nothing copies the
  asset into the output tree. Fix: leave an existing extension alone, and copy referenced local
  assets to the mirrored output path.
- [x] **G4. `memo=cmp` is silently ignored.** `node.parts.includes('memo')` (`zal.mjs:755`) is
  false for `memo=cmp`, so the component is not memoised and nothing is reported. Fix: support
  the custom comparator, and make any unrecognised `C`/`S` part a build error.
- [x] **G5. Void hooks have no line.** `use` requires a binding (`zal.mjs:208`), so
  `useLayoutEffect(…)`, `useImperativeHandle(ref, …)`, `useDebugValue(x)` can only be written as
  `js`. Fix: allow `use <call>` with no `=`.
- [x] **G6. No `lazy()` outside routes.** A lazily-loaded modal fails `checkComponents` — only
  `/path X lazy` splits. Fix: a `lazy` marker usable on a component reference.
- [x] **G7. Custom elements are a parse error.** `my-widget "x"` → `bad selector` — the tag regex
  forbids dashes, so web components and `<model-viewer>`-style tags cannot be written at all.
- [x] **G8. No `@keyframes` / media queries in `ui.zal`.** `css` passthrough reads `n.rest` only
  (`zal.mjs:401`), ignoring child lines, so raw CSS has to fit on one line. Responsive design is
  the biggest hole in the design system.

## Part 2 — features (React surface Zal cannot say)

- [ ] **F1. Custom hook blocks.** No `H useThing` — a shared hook is hand-written JS today.
- [ ] **F2. Dynamic / polymorphic tags.** `{Tag}` as an element, an `as=` prop.
- [ ] **F3. Portals.** A `portal` head, rather than a manual `createPortal` expression child.
- [ ] **F4. Own contexts.** `ctx` reads one; only `S` creates one. No `createContext` form.
- [ ] **F5. Event ergonomics.** No `.prevent` / `.stop` modifiers, no `@key.enter`; `EV`
  (`zal.mjs:237`) names 9 events and guesses the rest.
- [ ] **F6. Router depth.** `zal.mjs:1202` is a 44-line flat hash router: no history/pathname
  mode, nested layouts, declared 404, redirects, query params, scroll restoration or route data
  loading. Nested layouts are the first thing a real app wants.
- [ ] **F7. Per-route `<head>`.** Title and meta are app-global (`t` in `app.zal`).
- [ ] **F8. TypeScript output.** No types, no `.d.ts`, no prop types.
- [ ] **F9. Test scaffolding.** `application/` ships no vitest/RTL config.
- [ ] **F10. Server-side React.** No SSR/RSC story: `'use client'`, server actions,
  `<form action={fn}>` are outside the model.
