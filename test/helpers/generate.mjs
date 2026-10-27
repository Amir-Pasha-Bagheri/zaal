// A generator of small, valid Zaal components, for differential testing. Every shape it emits
// is one the language documents; the point is the combinations, which no hand-written suite
// enumerates. Seeded, so a failure is reproducible from its number alone.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAGS = ['div', 'span', 'p', 'b', 'section', 'em', 'small'];
const VOID = ['br', 'hr', 'img', 'input'];
// Values whose rendering differs between React's children rules and plain string building:
// a boolean, null or undefined renders as nothing, 0 renders as "0".
const EXPRS = ['n', 'label', 'flag', 'items.length', 'n - 3', 'n > 1', 'null', 'undefined',
  '""', '0', 'flag && label', 'n > 1 ? "yes" : ""', 'items[0].t'];
const CLASSES = ['card', 'row', 'hint', 'wide'];
const WORDS = ['alpha', 'beta', 'gamma', 'total', 'items', 'ok', 'no'];

// Names the generated component always has in scope.
const STATE = [
  's:n=3', 's:flag=true', 's:label="hi"',
  's:items=[{id:1,t:"a"},{id:2,t:"b"},{id:3,t:"c"}]',
];
const SCALARS = ['n', 'label', 'flag'];
const TESTS = ['flag', 'n > 1', 'n == 0', 'items.length', 'label == "hi"'];

export function generate(seed) {
  const r = rng(seed);
  const pick = xs => xs[Math.floor(r() * xs.length)];
  const chance = p => r() < p;

  const text = (vars) => {
    const parts = [];
    for (let i = 0; i < 1 + Math.floor(r() * 2); i++) {
      parts.push(pick(WORDS));
      if (chance(0.5)) parts.push(`{${pick(vars)}}`);
    }
    return `"${parts.join(' ')}"`;
  };

  const attrs = (vars) => {
    const out = [];
    if (chance(0.3)) out.push(`title=${text(vars)}`);
    if (chance(0.2)) out.push(`data-k=${pick([...vars, ...EXPRS])}`);
    if (chance(0.1)) out.push(`aria-label="{${pick(vars)}}"`);
    if (chance(0.15)) out.push('hidden');
    if (chance(0.2)) out.push(`c="${pick(CLASSES)}"`);
    return out.length ? ' ' + out.join(' ') : '';
  };

  // one markup line plus its children, at `indent`
  const node = (indent, depth, vars) => {
    const pad = '  '.repeat(indent);
    const kind = depth <= 0 ? pick(['text', 'expr', 'el', 'void'])
      : pick(['el', 'el', 'text', 'expr', 'if', 'map', 'void', 'comp']);

    if (kind === 'text') return `${pad}${text(vars)}\n`;
    if (kind === 'expr') return `${pad}{${pick([...vars, ...EXPRS])}}\n`;
    if (kind === 'void') return `${pad}${pick(VOID)}${attrs(vars)}\n`;
    if (kind === 'comp') {
      const key = chance(0.5) ? ` k=x.id` : '';
      return `${pad}*items as x${key}\n${'  '.repeat(indent + 1)}Item t=x.t n=${pick(['n', '1', 'items.length'])}\n`;
    }

    if (kind === 'if') {
      const arms = 1 + Math.floor(r() * 3);
      let out = `${pad}?${pick(TESTS)}\n` + kids(indent + 1, depth - 1, vars, 1);
      for (let i = 1; i < arms; i++) out += `${pad}:?${pick(TESTS)}\n` + kids(indent + 1, depth - 1, vars, 1);
      if (chance(0.6)) out += `${pad}:\n` + kids(indent + 1, depth - 1, vars, 1);
      return out;
    }

    if (kind === 'map') {
      const key = chance(0.7) ? ' k=x.id' : '';
      return `${pad}*items as x${key}\n` + kids(indent + 1, depth - 1, [...vars, 'x.t', 'x.id'], 1);
    }

    const tag = pick(TAGS) + (chance(0.3) ? '.' + pick(CLASSES) : '');
    const inline = chance(0.3) ? ' ' + text(vars) : '';
    const head = `${pad}${tag}${attrs(vars)}${inline}\n`;
    return head + (inline ? '' : kids(indent + 1, depth - 1, vars, Math.floor(r() * 3)));
  };

  const kids = (indent, depth, vars, least = 0) => {
    const count = Math.max(least, Math.floor(r() * 3));
    let out = '';
    for (let i = 0; i < count; i++) out += node(indent, depth, vars);
    return out || `${'  '.repeat(indent)}${text(vars)}\n`;
  };

  // every generated component declares the same state, so the markup is the only variable
  const vars = [...SCALARS];
  // a child component, so the generated tree is not all host elements
  const item = `C Item p:t p:n=0\n  span.item\n    "{t}"\n    ?n > 1\n      b "{n}"\n`;
  const head = `${item}C App ${STATE.join(' ')}\n`;
  const roots = 1 + Math.floor(r() * 2);
  let body = '';
  for (let i = 0; i < roots; i++) body += node(1, 2 + Math.floor(r() * 2), vars);
  return head + body;
}
