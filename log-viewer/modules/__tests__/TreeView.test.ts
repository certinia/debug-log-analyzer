/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import parseLog, { logLines } from "../parsers/TreeParser";
import { LineIterator } from "../parsers/TreeParser";

describe("LineIterator tests", () => {
  it("Should return null when there are no more lines", () => {
    const iter = new LineIterator([]);
    expect(iter.fetch()).toEqual(null);
  });

  it("Should not move to the next line when calling peek", async () => {
    const log =
      "09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n" +
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n" +
      "09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n";
    await parseLog(log);

    const iter = new LineIterator(logLines);
    expect(iter.peek()).toEqual(logLines[0]);
    expect(iter.fetch()).toEqual(logLines[0]);
  });

  it("Should return the lines in sequence", async () => {
    const log =
      "09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n" +
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n" +
      "09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n" +
      "09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n" +
      "09:19:13.82 (51595120059)|EXECUTION_FINISHED\n";

    await parseLog(log);

    const iter = new LineIterator(logLines);
    expect(iter.fetch()).toEqual(logLines[0]);
    expect(iter.fetch()).toEqual(logLines[1]);
    expect(iter.fetch()).toEqual(logLines[2]);
    expect(iter.fetch()).toEqual(logLines[3]);
    expect(iter.fetch()).toEqual(null);
  });
});
