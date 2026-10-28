// A structural check for the jsx backend's output, which nothing else in the suite parses:
// `node --check` only reads the esm modules, so a duplicate binding or an unescaped `<` in
// text reached the deliverable unnoticed. This is not a JSX parser — it is the subset of its
// grammar the compiler can get wrong, applied to every .jsx file the tests generate.

// Spans that are not code: strings, template literals, comments. Blanked out before scanning,
// so a `<` or a brace inside one never counts.
function blank(src) {
  let out = '', i = 0;
  // `from` is where the scan for `end` begins: past the opening quote for a string (so `""`
  // closes immediately), past `/*` for a comment.
  const skip = (from, end, esc) => {
    let j = from;
    for (; j < src.length; j++) {
      if (esc && src[j] === '\\') { j++; continue; }
      if (src.startsWith(end, j)) { j += end.length; break; }
    }
    out += ' '.repeat(Math.min(j, src.length) - i);
    i = Math.min(j, src.length);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { skip(i + 1, c, true); continue; }
    if (src.startsWith('//', i)) { skip(i + 2, '\n', false); continue; }
    if (src.startsWith('/*', i)) { skip(i + 2, '*/', false); continue; }
    out += c;
    i++;
  }
  return out;
}

const balanced = code => {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const c of code) {
    if ('([{'.includes(c)) stack.push(c);
    else if (pairs[c] && stack.pop() !== pairs[c]) return false;
  }
  return !stack.length;
};

// Every JSX tag in the file, read with brace awareness: a `>` inside `onClick={() => x}` is
// part of the attribute, not the end of the tag. Indices line up with the original source
// because `blank()` keeps the length of what it hides.
function tags(code, bare) {
  const out = [];
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] !== '<') continue;
    const close = bare[i + 1] === '/';
    let j = i + (close ? 2 : 1);
    const start = j;
    while (j < bare.length && /[\w$.:-]/.test(bare[j])) j++;
    const name = code.slice(start, j);
    // `<>` and `</>` are fragments — a tag whose name is empty, with the `>` right there. A `<`
    // with no name and no `>` after it is `a < b`. Without this an opening `<>` was not a tag at
    // all, so the text scan below read everything from the previous component's last tag up to
    // it as children, and reported the `<` it had just skipped.
    if (!close && !name && bare[j] !== '>') continue;           // `a < b`, not a fragment
    if (!close && name && !/^[A-Za-z_$]/.test(name)) continue;  // nor a tag
    let depth = 0;
    for (; j < bare.length; j++) {
      if ('{(['.includes(bare[j])) depth++;
      else if ('})]'.includes(bare[j])) depth--;
      else if (bare[j] === '>' && depth <= 0) break;
    }
    out.push({ name, close, self: bare[j - 1] === '/', attrs: code.slice(start + name.length, j), at: i, end: j });
    i = j;
  }
  return out;
}

export function checkJsx(code, where = 'module') {
  const problems = [];
  const bare = blank(code);
  if (!balanced(bare)) problems.push('brackets are not balanced');

  // A declaration may only appear once at module scope, and once per parameter list.
  const declared = new Map();
  for (const [, kind, name] of bare.matchAll(/^(?:export\s+)?(const|let|var|function|class)\s+([\w$]+)/gm)) {
    if (declared.has(name)) problems.push(`${name} is declared twice (${declared.get(name)} and ${kind})`);
    declared.set(name, kind);
  }
  for (const [, params] of code.matchAll(/function\s+[\w$]*\s*\(\{([^}]*)\}\)/g)) {
    const names = params.split(',').map(p => p.trim().split(/[:=]/)[0].replace('...', '').trim()).filter(Boolean);
    const seen = new Set();
    for (const n of names) {
      if (seen.has(n)) problems.push(`${n} is bound twice in one parameter list`);
      seen.add(n);
    }
  }

  // Tags balance, and no attribute is set twice.
  const stack = [];
  for (const t of tags(code, bare)) {
    if (t.close) {
      const open = stack.pop();                                 // `</>` closes a fragment
      if (open !== t.name) problems.push(`</${t.name}> closes <${open ?? 'nothing'}>`);
      continue;
    }
    if (!t.self) stack.push(t.name);
    if (!t.name) continue;                                      // `<>` carries no attributes
    const keys = [...t.attrs.matchAll(/(?:^|\s)([\w$:-]+)=/g)].map(a => a[1]);
    const twice = keys.find((k, i) => keys.indexOf(k) !== i);
    if (twice) problems.push(`<${t.name}> sets ${twice} twice`);
  }
  if (stack.length) problems.push(`<${stack[0]}> is never closed`);

  // What sits between two tags is children: text, and `{…}` expressions. A `<` there is not a
  // comparison — JSX reads it as the start of an element, which is a parse error.
  const found = tags(code, bare);
  for (let i = 0; i + 1 < found.length; i++) {
    const from = found[i].end + 1;          // the tag's own `>`, not one inside an attribute
    const between = bare.slice(from, found[i + 1].at);
    let depth = 0, text = '';
    for (const c of between) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (!depth) text += c;
    }
    if (text.includes('<')) problems.push(`text holds a bare \`<\`: ${JSON.stringify(text.trim())}`);
  }
  for (const [, inner] of code.matchAll(/>\s*\{([^{}]*)\}\s*</g)) {
    if (!inner.trim()) problems.push('an empty `{}` expression in children');
  }
  return problems.map(p => `${where}: ${p}`);
}
