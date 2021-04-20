/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { Command } from "./Command";

export interface SFDXResponse<T> {
  status: number;
  result: T;
}

export class SFDX {
  static async apply(path: string, args: string[]): Promise<string> {
    return Command.apply(path, ["sfdx"].concat(args));
  }
}
