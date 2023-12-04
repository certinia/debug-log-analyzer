/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  CodeUnitStartedLine,
  ExecutionStartedLine,
  LogLine,
  Method,
  MethodEntryLine,
  SOQLExecuteBeginLine,
  SOQLExecuteExplainLine,
  TimedNode,
  lineTypeMap,
  parse,
  parseLineNumber,
  parseObjectNamespace,
  parseRows,
  parseTimestamp,
  parseVfNamespace,
} from '../parsers/ApexLogParser.js';

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
  const log1 = parse('09:18:22.6 (6574780)|DUMMY');

  it('Parser will return 0 lines if line has invalid type name', () => {
    expect(log1.children.length).toEqual(0);
  });

  const line =
    '15:20:52.222 (6574780)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()';
  const log2 = parse(line);

  it('Should return an object with meta as prototype', () => {
    const methodLine = log2.children[0];
    expect(methodLine).toBeInstanceOf(MethodEntryLine);
    expect(methodLine?.logLine).toEqual(line);
    expect(methodLine?.timestamp).toEqual(6574780);
  });
});

describe('Pseudo EXIT events', () => {
  it('WF_APPROVAL_SUBMIT', () => {
    const logData =
      '00:00:00.757 (1)|WF_APPROVAL_SUBMIT|[Record: myrecord1 anId1]\n' +
      '00:00:00.757 (2)|WF_PROCESS_FOUND|ProcessDefinitionNameOrId:<processId>|Applicable process was found.\n' +
      '00:00:00.757 (3)|WF_APPROVAL_SUBMIT|[Record: myrecord2 anId2]\n' +
      '00:00:00.757 (4)|WF_PROCESS_FOUND|ProcessDefinitionNameOrId:<processId>|Applicable process was found.';

    const log1 = parse(logData);
    expect(log1.children.length).toEqual(4);
    expect(log1.duration).toEqual({ self: 0, total: 3 });

    const approval1 = log1.children[0] as Method;
    expect(approval1.duration).toEqual({ self: 1, total: 1 });
    expect(approval1.type).toEqual('WF_APPROVAL_SUBMIT');

    const processFound1 = log1.children[1] as Method;
    expect(processFound1.duration).toEqual({ self: 1, total: 1 });
    expect(processFound1.type).toEqual('WF_PROCESS_FOUND');

    const approval2 = log1.children[2] as Method;
    expect(approval2.duration).toEqual({ self: 1, total: 1 });
    expect(approval2.type).toEqual('WF_APPROVAL_SUBMIT');

    const processFound2 = log1.children[3] as Method;
    expect(processFound2.duration).toEqual({ self: 0, total: 0 }); // no lines after the last WF_PROCESS_FOUND to use as an exit
    expect(processFound2.type).toEqual('WF_PROCESS_FOUND');
  });

  it('Pseudo EXIT With Entry after last event', () => {
    const logData =
      '00:00:00.757 (1)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:ApprovalProcessActions\n' +
      '00:00:00.757 (2)|WF_NEXT_APPROVER|Phillip Box|Related User|: Approver\n' +
      '00:00:00.757 (3)|WF_NEXT_APPROVER|Phillip Box|Related User|: Approver\n' +
      '00:00:00.757 (4)|WF_NEXT_APPROVER|Phillip Box|Related User|: Approver\n' +
      '00:00:00.757 (5)|METHOD_ENTRY|[17]|a00000000000000|ns.MyClass.myMethod()\n' +
      '00:00:00.757 (6)|METHOD_EXIT|[17]|a00000000000000|ns.MyClass.myMethod()\n' +
      '00:00:00.757 (7)|CODE_UNIT_FINISHED|Workflow:ApprovalProcessActions\n';

    const log1 = parse(logData);
    expect(log1.children.length).toEqual(1);
    expect(log1.duration).toEqual({ self: 0, total: 6 });

    const children = (log1.children[0] as Method).children;
    expect(children.length).toEqual(4);

    const child1 = children[0] as Method;
    expect(child1.timestamp).toEqual(2);
    expect(child1.exitStamp).toEqual(3);

    const child2 = children[1] as Method;
    expect(child2.timestamp).toEqual(3);
    expect(child2.exitStamp).toEqual(4);

    const child3 = children[2] as Method;
    expect(child3.timestamp).toEqual(4);
    expect(child3.exitStamp).toEqual(5);

    const child4 = children[3] as Method;
    expect(child4.timestamp).toEqual(5);
    expect(child4.exitStamp).toEqual(6);
  });

  it('Pseudo EXIT With Exit after last event', () => {
    const logData =
      '00:00:00.757 (1)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:ApprovalProcessActions\n' +
      '00:00:00.757 (2)|WF_NEXT_APPROVER|Phillip Box|Related User|: Approver\n' +
      '00:00:00.757 (3)|WF_NEXT_APPROVER|Phillip Box|Related User|: Approver\n' +
      '00:00:00.757 (4)|WF_NEXT_APPROVER|Phillip Box|Related User|: Approver\n' +
      '00:00:00.757 (5)|CODE_UNIT_FINISHED|Workflow:ApprovalProcessActions\n';

    const log1 = parse(logData);
    expect(log1.children.length).toEqual(1);
    expect(log1.duration).toEqual({ self: 0, total: 4 });

    const children = (log1.children[0] as Method).children;
    expect(children.length).toEqual(3);

    const child1 = children[0] as Method;
    expect(child1.timestamp).toEqual(2);
    expect(child1.exitStamp).toEqual(3);

    const child2 = children[1] as Method;
    expect(child2.timestamp).toEqual(3);
    expect(child2.exitStamp).toEqual(4);

    const child3 = children[2] as Method;
    expect(child3.timestamp).toEqual(4);
    expect(child3.exitStamp).toEqual(5);
  });
});

