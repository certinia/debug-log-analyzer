/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import parseLog, {
  getRootMethod,
  parseObjectNamespace,
  parseVfNamespace,
  parseTimestamp,
  parseLineNumber,
  parseRows,
  parseLine,
  getLogSettings,
  Method,
  MethodEntryLine,
  LogLine,
  lineTypeMap,
  logLines,
  CodeUnitStartedLine,
  CodeUnitFinishedLine,
  truncated,
  cpuUsed,
  ExecutionStartedLine,
  ExecutionFinishedLine,
  TimedNode,
} from '../parsers/TreeParser';

describe('parseObjectNamespace tests', () => {
  it('Should consider no separator to be unmanaged', () => {
    expect(parseObjectNamespace('Account')).toEqual('unmanaged');
  });
  it('Should accept properly formatted namespaces', () => {
    expect(parseObjectNamespace('key001__Upsell_Contract__e')).toEqual('key001');
  });
});

describe('parseVfNamespace tests', () => {
  it('Should consider no separator to be unmanaged', () => {
    expect(parseVfNamespace('VF: /apex/CashMatching')).toEqual('unmanaged');
  });
  it('Should consider no slashes to be unmanaged', () => {
    expect(parseVfNamespace('VF: pse__ProjectBilling')).toEqual('unmanaged');
  });
  it('Should consider one slash to be unmanaged', () => {
    expect(parseVfNamespace('VF: /pse__ProjectBilling')).toEqual('unmanaged');
  });
  it('Should accept properly formatted namespaces', () => {
    expect(parseVfNamespace('VF: /apex/pse__ProjectBilling')).toEqual('pse');
  });
});

describe('parseTimestamp tests', () => {
  it("Should parse the timestamp from it's section", () => {
    expect(parseTimestamp('22:00:05.0 (59752074)')).toEqual(59752074);
  });
});

describe('parseLineNumber tests', () => {
  it("Should parse the line-number from it's section", () => {
    expect(parseLineNumber('[37]')).toEqual(37);
  });
});

describe('parseRows tests', () => {
  it("Should parse the row-count from it's section", () => {
    expect(parseRows('Rows:12')).toEqual(12);
  });
});

describe('parseLine tests', () => {
  const line =
    '15:20:52.222 (6574780)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()';

  it('Should return null if no meta', () => {
    expect(parseLine('09:18:22.6 (6574780)|DUMMY', null)).toEqual(null);
  });

  it('Should return an object with meta as prototype', () => {
    expect(parseLine(line, null)).toBeInstanceOf(MethodEntryLine);
  });

  it('Should return an object with a reference to the source line', () => {
    const node = parseLine(line, null);
    expect(node?.logLine).toEqual(line);
  });

  it('Should return an object with a timestamp', () => {
    const node = parseLine(line, null);
    expect(node?.timestamp).toEqual(6574780);
  });
});

