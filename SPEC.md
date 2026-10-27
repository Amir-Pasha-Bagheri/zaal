# Zaal v0.1 — a token-dense DSL that compiles to React

```
npm install                # links the workspace packages and puts `zaal` on the path
cd example && npx zaal dev # preview + live reload on http://localhost:5173
npm test                   # the compiler's own suite (no dependencies)
```
As a user rather than from this repo, it is the command plus a target to compile with:
```
npm i -g zaal
npm i -D @zaal/react
```
The compiler has no dependencies. `zaal` is this document's grammar, the build pipeline and the
command; `@zaal/web` is the `ui.zaal` design system and the `app.zaal` project model that every
web target shares; and a target package generates the code — `@zaal/react` today, named by the
`target` line in `app.zaal`. A Zaal **project** is two directories — `zaal/`, which
is everything hand-written, and `application/`, which `zaal build` writes — and `example/` is one.
Every command runs in the project directory.

```
zaal/                      application/          <- a complete React app; `git init` here
  app.zaal                   package.json
  ui.zaal                    vite.config.js
  styles/extra.css           .gitignore
  pages/Home.zaal            index.html
  pages/About.zaal           src/
  components/Panel.zaal        main.jsx
  stores/Todos.zaal            router.jsx
                               pages/Home.jsx
                               pages/About.jsx
                               components/Panel.jsx
                               stores/Todos.jsx
                               styles/ui.css
                               styles/extra.css
```
`application/` is the deliverable, and it is a React project like any other: its own
`package.json` and `vite.config.js`, an `index.html`, and a `src/` tree mirroring `zaal/`
one-to-one. Nothing in it names the compiler. A developer commits that folder, `npm install`s
it, runs `npm run dev`, bundles it with `npm run build` and deploys `dist/` — all without
knowing Zaal exists.

Its project files are **written once and then left alone**: a hand-added Vite plugin, dev proxy
or npm script survives every rebuild. The only standing change a build makes to them is adding a
package an `i` line named to `dependencies`. Inside `src/` the compiler is the author — a
renamed or deleted `.zaal` has its module swept — and it never touches `node_modules/`, `dist/`
or anything else you put in the folder.

Indentation = nesting. One node per line. `//` comments ignored — a whole line, or the tail of
one (`store Theme Todos  // outermost first`); inside a quoted string it is text, not a comment.

## Top level
| Zaal | React |
|---|---|
| `C Name p:a p:b=1 s:n=0` | `export default function Name({a, b = 1})` + `useState` per `s:` |
| `C Name memo` | the same, wrapped in `memo(…)` — re-renders only when its props change (`memo=eq` passes a comparator) |
| `C Name catch` | an **error boundary** (the class React still requires) — see below |
| `i Btn ./Btn` | `import Btn from './Btn';` (local — the extension is added for you) |
| `i confetti canvas-confetti` | `import confetti from 'canvas-confetti';` — see **Packages** |
| `i Heavy ./Heavy lazy` | `const Heavy = lazy(() => import('./Heavy.jsx'))` — wrap it in `Suspense` yourself |
| `i logo ./logo.png` | an asset: the path keeps its extension and the file is copied to the output (the `esm` preview resolves it to a URL, since it has no bundler) |
| `js const x = 1` | emitted verbatim above the component |
| `S Cart s:items=[]` | a store: context + `CartProvider` + `useCart()` — see **Global state** |

`p:` = prop (`=` gives a default), `s:` = state (`=` gives the initial value). Each has to be a
name, and every block in a file has to have a name of its own. A block's name starts with a
capital (React reads a lower-case tag as a DOM element); names may hold any letter — `C Café
p:prénom` — but not a JavaScript keyword, and not a name the generated module writes itself
(`value`/`children` in a store, `error`/`reset` in a boundary, a setter another `s:` needs).

