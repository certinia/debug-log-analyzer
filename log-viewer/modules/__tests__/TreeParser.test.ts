/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import parseLog, {
  parseObjectNamespace,
  parseVfNamespace,
  parseTimestamp,
  parseLineNumber,
  parseRows,
  parseLine,
  getLogSettings,
  Method,
  MethodEntryLine,
  logLines,
  CodeUnitStartedLine,
  CodeUnitFinishedLine,
  truncated,
  cpuUsed,
  ExecutionStartedLine,
  ExecutionFinishedLine,
} from "../parsers/TreeParser";

describe("parseObjectNamespace tests", () => {
  it("Should consider no separator to be unmanaged", () => {
    expect(parseObjectNamespace("Account")).toEqual("unmanaged");
  });
  it("Should accept properly formatted namespaces", () => {
    expect(parseObjectNamespace("key001__Upsell_Contract__e")).toEqual(
      "key001"
    );
  });
});

describe("parseVfNamespace tests", () => {
  it("Should consider no separator to be unmanaged", () => {
    expect(parseVfNamespace("VF: /apex/CashMatching")).toEqual("unmanaged");
  });
  it("Should consider no slashes to be unmanaged", () => {
    expect(parseVfNamespace("VF: pse__ProjectBilling")).toEqual("unmanaged");
  });
  it("Should consider one slash to be unmanaged", () => {
    expect(parseVfNamespace("VF: /pse__ProjectBilling")).toEqual("unmanaged");
  });
  it("Should accept properly formatted namespaces", () => {
    expect(parseVfNamespace("VF: /apex/pse__ProjectBilling")).toEqual("pse");
  });
});

describe("parseTimestamp tests", () => {
  it("Should parse the timestamp from it's section", () => {
    expect(parseTimestamp("22:00:05.0 (59752074)")).toEqual(59752074);
  });
});

describe("parseLineNumber tests", () => {
  it("Should parse the line-number from it's section", () => {
    expect(parseLineNumber("[37]")).toEqual(37);
  });
});

describe("parseRows tests", () => {
  it("Should parse the row-count from it's section", () => {
    expect(parseRows("Rows:12")).toEqual(12);
  });
});

describe("parseLine tests", () => {
  const line =
    "15:20:52.222 (6574780)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()";

  it("Should return null if no meta", () => {
    expect(parseLine("09:18:22.6 (6574780)|DUMMY", null)).toEqual(null);
  });

  it("Should return an object with meta as prototype", () => {
    expect(parseLine(line, null)).toBeInstanceOf(MethodEntryLine);
  });

  it("Should return an object with a reference to the source line", () => {
    const node = parseLine(line, null);
    expect(node?.logLine).toEqual(line);
  });

  it("Should return an object with a timestamp", () => {
    const node = parseLine(line, null);
    expect(node?.timestamp).toEqual(6574780);
  });
});

