import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const EXTENSION_PREFIX = 'salesforce.salesforcedx-vscode-services-';
const EXTENSION_DIRECTORIES = ['.vscode', '.vscode-insiders', '.vscode-server'];

const hasManifest = (location: string): boolean => existsSync(path.join(location, 'package.json'));

/**
 * The newest Salesforce Services extension unpacked by a local VS Code install, or `undefined`
 * when there is none. `LANA_SERVICES_EXTENSION_PATH` overrides the search.
 *
 * The web extension host loads a gallery extension from the publisher's CDN, which sends no
 * `Access-Control-Allow-Origin` for a `localhost` origin. Serving an unpacked copy from the test
 * server itself keeps that fetch same-origin.
 *
 * @throws when `LANA_SERVICES_EXTENSION_PATH` holds no `package.json`.
 */
export const findServicesExtension = (): string | undefined => {
  const override = process.env.LANA_SERVICES_EXTENSION_PATH;
  if (override) {
    if (!hasManifest(override)) {
      throw new Error(`LANA_SERVICES_EXTENSION_PATH has no package.json: ${override}`);
    }
    return override;
  }

  return (
    EXTENSION_DIRECTORIES.flatMap((directory) => {
      const root = path.join(homedir(), directory, 'extensions');
      let entries: string[];
      try {
        entries = readdirSync(root);
      } catch {
        return []; // that VS Code flavour is not installed, or its extensions are unreadable
      }

      return entries
        .filter((entry) => entry.startsWith(EXTENSION_PREFIX))
        .map((entry) => ({ entry, location: path.join(root, entry) }));
    })
      // Names carry a version and sometimes a platform suffix, so compare them numerically.
      .sort((a, b) => b.entry.localeCompare(a.entry, undefined, { numeric: true }))
      .find(({ location }) => hasManifest(location))?.location
  );
};
