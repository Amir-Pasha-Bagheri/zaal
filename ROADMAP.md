# Zaal roadmap — gaps, then features

**The goal behind every item here: fewer tokens for the agent that writes the app.** A gap is
worth closing when closing it removes an escape hatch (`js …`, hand-written JSX, a workaround an
agent has to be told about); a feature is worth adding when the Zaal form is materially shorter
than the React it replaces and needs no explanation. Anything that makes a `.zaal` file longer
than the JSX it compiles to is the wrong answer.

Status: SPEC.md is fully implemented (497 tests pass). Everything below is beyond the spec.

## Part 1 — gaps (wrong or missing in what Zaal already claims) — **done**

All eight are fixed, tested (422 passing) and documented in SPEC.md.

- [x] **G1. A lone expression root emits invalid JS.** `C A` whose only root line is `{x}` (or a
  lone text line) compiles to `return ( {x} );` — an object literal, not JSX. Same bug in a `?`
  branch arm (`cond && ( {x} )`) and in a `slot` fill (`actions={ {x} }`). The fragment collapse
  in `jsxNode` (`zaal.mjs:502`) is only safe in a JSX *children* position; in an expression
  position the result has to be an element or a fragment. Blocks every `createPortal` wrapper.
- [x] **G2. Namespaced component tags silently miscompile.** `motion.div "hi"` →
  `<motion className="div">hi</motion>`; the selector regex (`zaal.mjs:185`) reads `.div` as a
  class. Breaks `framer-motion`, `Dialog.Panel`, `Tab.List` — the way much of npm ships
  components. Planned rule: a dotted head whose first segment is bound in module scope (an `i`
  line or a `js` declaration) is a member tag; everything else stays `tag.class`.
- [x] **G3. Local asset imports break.** `i logo ./logo.png` → `import logo from './logo.png.jsx'`
  (`importLine`, `zaal.mjs:637` appends the extension unconditionally), and nothing copies the
  asset into the output tree. Fix: leave an existing extension alone, and copy referenced local
  assets to the mirrored output path.
- [x] **G4. `memo=cmp` is silently ignored.** `node.parts.includes('memo')` (`zaal.mjs:755`) is
  false for `memo=cmp`, so the component is not memoised and nothing is reported. Fix: support
  the custom comparator, and make any unrecognised `C`/`S` part a build error.
- [x] **G5. Void hooks have no line.** `use` requires a binding (`zaal.mjs:208`), so
  `useLayoutEffect(…)`, `useImperativeHandle(ref, …)`, `useDebugValue(x)` can only be written as
  `js`. Fix: allow `use <call>` with no `=`.
- [x] **G6. No `lazy()` outside routes.** A lazily-loaded modal fails `checkComponents` — only
  `/path X lazy` splits. Fix: a `lazy` marker usable on a component reference.
- [x] **G7. Custom elements are a parse error.** `my-widget "x"` → `bad selector` — the tag regex
  forbids dashes, so web components and `<model-viewer>`-style tags cannot be written at all.
- [x] **G8. No `@keyframes` / media queries in `ui.zaal`.** `css` passthrough reads `n.rest` only
  (`zaal.mjs:401`), ignoring child lines, so raw CSS has to fit on one line. Responsive design is
  the biggest hole in the design system.

## Part 1b — gaps the expanded example turned up — **done**

Building a real app against the DSL (see `example/`) found four more, all fixed and tested:

- [x] **G9. Two string literals on one line merged into one template.** `interp` looked for a
  `"…{…}…"` directly, so the match could start at the *closing* quote of one string and end
  inside the next: `setStatus("live")` beside a `{…}` object became one broken template. Now
  every literal is matched in turn and only the ones holding a `{` interpolate.
- [x] **G10. A lone `?` rendered React's stray `0`.** `{cond && (…)}` renders `0` for
  `?items.length` over an empty list. A lone branch is now `{cond ? (…) : null}` in both
  backends. (Deliberate change of a documented behaviour — SPEC.md updated.)
- [x] **G11. The esm backend's `createElement as h` could be shadowed.** `C Sparkline p:h=48`
  made the prop win and every `h(…)` call in the module threw. The alias now steps aside
  (`_h`, `_F`) when the source names the letter.
- [x] **G12. Trailing `//` comments were not stripped** from `.zaal` lines, though SPEC.md
  showed them in `app.zaal`. They are now, quote-aware, so a URL or a text node keeps its `//`.
- [x] **Catch-all route.** `/* NotFound` in `app.zaal` becomes the router's fallback — the first
  slice of F6, and what a 404 page needs.

Three fixes to the test harness came with them, so the suite can exercise what the example
does: `fetch` (a canned PokéAPI) in `test/helpers/env.mjs`, lazy imports that actually resolve,
and React's batching of several `setState` calls inside one event handler.

## Part 1c — a test-first bug hunt — **done**

Writing a third app (`test/board.test.mjs`, a kanban board) and probing the compiler's corners
turned up another nineteen, all fixed with a regression test each (497 passing). Grouped:

**Wrong output that ran**
- [x] `@keyup`/`@dblclick`/`@mouseenter`/… became `onKeyup`, `onDblclick`, `onMouseenter` —
  names React never attaches, so the handler was silently dead. Now a full DOM event table.
- [x] A lone `?` rendered React's stray `0` (G10, earlier round).
- [x] `memo o = { a, b }` emitted `useMemo(() => { a, b })` — an arrow body that starts with
  `{` is a *block*. Now parenthesised.
- [x] `$`-prefixed names (`p:$ref`) inferred **no** dependencies at all: the name went into a
  RegExp unescaped, where `$` is an anchor. Names are escaped now.
