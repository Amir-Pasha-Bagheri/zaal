// Markup -> React elements, two ways: JSX for a bundler to compile, and createElement calls
// for the no-install preview to run as-is.
import { fail, attrParts, textParts, tmpl, interp, JSX_TAG } from 'zaal';

// Kinds a fragment of one can collapse into; `if`/`map`/`slot` have to go through *Kids.
const PLAIN = new Set(['el', 'text', 'expr']);
const MARKUP = new Set(['el', 'text', 'expr', 'frag', 'if', 'map', 'slot', 'portal', 'provide']);
// What may stand alone where a key or an expression has to land: an element carries a key as a
// prop, and `createPortal` takes one as its third argument. A `provide` is an element too —
// `<NameContext.Provider>` — so it carries one the ordinary way.
const KEYED = new Set(['el', 'portal', 'provide']);

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
  const head = k.kind === 'map' ? `*${k.list}`
    : k.kind === 'portal' ? 'portal'
    : k.kind === 'provide' ? `provide ${k.name}` : k.test ? `?${k.test}` : ':';
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
  // `ret` is a real line, just not one a component has: a component returns its markup.
  if (k.kind === 'ret') fail(k, '`ret` belongs in an `H` block — a `C` block returns its markup');
  fail(k, `\`${k.raw?.[0]}\` is a top-level line — it can't appear inside markup`);
}

// A `provide` line is `<NameContext.Provider value={…}>` and nothing more. The value is an
// *expression* the way a hook line's is, not an attribute value: `provide Box = { v }` is an
// object literal, and the attribute path would read those braces as the `k={expr}` habit and
// unwrap them — handing descendants `v` itself instead of `{ v: v }`. So the provider is
// written out here rather than desugared into an element, and both backends write it the same.
const providerTag = n => `${n.name}Context.Provider`;

// A provider has one prop and it is the value the line already gives, so a `slot` under it
// would land a prop React's Provider does not read.
function checkProvide(n) {
  checkBody(n);
  const sl = n.kids.find(k => k.kind === 'slot');
  if (sl) {
    fail(sl, `slot ${sl.name}: \`provide ${n.name}\` passes one value, the one on its own line`
      + ' — a slot fills a prop on a component');
  }
}

// `slot x` fills a prop with markup, so it only means something on a component.
function slots(n) {
  const list = n.kids.filter(k => k.kind === 'slot');
  const seen = new Set();
  for (const sl of list) {
    // a dynamic tag may be a component — only a tag written out as a lower-case name cannot be
    if (!n.dyn && !/^\p{Lu}/u.test(n.tag)) fail(sl, `slot ${sl.name}: <${n.tag}> is not a component`);
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

// JSX names a tag; it cannot hold an expression. `<Tag>` and `<icons.Star>` are names it can
// write, so a dynamic tag that reads as one stays ordinary JSX. Anything else — a prop (`{as}`),
// a ternary, a call — goes through `createElement`, which is what the `const Tag = as` a
// hand-written polymorphic component opens with is for. The call is an expression, so in a
// children position it needs the braces an element does not.
const namesTag = n => n.kind !== 'portal' && (!n.dyn || JSX_TAG.test(n.tag));

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
    const one = jsxNode(ctx, k, ind);
    out.push(namesTag(k) ? one : `${pad}{${one.trimStart()}}`);
  }
  return out.join('\n');
}

// The props of a `createElement` call the jsx backend writes: the same pairs and slot fills an
// element would carry, as an object's entries. A slot's markup is still JSX.
function callEntries(ctx, pairs, fills, key, ind) {
  const entries = pairs.map(p => `${JSON.stringify(p.k)}: ${p.str ? JSON.stringify(p.v) : p.v}`);
  for (const sl of fills) {
    entries.push(`${JSON.stringify(sl.name)}: `
      + jsxNode(ctx, { kind: 'frag', kids: sl.kids, root: true }, ind + 2).trimStart());
  }
  if (key) entries.unshift(`key: ${key}`);
  return entries;
}

