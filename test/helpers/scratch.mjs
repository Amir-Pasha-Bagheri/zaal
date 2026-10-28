// Where a helper keeps the modules it writes for one test process. Test files run in parallel
// processes and several of them share a helper, so the directory is per process: otherwise one
// file's `after` removes what another is still importing (ENOTEMPTY, or a module that vanished
// mid-run), and two processes write `m0.mjs` to the same path.
import { rmSync, rmdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function dropDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  // the shared parent goes too, once the last process out leaves it empty
  try { rmdirSync(dirname(dir)); } catch { /* another process is still using it */ }
}
