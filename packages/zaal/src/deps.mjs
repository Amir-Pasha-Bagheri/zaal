// npm packages an `i` line named: the specifier the generated code writes, the version kept
// in one place, and the CDN url a no-install preview resolves it through.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fail } from './diagnostics.mjs';

const CDN = 'https://esm.sh';

const isRel = s => /^[.\/]/.test(s);

// `./logo.png` names a file; `./Btn` and `./Btn.jsx` name a module.
const isAsset = s => /\.[A-Za-z0-9]+$/.test(s) && !/\.jsx?$/.test(s);

// `@scope/name@1.2.3/sub` -> { pkg, version, sub }
function splitSpec(spec) {
  const m = /^(@[\w.-]+\/[\w.-]+|[\w.-]+)(?:@([^/]+))?(\/.*)?$/.exec(spec);
  // `fail` rather than a bare throw, so the message names the `i` line like every other one:
  // the caller (`importLine`) has already marked the node it is compiling.
  if (!m) fail(null, `bad package specifier: ${spec}`);
  return { pkg: m[1], version: m[2] || null, sub: m[3] || '' };
}

// Record a bare import; returns the specifier the generated code should name. Versions are
// stripped from the code and kept in one place (the import map, or package.json).
// `builtin` matches the packages the target puts in scope itself: React lives in the import map
// at the version app.zaal pins, and re-entering it here would overwrite that entry with an
// unpinned copy — a second React on the page, and every hook in the app throwing. `external`
// is the query the CDN needs so a package borrows those rather than shipping its own.
function pkgRef(spec, { pkgs, pins, cdn = CDN, builtin = null, external = '' } = {}) {
  const { pkg, version, sub } = splitSpec(spec);
  if (builtin?.test(pkg)) return { pkg, version: null, css: false, id: pkg + sub };
  const pin = pins?.get(pkg) || null;                            // a pin in app.zaal wins
  const v = pin || version;
  const id = pkg + sub, css = /\.css$/.test(sub);
  const entry = { pkg, version: v, css, url: `${cdn}/${pkg}${v ? '@' + v : ''}${sub}${css ? '' : external}` };
  if (pin && version && pin !== version) entry.clash = `${pkg}@${version} wanted, pinned ${pin}`;
  const prev = pkgs?.get(id);
  if (prev && prev.version !== v) prev.clash = `${id} imported as both ${prev.version || 'latest'} and ${v || 'latest'}`;
  else if (!prev) pkgs?.set(id, entry);
  return { ...entry, id };
}

// Add every package an `i` line named to package.json, for the bundler path.
function syncDeps(root, pkgs) {
  const file = join(root, 'package.json');
  if (!existsSync(file) || !pkgs.size) return [];
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const deps = json.dependencies ?? {};
  const added = [];
  for (const { pkg, version } of pkgs.values()) {
    if (deps[pkg] || json.devDependencies?.[pkg]) continue;
    deps[pkg] = version ? (/^\d/.test(version) ? '^' + version : version) : 'latest';
    added.push(`${pkg}@${deps[pkg]}`);
  }
  if (!added.length) return [];
  json.dependencies = Object.fromEntries(Object.keys(deps).sort().map(k => [k, deps[k]]));
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  return added;
}

export { CDN, isRel, isAsset, splitSpec, pkgRef, syncDeps };
