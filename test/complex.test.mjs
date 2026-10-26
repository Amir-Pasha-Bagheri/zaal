// One large, realistic app that uses every feature at once — nested directories, a design
// system, two stores (one reading the other), slots, named exports, an error boundary, a memo
// component, a lazy route, maps inside maps, if-chains inside maps, rest props and a package.
// It is compiled for both backends, checked as JavaScript, and then run.
import './helpers/loader.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { projectDir, buildIn, read, runProject, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const APP = {
  'zal/app.zal': `A Board
  t "Board"
  m #app
  ui ./ui.zal
  css ./styles/extra.css
  pkg canvas-confetti@1.9.3
  store Theme Board
  / Home
  /team/:id Member
  /stats Stats lazy
`,
  'zal/ui.zal': `D Board
t color
  bg #fff
  fg #111
  accent #36f
  muted #777
t space
  1 .25rem
  2 .5rem
  4 1rem
scheme dark
  color.bg #111
  color.fg #eee
e body
  m 0
  bg $color.bg
  fg $color.fg
k page main
  px $space.4
k card section
  p $space.2
  & h3
    m 0
k row div
  display flex
  gap $space.2
  :hover
    outline 1px solid $color.accent
k btn button
  p $space.1 $space.2
  v primary
    bg $color.accent
  v ghost
    bg transparent
k chip span
  fg $color.muted
k list ul
  p 0
k item li
  display flex
k field label
  display block
k hint p
  fg $color.muted
`,
  'zal/styles/extra.css': '.print-only { display: none }\n',

  'zal/stores/Theme.zal': `S Theme persist s:mode="light"
  cb toggle() = mode = mode == "dark" ? "light" : "dark"
  fx document.documentElement.dataset.theme = mode
`,
  'zal/stores/Board.zal': `// columns of cards, each card with tags: the shape the nested maps render
S Board persist=board:v1 s:columns=[] s:filter=""
  use { mode } = Theme
  memo total = columns.reduce((n, c) => n + c.cards.length, 0)
  memo visible = columns.map(c => ({ ...c, cards: c.cards.filter(x => !filter || x.title.includes(filter)) }))
  cb addColumn(title) = columns=[...columns,{id:columns.length+1,title,cards:[]}]
  cb addCard(col, title) = columns=columns.map(c => c.id === col ? { ...c, cards: [...c.cards, { id: c.cards.length + 1, title, tags: ["new"], done: false }] } : c)
  cb toggleCard(col, id) = columns=columns.map(c => c.id === col ? { ...c, cards: c.cards.map(x => x.id === id ? { ...x, done: !x.done } : x) } : c)
  cb filterBy(text) = filter=text
  memo theme = "{mode}"
`,

  'zal/components/ui/Field.zal': `C Field p:label
  %field
    "{label}"
    input ...rest
`,
  'zal/components/ui/Chip.zal': `C Chip memo p:text p:tone="plain"
  %chip "{tone == "warn" ? "! " : ""}{text}"
`,
  'zal/components/Card.zal': `i Chip ./ui/Chip
C Card p:card p:onToggle
  %card
    %row
      h3 "{card.title}"
      ?card.done
        %chip "done"
      :?card.tags.length > 2
        %chip "busy"
      :
        button @click=onToggle "take"
    %row
      *card.tags as t k=t
        Chip text=t tone="plain"
`,
  'zal/components/Column.zal': `i Card ./Card
C Column p:column p:onToggle p:actions=null
  %card
    %row
      h3 "{column.title} ({column.cards.length})"
      ?actions
        {actions}
    ?column.cards.length
      %list
        *column.cards as c k=c.id
          %item
            Card card=c onToggle=()=>onToggle(column.id, c.id)
    :
      %hint "empty"
`,
  'zal/components/Boundary.zal': `C Boundary catch p:title="Board broke"
  %card
    h3 "{title}"
    p "{error.message}"
    button @click=reset "retry"
`,
  'zal/components/Toolbar.zal': `i confetti canvas-confetti
i Field ./ui/Field
C Toolbar p:onAdd s:draft=""
  use { total, filter, filterBy } = Board
  use { mode, toggle } = Theme
  ref box
  fx! box.current?.focus()
  cb submit(e) = e.preventDefault(); onAdd(draft); draft=""; confetti()
  memo badge = "{total} cards"
  %row
    form @submit=submit
      Field label="Column"
        input val=draft @input=draft=e.target.value ref=box placeholder="name"
      %btn.primary type="submit" "add column"
    input val=filter @input=filterBy(e.target.value) placeholder="filter"
    %chip "{badge}"
    %btn.ghost @click=toggle "{mode}"
`,
  'zal/pages/Home.zal': `i Toolbar ../components/Toolbar
i Column ../components/Column
i Boundary ../components/Boundary
C Home
  use { visible, columns, addColumn, addCard, toggleCard } = Board
  %page
    %row
      Link to="/" "Board"
      Link to="/stats" "Stats"
    h1 "Board — {columns.length} columns"
    Toolbar onAdd=addColumn
    Boundary
      ?visible.length
        %list
          *visible as col k=col.id
            Column column=col onToggle=toggleCard
              slot actions
                %btn @click=addCard(col.id,"card") "+"
      :
        %hint "no columns yet"
`,
  'zal/pages/Member.zal': `C Member p:id
  %page
    h1 "Member {id}"
    Link to="/" "back"
`,
  'zal/pages/Stats.zal': `C Stats
  use { total } = Board
  %page
    h1 "{total} cards"
`,
};

