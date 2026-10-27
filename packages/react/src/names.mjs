// React's own vocabulary: what is in scope on sight, which packages the target provides
// itself, and the versions a generated project pins.

const REACT_V = '19.1.0';

// React lives in the import map at the version app.zaal pins, so a package must borrow it rather
// than ship its own copy — two Reacts on a page means every hook throws.
const EXTERNAL = '?external=react,react-dom';
const BUILTIN = /^(react|react-dom)$/;

// The versions `application/` is scaffolded with.
const VITE_V = '^5.4.0', PLUGIN_V = '^4.3.1';

// React's own hooks are imported on sight, however they got into the body; a custom hook
// (anything not listed) still needs an `i` import line.
// React's own components, and the router's exports: in scope on sight, the way `Link` already is.
const REACT_COMPS = ['Suspense', 'StrictMode', 'Profiler'];
const ROUTER_EXPORTS = ['Link', 'go', 'useRoute', 'useQuery'];

const REACT_HOOKS = ['useState', 'useEffect', 'useLayoutEffect', 'useMemo', 'useCallback', 'useRef',
  'useContext', 'useReducer', 'useId', 'useTransition', 'useDeferredValue', 'useOptimistic',
  'useActionState', 'useSyncExternalStore', 'useImperativeHandle', 'useDebugValue'];

export { REACT_V, EXTERNAL, BUILTIN, VITE_V, PLUGIN_V, REACT_COMPS, ROUTER_EXPORTS, REACT_HOOKS };
