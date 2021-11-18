/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { getLogSettings } from "../parsers/LineParser";

describe("Log Settings tests", () => {
  const log =
    "43.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,INFO;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,INFO\n" +
    "09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|partner.nisar.ahmed@philips.com.m2odryrun1|Greenwich Mean Time|GMTZ\n" +
    "09:18:22.6 (6574780)|EXECUTION_STARTED";

  it("The settings should be found", () => {
    expect(getLogSettings(log)).not.toBe(null);
  });
  it("The settings should be as expected", () => {
    expect(getLogSettings(log)).toEqual([
      ["APEX_CODE", "FINE"],
      ["APEX_PROFILING", "NONE"],
      ["CALLOUT", "NONE"],
      ["DB", "INFO"],
      ["NBA", "NONE"],
      ["SYSTEM", "NONE"],
      ["VALIDATION", "INFO"],
      ["VISUALFORCE", "NONE"],
      ["WAVE", "NONE"],
      ["WORKFLOW", "INFO"],
    ]);
  });
});
