import {
  test as base,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
} from '@vscode/test-electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { waitForVSCodeWorkbench } from '@salesforce/playwright-vscode-ext';

import { createLogWorkspace } from '../support/logWorkspace';
import { extensionRoot, vscodeTestPath } from '../support/paths';

const SERVICES_EXTENSION_ID = 'salesforce.salesforcedx-vscode-services';

type WorkerFixtures = {
  vscodeExecutable: string;
  extensionsDir: string;
};

type TestFixtures = {
  workspaceDir: string;
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  vscodeExecutable: [
    async ({ browserName: _browserName }, use) => {
      const executable = await downloadAndUnzipVSCode({ cachePath: vscodeTestPath });
      await use(executable);
    },
    { scope: 'worker' },
  ],

  extensionsDir: [
    async ({ vscodeExecutable }, use) => {
      const extensionsDir = path.join(vscodeTestPath, 'extensions');
      const installUserDataDir = path.join(vscodeTestPath, 'install-user-data');
      await fs.mkdir(extensionsDir, { recursive: true });
      await fs.mkdir(installUserDataDir, { recursive: true });

      const cli = resolveCliPathFromVSCodeExecutablePath(vscodeExecutable);
      const result = spawnSync(
        cli,
        [
          '--extensions-dir',
          extensionsDir,
          '--user-data-dir',
          installUserDataDir,
          '--install-extension',
          SERVICES_EXTENSION_ID,
          '--force',
        ],
        { stdio: 'inherit', shell: process.platform === 'win32' },
      );
      if (result.status !== 0) {
        throw new Error(
          `Unable to install ${SERVICES_EXTENSION_ID} (exit ${result.status ?? 'unknown'}).`,
        );
      }

      await use(extensionsDir);
    },
    { scope: 'worker' },
  ],

  workspaceDir: async ({ browserName: _browserName }, use) => {
    const workspaceDir = await createLogWorkspace();
    try {
      await use(workspaceDir);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  },

  electronApp: async ({ extensionsDir, vscodeExecutable, workspaceDir }, use) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lana-e2e-user-data-'));
    const launchEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    launchEnv.VSCODE_DESKTOP = '1';
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      executablePath: vscodeExecutable,
      args: [
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        `--extensionDevelopmentPath=${extensionRoot}`,
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-updates',
        '--no-sandbox',
        workspaceDir,
      ],
      env: launchEnv,
      timeout: 60_000,
    });

    try {
      await use(app);
    } finally {
      await app.close().catch(() => undefined);
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await waitForVSCodeWorkbench(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await use(page);
  },
});
