// The browser surface the generated app touches: localStorage (persisted stores), the hash
// location and hashchange listeners (the router), and document.documentElement.dataset +
// document.title (the Theme store's effect). Plus a container for createRoot().

import { mount, reset } from './tiny-react.mjs';

// The canned PokéAPI the example talks to. `fetch` is part of the browser surface now: the
// test run has no network, so every request is answered from here (or rejected, to exercise the
// offline path a page falls back to).
const POKEMON = {
  results: [{ name: 'pikachu' }, { name: 'eevee' }, { name: 'snorlax' }],
  pikachu: { name: 'pikachu', stats: [
    { stat: { name: 'hp' }, base_stat: 35 }, { stat: { name: 'attack' }, base_stat: 55 }] },
};

const cannedFetch = url => {
  const path = String(url);
  if (/\/pokemon\?/.test(path)) return Promise.resolve({ ok: true, json: () => Promise.resolve(POKEMON.results && { results: POKEMON.results }) });
  const one = /\/pokemon\/([\w-]+)/.exec(path);
  if (one && POKEMON[one[1]]) return Promise.resolve({ ok: true, json: () => Promise.resolve(POKEMON[one[1]]) });
  if (one) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
  return Promise.reject(new Error(`no stub for ${path}`));
};

export function installEnv({ hash = '#/', fetch: fetchImpl = cannedFetch } = {}) {
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
  // What a `portal` renders into. The tiny renderer never touches a real node — it only has to
  // be able to tell one container from another — so a selector resolves to a stable stand-in.
  const hosts = new Map();
  const doc = {
    title: '',
    documentElement: { dataset: {} },
    body: { __node: 'body' },
    getElementById: id => (container.id = id, container),
    querySelector: sel => {
      if (!hosts.has(sel)) hosts.set(sel, { __node: sel });
      return hosts.get(sel);
    },
    addEventListener: win.addEventListener,
    removeEventListener: win.removeEventListener,
  };

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = localStorage;
  globalThis.navigator ??= { userAgent: 'zaal-test' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => fetchImpl(url, opts);
  globalThis.AbortController ??= class { constructor() { this.signal = {}; } abort() { this.aborted = true; } };

  // `go('/x')` sets window.location.hash; the router listens for 'hashchange'.
  const navigate = to => { win.location.hash = '#' + to.replace(/^#/, ''); win.dispatch('hashchange'); };

  let app = null;
  container.__render = element => { app = mount(element); };

  return {
    window: win, document: doc, localStorage, navigate, pokemon: POKEMON,
    seed: (k, v) => store.set(k, JSON.stringify(v)),
    saved: k => JSON.parse(store.get(k) ?? 'null'),
    get app() { return app; },
    teardown() {
      reset();
      globalThis.fetch = realFetch;
      delete globalThis.window; delete globalThis.document; delete globalThis.localStorage;
    },
  };
}