test('the whole app compiles for both backends', () => {
  const root = projectDir(APP);
  const jsx = buildIn(root, 'jsx');
  assert.deepEqual(jsx.warnings, []);
  assert.deepEqual(jsx.made.sort(), [
    'src/components/Boundary.jsx', 'src/components/Card.jsx', 'src/components/Column.jsx',
    'src/components/Toolbar.jsx', 'src/components/ui/Chip.jsx', 'src/components/ui/Field.jsx',
    'src/pages/Home.jsx', 'src/pages/Member.jsx', 'src/pages/Stats.jsx',
    'src/stores/Board.jsx', 'src/stores/Theme.jsx',
  ]);
  const esm = buildIn(root, 'esm');
  assert.deepEqual(esm.warnings, []);
  for (const f of esm.made) {
    const file = join(root, '.zal-dev', f.replace(/\.jsx$/, '.js'));
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
    catch (e) { assert.fail(`${f}: ${e.stderr}`); }
  }
});

test('imports, props and paths come out right in the deepest module', () => {
  const root = projectDir(APP);
  buildIn(root);
  const card = read(root, 'application/src/components/Card.jsx');
  assert.match(card, /import Chip from '\.\/ui\/Chip\.jsx';/);
  const home = read(root, 'application/src/pages/Home.jsx');
  assert.match(home, /import Toolbar from '\.\.\/components\/Toolbar\.jsx';/);
  assert.match(home, /import \{ useBoard \} from '\.\.\/stores\/Board\.jsx';/);
  assert.match(home, /import \{ Link \} from '\.\.\/router\.jsx';/);
  assert.match(home, /actions=\{<button className="btn" onClick=\{\(\) => addCard\(col\.id,"card"\)\}>\+<\/button>\}/);
  const board = read(root, 'application/src/stores/Board.jsx');
  assert.match(board, /import \{ useTheme \} from '\.\/Theme\.jsx';/);
  assert.match(board, /const KEY = "board:v1";/);
  const field = read(root, 'application/src/components/ui/Field.jsx');
  assert.match(field, /function Field\(\{ label, \.\.\.rest \}\)/);
  const chip = read(root, 'application/src/components/ui/Chip.jsx');
  assert.match(chip, /const Chip = memo\(function Chip/);
});

test('the design system covers every class the markup uses', () => {
  const root = projectDir(APP);
  const out = buildIn(root);
  assert.deepEqual(out.warnings, [], 'an unstyled class would be reported here');
  const css = read(root, 'application/src/styles/ui.css');
  assert.match(css, /\.btn\.primary \{/);
  assert.match(css, /\.btn\.ghost \{/);
  assert.match(css, /\.card h3 \{/);
  assert.match(css, /\.row:hover \{/);
  assert.match(css, /:root\[data-theme="dark"\] \{/);
});

test('the app runs: nested maps, slots, stores, filters and the boundary', async () => {
  const root = projectDir(APP);
  const { app, env } = await runProject(root);
  assert.match(app.html, /<h1>Board — 0 columns<\/h1>/);
  assert.match(app.html, /class="hint">empty<\/p>|no columns yet/);
  assert.equal(env.document.documentElement.dataset.theme, 'light');

  // the Toolbar's form adds a column through the store
  const name = app.find(n => n.tag === 'input' && n.props.placeholder === 'name');
  app.fire(name, 'onInput', { target: { value: 'Todo' } });
  app.fire(app.find(n => n.tag === 'form'), 'onSubmit');
  assert.match(app.html, /<h1>Board — 1 columns<\/h1>/);
  assert.match(app.html, /<h3>Todo \(0\)<\/h3>/);
  assert.deepEqual(globalThis.__pkgCalls?.map(c => c[0]), ['default'], 'confetti fired');

  // the slot button adds a card, which the nested map renders with its tags
  app.fire('+');
  assert.match(app.html, /<h3>card<\/h3>/);
  assert.match(app.html, /class="chip">new<\/span>/, 'the inner *tags map rendered through Chip');
  assert.match(app.html, /<h3>Todo \(1\)<\/h3>/);
  assert.match(app.html, /1 cards<\/span>/, 'the store memo recounted');

  // the if-chain inside the map: "take" flips the card to "done"
  app.fire('take');
  assert.match(app.html, /class="chip">done<\/span>/);
  assert.doesNotMatch(app.html, />take</);

  // the filter is store state read by a sibling component
  const filter = app.find(n => n.tag === 'input' && n.props.placeholder === 'filter');
  app.fire(filter, 'onInput', { target: { value: 'zzz' } });
  assert.match(app.html, /class="hint">empty<\/p>/, 'the filtered column renders its else branch');
  app.fire(app.find(n => n.tag === 'input' && n.props.placeholder === 'filter'), 'onInput', { target: { value: '' } });
  assert.match(app.html, /<h3>card<\/h3>/);

  // one store reading another
  app.fire(app.find(n => n.tag === 'button' && n.text === 'light'), 'onClick');
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  assert.match(app.html, />dark</);

  // both stores persisted under their own keys
  assert.equal(env.saved('zal:theme').mode, 'dark');
  assert.equal(env.saved('board:v1').columns[0].title, 'Todo');
});

test('a :param route passes the parameter as a prop', async () => {
  const { app } = await runProject(projectDir(APP), { hash: '#/team/42' });
  assert.match(app.html, /<h1>Member 42<\/h1>/);
});

test('the same sources rebuild byte-for-byte', () => {
  const root = projectDir(APP);
  buildIn(root);
  const first = read(root, 'application/src/pages/Home.jsx');
  buildIn(root);
  assert.equal(read(root, 'application/src/pages/Home.jsx'), first);
});
