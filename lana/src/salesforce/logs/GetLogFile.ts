/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { AuthHelper } from '@apexdevtools/sfdx-auth-helper';
import { LogService } from '@salesforce/apex-node';

export class GetLogFile {
  static async apply(wsPath: string, logDir: string, logId: string): Promise<void> {
    const ah = await AuthHelper.instance(wsPath);
    const connection = await ah.connect(await ah.getDefaultUsername());

    if (connection) {
      await new LogService(connection).getLogs({ logId: logId, outputDir: logDir });
    }
    return new Promise((resolve) => resolve());
  }
}
