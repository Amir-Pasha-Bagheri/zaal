// The browser surface the generated app touches: localStorage (persisted stores), the hash
// location and hashchange listeners (the router), and document.documentElement.dataset +
// document.title (the Theme store's effect). Plus a container for createRoot().

import { mount, reset } from './tiny-react.mjs';

export function installEnv({ hash = '#/' } = {}) {
  const store = new Map();
  const listeners = new Map();

  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    __store: store,
  };

  const win = {
    location: { hash },
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
    },
    removeEventListener: (ev, fn) => listeners.get(ev)?.delete(fn),
    dispatch: ev => { for (const fn of listeners.get(ev) || []) fn(); },
    localStorage,
  };

  const container = { __render: null };
  const doc = {
    title: '',
    documentElement: { dataset: {} },
    getElementById: id => (container.id = id, container),
    addEventListener: win.addEventListener,
    removeEventListener: win.removeEventListener,
  };

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = localStorage;
  globalThis.navigator ??= { userAgent: 'zal-test' };

  // `go('/x')` sets window.location.hash; the router listens for 'hashchange'.
  const navigate = to => { win.location.hash = '#' + to.replace(/^#/, ''); win.dispatch('hashchange'); };

  let app = null;
  container.__render = element => { app = mount(element); };

  return {
    window: win, document: doc, localStorage, navigate,
    seed: (k, v) => store.set(k, JSON.stringify(v)),
    saved: k => JSON.parse(store.get(k) ?? 'null'),
    get app() { return app; },
    teardown() { reset(); delete globalThis.window; delete globalThis.document; delete globalThis.localStorage; },
  };
}