describe("parseLog tests", () => {
  it("Should parse between EXECUTION_STARTED and EXECUTION_FINISHED and return an iterator", async () => {
    const log =
      "09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n" +
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n" +
      "09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n" +
      "09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n" +
      "09:19:13.82 (51595120059)|EXECUTION_FINISHED\n";

    parseLog(log);
    expect(logLines.length).toEqual(4);
    expect(logLines[0]).toBeInstanceOf(ExecutionStartedLine);
    expect(logLines[1]).toBeInstanceOf(CodeUnitStartedLine);
    expect(logLines[2]).toBeInstanceOf(CodeUnitFinishedLine);
    expect(logLines[3]).toBeInstanceOf(ExecutionFinishedLine);
  });

  it("Should parse between EXECUTION_STARTED and EXECUTION_FINISHED for CRLF (\r\n)", async () => {
    const log =
      "09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\r\n" +
      "09:18:22.6 (6574780)|EXECUTION_STARTED\r\n" +
      "09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\r\n" +
      "09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\r\n" +
      "09:19:13.82 (51595120059)|EXECUTION_FINISHED\r\n";

    parseLog(log);
    expect(logLines.length).toEqual(4);
    expect(logLines[0]).toBeInstanceOf(ExecutionStartedLine);
    expect(logLines[1]).toBeInstanceOf(CodeUnitStartedLine);
    expect(logLines[2]).toBeInstanceOf(CodeUnitFinishedLine);
    expect(logLines[3]).toBeInstanceOf(ExecutionFinishedLine);
  });

  it("Should handle partial logs", async () => {
    const log =
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n" +
      "09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n";

    parseLog(log);

    expect(logLines.length).toBe(2);
    expect(logLines[0]).toBeInstanceOf(ExecutionStartedLine);
    expect(logLines[1]).toBeInstanceOf(CodeUnitStartedLine);
  });

  it("Should detect skipped log entries", async () => {
    const log =
      "09:18:22.6 (100)|EXECUTION_STARTED\n\n" +
      "15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n" +
      "*** Skipped 22606355 bytes of detailed log\n" +
      "15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n" +
      "09:19:13.82 (2000)|EXECUTION_FINISHED\n";

    parseLog(log);

    expect(truncated.length).toBe(1);
		expect(truncated[0].reason).toBe('Skipped-Lines');
  });

  it("Should detect truncated logs", async () => {
    const log =
      "09:18:22.6 (100)|EXECUTION_STARTED\n\n" +
      "15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n" +
      "15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n" +
      "*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n";

    parseLog(log);

    expect(truncated.length).toBe(1);
    expect(truncated[0].reason).toBe("Max-Size-reached");
  });

  it("Should detect exceptions", async () => {
    const log =
      "09:18:22.6 (100)|EXECUTION_STARTED\n\n" +
      "15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n" +
      "16:16:04.97 (1000)|EXCEPTION_THROWN|[60]|System.LimitException: c2g:Too many SOQL queries: 101\n" +
      "09:19:13.82 (2000)|EXECUTION_FINISHED\n";

    parseLog(log);

    expect(truncated.length).toBe(1);
    expect(truncated[0].reason).toBe(
      "System.LimitException: c2g:Too many SOQL queries: 101"
    );
  });
  it("Should detect fatal errors", async () => {
    const log =
      "09:18:22.6 (100)|EXECUTION_STARTED\n\n" +
      "15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n" +
      "16:16:04.97 (1000)|FATAL_ERROR|System.LimitException: c2g:Too many SOQL queries: 101\n" +
      "09:19:13.82 (2000)|EXECUTION_FINISHED\n";

    parseLog(log);

    expect(truncated.length).toBe(1);
    expect(truncated[0].reason).toBe(
      "FATAL ERROR! cause=System.LimitException: c2g:Too many SOQL queries: 101"
    );
  });
  it("Methods should have line-numbers", async () => {
    const log =
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n\n" +
      "15:20:52.222 (4113741282)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n" +
      "15:20:52.222 (4113760256)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n" +
      "09:19:13.82 (51595120059)|EXECUTION_FINISHED\n";

    parseLog(log);
    expect(logLines.length).toBe(4);
    expect(logLines[1].lineNumber).toBe(185);
  });
  it("Packages should have a namespace", async () => {
    const log =
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n" +
      "11:52:06.13 (151717928)|ENTERING_MANAGED_PKG|appirio_core\n" +
      "09:19:13.82 (51595120059)|EXECUTION_FINISHED\n";

    parseLog(log);
    expect(logLines.length).toBe(3);
    expect(logLines[1].namespace).toBe("appirio_core");
  });
  it("Limit Usage for NS provides cpuUsed", async () => {
    const log =
      "09:18:22.6 (6574780)|EXECUTION_STARTED\n" +
      "14:29:44.163 (40163621912)|CUMULATIVE_LIMIT_USAGE\n" +
      "14:29:44.163 (40163621912)|LIMIT_USAGE_FOR_NS|(default)|\n" +
      "  Number of SOQL queries: 8 out of 100\n" +
      "  Number of query rows: 26 out of 50000\n" +
      "  Number of SOSL queries: 0 out of 20\n" +
      "  Number of DML statements: 8 out of 150\n" +
      "  Number of DML rows: 26 out of 10000\n" +
      "  Maximum CPU time: 4564 out of 10000\n" +
      "  Maximum heap size: 0 out of 6000000\n" +
      "  Number of callouts: 0 out of 100\n" +
      "  Number of Email Invocations: 0 out of 10\n" +
      "  Number of future calls: 0 out of 50\n" +
      "  Number of queueable jobs added to the queue: 0 out of 50\n" +
      "  Number of Mobile Apex push calls: 0 out of 10\n" +
      "14:29:44.163 (40163621912)|CUMULATIVE_LIMIT_USAGE_END\n" +
      "09:19:13.82 (51595120059)|EXECUTION_FINISHED\n";

    parseLog(log);
    expect(logLines.length).toBe(5);
    expect(logLines[2].type).toBe("LIMIT_USAGE_FOR_NS");
    expect(cpuUsed).toBe(4564000000);
  });
});

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
			{key: 'APEX_CODE', level: 'FINE'},
			{key: 'APEX_PROFILING', level: 'NONE'},
			{key: 'CALLOUT', level: 'NONE'},
			{key: 'DB', level: 'INFO'},
			{key: 'NBA', level: 'NONE'},
			{key: 'SYSTEM', level: 'NONE'},
			{key: 'VALIDATION', level: 'INFO'},
			{key: 'VISUALFORCE', level: 'NONE'},
			{key: 'WAVE', level: 'NONE'},
			{key: 'WORKFLOW', level: 'INFO'}
    ]);
  });
});

describe('Recalculate durations tests', () => {
	it('Recalculates parent node', () => {
		const node = new Method(['14:32:07.563 (1)', 'DUMMY'], [], null, 'method', '');
		node.exitStamp = 3;

		node.recalculateDurations();
		expect(node.duration).toBe(2);
		expect(node.selfTime).toBe(2);
	});
	it('Children are subtracted from net duration', () => {
		const node = new Method(['14:32:07.563 (0)', 'DUMMY'], [], null, 'method', ''),
			child1 = new Method(['14:32:07.563 (10)', 'DUMMY'], [], null, 'method', ''),
			child2 = new Method(['14:32:07.563 (70)', 'DUMMY'], [], null, 'method', '');
		node.exitStamp = 100;
		child1.duration = 50;
		child2.duration = 25;
		node.addChild(child1);
		node.addChild(child2);
		node.recalculateDurations();
		expect(node.duration).toBe(100);
		expect(node.selfTime).toBe(25);
	});
});
