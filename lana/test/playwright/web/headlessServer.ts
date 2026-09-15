import fs from 'node:fs/promises';

import { open } from '@vscode/test-web';

import { createLogWorkspace } from '../support/logWorkspace';
import { extensionRoot, vscodeWebTestPath } from '../support/paths';
import { findServicesExtension } from '../support/servicesExtension';

// The test server has to provision Salesforce Services for a development extension.
const SERVICES_EXTENSION_ID = 'salesforce.salesforcedx-vscode-services';

const start = async (): Promise<void> => {
  const workspaceDir = await createLogWorkspace();
  const servicesExtension = findServicesExtension();
  if (!servicesExtension) {
    // eslint-disable-next-line no-console -- a dev harness reports this on stderr
    console.warn(
      'Salesforce Services not found locally, falling back to the gallery id — which a ' +
        'localhost origin cannot fetch, so commands needing an org will not work. Install the ' +
        'extension in VS Code, or set LANA_SERVICES_EXTENSION_PATH.',
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
    // Serve a local unpacked copy when there is one: the server hosts it, so the extension host
    // fetches it same-origin (see servicesExtension.ts). Never both — one identity, one source.
    ...(servicesExtension
      ? { extensionPaths: [servicesExtension] }
      : { extensionIds: [{ id: SERVICES_EXTENSION_ID }] }),
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