describe('parseLog tests', () => {
  it('Should parse between EXECUTION_STARTED and EXECUTION_FINISHED and return an iterator', async () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    parseLog(log);
    expect(logLines.length).toEqual(4);
    expect(logLines[0]).toBeInstanceOf(ExecutionStartedLine);
    expect(logLines[1]).toBeInstanceOf(CodeUnitStartedLine);
    expect(logLines[2]).toBeInstanceOf(CodeUnitFinishedLine);
    expect(logLines[3]).toBeInstanceOf(ExecutionFinishedLine);
  });

  it('Should parse between EXECUTION_STARTED and EXECUTION_FINISHED for CRLF (\r\n)', async () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|jwilson@57dev.financialforce.com|Greenwich Mean Time|GMT+01:00\r\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\r\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\r\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\r\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\r\n';

    parseLog(log);
    expect(logLines.length).toEqual(4);
    expect(logLines[0]).toBeInstanceOf(ExecutionStartedLine);
    expect(logLines[1]).toBeInstanceOf(CodeUnitStartedLine);
    expect(logLines[2]).toBeInstanceOf(CodeUnitFinishedLine);
    expect(logLines[3]).toBeInstanceOf(ExecutionFinishedLine);
  });

  it('Should handle partial logs', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n';

    parseLog(log);

    expect(logLines.length).toBe(2);
    expect(logLines[0]).toBeInstanceOf(ExecutionStartedLine);
    expect(logLines[1]).toBeInstanceOf(CodeUnitStartedLine);
  });

  it('Should detect skipped log entries', async () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '*** Skipped 22606355 bytes of detailed log\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    parseLog(log);

    expect(truncated.length).toBe(1);
    expect(truncated[0].reason).toBe('Skipped-Lines');
  });

  it('Should detect truncated logs', async () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n';

    parseLog(log);

    expect(truncated.length).toBe(1);
    expect(truncated[0].reason).toBe('Max-Size-reached');
  });

  it('Should detect exceptions', async () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '16:16:04.97 (1000)|EXCEPTION_THROWN|[60]|System.LimitException: c2g:Too many SOQL queries: 101\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    parseLog(log);

    expect(truncated.length).toBe(1);
    expect(truncated[0].reason).toBe('System.LimitException: c2g:Too many SOQL queries: 101');
  });
  it('Should detect fatal errors', async () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '16:16:04.97 (1000)|FATAL_ERROR|System.LimitException: c2g:Too many SOQL queries: 101\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    parseLog(log);

    expect(truncated.length).toBe(1);
    expect(truncated[0].reason).toBe(
      'FATAL ERROR! cause=System.LimitException: c2g:Too many SOQL queries: 101'
    );
  });
  it('Methods should have line-numbers', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (4113741282)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '15:20:52.222 (4113760256)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    parseLog(log);
    expect(logLines.length).toBe(4);
    expect(logLines[1].lineNumber).toBe(185);
  });
  it('Packages should have a namespace', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '11:52:06.13 (151717928)|ENTERING_MANAGED_PKG|appirio_core\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    parseLog(log);
    expect(logLines.length).toBe(3);
    expect(logLines[1].namespace).toBe('appirio_core');
  });
  it('Limit Usage for NS provides cpuUsed', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '14:29:44.163 (40163621912)|CUMULATIVE_LIMIT_USAGE\n' +
      '14:29:44.163 (40163621912)|LIMIT_USAGE_FOR_NS|(default)|\n' +
      '  Number of SOQL queries: 8 out of 100\n' +
      '  Number of query rows: 26 out of 50000\n' +
      '  Number of SOSL queries: 0 out of 20\n' +
      '  Number of DML statements: 8 out of 150\n' +
      '  Number of DML rows: 26 out of 10000\n' +
      '  Maximum CPU time: 4564 out of 10000\n' +
      '  Maximum heap size: 0 out of 6000000\n' +
      '  Number of callouts: 0 out of 100\n' +
      '  Number of Email Invocations: 0 out of 10\n' +
      '  Number of future calls: 0 out of 50\n' +
      '  Number of queueable jobs added to the queue: 0 out of 50\n' +
      '  Number of Mobile Apex push calls: 0 out of 10\n' +
      '14:29:44.163 (40163621912)|CUMULATIVE_LIMIT_USAGE_END\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    parseLog(log);
    expect(logLines.length).toBe(5);
    expect(logLines[2].type).toBe('LIMIT_USAGE_FOR_NS');
    expect(cpuUsed).toBe(4564000000);
  });
  it('Flow Value Assignemnt can handle multiple lines', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.670 (1372614277)|FLOW_VALUE_ASSIGNMENT|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|myVariable_old|{Id=a6U6T000001DypKUAS, OwnerId=005d0000003141tAAA, IsDeleted=false, Name=TR-001752, CurrencyIsoCode=USD, RecordTypeId=012d0000000T5CLAA0, CreatedDate=2022-05-06 11:40:47, CreatedById=005d0000003141tAAA, LastModifiedDate=2022-05-06 11:40:47, LastModifiedById=005d0000003141tAAA, SystemModstamp=2022-05-06 11:40:47, LastViewedDate=null, LastReferencedDate=null, SCMC__Carrier_Service__c=null, SCMC__Carrier__c=null, SCMC__Destination_Location__c=null, SCMC__Destination_Ownership__c=null, SCMC__Destination_Warehouse__c=a6Y6T000001Ib9ZUAS, SCMC__Notes__c=TVPs To Amazon Europe Spain, SCMC__Override_Ship_To_Address__c=null, SCMC__Pickup_Address__c=null, SCMC__Pickup_Required__c=false, SCMC__Reason_Code__c=a5i0W000001Ydw3QAC, SCMC__Requested_Delivery_Date__c=null, SCMC__Revision__c=0, SCMC__Ship_To_City__c=null, SCMC__Ship_To_Country__c=null, SCMC__Ship_To_Line_1__c=null, SCMC__Ship_To_Line_2__c=null, SCMC__Ship_To_Name__c=null, SCMC__Ship_To_State_Province__c=null, SCMC__Ship_To_Zip_Postal_Code__c=null, SCMC__Shipment_Date__c=null, SCMC__Shipment_Required__c=true, SCMC__Shipment_Status__c=Open, SCMC__Source_Location__c=null, SCMC__Source_Ownership__c=null, SCMC__Source_Warehouse__c=a6Y6T000001IS9fUAG, SCMC__Status__c=New, SCMC__Tracking_Number__c=null, SCMC__Number_Of_Transfer_Lines__c=0, Created_Date__c=2022-05-06 11:40:47, Shipment_Instructions__c=1Z V8F 767 681769 7682\n' +
      '1Z V8F 767 68 3968 7204\n' +
      '1Z VSF 767 68 0562 3292}\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED';

    parseLog(log);
    expect(logLines.length).toBe(3);
    expect(logLines[1].type).toBe('FLOW_VALUE_ASSIGNMENT');
    expect(logLines[1].text).toBe(
      'myVariable_old {Id=a6U6T000001DypKUAS, OwnerId=005d0000003141tAAA, IsDeleted=false, Name=TR-001752, CurrencyIsoCode=USD, RecordTypeId=012d0000000T5CLAA0, CreatedDate=2022-05-06 11:40:47, CreatedById=005d0000003141tAAA, LastModifiedDate=2022-05-06 11:40:47, LastModifiedById=005d0000003141tAAA, SystemModstamp=2022-05-06 11:40:47, LastViewedDate=null, LastReferencedDate=null, SCMC__Carrier_Service__c=null, SCMC__Carrier__c=null, SCMC__Destination_Location__c=null, SCMC__Destination_Ownership__c=null, SCMC__Destination_Warehouse__c=a6Y6T000001Ib9ZUAS, SCMC__Notes__c=TVPs To Amazon Europe Spain, SCMC__Override_Ship_To_Address__c=null, SCMC__Pickup_Address__c=null, SCMC__Pickup_Required__c=false, SCMC__Reason_Code__c=a5i0W000001Ydw3QAC, SCMC__Requested_Delivery_Date__c=null, SCMC__Revision__c=0, SCMC__Ship_To_City__c=null, SCMC__Ship_To_Country__c=null, SCMC__Ship_To_Line_1__c=null, SCMC__Ship_To_Line_2__c=null, SCMC__Ship_To_Name__c=null, SCMC__Ship_To_State_Province__c=null, SCMC__Ship_To_Zip_Postal_Code__c=null, SCMC__Shipment_Date__c=null, SCMC__Shipment_Required__c=true, SCMC__Shipment_Status__c=Open, SCMC__Source_Location__c=null, SCMC__Source_Ownership__c=null, SCMC__Source_Warehouse__c=a6Y6T000001IS9fUAG, SCMC__Status__c=New, SCMC__Tracking_Number__c=null, SCMC__Number_Of_Transfer_Lines__c=0, Created_Date__c=2022-05-06 11:40:47, Shipment_Instructions__c=1Z V8F 767 681769 7682 | 1Z V8F 767 68 3968 7204 | 1Z VSF 767 68 0562 3292}'
    );
    expect(cpuUsed).toBe(0);
  });
});

