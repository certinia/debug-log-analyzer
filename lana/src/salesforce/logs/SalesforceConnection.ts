/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import type { Connection } from '@salesforce/core';

import { setupPinoBundlerPaths } from '../setupPinoPaths.js';

export async function getSalesforceConnection(wsPath: string): Promise<Connection> {
  // Must be called before importing @salesforce packages that use pino
  setupPinoBundlerPaths();

  // Dynamic import for code splitting. Improves performance by reducing the amount of JS that is loaded and parsed at the start.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { ConfigAggregator, OrgConfigProperties, Org } = await import('@salesforce/core');

  const aggregator = await ConfigAggregator.create({ projectPath: wsPath });
  const usernameOrAlias = aggregator.getPropertyValue(OrgConfigProperties.TARGET_ORG);

  if (!usernameOrAlias) {
    throw new Error('No default org configured for workspace');
  }

  const org = await Org.create({ aliasOrUsername: String(usernameOrAlias) });
  return org.getConnection();
}
