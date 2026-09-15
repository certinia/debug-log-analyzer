import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const EXTENSION_PREFIX = 'salesforce.salesforcedx-vscode-services-';
const EXTENSION_DIRECTORIES = ['.vscode', '.vscode-insiders', '.vscode-server'];

const hasManifest = (location: string): boolean => existsSync(path.join(location, 'package.json'));

interface Candidate {
  entry: string;
  location: string;
}

const toNumber = (part: string | undefined): number => {
  const value = Number.parseInt(part ?? '', 10);
  return Number.isFinite(value) ? value : 0;
};

/**
 * A directory name is `<prefix><release>` and may carry a `-` suffix for a pre-release or a
 * platform build. Comparing the whole name as text ranks `1.10.0-rc.1` above `1.10.0`, because
 * the longer string wins a tie, so the release numbers are compared on their own.
 */
const newestFirst = (a: Candidate, b: Candidate): number => {
  const [leftRelease = '', ...leftSuffix] = a.entry.slice(EXTENSION_PREFIX.length).split('-');
  const [rightRelease = '', ...rightSuffix] = b.entry.slice(EXTENSION_PREFIX.length).split('-');

  const left = leftRelease.split('.');
  const right = rightRelease.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = toNumber(right[i]) - toNumber(left[i]);
    if (difference !== 0) {
      return difference;
    }
  }

  // Same release: prefer the plain build over a pre-release or a platform-specific one.
  return Number(leftSuffix.length > 0) - Number(rightSuffix.length > 0);
};

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

  return EXTENSION_DIRECTORIES.flatMap((directory) => {
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
    .sort(newestFirst)
    .find(({ location }) => hasManifest(location))?.location;
};
