/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { getSalesforceConnection } from './SalesforceConnection.js';

export class GetLogFile {
  static async apply(wsPath: string, logDir: string, logId: string): Promise<void> {
    const connection = await getSalesforceConnection(wsPath);

    // Dynamic import for code splitting. Improves performance by reducing the amount of JS that is loaded and parsed at the start.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { LogService } = await import('@salesforce/apex-node');
    await new LogService(connection).getLogs({ logId: logId, outputDir: logDir });
  }
}
