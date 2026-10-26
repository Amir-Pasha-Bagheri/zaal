// Errors that name the line they came from, wherever in the compiler they were thrown.

// Every error names the line that caused it — `zaal/Home.zaal:7  message` plus the line itself —
// so the message alone is enough to fix the mistake, without reopening the file to hunt for it.
let AT = null;                         // the node being compiled, for throws deep inside codegen
const here = n => { AT = n; return n; };
const fail = (n, msg) => {
  const e = new Error(msg);
  e.ln = (typeof n === 'number' ? n : n?.ln) ?? AT?.ln;
  throw e;
};

// Stamp file and line onto an error on its way out of a source file.
function located(e, src, file) {
  if (e.at) return e;
  e.at = [file, e.ln].filter(Boolean).join(':');
  const line = e.ln && src.split('\n')[e.ln - 1];
  e.message = (e.at ? `${e.at}  ` : '') + e.message + (line ? `\n         ${e.ln} | ${line.trim()}` : '');
  return e;
}

// Run a compiler pass over one source file, so anything it throws points into that file.
const inFile = (src, file, f) => { try { return f(); } catch (e) { throw located(e, src, file); } };

export { here, fail, located, inFile };
