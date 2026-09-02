import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '../../../..');
export const extensionRoot = path.join(repoRoot, 'lana');
export const fixtureLogPath = path.join(
  extensionRoot,
  'test',
  'playwright',
  'fixtures',
  'apex-log.log',
);
export const vscodeWebTestPath = path.join(repoRoot, '.vscode-test-web');
