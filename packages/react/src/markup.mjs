// Markup -> React elements, two ways: JSX for a bundler to compile, and createElement calls
// for the no-install preview to run as-is.
import { fail, attrParts, tmpl } from 'zaal';

// Kinds a fragment of one can collapse into; `if`/`map`/`slot` have to go through *Kids.
const PLAIN = new Set(['el', 'text', 'expr']);
const MARKUP = new Set(['el', 'text', 'expr', 'frag', 'if', 'map', 'slot']);

// `?a` · `:?b` · `:` — one chain of branches. Returns the chain and the index it consumed up to.
function chainOf(kids, i) {
  const chain = [kids[i]];
  while (kids[i + 1]?.kind === 'else') chain.push(kids[++i]);
  for (const [j, c] of chain.entries()) {
    if (!c.test && j !== chain.length - 1) fail(c, '`:` is the last branch — write `:?cond` to test again');
    checkBody(c);
  }
  return [chain, i];
}

// `?a` or `*xs as x` with nothing under it renders nothing at all — in practice the child is
// there but one indent short, which is worth saying rather than quietly emitting an empty node.
// The `*` line owns the key of what it renders, so a `key=` on one of its children would be a
// second key on the same element — one of the two silently dropped.
function checkKeys(map) {
  for (const kid of map.kids) {
    if (kid.kind === 'el' && (kid.attrs || []).some(a => a.startsWith('key='))) {
      fail(kid, `<${kid.tag}> already gets its key from the \`*\` line — drop the \`key=\``);
    }
  }
}

function checkBody(k) {
  if (k.kids.length) return;
  const head = k.kind === 'map' ? `*${k.list}` : k.test ? `?${k.test}` : ':';
  fail(k, `${head} has nothing under it — indent the markup it should render`);
}

function checkMarkup(k) {
  // A slot fills a prop, so it only means anything directly under a component. Anywhere else
  // it reached the element writer as a node with no tag and crashed there.
  if (k.kind === 'slot') {
    fail(k, `slot ${k.name}: a slot fills a prop on a component, so it has to sit directly under one`);
  }
  if (MARKUP.has(k.kind)) return;
  if (k.kind === 'else') fail(k, `\`${k.test ? ':?' + k.test : ':'}\` needs a \`?\` branch directly above it`);
  if (k.kind === 'hook' || k.kind === 'line') fail(k, 'hook lines must be direct children of `C`');
  fail(k, `\`${k.raw?.[0]}\` is a top-level line — it can't appear inside markup`);
}

// `slot x` fills a prop with markup, so it only means something on a component.
function slots(n) {
  const list = n.kids.filter(k => k.kind === 'slot');
  const seen = new Set();
  for (const sl of list) {
    if (!/^\p{Lu}/u.test(n.tag)) fail(sl, `slot ${sl.name}: <${n.tag}> is not a component`);
    if (!sl.kids.length) fail(sl, `slot ${sl.name}: nothing to pass`);
    if (seen.has(sl.name)) fail(sl, `slot ${sl.name} is filled twice — only the last would arrive`);
    seen.add(sl.name);
  }
  return list;
}