describe('Invalid Debug Lines tests', () => {
  it('Unrecognised line type will added to issues', () => {
    const log1 = parse('09:18:22.6 (1)|FAKE_TYPE');
    expect(log1.children.length).toEqual(0);
    expect(log1.parsingErrors.length).toEqual(1);
    expect(log1.parsingErrors[0]).toEqual(`Unsupported log event name: FAKE_TYPE`);
  });

  it('Bad Log line will added to issues', () => {
    const log1 = parse('INVALID LINE');
    expect(log1.children.length).toEqual(0);
    expect(log1.parsingErrors.length).toEqual(1);
    expect(log1.parsingErrors[0]).toEqual(`Invalid log line: INVALID LINE`);
  });
});

describe('parseLog tests', () => {
  it('Should parse between EXECUTION_STARTED and EXECUTION_FINISHED and return an iterator', async () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|user@example.com|Greenwich Mean Time|GMT+01:00\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const logLines = apexLog.children;
    expect(logLines.length).toEqual(1);
    expect(logLines[0]).toBeInstanceOf(ExecutionStartedLine);

    const firstChildren = (logLines[0] as Method).children;
    expect(firstChildren.length).toEqual(1);
    expect(firstChildren[0]).toBeInstanceOf(CodeUnitStartedLine);
  });

  it('Should parse between EXECUTION_STARTED and EXECUTION_FINISHED for CRLF (\r\n)', async () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|user@example.com|Greenwich Mean Time|GMT+01:00\r\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\r\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\r\n' +
      '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\r\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\r\n';

    const apexLog = parse(log);

    expect(apexLog.children.length).toEqual(1);
    expect(apexLog.children[0]).toBeInstanceOf(ExecutionStartedLine);

    const firstChildren = (apexLog.children[0] as Method).children;
    expect(firstChildren.length).toEqual(1);
    expect(firstChildren[0]).toBeInstanceOf(CodeUnitStartedLine);
  });

  it('Should handle partial logs', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|pse.VFRemote: pse.SenchaTCController invoke(saveTimecard)\n';

    const apexLog = parse(log);

    expect(apexLog.children.length).toBe(1);
    expect(apexLog.children[0]).toBeInstanceOf(ExecutionStartedLine);

    const firstChildren = (apexLog.children[0] as Method).children;
    expect(firstChildren[0]).toBeInstanceOf(CodeUnitStartedLine);
  });

  it('Should detect skipped log entries', async () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '*** Skipped 22606355 bytes of detailed log\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.children.length).toBe(1);
    expect(apexLog.logIssues[0]?.summary).toBe('Skipped-Lines');
  });

  it('Should detect truncated logs', async () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n';

    const apexLog = parse(log);

    expect(apexLog.children.length).toBe(1);
    expect(apexLog.logIssues.length).toBe(2);
    expect(apexLog.logIssues[0]?.summary).toBe('Unexpected-End');
    expect(apexLog.logIssues[1]?.summary).toBe('Max-Size-reached');
  });

  it('Should detect exceptions', async () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '16:16:04.97 (1000)|EXCEPTION_THROWN|[60]|System.LimitException: c2g:Too many SOQL queries: 101\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.children.length).toBe(1);
    expect(apexLog.logIssues[0]?.summary).toBe(
      'System.LimitException: c2g:Too many SOQL queries: 101',
    );
  });
  it('Should detect fatal errors', async () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '16:16:04.97 (1000)|FATAL_ERROR|System.LimitException: c2g:Too many SOQL queries: 101\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.children.length).toBe(1);
    expect(apexLog.logIssues[0]?.summary).toBe(
      'FATAL ERROR! cause=System.LimitException: c2g:Too many SOQL queries: 101',
    );
  });
  it('Methods should have line-numbers', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (4113741282)|METHOD_ENTRY|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '15:20:52.222 (4113760256)|METHOD_EXIT|[185]|01p4J00000FpS6t|CODAUnitOfWork.getNextIdInternal()\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.children.length).toBe(1);
    const executeEvent = apexLog.children[0] as MethodEntryLine;

    expect(executeEvent.children[0]?.lineNumber).toBe(185);
  });
  it('Packages should have a namespace', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '11:52:06.13 (151717928)|ENTERING_MANAGED_PKG|appirio_core\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const execEvent = apexLog.children[0] as MethodEntryLine;
    expect(execEvent.children[0]?.namespace).toBe('appirio_core');
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

    const apexLog = parse(log);
    expect(apexLog.cpuTime).toBe(4564000000);
    const execEvent = apexLog.children[0] as MethodEntryLine;
    expect(execEvent.children.length).toBe(1);

    const cumulativeUsage = execEvent.children[0] as MethodEntryLine;
    const limitUsage = cumulativeUsage.children[0] as MethodEntryLine;
    expect(limitUsage.type).toBe('LIMIT_USAGE_FOR_NS');
  });

  it('Flow Value Assignemnt can handle multiple lines', async () => {
    const log =
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '09:18:22.670 (1372614277)|FLOW_VALUE_ASSIGNMENT|91080693a3c13822bcdbdd838a5180aed7a0e-5f03|myVariable_old|{Id=a6U6T000001DypKUAS, OwnerId=005d0000003141tAAA, IsDeleted=false, Name=TR-001752, CurrencyIsoCode=USD, RecordTypeId=012d0000000T5CLAA0, CreatedDate=2022-05-06 11:40:47, CreatedById=005d0000003141tAAA, LastModifiedDate=2022-05-06 11:40:47, LastModifiedById=005d0000003141tAAA, SystemModstamp=2022-05-06 11:40:47, LastViewedDate=null, LastReferencedDate=null, SCMC__Carrier_Service__c=null, SCMC__Carrier__c=null, SCMC__Destination_Location__c=null, SCMC__Destination_Ownership__c=null, SCMC__Destination_Warehouse__c=a6Y6T000001Ib9ZUAS, SCMC__Notes__c=TVPs To Amazon Europe Spain, SCMC__Override_Ship_To_Address__c=null, SCMC__Pickup_Address__c=null, SCMC__Pickup_Required__c=false, SCMC__Reason_Code__c=a5i0W000001Ydw3QAC, SCMC__Requested_Delivery_Date__c=null, SCMC__Revision__c=0, SCMC__Ship_To_City__c=null, SCMC__Ship_To_Country__c=null, SCMC__Ship_To_Line_1__c=null, SCMC__Ship_To_Line_2__c=null, SCMC__Ship_To_Name__c=null, SCMC__Ship_To_State_Province__c=null, SCMC__Ship_To_Zip_Postal_Code__c=null, SCMC__Shipment_Date__c=null, SCMC__Shipment_Required__c=true, SCMC__Shipment_Status__c=Open, SCMC__Source_Location__c=null, SCMC__Source_Ownership__c=null, SCMC__Source_Warehouse__c=a6Y6T000001IS9fUAG, SCMC__Status__c=New, SCMC__Tracking_Number__c=null, SCMC__Number_Of_Transfer_Lines__c=0, Created_Date__c=2022-05-06 11:40:47, Shipment_Instructions__c=1Z V8F 767 681769 7682\n' +
      '1Z V8F 767 68 3968 7204\n' +
      '1Z VSF 767 68 0562 3292}\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED';

    const apexLog = parse(log);

    expect(apexLog.cpuTime).toBe(0);

    const execEvent = apexLog.children[0] as MethodEntryLine;
    expect(execEvent.children.length).toBe(1);

    const flowLine = execEvent.children[0];
    expect(flowLine?.type).toBe('FLOW_VALUE_ASSIGNMENT');
    expect(flowLine?.text).toBe(
      'myVariable_old {Id=a6U6T000001DypKUAS, OwnerId=005d0000003141tAAA, IsDeleted=false, Name=TR-001752, CurrencyIsoCode=USD, RecordTypeId=012d0000000T5CLAA0, CreatedDate=2022-05-06 11:40:47, CreatedById=005d0000003141tAAA, LastModifiedDate=2022-05-06 11:40:47, LastModifiedById=005d0000003141tAAA, SystemModstamp=2022-05-06 11:40:47, LastViewedDate=null, LastReferencedDate=null, SCMC__Carrier_Service__c=null, SCMC__Carrier__c=null, SCMC__Destination_Location__c=null, SCMC__Destination_Ownership__c=null, SCMC__Destination_Warehouse__c=a6Y6T000001Ib9ZUAS, SCMC__Notes__c=TVPs To Amazon Europe Spain, SCMC__Override_Ship_To_Address__c=null, SCMC__Pickup_Address__c=null, SCMC__Pickup_Required__c=false, SCMC__Reason_Code__c=a5i0W000001Ydw3QAC, SCMC__Requested_Delivery_Date__c=null, SCMC__Revision__c=0, SCMC__Ship_To_City__c=null, SCMC__Ship_To_Country__c=null, SCMC__Ship_To_Line_1__c=null, SCMC__Ship_To_Line_2__c=null, SCMC__Ship_To_Name__c=null, SCMC__Ship_To_State_Province__c=null, SCMC__Ship_To_Zip_Postal_Code__c=null, SCMC__Shipment_Date__c=null, SCMC__Shipment_Required__c=true, SCMC__Shipment_Status__c=Open, SCMC__Source_Location__c=null, SCMC__Source_Ownership__c=null, SCMC__Source_Warehouse__c=a6Y6T000001IS9fUAG, SCMC__Status__c=New, SCMC__Tracking_Number__c=null, SCMC__Number_Of_Transfer_Lines__c=0, Created_Date__c=2022-05-06 11:40:47, Shipment_Instructions__c=1Z V8F 767 681769 7682\n' +
        '1Z V8F 767 68 3968 7204\n' +
        '1Z VSF 767 68 0562 3292}',
    );
  });

  it('VF_APEX_CALL_START for ApexMessages calls should have no exittypes', async () => {
    const log = `09:15:43.263 (263506132)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex <init>
    09:15:43.263 (263714319)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex set(conEscape)
    09:15:43.263 (263738292)|VF_APEX_CALL_START|[EXTERNAL]|PageMessagesComponentController set(conEscape)
    09:15:43.263 (263756710)|VF_APEX_CALL_START|[EXTERNAL]|PageMessagesComponentController invoke(setconEscape)
    09:15:43.263 (263912147)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex get(severities)
    09:15:43.263 (263933174)|VF_APEX_CALL_START|[EXTERNAL]|PageMessagesComponentController invoke(getseverities)
    09:15:43.265 (265740249)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagecomponentcontroller.apex <init>
    09:15:43.265 (265929451)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex get(conEscape)
    09:15:43.265 (265953893)|VF_APEX_CALL_START|[EXTERNAL]|PageMessagesComponentController invoke(getconEscape)
    09:15:43.266 (266057615)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagecomponentcontroller.apex set(conEscape)
    09:15:43.266 (266077465)|VF_APEX_CALL_START|[EXTERNAL]|pagemessagecomponentcontroller set(conEscape)
    09:15:43.266 (266093105)|VF_APEX_CALL_START|[EXTERNAL]|pagemessagecomponentcontroller invoke(setconEscape)
    09:15:43.266 (266182651)|VF_APEX_CALL_START|[EXTERNAL]|severity
    09:15:43.334 (334702333)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagecomponentcontroller.apex set(conSeverity)
    09:15:43.334 (334715923)|VF_APEX_CALL_START|[EXTERNAL]|pagemessagecomponentcontroller set(conSeverity)
    09:15:43.334 (334762915)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagecomponentcontroller.apex set(conStrength)
    09:15:43.334 (334774783)|VF_APEX_CALL_START|[EXTERNAL]|pagemessagecomponentcontroller set(conStrength)
    09:15:43.334 (334880548)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagecomponentcontroller.apex get(styleClass)
    09:15:43.334 (334897897)|VF_APEX_CALL_START|[EXTERNAL]|pagemessagecomponentcontroller invoke(getstyleClass)
    09:15:43.335 (335434720)|VF_APEX_CALL_START|[EXTERNAL]|severityMessages invoke(getlabel)
    09:15:43.335 (335739619)|VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagecomponentcontroller.apex get(conEscape)
    09:15:43.335 (335765383)|VF_APEX_CALL_START|[EXTERNAL]|pagemessagecomponentcontroller invoke(getconEscape)
    09:15:43.335 (335933546)|VF_APEX_CALL_START|[EXTERNAL]|isSingle
    09:15:43.336 (336270391)|VF_APEX_CALL_START|[EXTERNAL]|messages`;

    const apexLog = parse(log);

    const methods = apexLog.children as Method[];
    expect(methods.length).toBe(24);
    methods.forEach((line) => {
      expect(line.exitTypes.length).toBe(0);
    });
  });

  it('should parse SOQL lines', async () => {
    const log =
      '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|user@example.com|Greenwich Mean Time|GMT+01:00\r\n' +
      '09:18:22.6 (6574780)|EXECUTION_STARTED\r\n' +
      '06:22:49.429 (15821966627)|SOQL_EXECUTE_BEGIN|[895]|Aggregations:2|SELECT Id FROM MySObject__c WHERE Id = :recordId\n' +
      '06:22:49.429 (15861642580)|SOQL_EXECUTE_EXPLAIN|[895]|TableScan on MySObject__c : [MyField__c, AnotherField__c], cardinality: 2, sobjectCardinality: 2, relativeCost 1.3\n' +
      '06:22:49.429 (15861665431)|SOQL_EXECUTE_END|[895]|Rows:50\n' +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const execEvent = apexLog.children[0] as MethodEntryLine;
    expect(execEvent).toBeInstanceOf(ExecutionStartedLine);

    expect(execEvent.children.length).toEqual(1);
    const soqlLine = execEvent.children[0] as SOQLExecuteBeginLine;
    expect(soqlLine.type).toEqual('SOQL_EXECUTE_BEGIN');
    expect(soqlLine.aggregations).toEqual(2);
    expect(soqlLine.rowCount.self).toEqual(50);
    expect(soqlLine.rowCount.total).toEqual(50);

    const soqlExplain = soqlLine.children[0] as SOQLExecuteExplainLine;
    expect(soqlExplain.type).toEqual('SOQL_EXECUTE_EXPLAIN');
    expect(soqlExplain.type).toEqual('SOQL_EXECUTE_EXPLAIN');
    expect(soqlExplain.cardinality).toEqual(2);
    expect(soqlExplain.fields).toEqual(['MyField__c', 'AnotherField__c']);
    expect(soqlExplain.leadingOperationType).toEqual('TableScan');
    expect(soqlExplain.relativeCost).toEqual(1.3);
    expect(soqlExplain.sObjectCardinality).toEqual(2);
    expect(soqlExplain.sObjectType).toEqual('MySObject__c');
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

    const apexLog = parse(log);

    const timedLogLines = apexLog.children as TimedNode[];
    expect(timedLogLines.length).toBe(1);
    const startLine = timedLogLines[0];
    expect(startLine?.type).toBe('EXECUTION_STARTED');

    expect(startLine?.children.length).toBe(1);
    const unitStart = startLine?.children[0] as CodeUnitStartedLine;
    expect(unitStart.type).toBe('CODE_UNIT_STARTED');
    expect(unitStart.codeUnitType).toBe('Workflow');

    expect(unitStart.children.length).toBe(1);
    const interViewsBegin = unitStart.children[0] as TimedNode;
    expect(interViewsBegin.type).toBe('FLOW_START_INTERVIEWS_BEGIN');
    expect(interViewsBegin.text).toBe('FLOW_START_INTERVIEWS : Example Process Builder');
    expect(interViewsBegin.suffix).toBe(' (Process Builder)');

    expect(interViewsBegin.children.length).toBe(1);
    const interViewBegin = interViewsBegin.children[0];
    expect(interViewBegin?.type).toBe('FLOW_START_INTERVIEW_BEGIN');
    expect(interViewBegin?.duration).toEqual({ self: 6332706, total: 6332706 });
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

    const apexLog = parse(log);

    const timedLogLines = apexLog.children as TimedNode[];
    expect(timedLogLines.length).toBe(1);
    const startLine = timedLogLines[0];
    expect(startLine?.type).toBe('EXECUTION_STARTED');

    expect(startLine?.children.length).toBe(1);
    const unitStart = startLine?.children[0] as CodeUnitStartedLine;
    expect(unitStart.type).toBe('CODE_UNIT_STARTED');
    expect(unitStart.codeUnitType).toBe('Flow');

    expect(unitStart.children.length).toBe(1);
    const interViewsBegin = unitStart.children[0] as TimedNode;
    expect(interViewsBegin.type).toBe('FLOW_START_INTERVIEWS_BEGIN');
    expect(interViewsBegin.text).toBe('FLOW_START_INTERVIEWS : Example Flow');
    expect(interViewsBegin.suffix).toBe(' (Flow)');

    expect(interViewsBegin.children.length).toBe(1);
    const interViewBegin = interViewsBegin.children[0];
    expect(interViewBegin?.type).toBe('FLOW_START_INTERVIEW_BEGIN');
    expect(interViewBegin?.duration).toEqual({ self: 6332706, total: 6332706 });
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

    const apexLog = parse(log);

    const timedLogLines = apexLog.children as TimedNode[];
    expect(timedLogLines.length).toBe(1);
    const startLine = timedLogLines[0];
    expect(startLine?.type).toBe('EXECUTION_STARTED');

    expect(startLine?.children.length).toBe(1);
    const unitStart = startLine?.children[0] as CodeUnitStartedLine;
    expect(unitStart.type).toBe('CODE_UNIT_STARTED');
    expect(unitStart.codeUnitType).toBe('Workflow');

    expect(unitStart.children.length).toBe(1);
    const pbBegin = unitStart.children[0] as TimedNode;
    expect(pbBegin.type).toBe('FLOW_START_INTERVIEWS_BEGIN');
    expect(pbBegin.text).toBe('FLOW_START_INTERVIEWS : Example Process Builder');
    expect(pbBegin.suffix).toBe(' (Process Builder)');

    expect(pbBegin.children.length).toBe(1);
    const pbDetail = pbBegin.children[0] as TimedNode;
    expect(pbDetail.type).toBe('FLOW_START_INTERVIEW_BEGIN');
    expect(pbDetail.text).toBe('Example Process Builder');

    const interViewsBegin = pbDetail.children[0] as TimedNode;
    expect(interViewsBegin.type).toBe('FLOW_START_INTERVIEWS_BEGIN');
    expect(interViewsBegin.text).toBe('FLOW_START_INTERVIEWS : Example Flow');
    expect(interViewsBegin.suffix).toBe(' (Flow)');
    expect(interViewsBegin.duration).toEqual({ self: 2, total: 3 });

    expect(interViewsBegin.children.length).toBe(1);
    const interViewBegin = interViewsBegin.children[0];
    expect(interViewBegin?.type).toBe('FLOW_START_INTERVIEW_BEGIN');
    expect(interViewBegin?.duration).toEqual({ self: 1, total: 1 });
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

    const apexLog = parse(log);

    // This should match the last node with a duration
    // The last log line is information only (duration is 0)
    // The last `FLOW_START_INTERVIEW_BEGIN` + `FLOW_START_INTERVIEW_END` are the last pair that will result in a duration
    expect(apexLog.exitStamp).toBe(1530000000);
    expect(apexLog.executionEndTime).toBe(1520000000);
  });

  it('Root exitStamp should match last line timestamp if none of the line pairs have duration', async () => {
    const log =
      '17:52:36.321 (1500000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 0 out of 100\n' +
      '17:52:37.321 (1510000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 1 out of 100\n' +
      '17:52:38.321 (1520000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 2 out of 100\n' +
      '17:52:39.321 (1530000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 3 out of 100\n';

    const apexLog = parse(log);

    expect(apexLog.exitStamp).toBe(1530000000);
    expect(apexLog.executionEndTime).toBe(0);
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

    const apexLog = parse(log);

    expect(apexLog.children.length).toBe(1);
    expect(apexLog.exitStamp).toBe(1100);
    expect(apexLog.executionEndTime).toBe(1100);

    const rootChildren = apexLog.children as Method[];

    const executionChildren = rootChildren[0]?.children as Method[];
    expect(executionChildren.length).toBe(5);
    expect(executionChildren[0]?.type).toBe('METHOD_ENTRY');
    expect(executionChildren[0]?.timestamp).toBe(200);
    expect(executionChildren[0]?.exitStamp).toBe(300);
    expect(executionChildren[0]?.children.length).toBe(1);
    expect(executionChildren[0]?.children[0]?.type).toBe('ENTERING_MANAGED_PKG');
    expect(executionChildren[0]?.children[0]?.namespace).toBe('ns');

    expect(executionChildren[1]?.type).toBe('ENTERING_MANAGED_PKG');
    expect(executionChildren[1]?.namespace).toBe('ns');
    expect(executionChildren[1]?.timestamp).toBe(400);
    expect(executionChildren[1]?.exitStamp).toBe(700);

    expect(executionChildren[2]?.type).toBe('ENTERING_MANAGED_PKG');
    expect(executionChildren[2]?.namespace).toBe('ns2');
    expect(executionChildren[2]?.timestamp).toBe(700);
    expect(executionChildren[2]?.exitStamp).toBe(725);

    expect(executionChildren[3]?.type).toBe('DML_BEGIN');
    expect(executionChildren[3]?.timestamp).toBe(725);
    expect(executionChildren[3]?.exitStamp).toBe(750);

    expect(executionChildren[4]?.type).toBe('ENTERING_MANAGED_PKG');
    expect(executionChildren[4]?.namespace).toBe('ns2');
    expect(executionChildren[4]?.timestamp).toBe(800);
    expect(executionChildren[4]?.exitStamp).toBe(1100);
    expect(executionChildren[4]?.children.length).toBe(0);
  });
});

