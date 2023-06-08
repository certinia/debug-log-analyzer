/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
// todo: jsforce need to be fixed for bundling
// todo: https://github.com/forcedotcom/node-bunyan needs requires with concat fixing e.g require('mv'+'') to just mv

import { LogService } from '@salesforce/apex-node';
import { AuthHelper } from '@apexdevtools/sfdx-auth-helper';
import { createWriteStream, mkdirSync } from 'fs';
import { join as pathJoin } from 'path';

export class GetLogFile {
  static async apply(wsPath: string, logDir: string, logId: string): Promise<void> {
    const ah = await AuthHelper.instance(wsPath);
    const connection = await ah.connect(await ah.getDefaultUsername());

    if (connection) {
      const logResults = await new LogService(connection).getLogs({ logId, outputDir: logDir });
      if (logResults.length > 0) {
        const logResult = logResults[0];
        mkdirSync(logDir, { recursive: true });
        const writeStream = createWriteStream(pathJoin(logDir, `${logId}.log`));
        writeStream.write(logResult.log);
        writeStream.end();
      }
    }
    return new Promise((resolve) => resolve());
  }
}
