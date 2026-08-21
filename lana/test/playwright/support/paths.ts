import path from 'node:path';

export const repoRoot = path.resolve(__dirname, '../../../..');
export const extensionRoot = path.join(repoRoot, 'lana');
export const sampleLogPath = path.join(repoRoot, 'sample-app', 'debug-logs', 'sample-log.log');
export const vscodeWebTestPath = path.join(repoRoot, '.vscode-test-web');