describe('Log Settings tests', () => {
  const log =
    '43.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,INFO;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,INFO\n' +
    '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|partner.nisar.ahmed@philips.com.m2odryrun1|Greenwich Mean Time|GMTZ\n' +
    '09:18:22.6 (6574780)|EXECUTION_STARTED';

  const apexLog = parse(log);

  it('The settings should be found', () => {
    expect(apexLog.debugLevels).not.toBe(null);
  });
  it('The settings should be as expected', () => {
    expect(apexLog.debugLevels).toEqual([
      { logCategory: 'APEX_CODE', logLevel: 'FINE' },
      { logCategory: 'APEX_PROFILING', logLevel: 'NONE' },
      { logCategory: 'CALLOUT', logLevel: 'NONE' },
      { logCategory: 'DB', logLevel: 'INFO' },
      { logCategory: 'NBA', logLevel: 'NONE' },
      { logCategory: 'SYSTEM', logLevel: 'NONE' },
      { logCategory: 'VALIDATION', logLevel: 'INFO' },
      { logCategory: 'VISUALFORCE', logLevel: 'NONE' },
      { logCategory: 'WAVE', logLevel: 'NONE' },
      { logCategory: 'WORKFLOW', logLevel: 'INFO' },
    ]);
  });
});

describe('Recalculate durations tests', () => {
  it('Recalculates parent node', () => {
    const node = new Method(['14:32:07.563 (1)', 'DUMMY'], [], 'Method', '');
    node.exitStamp = 3;

    node.recalculateDurations();
    expect(node.duration).toEqual({ self: 2, total: 2 });
  });

  it('Children are subtracted from net duration', () => {
    const node = new Method(['14:32:07.563 (0)', 'DUMMY'], [], 'Method', ''),
      child1 = new Method(['14:32:07.563 (10)', 'DUMMY'], [], 'Method', ''),
      child2 = new Method(['14:32:07.563 (70)', 'DUMMY'], [], 'Method', '');
    node.exitStamp = 100;
    child1.duration.total = 50;
    child2.duration.total = 25;
    node.addChild(child1);
    node.addChild(child2);
    node.recalculateDurations();
    expect(node.duration).toEqual({ self: 25, total: 100 });
  });
});

