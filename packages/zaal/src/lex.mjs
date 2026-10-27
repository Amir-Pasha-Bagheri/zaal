// Split a .zaal line into tokens.

// Split a line on spaces, ignoring spaces inside "" or ()[]{}. A `{…}` inside a string is an
// interpolated expression, and the quotes in it belong to that expression, not to the string:
// `"{mode == "dark" ? "a" : "b"}"` is one token.
function tokens(line) {
  const out = [];
  let buf = '', depth = 0, q = false, brace = 0, inner = false, plain = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const lit = line[i - 1] === '\\';
    // `'…'` and `` `…` `` have no interpolation of their own, but their spacing is content:
    // `log('a  b')` must keep both spaces.
    if (plain) {
      buf += c;
      if (c === plain && !lit) plain = '';
      continue;
    }
    if (q) {
      buf += c;
      if (inner) { if (c === '"' && !lit) inner = false; continue; }
      if (c === '{' && !lit) brace++;
      else if (c === '}' && !lit) brace = Math.max(0, brace - 1);
      else if (c === '"' && !lit) { if (brace) inner = true; else q = false; }
      continue;
    }
    if (c === '"') { q = true; brace = 0; buf += c; continue; }
    if (c === "'" || c === '`') { plain = c; buf += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ' ' && depth === 0) { if (buf) out.push(buf); buf = ''; continue; }
    buf += c;
  }
  if (buf) out.push(buf);
  return out;
}

export { tokens };
