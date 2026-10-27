// A third app, heavier than the shop: nested maps three deep, per-item component state beside
// store state, a reducer, cross-store reads, counted effect cleanups, a boundary inside a map
// and a filter. Written the way an app author would write it, then run.
import './helpers/loader.mjs';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { projectDir, buildIn, read, runProject, cleanup } from './helpers/fixture.mjs';

after(cleanup);
beforeEach(() => { globalThis.__pkgCalls = []; });

const BOARD = {
  'zaal/app.zaal': `A Board
  t "Zaal Board"
  ui ./ui.zaal
  store Prefs Cards
  / Home
  /card/:id Detail
  /* Missing
`,
  'zaal/ui.zaal': `D B
t color
  bg #fff
  line #ddd
  fg #111
t space
  1 .25rem
  2 .5rem
e body
  m 0
k board main
  display flex
  gap $space.2
  @media (max-width: 30rem)
    display block
k col section
  flex 1
  border 1px solid $color.line
k card article
  p $space.1
  v done
    opacity .5
k row div
  display flex
k btn button
  p $space.1
k hint p
  fg $color.fg
`,
  // one store holds the data, another the view preferences — and reads the first
  'zaal/stores/Prefs.zaal': `S Prefs persist s:hide=false s:q=""
  cb toggleHide() = hide = !hide
  cb search(text) = q = text
`,
  'zaal/stores/Cards.zaal': `S Cards persist s:cards=[]
  use [bumps, bump] = useReducer((n) => n + 1, 0)
  memo byCol = cards.reduce((acc, c) => ({ ...acc, [c.col]: [...(acc[c.col] ?? []), c] }), {})
  memo open = cards.filter(c => !c.done).length
  cb add(col, text) = cards = [...cards, { id: "c" + (cards.length + 1), col, text, done: false }]; bump()
  cb rename(id, text) = cards = cards.map(c => c.id === id ? { ...c, text } : c)
  cb toggle(id) = cards = cards.map(c => c.id === id ? { ...c, done: !c.done } : c)
  cb drop(id) = cards = cards.filter(c => c.id !== id)
  cb find(id) = cards.find(c => c.id === id) ?? null
`,
  // a card that keeps its own draft state, so removing a sibling must not shuffle it
  'zaal/components/Card.zaal': `C Card p:card s:draft=""
  use { rename, toggle, drop } = Cards
  cb commit(e) = e.preventDefault(); rename(card.id, draft); draft=""
  %card c={card.done ? "done" : ""}
    span "{card.text}"
    %row
      %btn @click=toggle(card.id) "done"
      %btn @click=drop(card.id) "x"
    form @submit=commit
      input val=draft @input=draft=e.target.value
`,
  // throws for one known card, to prove the boundary isolates a single row
  'zaal/components/Risky.zaal': `C Risky p:card
  js if (card.text === "boom") throw new Error("card " + card.id + " is poison")
  span "ok:{card.text}"
`,
  'zaal/components/Oops.zaal': `C Oops catch p:label="broken"
  %hint "{label}: {error.message}"
`,
  'zaal/components/Column.zaal': `i Card ./Card
C Column p:name p:cards=[] s:text=""
  use { add } = Cards
  use { hide } = Prefs
  cb submit(e) = e.preventDefault(); add(name, text); text=""
  memo shown = hide ? cards.filter(c => !c.done) : cards
  %col
    h2 "{name} ({shown.length})"
    ?shown.length
      *shown as c k=c.id
        Card card=c
    :
      %hint "empty"
    form @submit=submit
      input val=text @input=text=e.target.value placeholder="new in {name}"
      %btn type="submit" "add"
`,
  'zaal/pages/Home.zaal': `i Column ../components/Column
i Card ../components/Card
i Risky ../components/Risky
i Oops ../components/Oops
C Home s:ticks=0
  use { cards, byCol, open, add } = Cards
  use { hide, q, toggleHide, search } = Prefs
  fx[q] document.title = "search:{q}"
  fx!
    const id = setInterval(() => setTicks(t => t + 1), 1000)
    off clearInterval(id)
  memo matches = q ? cards.filter(c => c.text.includes(q)) : cards
  %board
    h1 "{open} open"
    %btn @click=toggleHide "{hide ? "show done" : "hide done"}"
    input val=q @input=search(e.target.value) placeholder="filter"
    ?q
      %hint "{matches.length} match"
    *["todo", "doing"] as name k=name
      Column name=name cards={byCol[name] ?? []}
    %col
      *cards as c k=c.id
        Oops label="card {c.id}"
          Risky card=c
`,
  'zaal/pages/Detail.zaal': `i Oops ../components/Oops
C Detail p:id s:note=""
  use { find, toggle } = Cards
  memo card = find(id)
  fx[id] document.title = "open:{id}"
  ?card
    %board
      h1 "{card.text}"
      %btn @click=toggle(card.id) "toggle"
      Link to="/" "back"
  :
    %hint "no card {id}"
`,
  'zaal/pages/Missing.zaal': `C Missing
  use path = useRoute()
  %hint "404 {path}"
`,
};