// `\{` -> a literal brace, which JSX can only say as an expression.
// `\{` is a literal brace — and so is any brace that does not pair into a `{expr}`: `a { b` is
// a JSX syntax error and `a {} b` silently renders nothing, while the esm backend prints both
// as the text they are. The two backends have to agree, so both are escaped here.
const jsxText = s => s.replace(/\\([{}])|\{[^{}]+\}|[{}<]|&[#\w]+;/g,
  (m, lit) => lit ? `{'${lit}'}`
    : m.length > 1 && m[0] === '{' ? m                      // a real `{expr}`, left alone
    : `{'${m}'}`);                                          // `{`, `}`, `<`, `&amp;` — text

function jsxKids(ctx, kids, ind) {
  const out = [], pad = ' '.repeat(ind);
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    checkMarkup(k);
    if (k.kind === 'if') {
      const [chain, j] = chainOf(kids, i);
      i = j;
      const arm = c => jsxNode(ctx, { kind: 'frag', kids: c.kids, root: true }, ind + 2);
      // `cond ? … : null`, never `cond && …`: React renders a falsy *number* (`?items.length`
      // with an empty list) as a stray `0`, and a test here is as often a count as a boolean.
      if (chain.length === 1) { out.push(`${pad}{${k.test} ? (\n${arm(k)}\n${pad}) : null}`); continue; }
      const tail = chain.at(-1).test ? null : chain.pop();
      let expr = tail ? `(\n${arm(tail)}\n${pad})` : 'null';
      for (const c of [...chain].reverse()) expr = `${c.test} ? (\n${arm(c)}\n${pad}) : ${expr}`;
      out.push(`${pad}{${expr}}`);
      continue;
    }
    if (k.kind === 'map') {
      checkBody(k);
      checkKeys(k);
      const body = jsxNode(ctx, { kind: 'frag', kids: k.kids }, ind + 2, k.key ?? 'i');
      out.push(`${pad}{${k.list}.map((${k.item}, i) => (\n${body}\n${pad}))}`);
      continue;
    }
    out.push(jsxNode(ctx, k, ind));
  }
  return out.join('\n');
}

function jsxNode(ctx, n, ind, key) {
  const pad = ' '.repeat(ind);
  if (n.kind === 'text') return pad + jsxText(n.value);
  if (n.kind === 'expr') return `${pad}{${n.code}}`;
  if (n.kind === 'frag') {
    // One child collapses into itself — but a key has to land somewhere, and only an element
    // can carry one: `*rows as r k=r.id` over a bare `{r.label}` needs the fragment. The same
    // holds in an expression position (`n.root`): `return ( {x} )` is an object literal, not JSX.
    if (n.kids.length === 1 && (key || n.root ? n.kids[0].kind === 'el' : PLAIN.has(n.kids[0].kind))) {
      return jsxNode(ctx, n.kids[0], ind, key);
    }
    const [open, close] = key ? [`<Fragment key={${key}}>`, '</Fragment>'] : ['<>', '</>'];
    return `${pad}${open}\n${jsxKids(ctx, n.kids, ind + 2)}\n${pad}${close}`;
  }
  const { pairs, spreads, text } = attrParts(ctx, n);
  const fills = slots(n);
  const rest = n.kids.filter(k => k.kind !== 'slot');
  const props = [];
  if (key) props.push(`key={${key}}`);
  for (const p of pairs) props.push(p.str ? `${p.k}="${p.v}"` : `${p.k}={${p.v}}`);
  for (const sl of fills) {
    props.push(`${sl.name}={${jsxNode(ctx, { kind: 'frag', kids: sl.kids, root: true }, ind + 2).trimStart()}}`);
  }
  for (const s of spreads) props.push(`{...${s}}`);
  const head = `<${n.tag}${props.length ? ' ' + props.join(' ') : ''}`;
  const kids = text.map(t => pad + '  ' + jsxText(t));
  const sub = jsxKids(ctx, rest, ind + 2);
  if (sub) kids.push(sub);
  if (!kids.length) return `${pad}${head} />`;
  if (kids.length === 1 && !rest.length) return `${pad}${head}>${kids[0].trim()}</${n.tag}>`;
  return `${pad}${head}>\n${kids.join('\n')}\n${pad}</${n.tag}>`;
}

// The esm backend calls `createElement` under a one-letter alias, which a component is free to
// use as a name of its own (`C Sparkline p:h=48` shadowed it). The alias steps aside when the
// source mentions the letter anywhere.
let EL = 'h', FRAG = 'F';
const aliases = src => {
  const free = n => (new RegExp(`(?<![\\p{L}\\p{N}_$])${n}(?![\\p{L}\\p{N}_$])`, 'u').test(src) ? '_' + n : n);
  EL = free('h'); FRAG = free('F');
};

