// What the last build wrote. The sweep needs it: a file is stale because a previous build made
// it and this one did not, which is not something a filename can tell you — a hand-written
// `src/helpers.js` looks exactly like a `src/helpers.js` the compiler would have written.
//
// It lives at the project root rather than in the output, because `application/` is handed to a
// developer and nothing in it names the compiler. It is build state, not source: a project
// whose manifest is missing rebuilds correctly, it just has nothing to sweep against.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const STATE_DIR = '.zaal';
const FILE = 'manifest.json';
const VERSION = 1;

const path = root => join(root, STATE_DIR, FILE);

// A hand-mangled, truncated or older manifest is not an error: returning null puts the build on
// the no-manifest path, which still produces correct output.
function load(root) {
  if (!existsSync(path(root))) return null;
  try {
    const json = JSON.parse(readFileSync(path(root), 'utf8'));
    return json?.version === VERSION && json.outputs ? json : null;
  } catch { return null; }
}

// One entry per output directory: `application/` and `.zaal-dev/` are built from the same
// sources, write different code and sweep independently.
const readManifest = (root, outDir) => load(root)?.outputs?.[outDir] ?? null;

function writeManifest(root, outDir, entry) {
  const json = load(root) ?? { version: VERSION, outputs: {} };
  json.outputs[outDir] = entry;
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  writeFileSync(path(root), JSON.stringify(json, null, 2) + '\n');
}

export { STATE_DIR, readManifest, writeManifest };
