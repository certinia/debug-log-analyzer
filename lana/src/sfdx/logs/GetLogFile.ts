/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { SFDX } from "../SFDX";

export class GetLogFile {
  static async apply(
    path: string,
    logDir: string,
    logId: string
  ): Promise<string> {
    return SFDX.apply(path, [
      "force:apex:log:get",
      `--outputdir ${logDir}`,
      `--logid ${logId}`,
    ]);
  }
}
