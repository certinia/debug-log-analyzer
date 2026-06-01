import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Copy the package docs into lana/ for vsce packaging only.
// The root files are the sources of truth; the lana/ copies are gitignored
// build artifacts consumed by `vsce package` (see lana/.vscodeignore).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docs = ['CHANGELOG.md', 'LICENSE.txt', 'README.md'];

await Promise.all(
  docs.map((file) => copyFile(path.join(repoRoot, file), path.join(repoRoot, 'lana', file))),
);