describe('getRootMethod tests', () => {
  it('FlowStartInterviewsBeginLine should be a process builder', async () => {
    const log =
      '17:52:34.317 (1350000000)|EXECUTION_STARTED\n' +
      '17:52:35.317 (1363038330)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:01Id0000000roIX\n' +
      '17:52:35.370 (1370636436)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
      '17:52:35.370 (1370676724)|FLOW_START_INTERVIEW_BEGIN|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Process Builder\n' +
      '17:52:35.370 (1377009430)|FLOW_START_INTERVIEW_END|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Process Builder\n' +
      '17:52:35.370 (1497348059)|FLOW_START_INTERVIEWS_END|1\n' +
      '17:52:35.317 (1499617717)|CODE_UNIT_FINISHED|Workflow:01Id0000000roIX\n' +
      '17:52:36.317 (1500000000)|EXECUTION_FINISHED\n';

    parseLog(log);
    const rootMethod = getRootMethod();

    const timedLogLines = rootMethod.children as TimedNode[];
    expect(timedLogLines.length).toBe(1);
    const startLine = timedLogLines[0];
    expect(startLine.type).toBe('EXECUTION_STARTED');

    expect(startLine.children.length).toBe(1);
    const unitStart = startLine.children[0] as TimedNode;
    expect(unitStart.type).toBe('CODE_UNIT_STARTED');
    expect(unitStart.group).toBe('Workflow');

    expect(unitStart.children.length).toBe(1);
    const interViewsBegin = unitStart.children[0] as TimedNode;
    expect(interViewsBegin.type).toBe('FLOW_START_INTERVIEWS_BEGIN');
    expect(interViewsBegin.text).toBe('FLOW_START_INTERVIEWS : Example Process Builder');
    expect(interViewsBegin.group).toBe('Process Builder');
    expect(interViewsBegin.suffix).toBe(' (Process Builder)');

    expect(interViewsBegin.children.length).toBe(2);
    const interViewBegin = interViewsBegin.children[0];
    expect(interViewBegin.type).toBe('FLOW_START_INTERVIEW_BEGIN');

    const interViewEnd = interViewsBegin.children[1];
    expect(interViewEnd.type).toBe('FLOW_START_INTERVIEW_END');
  });

  it('FlowStartInterviewsBeginLine should be a flow ', async () => {
    const log =
      '17:52:34.317 (1350000000)|EXECUTION_STARTED\n' +
      '17:52:35.317 (1363038330)|CODE_UNIT_STARTED|[EXTERNAL]|Flow:01Id0000000roIX\n' +
      '17:52:35.370 (1370636436)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
      '17:52:35.370 (1370676724)|FLOW_START_INTERVIEW_BEGIN|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Flow\n' +
      '17:52:35.370 (1377009430)|FLOW_START_INTERVIEW_END|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Flow\n' +
      '17:52:35.370 (1497348059)|FLOW_START_INTERVIEWS_END|1\n' +
      '17:52:35.317 (1499617717)|CODE_UNIT_FINISHED|Flow:01Id0000000roIX\n' +
      '17:52:36.317 (1500000000)|EXECUTION_FINISHED\n';

    parseLog(log);
    const rootMethod = getRootMethod();

    const timedLogLines = rootMethod.children as TimedNode[];
    expect(timedLogLines.length).toBe(1);
    const startLine = timedLogLines[0];
    expect(startLine.type).toBe('EXECUTION_STARTED');

    expect(startLine.children.length).toBe(1);
    const unitStart = startLine.children[0] as TimedNode;
    expect(unitStart.type).toBe('CODE_UNIT_STARTED');
    expect(unitStart.group).toBe('Flow');

    expect(unitStart.children.length).toBe(1);
    const interViewsBegin = unitStart.children[0] as TimedNode;
    expect(interViewsBegin.type).toBe('FLOW_START_INTERVIEWS_BEGIN');
    expect(interViewsBegin.text).toBe('FLOW_START_INTERVIEWS : Example Flow');
    expect(interViewsBegin.group).toBe('Flow');
    expect(interViewsBegin.suffix).toBe(' (Flow)');

    expect(interViewsBegin.children.length).toBe(2);
    const interViewBegin = interViewsBegin.children[0];
    expect(interViewBegin.type).toBe('FLOW_START_INTERVIEW_BEGIN');

    const interViewEnd = interViewsBegin.children[1];
    expect(interViewEnd.type).toBe('FLOW_START_INTERVIEW_END');
  });

  it('FlowStartInterviewsBeginLine should be a flow called from a process builder', async () => {
    const log =
      '17:52:34.317 (1350000000)|EXECUTION_STARTED\n' +
      '17:52:35.317 (1363038330)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:01Id0000000roIX\n' +
      '17:52:35.370 (1363038331)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
      '17:52:35.370 (1363038332)|FLOW_START_INTERVIEW_BEGIN|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Process Builder\n' +
      '17:52:35.370 (1363038333)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
      '17:52:35.370 (1363038334)|FLOW_START_INTERVIEW_BEGIN|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Flow\n' +
      '17:52:35.370 (1363038335)|FLOW_START_INTERVIEW_END|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Flow\n' +
      '17:52:35.370 (1363038336)|FLOW_START_INTERVIEWS_END|1\n' +
      '17:52:35.370 (1363038337)|FLOW_START_INTERVIEW_END|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Process Builder\n' +
      '17:52:35.370 (1363038338)|FLOW_START_INTERVIEWS_END|1\n' +
      '17:52:35.317 (1363038339)|CODE_UNIT_FINISHED|Workflow:01Id0000000roIX\n' +
      '17:52:36.317 (1500000000)|EXECUTION_FINISHED\n';

    parseLog(log);
    const rootMethod = getRootMethod();

    const timedLogLines = rootMethod.children as TimedNode[];
    expect(timedLogLines.length).toBe(1);
    const startLine = timedLogLines[0];
    expect(startLine.type).toBe('EXECUTION_STARTED');

    expect(startLine.children.length).toBe(1);
    const unitStart = startLine.children[0] as TimedNode;
    expect(unitStart.type).toBe('CODE_UNIT_STARTED');
    expect(unitStart.group).toBe('Workflow');

    expect(unitStart.children.length).toBe(1);
    const pbBegin = unitStart.children[0] as TimedNode;
    expect(pbBegin.type).toBe('FLOW_START_INTERVIEWS_BEGIN');
    expect(pbBegin.text).toBe('FLOW_START_INTERVIEWS : Example Process Builder');
    expect(pbBegin.group).toBe('Process Builder');
    expect(pbBegin.suffix).toBe(' (Process Builder)');

    expect(pbBegin.children.length).toBe(3);
    const pbDetail = pbBegin.children[0] as TimedNode;
    expect(pbDetail.type).toBe('FLOW_START_INTERVIEW_BEGIN');
    expect(pbDetail.text).toBe('Example Process Builder');

    const interViewsBegin = pbBegin.children[1] as TimedNode;
    expect(interViewsBegin.type).toBe('FLOW_START_INTERVIEWS_BEGIN');
    expect(interViewsBegin.text).toBe('FLOW_START_INTERVIEWS : Example Flow');
    expect(interViewsBegin.group).toBe('Flow');
    expect(interViewsBegin.suffix).toBe(' (Flow)');

    const pbDetailEnd = pbBegin.children[2] as TimedNode;
    expect(pbDetailEnd.type).toBe('FLOW_START_INTERVIEW_END');

    expect(interViewsBegin.children.length).toBe(2);
    const interViewBegin = interViewsBegin.children[0];
    expect(interViewBegin.type).toBe('FLOW_START_INTERVIEW_BEGIN');

    const interViewEnd = interViewsBegin.children[1];
    expect(interViewEnd.type).toBe('FLOW_START_INTERVIEW_END');
  });

  it('Root exitStamp should match last line pair with a duration', async () => {
    const log =
      '17:52:34.317 (1350000000)|EXECUTION_STARTED\n' +
      '17:52:35.317 (1363038330)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:01Id0000000roIX\n' +
      '17:52:35.370 (1363038331)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
      '17:52:35.370 (1363038332)|FLOW_START_INTERVIEW_BEGIN|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Process Builder\n' +
      '17:52:35.370 (1363038333)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
      '17:52:35.370 (1363038334)|FLOW_START_INTERVIEW_BEGIN|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Flow\n' +
      '17:52:35.370 (1363038335)|FLOW_START_INTERVIEW_END|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Flow\n' +
      '17:52:35.370 (1363038336)|FLOW_START_INTERVIEWS_END|1\n' +
      '17:52:35.370 (1363038337)|FLOW_START_INTERVIEW_END|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|Example Process Builder\n' +
      '17:52:35.370 (1363038338)|FLOW_START_INTERVIEWS_END|1\n' +
      '17:52:35.317 (1363038339)|CODE_UNIT_FINISHED|Workflow:01Id0000000roIX\n' +
      '17:52:36.317 (1500000000)|EXECUTION_FINISHED\n' +
      '17:52:36.320 (1510000000)|FLOW_START_INTERVIEWS_BEGIN|2\n' +
      '17:52:36.320 (1520000000)|FLOW_START_INTERVIEWS_END|2\n' +
      '17:52:36.321 (1530000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 0 out of 100';

    parseLog(log);
    const rootMethod = getRootMethod();
    // This should match the last node with a duration
    // The last log line is information only (duration is 0)
    // The last `FLOW_START_INTERVIEW_BEGIN` + `FLOW_START_INTERVIEW_END` are the last pair that will result in a duration
    expect(rootMethod.exitStamp).toBe(1530000000);
    expect(rootMethod.executionEndTime).toBe(1520000000);
  });

  it('Root exitStamp should match last line timestamp if none of the line pairs have duration', async () => {
    const log =
      '17:52:36.321 (1500000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 0 out of 100\n' +
      '17:52:37.321 (1510000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 1 out of 100\n' +
      '17:52:38.321 (1520000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 2 out of 100\n' +
      '17:52:39.321 (1530000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 3 out of 100\n';

    parseLog(log);
    const rootMethod = getRootMethod();
    expect(rootMethod.exitStamp).toBe(1530000000);
    expect(rootMethod.executionEndTime).toBe(0);
  });

  it('Entering Managed Package events should be merged', async () => {
    const log =
      '11:52:06.13 (100)|EXECUTION_STARTED\n' +
      '11:52:06.13 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|ns.MyClass.myMethod()\n' +
      '11:52:06.13 (151717928)|ENTERING_MANAGED_PKG|ns\n' +
      '11:52:06.13 (300)|METHOD_EXIT|[185]|01p4J00000FpS6t|ns.MyClass.myMethod()\n' +
      '11:52:06.13 (400)|ENTERING_MANAGED_PKG|ns\n' +
      '11:52:06.13 (500)|ENTERING_MANAGED_PKG|ns\n' +
      '11:52:06.13 (600)|ENTERING_MANAGED_PKG|ns\n' +
      '11:52:06.13 (700)|ENTERING_MANAGED_PKG|ns2\n' +
      '11:52:06.13 (725)|DML_BEGIN|[194]|Op:Update|Type:ns2__MyObject__c|Rows:1\n' +
      '11:52:06.13 (750)|DML_END|[194]\n' +
      '11:52:06.13 (800)|ENTERING_MANAGED_PKG|ns2\n' +
      '11:52:06.13 (900)|ENTERING_MANAGED_PKG|ns2\n' +
      '11:52:06.13 (1000)|ENTERING_MANAGED_PKG|ns2\n' +
      '11:52:06.13 (1100)|ENTERING_MANAGED_PKG|ns2\n';
    parseLog(log);
    const rootMethod = getRootMethod();
    expect(rootMethod.children.length).toBe(1);
    expect(rootMethod.exitStamp).toBe(1100);
    expect(rootMethod.executionEndTime).toBe(1100);

    const rootChildren = rootMethod.children as Method[];
    //expect([]).toBe(rootChildren);
    const executionChildren = rootChildren[0].children as Method[];
    expect(executionChildren.length).toBe(3);
    expect(executionChildren[0].type).toBe('METHOD_ENTRY');
    expect(executionChildren[0].timestamp).toBe(200);
    expect(executionChildren[0].exitStamp).toBe(300);

    expect(executionChildren[1].type).toBe('ENTERING_MANAGED_PKG');
    expect(executionChildren[1].namespace).toBe('ns');
    expect(executionChildren[1].timestamp).toBe(400);
    expect(executionChildren[1].exitStamp).toBe(700);

    expect(executionChildren[2].type).toBe('ENTERING_MANAGED_PKG');
    expect(executionChildren[2].namespace).toBe('ns2');
    expect(executionChildren[2].timestamp).toBe(700);
    expect(executionChildren[2].exitStamp).toBe(1100);
    expect(executionChildren[2].children.length).toBe(1);
    expect(executionChildren[2].children[0].type).toBe('DML_BEGIN');
  });
});

