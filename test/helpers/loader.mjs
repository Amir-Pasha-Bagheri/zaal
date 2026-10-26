// Point every bare `react*` specifier the generated modules use at the tiny React in this
// folder, so a build's output can be imported and run with nothing installed.
import { registerHooks } from 'node:module';

const TINY = new URL('./tiny-react.mjs', import.meta.url).href;
const STUB = new URL('./pkg-stub.mjs', import.meta.url).href;
const REACT = /^react(-dom)?(\/.*)?$/;
const LOCAL = /^(\.|\/|node:|data:|file:)/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (REACT.test(specifier)) return { url: TINY, shortCircuit: true, format: 'module' };
    // Any other bare specifier is an npm package the preview would fetch from a CDN; the test
    // run has no network and no node_modules, so it gets a recording stub.
    if (!LOCAL.test(specifier)) return { url: STUB, shortCircuit: true, format: 'module' };
    return nextResolve(specifier, context);
  },
});