// JSX reads consecutive text lines as one text node and collapses the newline between them
// into a single space, so `p` over `"total:"` and `"5 items"` renders `total: 5 items`.
// `createElement` would run them together, and the preview has to render what the build does.
function esmKids(ctx, kids, textAt = new Set()) {
  const out = [];
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    checkMarkup(k);
    if (k.kind === 'if') {
      const [chain, j] = chainOf(kids, i);
      i = j;
      const arm = c => esmNode(ctx, { kind: 'frag', kids: c.kids });
      // A lone `?` is `cond ? … : null`, exactly as the jsx backend writes it — the two
      // backends have to agree, including on what a falsy non-boolean renders.
      if (chain.length === 1) { out.push(`${k.test} ? ${arm(k)} : null`); continue; }
      const tail = chain.at(-1).test ? null : chain.pop();
      let expr = tail ? arm(tail) : 'null';
      for (const c of [...chain].reverse()) expr = `${c.test} ? ${arm(c)} : ${expr}`;
      out.push(expr);
      continue;
    }
    if (k.kind === 'map') {
      checkBody(k);
      checkKeys(k);
      out.push(`${k.list}.map((${k.item}, i) => ${esmNode(ctx, { kind: 'frag', kids: k.kids }, k.key ?? 'i')})`);
      continue;
    }
    out.push(esmNode(ctx, k), ...(k.kind === 'text' ? [] : []));
    if (k.kind === 'text') textAt.add(out.length - 1);
  }
  return out;
}

function esmNode(ctx, n, key) {
  if (n.kind === 'text') return tmpl(n.value);
  if (n.kind === 'expr') return n.code;
  if (n.kind === 'frag') {
    const k = spaced(ctx, n.kids);
    if (k.length === 1 && (!key || PLAIN.has(n.kids[0].kind))) return key ? withKey(k[0], key) : k[0];
    return `${EL}(${FRAG}, ${key ? `{ key: ${key} }` : 'null'}, ${k.join(', ')})`;
  }
  const { pairs, spreads, text } = attrParts(ctx, n);
  const fills = slots(n);
  const rest = n.kids.filter(k => k.kind !== 'slot');
  const entries = pairs.map(p => `${JSON.stringify(p.k)}: ${p.str ? JSON.stringify(p.v) : p.v}`);
  for (const sl of fills) entries.push(`${JSON.stringify(sl.name)}: ${esmNode(ctx, { kind: 'frag', kids: sl.kids })}`);
  if (key) entries.unshift(`key: ${key}`);
  const props = !spreads.length ? (entries.length ? `{ ${entries.join(', ')} }` : 'null')
    : !entries.length && spreads.length === 1 ? spreads[0]          // forwarding props, nothing else
    : `Object.assign({${entries.join(', ')}}, ${spreads.join(', ')})`;
  const tag = /^\p{Ll}/u.test(n.tag) && !n.tag.includes('.') ? JSON.stringify(n.tag) : n.tag;
  // Inline text (`p "a" "b"`) lands on its own line in JSX too, so it spaces the same way.
  const inline = text.map(tmpl);
  for (let i = inline.length - 1; i > 0; i--) inline.splice(i, 0, "' '");
  const after = spaced(ctx, rest);
  const kids = [...inline, ...(inline.length && rest[0]?.kind === 'text' ? ["' '"] : []), ...after];
  return `${EL}(${tag}, ${props}${kids.length ? ', ' + kids.join(', ') : ''})`;
}

// Children of one element, with a `' '` between two that came from text lines.
function spaced(ctx, kids) {
  const textAt = new Set();
  const out = esmKids(ctx, kids, textAt);
  for (let i = out.length - 1; i > 0; i--) {
    if (textAt.has(i) && textAt.has(i - 1)) out.splice(i, 0, "' '");
  }
  return out;
}

// Put a key into an element the backend has already written, or wrap what cannot take one.
const withKey = (expr, key) => {
  const m = new RegExp(`^${EL}\\((.+?), (null|\\{ ?)`).exec(expr);
  if (!m) return `${EL}(${FRAG}, { key: ${key} }, ${expr})`;
  const head = m[2] === 'null' ? `${EL}(${m[1]}, { key: ${key} }` : `${EL}(${m[1]}, { key: ${key}, `;
  return head + expr.slice(m[0].length);
};

export { jsxNode, esmNode, aliases, EL, FRAG };
