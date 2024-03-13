/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { type LogRecord } from '@salesforce/apex-node';

export class GetLogFiles {
  static async apply(wsPath: string): Promise<LogRecord[]> {
    // Dynamic import for code splitting. Improves performance by reducing the amount of JS that is loaded and parsed at the start.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const { AuthHelper } = await import('@apexdevtools/sfdx-auth-helper');
    const ah = await AuthHelper.instance(wsPath);
    const connection = await ah.connect(await ah.getDefaultUsername());

    if (connection) {
      // Dynamic import for code splitting. Improves performance by reducing the amount of JS that is loaded and parsed at the start.
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { LogService } = await import('@salesforce/apex-node');
      return new LogService(connection).getLogRecords();
    }
    return [];
  }
}