**Error boundaries** — `C Oops catch` generates the class, because no hook catches a render error.
The children render while nothing has thrown; the markup is the fallback, with `error` and `reset`
in scope. A boundary has no `s:` state and no hooks (a class can't): both are build errors.
```
C Oops catch p:title="Something broke"
  %card
    h2 "{title}"
    p "{error.message}"
    button @click=reset "try again"
```

## Elements
`tag.class.class#id attr=... "text"` — tag defaults to `div`, so `.card` = `<div className="card">`.
Capitalized tag = component (`Item todo=t`); a dashed tag is a custom element (`my-widget`).
A dotted tag is a **member** of something the file imports when the dot can't be a class —
`motion.div`, `Dialog.Panel` — because a class is lower-case and a component is not, so
`Card.wide` is still `<Card className="wide">`.
`%name` = a UI-kit entry from `ui.zaal`: `%btn.primary` → `<button className="btn primary">`
(the tag comes from the kit, so markup never repeats it). An unknown `%name` is a build error;
a plain `.class` with no kit entry is a build warning.

Attributes:
- `k="str"` → string literal, and it interpolates like text: `title="{n} items"`
- `k=expr` → `{expr}`; bare `k` → boolean prop
- `k={expr}` is accepted too (the JSX habit); an object literal stays itself — `style={color:"red"}`
- `...rest` → spread. A spread naming nothing in scope makes it a rest prop on the component
  (`input ...rest` → `function Field({ ...rest })`), the way `{children}` does — no `p:` line needed.
  Two such names in one component is an error: only one can be the rest prop.
- shorthands: `c=` → `className`, `val=` → `value`, `ph=` → `placeholder`
- on a DOM element the HTML spelling of an attribute is translated — `class`, `for`,
  `tabindex`, `readonly`, `colspan`, `viewbox`… all reach React under the name it wants
- `style="color: red; width: {w}px"` becomes the object React requires (a custom property
  keeps its name); `style={…}` is still an object as written
- `@click=`, `@input=`, `@change=`, `@submit=`, `@key=`… → `onClick` etc. A DOM event gets
  React's spelling, whatever case you write (`@keyup` → `onKeyUp`, `@dblclick` → `onDoubleClick`);
  any other name is a callback prop (`@pick` → `onPick`)
- an attribute set twice is an error — except classes, which are joined: `%card c="wide"` is
  `className="card wide"`, and `%card c=extra` is `` className={`card ${extra}`} ``

Text: a quoted string, inline (`h1 "hi"`) or on its own line. `{expr}` inside interpolates,
and `\{` is a literal brace.

## Nesting, children and slots
Indentation nests, so a component's children are just the lines under it — any depth, any mix
of elements and components:
```
Panel title="About"
  p "a child"
  Card
    p "a grandchild"
```

`{expr}` on its own line is an **expression child** — that is how a wrapper renders what it
was given:
```
C Panel p:title
  %card
    h2 "{title}"
    {children}
```
`children` needs no `p:` line: a component that mentions it takes it. `{expr}` also covers any
value JSX would need braces for — `{items.length}`, `{cond ? a : b}`, `{null}`.

To pass **markup as a prop** (a header, an icon, a footer — a named slot), use `slot`:
```
Panel title="About"
  slot actions
    Link to="/" "back home"
  p "the ordinary children"
```
→ `<Panel title="About" actions={<Link to="/">back home</Link>}>…</Panel>`. The component reads
it like any other prop: `p:actions=null` + `{actions}`. A `slot` on a plain element, or an
empty one, is a build error.

A component may have **several root lines**; they are wrapped in a fragment for you (and a
`?`/`*` may be the root too).

**One block per file is the default export** — the one named after the file. Extra `C`/`S`
blocks in the same file become named exports, reachable with `i { Row } from ./Table`.

`i`, `js`, `slot`, `fx`, `memo`, `cb`, `ref`, `ctx` and `use` are reserved heads, so no element
may be named one. `i` is the exception that keeps `<i>`: `i "text"` and `i c="..."` are the
element, `i X ./X` is an import.

## Handlers (`@ev=`)
- `n++` / `n--` / `n=x` / `n+=x` on a **state** name → `setN(...)`
- state is replaced, never edited: `o.a = 1` or `xs.push(x)` on a state name is a build error,
  because React would not re-render
- mentions `e` → arrow gets the event param
- `;` separates statements; a bare identifier passes the function by reference
- `"a {b}"` interpolates, as in text — so `@click=log("n is {n}")` works

## Packages
An `i` line whose specifier is not `./…` is a package. Write it the way npm names it; the
compiler takes care of resolving it in both backends.

```
i confetti canvas-confetti            // default export
i { motion } from framer-motion       // named — `from` is optional noise, allowed anywhere
i debounce lodash/debounce            // subpath
i Chart,{ Line } from react-chartjs-2 // default + named (no space before the comma)
i react-toastify/dist/ReactToastify.css   // side-effect / stylesheet import
```

Versions live in one place, `app.zaal`, so two files can't disagree:
```
A Demo
  pkg canvas-confetti@1.9.3
  pkg framer-motion@11.11.9
  cdn https://esm.sh          // optional, for the esm preview
```
A version may also be written inline (`i x some-pkg@1.2.3`) — handy for a one-off; a `pkg`
pin wins over it and a mismatch is a warning. Unpinned packages build fine and resolve to
`latest`, with a warning telling you what to pin.

| Backend | How it resolves |
|---|---|
| `jsx` | bare specifiers, resolved from `node_modules`; every package is added to `application/package.json` `dependencies` on build, and `zaal dev --vite` installs anything missing. |
| `esm` (preview) | an import map in `index.html`: `<pkg>@<version>` on the CDN, `?external=react,react-dom` so every package shares the app's one React. **No install.** |

Package stylesheets follow the backend too: the `esm` preview links them from the CDN in `<head>`,
`jsx` leaves the `import` for the bundler. A **local** stylesheet is not an `i` line — it
belongs to the app (`css ./styles/extra.css` in `app.zaal`).

## Hooks (child lines of `C`, before the markup)
| Line | React |
|---|---|
| `fx <stmts>` | `useEffect(() => {…}, [deps])` |
| `memo n = <expr>` | `const n = useMemo(() => expr, [deps])` |
| `cb f(a) = <stmts>` | `const f = useCallback((a) => {…}, [deps])` |
| `ref el` / `ref n = 0` | `const el = useRef(null)` — stable, never a dep |
| `ctx theme = Ctx` | `const theme = useContext(Ctx)` |
| `use <pattern> = <expr>` | `const <pattern> = <expr>` — any other hook |
| `use <call>` | the same for a hook that hands nothing back (`use useLayoutEffect(…)`) |
| `js const x = 1` | emitted verbatim in the body |

A hook that is evaluated while the component renders (`memo`, `use`, `ctx`, a `ref` initial
value) may only name what is written above it, which is the order the dependency scan reads too.

`use` is the escape hatch, so `useReducer`, `useId`, a custom `useFetch` and friends all fit:
`use [log, dispatch] = useReducer(reduce, [])`. Every hook React itself owns is imported on
sight; a custom hook still needs an `i` line. A hook has to run on every render, so it belongs
on a `use` line and nowhere else: naming one inside `memo`, `cb` or `fx` is a build error.

**Dependencies are inferred**: the body is scanned for props, state and earlier hook values,
in scope order. A suffix on the head overrides that — `fx!` mount only (`[]`), `fx*` every
render (no array), `fx[a b]` exactly these. Same on `memo` and `cb`.

Bodies are JS, one statement per child line (or inline after the head, `;`-separated), with
two conveniences: state assignment becomes a setter (`n++`, `n+=step`, `n=x` → `setN(…)`,
as in handlers) and `"a {b} c"` interpolates like a text node.
`off <expr>` inside `fx` is the cleanup return.

```
C Clock p:label="now" s:n=0
  ref box
  fx! box.current?.focus()
  fx document.title = "{label}: {n}"
  memo even = n % 2 == 0
  cb tick(by) = n+=by
  fx!
    const id = setInterval(() => tick(1), 1000)
    off clearInterval(id)
```
```js
const box = useRef(null);
useEffect(() => { box.current?.focus(); }, []);
useEffect(() => { document.title = `${label}: ${n}`; }, [label, n]);
const even = useMemo(() => n % 2 == 0, [n]);
const tick = useCallback((by) => setN(n + (by)), [n]);
useEffect(() => {
  const id = setInterval(() => tick(1), 1000);
  return () => clearInterval(id);
}, []);
```

Each hook line declares a fresh name: reusing a `p:` prop, an `s:` state, one of its setters or
an earlier hook's name is a build error, as is a name that is not an identifier.

A hook line nested inside markup is an error: they belong to the component, not to an element.
`fx`, `memo`, `cb`, `ref`, `ctx` and `use` are reserved heads — no element may be named one.
A suffix (`!`, `*`, `[a b]`) belongs to the three hooks that have a dependency array, and every
name in `[a b]` has to be a prop, a state or a value the component declares.

## Global state (`S Name`)
A store is a component with no markup: whatever it declares becomes its context value. Every
`C` line means the same thing inside an `S` block — `s:` state, `memo` derived values, `cb`
actions, `fx` effects.

```
S Todos persist s:items=[]
  memo left = items.filter(t => !t.done).length
  cb add(text) = items=[...items,{id:Date.now(),text}]
  cb drop(id) = items=items.filter(t => t.id !== id)
```
compiles to `TodosContext`, `<TodosProvider>` and `useTodos()` (also the default export). The
value is `{ items, setItems, left, add, drop }` — state, a setter per state, and every `memo`,
`cb`, `ref`, `ctx` and `use` name, memoised on its own dependencies.

`persist` syncs the store's **state** to `localStorage` (key `zaal:<name>`, or `persist=my:key`)
and seeds it back on load. Everything derived is recomputed, never stored.

Read a store from any component — a bare store name on a `use` line, imported for you:
```
C TodoList s:draft=""
  use { items, left, add } = Todos
  cb submit(e) = e.preventDefault(); add(draft); draft=""
```
```js
const { items, left, add } = useTodos();
```
Store values are read-only in a component: assigning one (`items=[]` in a handler) is a build
error pointing at the action or `setItems` instead — only the store mutates its own state.

Every `S` block found in `zaal/` is wrapped around the app in `main.jsx` automatically, so there
is no provider to mount by hand, and a store that reads another is nested inside it — the order
follows what the stores actually read. A `store` line fixes the order of the rest (outermost
first); one that contradicts a store's own reads, or two stores reading each other, is a build
error:
```
A Demo
  store Theme Todos
```
`ctx name = SomeContext` stays the way to read a context you didn't declare — one from a
package, say.

## Control flow (child lines)
```
?cond          → {cond ? (…) : null}   // never `&&`: a falsy *number* would render as `0`
:?cond2        → else-if, any number of them (the chain becomes one ternary)
:              → else branch, always last  (the chain becomes a ternary)
*items as x k=x.id   → {items.map((x, i) => (…))}   key defaults to i
```
Multiple children inside a branch are wrapped in `<>…</>` automatically.

## Example
```
C Counter p:label="Count" s:n=0
  fx document.title = "{label}: {n}"
  %counter
    h2 "{label}: {n}"
    %btn.primary @click=n++ "+"
    ?n>0
      %hint "keep going"
    :
      %hint "click +"
```
(`counter`, `btn`, `primary` and `hint` are entries in the design system — see below.)

---

# App declaration (`zaal/app.zaal`)

```
A Demo              // app block
  target react      // which target package compiles this app (default: react)
  t "Zaal Demo"      // document title
  m #root           // mount node id
  ui ./ui.zaal       // design system -> generated src/styles/ui.css
  css ./styles/extra.css   // optional raw stylesheet(s), copied as-is
  store Theme Todos   // provider nesting order, outermost first (see Global state)
  pkg confetti@1.9.3  // package version pin (see Packages)
  cdn https://esm.sh  // where the esm preview resolves packages
  / Home            // route: path -> component
  /about About
  /todo/:id Detail  // :params are passed to the component as props
  /heavy Heavy lazy // fetched on first visit, not in the main bundle (wrapped in Suspense)
  /* NotFound       // the catch-all: rendered when nothing else matched, whatever the order
```

`target` names the package that generates the code: `react` means `@zaal/react`, and a name with
a slash is taken as written (`target my-org/zaal-svelte`). It is the one directive read before
anything else is parsed — `zaal` itself has no framework in it, and must know whose compiler to
load before it can read the rest of the file. Omitted, it is `react`.

`ui` and `css` paths are relative to `app.zaal` itself, so they read the way the source tree does.
A directive this list does not name is an error, so a typo (`stores`, `title`) is reported rather
than ignored; a `ui` path that is not there is a warning and the app builds unstyled.

Every `.zaal` under `zaal/` compiles to `application/src/<same path>.jsx` — **the tree is
mirrored**, so `zaal/components/Btn.zaal` becomes `application/src/components/Btn.jsx` and a local
`i` line is written the way the source reads it (`i Btn ../components/Btn`). Fold the sources
into whatever directories the app wants — `pages/`, `components/`, `stores/`, any depth — and
the app follows. A route component may live in a subdirectory; it still has to be the file's own
default export. A build also generates:
- `src/main.jsx` — createRoot + route table, wrapped in every store's provider
- `src/router.jsx` — dependency-free hash router (`Router`, `Link`, `useRoute`)
- `src/styles/ui.css` — the compiled design system, with the `css` stylesheets beside it
- `index.html` — title, mount div, stylesheet links and `<script src="./src/main.jsx">`
- `package.json`, `vite.config.js`, `.gitignore` — once each, if absent

`app.zaal` and `ui.zaal` are config, not modules: they compile to the app, never to a module of
their own, and no other `.zaal` file imports them.

The output directory is the build's own: `.js`/`.jsx`/`.css`/`.html` files it no longer
generates are removed on every build — at any depth, and an emptied directory goes too — so a
renamed or deleted `.zaal` leaves nothing live behind. Other files (images, fonts) are left alone.
A build that fails writes nothing at all, so the last good output stays runnable.

**In scope for free** — no `i` line: `Link`, `go`, `useRoute` and `useQuery` from the router, and
React's own `Suspense`, `StrictMode` and `Profiler`. A name the file declares itself always wins.
```
Link to="/about" "About"        // the active link gets data-active
cb save() = post(); go("/done") // navigate from code
use path = useRoute()           // the current path, without the query
use { tab } = useQuery()        // ?tab=stats — the query as an object
```
React's other exports come from an `i` line that is folded into the module's own React import:
`i { startTransition } from react`.
The active link gets `data-active` for styling.

---

# Design system (`ui.zaal`)

One config file is the whole look of the app: **tokens** (the raw scale) + a **UI kit**
(one named recipe per class). It compiles to `application/src/styles/ui.css`, which `index.html` links
first. There is no hand-written CSS in a Zaal project; `.zaal` files only ever name kit
entries, never properties.

The format is Zaal-shaped: indentation nests, one thing per line, `//` comments.

| Line | Means |
|---|---|
| `D <Name>` | design-system name (header, once) |
| `t <group>` | token group — each child `name value` becomes `--<group>-<name>` on `:root` |
| `scheme <name>` | token overrides — `<group>.<name> value` children |
| `e <selector>` | base styles for bare elements (`body`, `h1`, `*, *::before`) |
| `k <class> [tag]` | kit entry: the class, and the HTML tag `%class` expands to (default `div`) |
| `v <name>` | a modifier inside `k` — emits `.<class>.<name>`, used as `%btn.primary` |
| `css <...>` | raw CSS passthrough (one line), for anything the format can't say |
| `@<rule>` | an at-rule: `k`/`e` blocks inside a `@media`, steps inside a `@keyframes` |

An `@media` may also sit **inside** a `k`, `v` or `e` block, where it wraps that one rule:

```
k card section
  p $space.3
  @media (max-width: 40rem)
    p $space.1
```

Inside `e`, `k` and `v`, each line is `property value`. Children whose first token starts
with `:`, `&`, `[`, `>`, `.`, `#` or `*` are nested selectors — `:hover` → `.btn:hover`,
`& input` → `.row input`, `.dark &` → `.dark .card` (`&` is the parent selector; with no `&` the
selector is appended, so `.wide` inside `k card` is `.card.wide`).

**Values** reference tokens as `$group.name` → `var(--group-name)`, so schemes and
`[data-theme]` switch at runtime with no rebuild.

**Property aliases** (everything else passes through verbatim):
`bg` background · `fg` color · `radius` border-radius · `size` font-size ·
`weight` font-weight · `leading` line-height · `font` font-family · `shadow` box-shadow ·
`w`/`h`/`maxw`/`minw` · `z` z-index ·
`p`/`px`/`py`/`pt`/`pr`/`pb`/`pl` padding · `m`/`mx`/`my`/`mt`/`mr`/`mb`/`ml` margin
(`px`/`py` are the logical `padding-inline`/`padding-block`).

```
t color
  accent  #3b5bfd
scheme dark
  color.accent #7d9bff
k btn button
  p $space.2 $space.3
  radius $radius.sm
  :hover
    fg $color.accent
  v primary
    bg $color.accent
    fg $color.on-accent
```

`scheme dark` emits both `@media (prefers-color-scheme: dark) :root:not([data-theme=light])`
and `:root[data-theme="dark"]`, so the OS setting and an explicit toggle both work (a `scheme
light` block is the mirror image, excluding `[data-theme=dark]`).

## Extracting a design system into `ui.zaal`

This file is the hand-off point for an agent given a design (screenshots, a Figma, a brand
page, an existing stylesheet). Fill it in this order — tokens first, because every recipe
must be expressed in them:

1. **Colors** → `t color`. Capture *roles*, not swatch names: `bg`, `surface`, `line`, `fg`,
   `muted`, `accent`, `on-accent`, plus any status roles actually used (`danger`, `warn`,
   `ok`). Add a `scheme dark` (or `light`) block with the same keys whenever the design has
   two modes.
2. **Scales** → `t space`, `t radius`, `t size`, `t weight`, `t leading`, `t font`. Round the
   measured values onto a small, regular scale; a design with eight near-identical paddings
   has one scale, not eight tokens.
3. **Base elements** → `e`. Only resets and typographic defaults (`body`, headings).
4. **Kit** → one `k` per repeated visual element, named for its role (`card`, `row`, `btn`,
   `item`, `hint`), with its canonical `tag`. Differences between two instances of the same
   element become `v` variants, not new entries.
5. **Check**: every declaration value is either a `$token`, a keyword, or `0`/`1px`-class
   trivia. A raw hex or a stray `13px` in a recipe means a token is missing.

Then write markup against it with `%entry` and run `zaal build` — unknown classes are
reported per file, so a design-system gap shows up as a warning rather than silently
unstyled markup.

---

## Backends
| | |
|---|---|
| `jsx` | real JSX in `application/` — the deliverable, bundled by Vite like any React project |
| `esm` | `createElement` modules in `.zaal-dev/` — **no build, no npm install**; React comes from an esm.sh import map |

Both write the same shape: `index.html` at the root, modules under its `src/`. `application/` is
what a build produces and what you commit; `.zaal-dev/` is a preview, rewritten freely and safe
to delete, which is why `zaal dev` can run with an empty `node_modules` without disturbing the
folder you have under git.

## Commands
| | |
|---|---|
| `zaal build` | write the React app to `application/` |
| `zaal dev [port]` | preview from `.zaal-dev/`, live-reload on every `.zaal`/`.css` save — **no install** |
| `zaal dev --vite` | build `application/`, install there and run the real Vite dev server |
| `zaal serve [port]` | serve the preview, no watching |
| `zaal zaal/pages/X.zaal out` | compile a single file |

To ship: `zaal build`, then `cd application && npm install && npm run build` — `dist/` is the
static site. Every package an `i` line names is already in `dependencies`.
