// The fenced code blocks of SPEC.md and README.md, classified by what they are.
//
// The documentation is the contract: every Zaal snippet in it is a promise that the compiler
// accepts that shape, and every `js`/`jsx` block right after one is a promise about what it
// writes. Nothing checked either, so the spec could drift from the compiler in silence — and a
// reader following a stale example gets a build error instead of a page.
import { readFileSync } from 'node:fs';

const DOC = name => new URL(`../../${name}`, import.meta.url).pathname;

// A block is `lang` (empty for the Zaal ones — Zaal has no highlighter) plus its body, in
// document order, so a snippet and the output printed below it stay neighbours.
export function blocks(file) {
  const md = readFileSync(DOC(file), 'utf8');
  return [...md.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)]
    .map((m, i) => ({ at: i, file, lang: m[1], body: m[2], kind: classify(m[1], m[2]) }));
}

// Prose blocks that are not source: a shell transcript, the directory tree, the control-flow
// table written as `?cond → …`. Recognised by what they hold rather than by position, so
// inserting a paragraph never silently drops a snippet from the sweep.
const PROSE = [
  /[├└│─]/,               // the directory tree
  /→/,                    // a table of equivalences, not a program
  /^\s*(npm|npx|cd|zaal\/)/, // a shell transcript, or the project layout
];

// What the first line says the block is. A Zaal block's head letter is the whole grammar:
// `C`/`S`/`H` a block, `i`/`js` a module line, `A` an app declaration, `D`/`t`/`k`/`e`/`scheme`
// a design system. Anything else that still looks like markup is a fragment — the spec shows
// plenty of those, a few lines of a component's body with the `C` line left off.
function classify(lang, body) {
  if (lang) return lang === 'js' || lang === 'jsx' ? 'output' : 'other';
  const lines = body.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
  const first = lines[0] ?? '';
  if (PROSE.some(re => re.test(body))) return 'prose';
  if (/^(C|S|H|i|js)\s/.test(first)) return 'module';
  if (/^A\s/.test(first)) return 'app';
  if (/^(D|t|k|e|scheme|css|@)\s/.test(first)) return 'ui';
  // markup is what is left that could be a line of a component body
  if (/^[A-Za-z%.#{?*:]/.test(first)) return 'markup';
  return 'other';
}

// The scope the spec's fragments are written against. The prose says what is imported and what
// the design system holds; this is that, spelled out, so a snippet is checked as the language
// rather than as a project. A new `%entry` or a new component in the spec fails here first,
// which is the right place to be told the example needs scope the test does not give it.
export const KIT = `D Spec
k card section
k counter
k hint
k scrim
k tablist
k tab button
k btn button
`;

// Components the spec's fragments name without showing the `i` line, and the stores and hooks
// its prose says are reachable.
// (`Link` is not here: the router's exports are in scope for free, which is itself one of the
// promises these snippets make.)
export const KNOWN = {
  comps: ['Panel', 'Card', 'Item', 'Tab', 'Row', 'Dialog'],
  stores: ['Todos', 'Theme'],
  hooks: ['useCounter'],
};

// A markup fragment becomes a component, with the imports the prose promised above it.
export const asModule = body => KNOWN.comps.map(c => `i ${c} ./${c}`).join('\n')
  + '\nC Spec\n' + body.replace(/^(?=.)/gm, '  ');
