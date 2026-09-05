import fs from 'node:fs/promises';
import path from 'node:path';

import { createTestWorkspace } from '@salesforce/playwright-vscode-ext';

import { fixtureLogPath } from './paths';

export const LOG_FILE_NAME = 'apex-log.log';

export const createLogWorkspace = async (): Promise<string> => {
  const workspaceDir = await createTestWorkspace();
  await fs.copyFile(fixtureLogPath, path.join(workspaceDir, LOG_FILE_NAME));
  return workspaceDir;
};
