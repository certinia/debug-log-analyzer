import fs from 'node:fs/promises';

import { open } from '@vscode/test-web';

import { createLogWorkspace } from '../support/logWorkspace';
import { extensionRoot, vscodeWebTestPath } from '../support/paths';
import { findServicesExtension } from '../support/servicesExtension';

const start = async (): Promise<void> => {
  const workspaceDir = await createLogWorkspace();
  const servicesExtension = findServicesExtension();
  if (!servicesExtension) {
    // eslint-disable-next-line no-console -- a dev harness reports this on stderr
    console.warn(
      'Salesforce Services not found locally, so commands needing an org will not work. ' +
        'Install the extension in VS Code, or set LANA_SERVICES_EXTENSION_PATH.',
    );
  }

  const server = await open({
    browserType: 'none',
    quality: 'stable',
    commit: process.env.PLAYWRIGHT_WEB_VSCODE_COMMIT,
    port: Number(process.env.PORT) || 3001,
    printServerLog: true,
    verbose: true,
    extensionDevelopmentPath: extensionRoot,
    // A local unpacked copy only: the server hosts it, so the extension host fetches it
    // same-origin (see servicesExtension.ts). The gallery id is not a fallback — the browser
    // resolves it from the publisher CDN, which sends no CORS header to a localhost origin, so
    // Services sits at "Activating" for good and waitForExtensionsActivated never returns.
    ...(servicesExtension ? { extensionPaths: [servicesExtension] } : {}),
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