- [x] Unicode names (`s:zählung`) skipped the setter rewrite entirely, leaving an assignment to
  a `const`. Every identifier pattern in the compiler is unicode-aware now.
- [x] `<` and HTML entities in text were not escaped for JSX, so the two backends rendered
  different strings (and `a < b` was a JSX syntax error).

**Silent drops**
- [x] Any attribute set twice (`%card c="wide"` → kit classes lost, `@click` twice, `id` twice).
  Classes are now joined — static or dynamic — and any other repeat is an error.
- [x] A `slot` filled twice, and a `key=` on an element the `*` line already keys.
- [x] A kit entry declared twice in `ui.zaal` silently replaced the first.
- [x] A `$token` or a `scheme` override naming a token no `t` group declares — now a warning.
- [x] A second route for one path, a second `/*`, a package pinned twice.

**Invalid JavaScript, reported far from the cause**
- [x] `p:class`, `s:new`, `cb delete()`, `*xs as class` — JS keywords as names.
- [x] `C card` / `S cart` — a lower-case block name renders as a DOM tag; `C 2Cool` is a
  syntax error.
- [x] Store state named `value`, `children`, `KEY` or `saved`; boundary props named `error`,
  `reset` or `children`; `s:n` beside `s:N` (one `setN`); `p:setN` beside `s:n`.
- [x] A name declared twice at module scope (`i A ./A` beside `C A`, two `i` lines, an `i`
  line beside a `js const`).
- [x] A render-time hook (`memo`, `use`, `ctx`, `ref`) naming a value declared below it —
  a temporal-dead-zone crash on first paint.

**Crashes and silent corruption**
- [x] A `slot` at a component's root crashed with an internal TypeError.
- [x] `'a  b'` and `` `a  b` `` lost their spacing in the line splitter.
- [x] A `persist=` key holding a quote swallowed the rest of the line.
- [x] The document title was not HTML-escaped (`Tom & Jerry`, `</title>`), and a mount id
  with a quote broke `getElementById('…')`.
- [x] A branch or a map with nothing under it (a child one indent short) rendered an empty
  node instead of saying so.
- [x] Editing state in place (`o.a = 1`, `xs.push(x)`) — nothing re-renders; now an error
  naming the setter to call.

Three more harness gaps closed so the suite can test what a real app does: unmounting between
runs (a timer in an `fx` held the event loop open), resolving lazy imports, and the missing
hooks (`useDebugValue`, `useImperativeHandle`, …).

## Part 2 — features (React surface Zaal cannot say)

- [ ] **F1. Custom hook blocks.** No `H useThing` — a shared hook is hand-written JS today.
- [ ] **F2. Dynamic / polymorphic tags.** `{Tag}` as an element, an `as=` prop.
- [ ] **F3. Portals.** A `portal` head, rather than a manual `createPortal` expression child.
- [ ] **F4. Own contexts.** `ctx` reads one; only `S` creates one. No `createContext` form.
- [ ] **F5. Event ergonomics.** No `.prevent` / `.stop` modifiers, no `@key.enter`; `EV`
  (`packages/zaal/src/expr.mjs`) names 9 events and guesses the rest.
- [ ] **F6. Router depth.** A flat hash router: no history/pathname mode, nested layouts,
  redirects, query params, scroll restoration or route data loading. (A declared 404 is done —
  `/* NotFound`.) Nested layouts are the first thing a real app wants.
- [ ] **F7. Per-route `<head>`.** Title and meta are app-global (`t` in `app.zaal`).
- [ ] **F8. TypeScript output.** No types, no `.d.ts`, no prop types.
- [ ] **F9. Test scaffolding.** `application/` ships no vitest/RTL config.
- [ ] **F10. Server-side React.** No SSR/RSC story: `'use client'`, server actions,
  `<form action={fn}>` are outside the model.

- [ ] **F11. Async flow sugar.** A page that fetches writes its own `setStatus(…)`/`setData(…)`
  calls inside a promise chain (see `zaal/pages/Dex.zaal`): state assignment only rewrites at the
  top level of a statement. A `load` or `async` line that owns the loading/error/data triple
  would cut the most verbose thing in the example by half.

## Part 1e — the oracles

The bug hunts kept working because the suite had no way to *check* the output, only to compare
it to itself. Three holes, two now closed:

- [x] **The jsx backend's output was never parsed.** Every `--check` in the suite ran on the
  esm preview; the deliverable was only ever diffed as text. `test/helpers/jsx-check.mjs` is a
  structural check for the subset of JSX the compiler can get wrong — unbalanced brackets, a
  name declared twice, a parameter bound twice, an attribute set twice, an unclosed element, a
  bare `<` or an empty `{}` in children. It runs over the example, the checked-in deliverable,
  every golden, and a corpus of awkward sources (`test/jsx-output.test.mjs`).
- [x] **Nothing held React's DOM contract.** The test React rendered anything; real React
  throws on a string `style` and warns-then-drops for `class`, `tabindex` or `onKeyup`. The
  harness now refuses all of those, so the next such regression fails a test.
- [ ] **No real parser, no real React.** Both of the above are approximations written here
  because the sandbox has no network. One dev dependency (`esbuild` or `@babel/parser`) would
  parse the jsx output properly, and `react-dom/server` with `console.error` treated as a
  failure would make React itself the oracle. That pair would have caught about half of the
  bugs in Part 1d without anyone looking for them. **Worth doing first, next time there is a
  registry.**
- [ ] **Differential testing.** Generate random valid sources, compile both backends, render
  both, compare. The two backend divergences found so far (`&&` vs ternary, text spacing) were
  both caught by reading, not by testing.
