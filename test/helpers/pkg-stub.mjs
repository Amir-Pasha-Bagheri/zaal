// Stands in for any npm package an `i` line names, so a generated module can be imported with
// nothing installed. Calls are recorded on globalThis.__pkgCalls.
globalThis.__pkgCalls ??= [];

const spy = name => Object.assign((...args) => { globalThis.__pkgCalls.push([name, args]); }, { $$spy: name });

export default spy('default');
export const motion = new Proxy({}, { get: (_, k) => `motion.${String(k)}` });
export const Line = spy('Line');
export const Chart = spy('Chart');