describe('Line Type Tests', () => {
  it('Lines referenced by exitTypes should be exits', () => {
    for (const [key, lineType] of lineTypeMap) {
      const line = new lineType([
        '14:32:07.563 (17358806534)',
        'DUMMY',
        '[10]',
        'Rows:3',
        '',
        'Rows:5',
      ]) as LogLine;
      if (line instanceof Method) {
        expect(line.exitTypes).not.toBe(null);
        if (line.isExit) {
          expect(line.exitTypes).toEqual([key]);
        }
        line.exitTypes.forEach((exitType) => {
          const exitCls = lineTypeMap.get(exitType);
          expect(exitCls).not.toBe(null);
          if (exitCls) {
            const exitLine = new exitCls!([
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

  it('SOQL Explain null when no plan available ', () => {
    const qp = new SOQLExecuteExplainLine([
      '6:22:36.91 (2106345473)',
      'SOQL_EXECUTE_EXPLAIN',
      '[19]',
      'No explain plan is available',
    ]);

    expect(qp.cardinality).toBe(null);
    expect(qp.fields).toBe(null);
    expect(qp.leadingOperationType).toBe(null);
    expect(qp.relativeCost).toBe(null);
    expect(qp.sObjectCardinality).toBe(null);
    expect(qp.sObjectType).toBe(null);
  });
});
