import fs from 'node:fs/promises';

import { open } from '@vscode/test-web';

import { createLogWorkspace } from '../support/logWorkspace';
import { extensionRoot, vscodeWebTestPath } from '../support/paths';

// Lana declares Salesforce Services as an extension dependency, but VS Code Web
// needs the test server to explicitly provision it for a development extension.
const SERVICES_EXTENSION_ID = 'salesforce.salesforcedx-vscode-services';

const start = async (): Promise<void> => {
  const workspaceDir = await createLogWorkspace();
  const server = await open({
    // The Services extension is loaded from the extension gallery. A normal
    // browser blocks that cross-origin module fetch, so use the same local
    // development browser setting as the Services extension's web launcher.
    browserType: 'chromium',
    browserOptions: ['--disable-web-security'],
    devTools: true,
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
