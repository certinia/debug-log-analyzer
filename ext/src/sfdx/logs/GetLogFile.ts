/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { SFDX } from "../sfdx";

export class GetLogFile {
  static async apply(path: string, logId: string): Promise<string> {
    return SFDX.apply(path, ["force:apex:log:get", "--logid", logId]);
  }
}