test('the board compiles both ways with no warnings, and every module parses', () => {
  const root = projectDir(BOARD);
  const jsx = buildIn(root, 'jsx');
  assert.deepEqual(jsx.warnings, [], 'jsx warnings');
  const esm = buildIn(root, 'esm');
  assert.deepEqual(esm.warnings, [], 'esm warnings');
  for (const f of esm.made) {
    execFileSync(process.execPath, ['--check', join(root, '.zaal-dev', f)]);
  }
  // the design system kept its media query, and the board is one flex row
  const css = read(root, 'application/src/styles/ui.css');
  assert.match(css, /@media \(max-width: 30rem\) \{\n  \.board \{\n    display: block;\n  \}\n\}/);
});

test('the board renders: columns, counts, and a card in each', async () => {
  const { app } = await runProject(projectDir(BOARD));
  assert.match(app.html, /<h1>0 open<\/h1>/);
  assert.equal(app.all(n => n.tag === 'section').length, 3, 'two columns plus the risky list');
  assert.match(app.html, /<h2>todo \(0\)<\/h2>/);
  assert.match(app.html, /<h2>doing \(0\)<\/h2>/);
  assert.equal(app.all(n => n.text.trim() === 'empty').length, 2);
});

test('adding cards runs the store action, the reducer and every derived value', async () => {
  const { app, env } = await runProject(projectDir(BOARD));
  const forms = () => app.all(n => n.tag === 'form');
  const typeIn = (name, text) => {
    const input = app.find(n => n.tag === 'input' && n.props.placeholder === `new in ${name}`);
    app.fire(input, 'onInput', { target: { value: text } });
  };
  typeIn('todo', 'write tests');
  app.fire(forms().find(f => f.props.onSubmit && f.text.includes('add')), 'onSubmit');
  assert.match(app.html, /<h1>1 open<\/h1>/, 'the memo over the store recomputed');
  assert.match(app.html, /<h2>todo \(1\)<\/h2>/, 'byCol grouped it');
  assert.match(app.html, /write tests/);
  assert.deepEqual(env.saved('zaal:cards').cards.map(c => c.text), ['write tests'], 'persisted');
});

const fill = app => {
  const type = (name, text) => {
    const input = app.find(n => n.tag === 'input' && n.props.placeholder === `new in ${name}`);
    app.fire(input, 'onInput', { target: { value: text } });
    const form = app.all(n => n.tag === 'form').find(f => f.text.includes('add')
      && f.props.children && JSON.stringify(f.props).includes(`new in ${name}`));
    app.fire(form ?? app.all(n => n.tag === 'form').find(f => f.text.includes('add')), 'onSubmit');
  };
  type('todo', 'alpha');
  type('todo', 'beta');
  type('todo', 'gamma');
  return app;
};

test('per-card state survives a sibling being removed — the keys are right', async () => {
  const { app } = await runProject(projectDir(BOARD));
  fill(app);
  const drafts = () => app.all(n => n.tag === 'input' && n.props.placeholder === undefined);
  assert.equal(drafts().length, 3, 'one draft input per card');
  // type a different draft into each card
  drafts().forEach((d, i) => app.fire(d, 'onInput', { target: { value: `draft-${i}` } }));
  assert.deepEqual(drafts().map(d => d.props.value), ['draft-0', 'draft-1', 'draft-2']);
  // remove the middle card: the first and last keep their own drafts
  const xs = app.all(n => n.tag === 'button' && n.text === 'x');
  app.fire(xs[1], 'onClick');
  assert.equal(drafts().length, 2);
  assert.deepEqual(drafts().map(d => d.props.value), ['draft-0', 'draft-2'],
    'state followed the key, not the position');
  assert.doesNotMatch(app.html, /beta/);
});

