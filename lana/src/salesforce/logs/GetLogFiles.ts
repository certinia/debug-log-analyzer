/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { AuthHelper } from '@apexdevtools/sfdx-auth-helper';
import { LogService, type LogRecord } from '@salesforce/apex-node';

export class GetLogFiles {
  static async apply(wsPath: string): Promise<LogRecord[]> {
    const ah = await AuthHelper.instance(wsPath);
    const connection = await ah.connect(await ah.getDefaultUsername());

    if (connection) {
      return new LogService(connection).getLogRecords();
    }
    return [];
  }
}