function jsxNode(ctx, n, ind, key) {
  const pad = ' '.repeat(ind);
  if (n.kind === 'provide') {
    checkProvide(n);
    const tag = providerTag(n), k = key ? ` key={${key}}` : '';
    return `${pad}<${tag}${k} value={${interp(n.expr)}}>\n`
      + `${jsxKids(ctx, n.kids, ind + 2)}\n${pad}</${tag}>`;
  }
  if (n.kind === 'text') return pad + jsxText(n.value);
  if (n.kind === 'expr') return `${pad}{${n.code}}`;
  // `createPortal(markup, target)` — React's own call, with the key (if any) as its third
  // argument. It is an expression, so jsxKids puts it in braces where a child needs them.
  if (n.kind === 'portal') {
    checkBody(n);
    const kids = jsxNode(ctx, { kind: 'frag', kids: n.kids, root: true }, ind + 2);
    const third = key ? `,\n${pad}  ${key}` : '';
    return `${pad}createPortal(\n${kids},\n${pad}  ${n.target}${third}\n${pad})`;
  }
  if (n.kind === 'frag') {
    // One child collapses into itself — but a key has to land somewhere, and only an element
    // can carry one: `*rows as r k=r.id` over a bare `{r.label}` needs the fragment. The same
    // holds in an expression position (`n.root`): `return ( {x} )` is an object literal, not JSX.
    if (n.kids.length === 1 && (key || n.root ? KEYED.has(n.kids[0].kind) : PLAIN.has(n.kids[0].kind))) {
      return jsxNode(ctx, n.kids[0], ind, key);
    }
    const [open, close] = key ? [`<Fragment key={${key}}>`, '</Fragment>'] : ['<>', '</>'];
    return `${pad}${open}\n${jsxKids(ctx, n.kids, ind + 2)}\n${pad}${close}`;
  }
  const { pairs, spreads, text } = attrParts(ctx, n);
  const fills = slots(n);
  const rest = n.kids.filter(k => k.kind !== 'slot');
  if (!namesTag(n)) {
    // The children are one fragment argument rather than a list: `?`/`*` arrive from jsxKids
    // already wrapped in the braces a JSX child needs, which an argument may not have.
    const kids = [...text.map(value => ({ kind: 'text', value })), ...rest];
    const props = propsArg(callEntries(ctx, pairs, fills, key, ind), spreads);
    // One text or expression child is an argument as it stands — `createElement(as, props,
    // children)`, which is what the wrapper this feature exists for renders.
    if (kids.length === 1 && (kids[0].kind === 'text' || kids[0].kind === 'expr')) {
      const only = kids[0].kind === 'expr' ? [kids[0].code] : textParts(kids[0].value).map(x => x.code);
      return `${pad}createElement(${n.tag}, ${props}, ${only.join(', ')})`;
    }
    const arg = kids.length
      ? `,\n${jsxNode(ctx, { kind: 'frag', kids, root: true }, ind + 2)}\n${pad}` : '';
    return `${pad}createElement(${n.tag}, ${props}${arg})`;
  }
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
function esmKids(ctx, kids, starts = new Set(), ends = new Set()) {
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
    if (k.kind === 'text') {
      // One text node, but React sees each `{expr}` as a child of its own.
      const parts = textParts(k.value);
      if (parts[0].lit) starts.add(out.length);
      out.push(...parts.map(p => p.code));
      if (parts.at(-1).lit) ends.add(out.length - 1);
      continue;
    }
    out.push(esmNode(ctx, k));
  }
  return out;
}

