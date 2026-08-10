import { open } from '@vscode/test-web';
import fs from 'node:fs/promises';

import { createLogWorkspace } from '../support/logWorkspace';
import { extensionRoot, vscodeWebTestPath } from '../support/paths';

const SERVICES_EXTENSION_ID = 'salesforce.salesforcedx-vscode-services';

const start = async (): Promise<void> => {
  const workspaceDir = await createLogWorkspace();
  const server = await open({
    browserType: 'none',
    quality: 'stable',
    commit: process.env.PLAYWRIGHT_WEB_VSCODE_COMMIT,
    port: Number(process.env.PORT) || 3001,
    printServerLog: true,
    verbose: true,
    extensionDevelopmentPath: extensionRoot,
    extensionIds: [{ id: SERVICES_EXTENSION_ID }],
    folderPath: workspaceDir,
    testRunnerDataDir: vscodeWebTestPath,
  });

  const shutdown = (): void => {
    server.dispose();
    void fs.rm(workspaceDir, { recursive: true, force: true }).finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

void start();
