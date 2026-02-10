/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { type LogRecord } from '@salesforce/apex-node';

import { getSalesforceConnection } from './SalesforceConnection.js';

export class GetLogFiles {
  static async apply(wsPath: string): Promise<LogRecord[]> {
    const connection = await getSalesforceConnection(wsPath);

    // Dynamic import for code splitting. Improves performance by reducing the amount of JS that is loaded and parsed at the start.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { LogService } = await import('@salesforce/apex-node');
    return new LogService(connection).getLogRecords();
  }
}
