/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
// todo: jsforce need to be fixed for bundling
// todo: https://github.com/forcedotcom/node-bunyan needs requires with concat fixing e.g require('mv'+'') to just mv

import { LogService } from '@salesforce/apex-node';
import { AuthHelper } from '@apexdevtools/sfdx-auth-helper';
import * as fs from 'fs';
import * as path from 'path';

// import { SFDXWorkspaceUtil } from "../../sfdxworkspace/SFDXWorkspaceUtil";

export class GetLogFile {
  static async apply(wsPath: string, logDir: string, logId: string): Promise<void> {
    const ah = await AuthHelper.instance(wsPath);
    const connection = await ah.connect(await ah.getDefaultUsername());

    // todo: can replace with this, once jsforce has been fixed.
    // const connection = await new SFDXWorkspaceUtil().getConnection();
    if (connection) {
      const logResults = await new LogService(connection).getLogs({ logId, outputDir: logDir });
      if (logResults.length > 0) {
        const logResult = logResults[0];
        fs.mkdirSync(logDir, { recursive: true });
        const writeStream = fs.createWriteStream(path.join(logDir, `${logId}.log`), {
          encoding: 'utf8',
          flags: 'w',
        });
        writeStream.write(logResult.log);
        writeStream.end();
      }
    }
    return new Promise((resolve) => resolve());
  }
}
