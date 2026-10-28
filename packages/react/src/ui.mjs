// ui.zaal -> CSS custom properties, base element rules and a UI kit. Plain CSS out, so every
// target shares one design system.
import { tokens, fail } from 'zaal';

// Dense property aliases. Anything not listed is passed through as plain CSS.
const PROP = { bg: 'background', fg: 'color', radius: 'border-radius', size: 'font-size',
  weight: 'font-weight', leading: 'line-height', font: 'font-family', shadow: 'box-shadow',
  w: 'width', h: 'height', maxw: 'max-width', minw: 'min-width', z: 'z-index',
  p: 'padding', px: 'padding-inline', py: 'padding-block',
  pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left',
  m: 'margin', mx: 'margin-inline', my: 'margin-block',
  mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left' };

// $group.name -> var(--group-name)
const tokenRef = v => v.replace(/\$([A-Za-z][\w-]*)\.([\w-]+)/g, (_, g, n) => `var(--${g}-${n})`);

const decl = (prop, value) => `  ${PROP[prop] || prop}: ${tokenRef(value)};`;

// indentation -> { head, rest, kids }, `//` comments stripped
function outline(src) {
  const root = { head: '', rest: [], kids: [] };
  const stack = [{ indent: -1, node: root }];
  // CRLF is normalised first, before any comment is stripped: `.` does not match `\r`, so
  // `//.*$` would fail to match at all on a CRLF line and leave the comment in place — a
  // whole-line one then reads as an unknown directive, and a trailing one as part of the value.
  for (const [i, raw] of src.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const line = raw.replace(/(^|\s)\/\/.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const tk = line.trim().split(/\s+/);
    const node = { head: tk[0], rest: tk.slice(1), kids: [], ln: i + 1 };
    stack.at(-1).node.kids.push(node);
    stack.push({ indent, node });
  }
  return root;
}

// A nested selector, not a declaration: no CSS property starts with any of these, so a line
// like `.dark &` or `> p` can only be a selector.
const isSel = h => /^[:&\[>.#*]/.test(h);

// A recipe body: own declarations, nested selectors (`:hover`, `& input`, `[data-x]`) and
// nested at-rules (`@media (max-width: 40rem)`), which wrap the rule they sit in.
function recipe(node) {
  const decls = [], nested = [], at = [];
  for (const k of node.kids) {
    if (k.head === 'v') continue;                                  // variants handled by caller
    if (k.head.startsWith('@')) { at.push({ query: [k.head, ...k.rest].join(' '), ...recipe(k) }); continue; }
    if (isSel(k.head)) { nested.push({ sel: [k.head, ...k.rest].join(' '), ...recipe(k) }); continue; }
    decls.push([k.head, k.rest.join(' ')]);
  }
  return { decls, nested, at };
}

// `k <class> [tag]` + its `v` variants. Both the top level and an at-rule block hold these.
function kitEntry(n, ui) {
  const name = n.rest[0];
  const variants = n.kids.filter(k => k.head === 'v').map(k => ({ name: k.rest[0], ...recipe(k) }));
  ui.known.add(name);
  for (const v of variants) ui.known.add(v.name);
  return { name, el: n.rest[1] || 'div', ...recipe(n), variants };
}

// An at-rule holds rules rather than declarations: `k`/`e` keep their meaning inside it, and
// anything else is the selector it reads as — a keyframe step (`from`, `50%`) or a bare selector.
function atBlock(n, ui) {
  const parts = [];
  for (const k of n.kids) {
    if (k.head === 'k') { const e = kitEntry(k, ui); parts.push({ sel: '.' + e.name, body: e }); continue; }
    if (k.head === 'e') { parts.push({ sel: k.rest.join(' '), body: recipe(k) }); continue; }
    parts.push({ sel: [k.head, ...k.rest].join(' '), body: recipe(k) });
  }
  return { query: [n.head, ...n.rest].join(' '), parts };
}

// Every `$group.name` a recipe uses, and every `group.name` a scheme overrides, has to be a
// token some `t` group declared. Otherwise it compiles to a `var()` that resolves to nothing —
// a silently unstyled rule, which no stylesheet will ever complain about.
function checkTokens(ui) {
  const have = new Set(ui.tokens.flatMap(t => t.vars.map(([n]) => `${t.group}.${n}`)));
  const seen = new Set();
  const used = v => [...String(v).matchAll(/\$([A-Za-z][\w-]*)\.([\w-]+)/g)].map(m => `${m[1]}.${m[2]}`);
  const note = (ref, where) => {
    if (have.has(ref) || seen.has(ref + where)) return;
    seen.add(ref + where);
    ui.warnings.push(`ui: ${where} uses $${ref}, which no \`t\` group declares`);
  };
  const body = (b, where) => {
    for (const [, v] of b.decls || []) for (const ref of used(v)) note(ref, where);
    for (const n of b.nested || []) body(n, where);
    for (const a of b.at || []) body(a, where);
    for (const v of b.variants || []) body(v, where);
  };
  for (const t of ui.tokens) for (const [, v] of t.vars) for (const ref of used(v)) note(ref, `t ${t.group}`);
  for (const e of ui.elements) body(e, `e ${e.sel}`);
  for (const k of Object.values(ui.kit)) body(k, `k ${k.name}`);
  for (const a of ui.at || []) for (const part of a.parts) body(part.body, a.query);
  for (const sc of ui.schemes) {
    for (const [n, v] of sc.vars) {
      const ref = n.replace('-', '.');
      if (!have.has(ref)) {
        ui.warnings.push(`ui: scheme ${sc.name} sets ${ref}, which no \`t\` group declares`);
      }
      for (const r of used(v)) note(r, `scheme ${sc.name}`);
    }
  }
}

function parseUI(src) {
  const ui = { name: null, tokens: [], schemes: [], elements: [], kit: {}, at: [], raw: [],
    known: new Set(), warnings: [] };
  for (const n of outline(src).kids) {
    if (n.head === 'D') { ui.name = n.rest[0] ?? 'design'; continue; }
    if (n.head === 't') {
      ui.tokens.push({ group: n.rest[0], vars: n.kids.map(k => [k.head, k.rest.join(' ')]) });
      continue;
    }
    if (n.head === 'scheme') {
      ui.schemes.push({ name: n.rest[0], vars: n.kids.map(k => [k.head.replace('.', '-'), k.rest.join(' ')]) });
      continue;
    }
    if (n.head === 'e') { ui.elements.push({ sel: n.rest.join(' '), ...recipe(n) }); continue; }
    if (n.head === 'k') {
      const k = kitEntry(n, ui);
      if (ui.kit[k.name]) fail(n, `ui: \`k ${k.name}\` is declared twice — the first recipe would be lost`);
      ui.kit[k.name] = k;
      continue;
    }
    // `@media …`, `@supports …`, `@keyframes …` — a block of whole rules, not of declarations.
    if (n.head.startsWith('@')) { ui.at.push(atBlock(n, ui)); continue; }
    if (n.head === 'css') { ui.raw.push([n.head, ...n.rest].join(' ').slice(4)); continue; }
    fail(n, `ui: unknown directive \`${n.head}\``);
  }
  for (const e of ui.elements) for (const c of e.sel.match(/\.[\w-]+/g) || []) ui.known.add(c.slice(1));
  checkTokens(ui);
  return ui;
}

const rule = (sel, body) => body.decls.length
  ? [`${sel} {`, ...body.decls.map(([p, v]) => decl(p, v)), '}'].join('\n') : '';

const wrap = (query, inner) => `${query} {\n${inner.join('\n\n').replace(/^(?!$)/gm, '  ')}\n}`;

// A recipe's own rule plus every nested selector, `&` standing for the parent, plus every
// at-rule nested in it — which wraps the same selector in the query it names.
function rules(sel, body) {
  const out = [rule(sel, body)];
  for (const n of body.nested || []) {
    out.push(...rules(n.sel.includes('&') ? n.sel.replace(/&/g, sel) : sel + n.sel, n));
  }
  for (const a of body.at || []) {
    const inner = rules(sel, a);
    if (inner.length) out.push(wrap(a.query, inner));
  }
  return out.filter(Boolean);
}

function uiCss(ui) {
  const out = [`/* ${ui.name || 'design system'} — tokens, base elements and the UI kit */`];
  const root = ui.tokens.flatMap(t => t.vars.map(([n, v]) => `  --${t.group}-${n}: ${tokenRef(v)};`));
  out.push([':root {', '  color-scheme: light dark;', ...root, '}'].join('\n'));
  for (const s of ui.schemes) {
    const vars = s.vars.map(([n, v]) => `  --${n}: ${tokenRef(v)};`).join('\n');
    // The OS preference applies unless the page asked for the other mode by hand.
    const other = s.name === 'dark' ? 'light' : 'dark';
    out.push(`@media (prefers-color-scheme: ${s.name}) {\n  :root:not([data-theme="${other}"]) {\n${vars.replace(/^/gm, '  ')}\n  }\n}`);
    out.push(`:root[data-theme="${s.name}"] {\n${vars}\n}`);
  }
  for (const e of ui.elements) out.push(...rules(e.sel, e));
  for (const k of Object.values(ui.kit)) {
    out.push(...rules('.' + k.name, k));
    for (const v of k.variants) out.push(...rules(`.${k.name}.${v.name}`, v));
  }
  for (const a of ui.at || []) {
    const inner = a.parts.flatMap(p => [...rules(p.sel, p.body),
      ...(p.body.variants || []).flatMap(v => rules(`${p.sel}.${v.name}`, v))]);
    if (inner.length) out.push(wrap(a.query, inner));
  }
  out.push(...ui.raw);
  return out.filter(Boolean).join('\n\n') + '\n';
}

export { parseUI, uiCss, PROP, tokenRef };
