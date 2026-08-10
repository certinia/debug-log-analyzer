import fs from 'node:fs/promises';
import path from 'node:path';

import { createTestWorkspace } from '@salesforce/playwright-vscode-ext';

import { sampleLogPath } from './paths';

export const SAMPLE_LOG_NAME = 'sample-log.log';

export const createLogWorkspace = async (): Promise<string> => {
  const workspaceDir = await createTestWorkspace();
  await fs.copyFile(sampleLogPath, path.join(workspaceDir, SAMPLE_LOG_NAME));
  return workspaceDir;
};