function esmNode(ctx, n, key) {
  if (n.kind === 'provide') {
    checkProvide(n);
    const kids = spaced(ctx, n.kids);
    const props = `{ ${key ? `key: ${key}, ` : ''}value: ${interp(n.expr)} }`;
    return `${EL}(${providerTag(n)}, ${props}${kids.length ? ', ' + kids.join(', ') : ''})`;
  }
  if (n.kind === 'portal') {
    checkBody(n);
    const kids = esmNode(ctx, { kind: 'frag', kids: n.kids });
    return `createPortal(${kids}, ${n.target}${key ? `, ${key}` : ''})`;
  }
  if (n.kind === 'text') {
    const parts = textParts(n.value).map(p => p.code);
    return parts.length === 1 ? parts[0] : `${EL}(${FRAG}, null, ${parts.join(', ')})`;
  }
  if (n.kind === 'expr') return n.code;
  if (n.kind === 'frag') {
    // A lone portal carries the key itself — `createPortal`'s third argument — rather than
    // standing inside a keyed fragment, so both backends write one keyed portal per item.
    if (n.kids.length === 1 && n.kids[0].kind === 'portal') return esmNode(ctx, n.kids[0], key);
    const k = spaced(ctx, n.kids);
    // What can carry the key itself, rather than stand inside a keyed fragment — the same set
    // the jsx backend collapses into, or the two write different trees for one `*` line.
    if (k.length === 1 && (!key || KEYED.has(n.kids[0].kind))) return key ? withKey(k[0], key) : k[0];
    return `${EL}(${FRAG}, ${key ? `{ key: ${key} }` : 'null'}, ${k.join(', ')})`;
  }
  const { pairs, spreads, text } = attrParts(ctx, n);
  const fills = slots(n);
  const rest = n.kids.filter(k => k.kind !== 'slot');
  const entries = pairs.map(p => `${JSON.stringify(p.k)}: ${p.str ? JSON.stringify(p.v) : p.v}`);
  for (const sl of fills) entries.push(`${JSON.stringify(sl.name)}: ${esmNode(ctx, { kind: 'frag', kids: sl.kids })}`);
  if (key) entries.unshift(`key: ${key}`);
  const props = propsArg(entries, spreads);
  // A dynamic tag is the expression as written; a static one is a string for a DOM tag and the
  // name itself for a component or a member.
  const tag = n.dyn ? n.tag
    : /^\p{Ll}/u.test(n.tag) && !n.tag.includes('.') ? JSON.stringify(n.tag) : n.tag;
  // Inline text (`p "a" "b"`) lands on its own line in JSX too, so it spaces the same way.
  // Inline text (`p "a" "b"`) lands on its own line in JSX too, and spaces by the same rule.
  const inline = [];
  let prevLit = false;
  for (const t of text) {
    const parts = textParts(t);
    if (inline.length && prevLit && parts[0].lit) inline.push("' '");
    inline.push(...parts.map(p => p.code));
    prevLit = parts.at(-1).lit;
  }
  const after = spaced(ctx, rest);
  const join = inline.length && prevLit && rest[0]?.kind === 'text'
    && textParts(rest[0].value)[0].lit ? ["' '"] : [];
  const kids = [...inline, ...join, ...after];
  return `${EL}(${tag}, ${props}${kids.length ? ', ' + kids.join(', ') : ''})`;
}

// The second argument of a `createElement` call: the props, whatever they came from.
const propsArg = (entries, spreads) => !spreads.length
  ? (entries.length ? `{ ${entries.join(', ')} }` : 'null')
  : !entries.length && spreads.length === 1 ? spreads[0]            // forwarding props, nothing else
  : `Object.assign({${entries.join(', ')}}, ${spreads.join(', ')})`;

// Children of one element, with a `' '` between two that came from text lines.
function spaced(ctx, kids) {
  const starts = new Set(), ends = new Set();
  const out = esmKids(ctx, kids, starts, ends);
  // The space comes from a newline *inside one JSXText node*, so it appears only where two
  // text lines actually touch: the first has to end in literal text and the second begin with
  // it. `"ok {n}"` above `"total"` is two text nodes in JSX, and renders with no space.
  for (let i = out.length - 1; i > 0; i--) {
    if (starts.has(i) && ends.has(i - 1)) out.splice(i, 0, "' '");
  }
  return out;
}

// Where the top-level arguments of a `h(…)` call start. Read with bracket awareness: a tag
// expression is an expression like any other, and `h(f(r, null, 1), null, …)` holds both a
// comma and a `null` that belong to it, not to the call.
function argSpans(expr) {
  const open = `${EL}(`;
  if (!expr.startsWith(open) || !expr.endsWith(')')) return null;
  const out = [];
  let depth = 0, q = null, from = open.length;
  for (let i = open.length; i < expr.length; i++) {
    const c = expr[i];
    if (q) { if (c === q && expr[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (!depth && c === ')') { out.push([from, i]); break; }      // the call's own closer
      depth--;
    }
    else if (c === ',' && !depth) { out.push([from, i]); from = i + 1; }
  }
  return out.length > 1 ? out : null;
}

// Put a key into an element the backend has already written, or wrap what cannot take one.
const withKey = (expr, key) => {
  const spans = argSpans(expr);
  const at = spans?.[1];
  const props = at && expr.slice(at[0], at[1]).trim();
  const put = text => expr.slice(0, at[0]) + text + expr.slice(at[1]);
  if (props === 'null') return put(` { key: ${key} }`);
  // `{ a: 1 }` -> `{ key: k, a: 1 }`, and `{}`/`{ }` -> `{ key: k }`
  if (props?.startsWith('{')) {
    const body = props.slice(1, -1).trim();
    return put(` { key: ${key}${body ? `, ${body}` : ''} }`);
  }
  return `${EL}(${FRAG}, { key: ${key} }, ${expr})`;
};

export { jsxNode, esmNode, aliases, EL, FRAG };