describe('lineTypeMap tests', () => {
  it('Lines referenced by exitTypes should be exits', () => {
    for (const [_keyName, cls] of lineTypeMap) {
      const line = new cls([
        '14:32:07.563 (17358806534)',
        'DUMMY',
        '[10]',
        'Rows:3',
        '',
        'Rows:5',
      ]) as LogLine;
      if (line instanceof Method) {
        expect(line.exitTypes).not.toBe(null);
        expect(line.isExit).toBe(false);
        line.exitTypes.forEach((exitType) => {
          const exitCls = lineTypeMap.get(exitType);
          expect(exitCls).not.toBe(null);
          if (exitCls) {
            const exitLine = new exitCls([
              '14:32:07.563 (17358806534)',
              'DUMMY',
              '[10]',
              'Rows:3',
              '',
              'Rows:5',
            ]) as LogLine;
            expect(exitLine.isExit).toBe(true);
          }
        });
      }
    }
  });
});

describe('Log Settings tests', () => {
  const log =
    '43.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,INFO;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,INFO\n' +
    '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|partner.nisar.ahmed@philips.com.m2odryrun1|Greenwich Mean Time|GMTZ\n' +
    '09:18:22.6 (6574780)|EXECUTION_STARTED';

  it('The settings should be found', () => {
    expect(getLogSettings(log)).not.toBe(null);
  });
  it('The settings should be as expected', () => {
    expect(getLogSettings(log)).toEqual([
      { key: 'APEX_CODE', level: 'FINE' },
      { key: 'APEX_PROFILING', level: 'NONE' },
      { key: 'CALLOUT', level: 'NONE' },
      { key: 'DB', level: 'INFO' },
      { key: 'NBA', level: 'NONE' },
      { key: 'SYSTEM', level: 'NONE' },
      { key: 'VALIDATION', level: 'INFO' },
      { key: 'VISUALFORCE', level: 'NONE' },
      { key: 'WAVE', level: 'NONE' },
      { key: 'WORKFLOW', level: 'INFO' },
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
