/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import analyseMethods, { Metric } from "../Analysis";
import parseLog from "../parsers/LineParser";
import { getRootMethod } from "../parsers/TreeParser";

describe("Analyse methods tests", () => {
  it("Nodes should use group as key", async () => {
    const log =
      "09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n" +
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n" +
      "09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n" +
      "07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n" +
      "09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n" +
      "09:19:13.82 (51595120059)|EXECUTION_FINISHED\n";

    await parseLog(log);
    const metricList = await analyseMethods(getRootMethod());

    expect(metricList).toEqual([
      new Metric("EXECUTION_STARTED", 1, 51588545279, 2394092),
      new Metric(
        "pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)",
        1,
        51586151187,
        1677539906
      ),
      new Metric("DML", 1, 49908611281, 49908611281),
    ]);
  });

  it("Durations should accumulate by Key", async () => {
    const log =
      "09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n" +
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n" +
      "09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n" +
      "07:54:17.2 (1684126610)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n" +
      "07:54:17.2 (1684126620)|DML_END|[774]\n" +
      "07:54:17.2 (1684126630)|DML_BEGIN|[774]|Op:Insert|Type:codaCompany__c|Rows:2\n" +
      "07:54:17.2 (1684126640)|DML_END|[774]\n" +
      "09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n" +
      "09:19:13.82 (51595120059)|EXECUTION_FINISHED\n";

    await parseLog(log);
    const metricList = await analyseMethods(getRootMethod());

    expect(metricList).toEqual([
      new Metric("EXECUTION_STARTED", 1, 51588545279, 2394092),
      new Metric(
        "pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)",
        1,
        51586151187,
        51586151167
      ),
      new Metric("DML", 2, 20, 20),
    ]);
  });
});
