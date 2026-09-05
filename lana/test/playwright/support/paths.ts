import { existsSync } from 'node:fs';
import path from 'node:path';

const findRepoRoot = (startDirectory: string): string => {
  let directory = startDirectory;

  while (!existsSync(path.join(directory, 'pnpm-workspace.yaml'))) {
    const parentDirectory = path.dirname(directory);
    if (parentDirectory === directory) {
      throw new Error(`Could not find the repository root from ${startDirectory}`);
    }
    directory = parentDirectory;
  }

  return directory;
};

export const repoRoot = findRepoRoot(process.cwd());
export const extensionRoot = path.join(repoRoot, 'lana');
export const fixtureLogPath = path.join(
  extensionRoot,
  'test',
  'playwright',
  'fixtures',
  'apex-log.log',
);
export const vscodeWebTestPath = path.join(repoRoot, '.vscode-test-web');