test('a card renames itself through the store, and the list re-renders', async () => {
  const { app, env } = await runProject(projectDir(BOARD));
  fill(app);
  const draft = app.all(n => n.tag === 'input' && n.props.placeholder === undefined)[0];
  app.fire(draft, 'onInput', { target: { value: 'alpha prime' } });
  const form = app.all(n => n.tag === 'form').find(f => !f.text.includes('add'));
  app.fire(form, 'onSubmit');
  assert.match(app.html, /alpha prime/);
  assert.doesNotMatch(app.html, />alpha</);
  assert.equal(app.all(n => n.tag === 'input' && n.props.placeholder === undefined)[0].props.value, '',
    'the draft cleared');
  assert.deepEqual(env.saved('zaal:cards').cards.map(c => c.text), ['alpha prime', 'beta', 'gamma']);
});

test('toggling done flows through two stores: the count, the filter and the class', async () => {
  const { app } = await runProject(projectDir(BOARD));
  fill(app);
  assert.match(app.html, /<h1>3 open<\/h1>/);
  app.fire(app.all(n => n.tag === 'button' && n.text === 'done')[0], 'onClick');
  assert.match(app.html, /<h1>2 open<\/h1>/, 'the store memo recomputed');
  assert.match(app.html, /class="card done"/, 'the kit class and the dynamic one merged');
  assert.match(app.html, /<h2>todo \(3\)<\/h2>/, 'still shown while hide is off');
  app.fire(app.find(n => n.tag === 'button' && /hide done/.test(n.text)), 'onClick');
  assert.match(app.html, /<h2>todo \(2\)<\/h2>/, 'Prefs drives the Column memo');
  assert.match(app.html, /show done/, 'the button label flipped');
});

test('the boundary catches one poisoned card and leaves the others alone', async () => {
  const { app } = await runProject(projectDir(BOARD));
  fill(app);
  const type = (name, text) => {
    const input = app.find(n => n.tag === 'input' && n.props.placeholder === `new in ${name}`);
    app.fire(input, 'onInput', { target: { value: text } });
    app.fire(app.all(n => n.tag === 'form').find(f => f.text.includes('add')), 'onSubmit');
  };
  type('todo', 'boom');
  assert.match(app.html, /card c4 is poison/, 'the fallback rendered in place of that row');
  assert.match(app.html, /ok:alpha/, 'its siblings still rendered');
  assert.match(app.html, /ok:gamma/);
  assert.match(app.html, /<h1>4 open<\/h1>/, 'the rest of the page is unharmed');
});

test('the filter memo and its dep-pinned effect', async () => {
  const { app, env } = await runProject(projectDir(BOARD));
  fill(app);
  app.fire(app.find(n => n.props.placeholder === 'filter'), 'onInput', { target: { value: 'ta' } });
  assert.match(app.html, /1 match/, 'beta only');
  assert.equal(env.document.title, 'search:ta', 'fx[q] ran on the new value');
  app.fire(app.find(n => n.props.placeholder === 'filter'), 'onInput', { target: { value: 'zzz' } });
  assert.match(app.html, /0 match/);
});

test('a :param route reads the store, and the catch-all handles the rest', async () => {
  const { app, env } = await runProject(projectDir(BOARD));
  fill(app);
  env.navigate('/card/c2');
  assert.match(app.html, /<h1>beta<\/h1>/, 'find(id) ran through the store');
  assert.equal(env.document.title, 'open:c2');
  app.fire(app.find(n => n.tag === 'button' && n.text === 'toggle'), 'onClick');
  env.navigate('/');
  assert.match(app.html, /<h1>2 open<\/h1>/, 'the toggle survived the navigation');
  env.navigate('/card/nope');
  assert.match(app.html, /no card nope/);
  env.navigate('/elsewhere');
  assert.match(app.html, /404 \/elsewhere/);
});
