/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  ApexLogParser,
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
  parseObjectNamespace,
  parseRows,
  parseVfNamespace,
} from '../parsers/ApexLogParser.js';

describe('parseObjectNamespace tests', () => {
  it('Should consider no separator to be unmanaged', () => {
    expect(parseObjectNamespace('Account')).toEqual('default');
  });
  it('Should accept properly formatted namespaces', () => {
    expect(parseObjectNamespace('key001__Upsell_Contract__e')).toEqual('key001');
  });
});

describe('parseVfNamespace tests', () => {
  it('Should consider no separator to be unmanaged', () => {
    expect(parseVfNamespace('VF: /apex/CashMatching')).toEqual('default');
  });
  it('Should consider no slashes to be unmanaged', () => {
    expect(parseVfNamespace('VF: pse__ProjectBilling')).toEqual('default');
  });
  it('Should consider one slash to be unmanaged', () => {
    expect(parseVfNamespace('VF: /pse__ProjectBilling')).toEqual('default');
  });
  it('Should accept properly formatted namespaces', () => {
    expect(parseVfNamespace('VF: /apex/pse__ProjectBilling')).toEqual('pse');
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
    expect(approval1).toMatchObject({
      type: 'WF_APPROVAL_SUBMIT',
      timestamp: 1,
      duration: { self: 1, total: 1 },
    });

    const processFound1 = log1.children[1] as Method;
    expect(processFound1).toMatchObject({
      parent: log1,
      type: 'WF_PROCESS_FOUND',
      timestamp: 2,
      duration: { self: 1, total: 1 },
    });

    const approval2 = log1.children[2] as Method;
    expect(approval2).toMatchObject({
      parent: log1,
      type: 'WF_APPROVAL_SUBMIT',
      timestamp: 3,
      duration: { self: 1, total: 1 },
    });

    const processFound2 = log1.children[3] as Method;
    expect(processFound2).toMatchObject({
      parent: log1,
      type: 'WF_PROCESS_FOUND',
      timestamp: 4,
      duration: { self: 0, total: 0 }, // no lines after the last WF_PROCESS_FOUND to use as an exit
    });
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
      '09:18:22.6 (0)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (1)|METHOD_ENTRY|[185]|Id1|CODAUnitOfWork.getNextIdInternal()\n' +
      '15:20:52.222 (2)|METHOD_EXIT|[185]|Id1|CODAUnitOfWork.getNextIdInternal()\n' +
      '15:20:52.222 (3)|METHOD_ENTRY|[EXTERNAL]|Id2|MyClass.MyMethod2()\n' +
      '15:20:52.222 (4)|METHOD_EXIT|[EXTERNAL]|Id2|MyClass.MyMethod2()\n' +
      '09:19:13.82 (5)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.children.length).toBe(1);
    const executeEvent = apexLog.children[0] as MethodEntryLine;
    expect(executeEvent.children[0]?.lineNumber).toBe(185);
    expect(executeEvent.children[1]?.lineNumber).toBe('EXTERNAL');
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
  it('Limit Usage for NS as child of CUMULATIVE_LIMIT_USAGE', async () => {
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
    expect(soqlLine).toMatchObject({
      parent: execEvent,
      type: 'SOQL_EXECUTE_BEGIN',
      aggregations: 2,
      soqlRowCount: { self: 50, total: 50 },
      soqlCount: { self: 1, total: 1 },
    });

    const soqlExplain = soqlLine.children[0] as SOQLExecuteExplainLine;
    expect(soqlExplain).toMatchObject({
      parent: soqlLine,
      type: 'SOQL_EXECUTE_EXPLAIN',
      cardinality: 2,
      fields: ['MyField__c', 'AnotherField__c'],
      leadingOperationType: 'TableScan',
      relativeCost: 1.3,
      sObjectCardinality: 2,
      sObjectType: 'MySObject__c',
    });
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
    expect(unitStart).toMatchObject({
      parent: startLine,
      type: 'CODE_UNIT_STARTED',
      codeUnitType: 'Workflow',
    });

    expect(unitStart.children.length).toBe(1);
    const interViewsBegin = unitStart.children[0] as TimedNode;
    expect(interViewsBegin).toMatchObject({
      parent: unitStart,
      type: 'FLOW_START_INTERVIEWS_BEGIN',
      text: 'FLOW_START_INTERVIEWS : Example Process Builder',
      suffix: ' (Process Builder)',
    });

    expect(interViewsBegin.children.length).toBe(1);
    const interViewBegin = interViewsBegin.children[0];
    expect(interViewBegin).toMatchObject({
      parent: interViewsBegin,
      type: 'FLOW_START_INTERVIEW_BEGIN',
      duration: { self: 6332706, total: 6332706 },
    });
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
    const executionStarted = rootChildren[0];
    const executionChildren = executionStarted?.children as Method[];
    expect(executionChildren.length).toBe(5);

    expect(executionChildren[0]).toMatchObject({
      parent: executionStarted,
      type: 'METHOD_ENTRY',
      timestamp: 200,
      exitStamp: 300,
      children: [{ type: 'ENTERING_MANAGED_PKG', namespace: 'ns' }],
    });

    expect(executionChildren[1]).toMatchObject({
      parent: executionStarted,
      type: 'ENTERING_MANAGED_PKG',
      timestamp: 400,
      exitStamp: 700,
      children: [],
      namespace: 'ns',
    });

    expect(executionChildren[2]).toMatchObject({
      parent: executionStarted,
      type: 'ENTERING_MANAGED_PKG',
      timestamp: 700,
      exitStamp: 725,
      children: [],
      namespace: 'ns2',
    });

    expect(executionChildren[3]).toMatchObject({
      parent: executionStarted,
      type: 'DML_BEGIN',
      timestamp: 725,
      exitStamp: 750,
      children: [],
      namespace: 'default',
    });

    expect(executionChildren[4]).toMatchObject({
      parent: executionStarted,
      type: 'ENTERING_MANAGED_PKG',
      timestamp: 800,
      exitStamp: 1100,
      children: [],
      namespace: 'ns2',
    });
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

describe('namespace tests', () => {
  it('CodeUnit Started should have namespaces set', () => {
    const log =
      '01:01:01.000 (1)|CODE_UNIT_STARTED|[EXTERNAL]|01q58000000352C|MyNS.MyTrigger on MyObject trigger event BeforeInsert|__sfdc_trigger/MyNS/MyTrigger\n' +
      '01:01:01.000 (2)|CODE_UNIT_FINISHED|MyNS.MyTrigger on MyObject trigger event BeforeInsert|__sfdc_trigger/MyNS/MyTrigger\n' +
      '01:01:01.000 (3)|CODE_UNIT_STARTED|[EXTERNAL]|EventService:MyNS__MyObject\n' +
      '01:01:01.000 (4)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (5)|CODE_UNIT_STARTED|[EXTERNAL]|0664J000002uLqm|VF: /apex/MyNs__MyObject\n' +
      '01:01:01.000 (6)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (7)|CODE_UNIT_STARTED|[EXTERNAL]|0666C0000000bhK|MyNs.VFRemote: MyNs.MyController invoke(save)\n' +
      '01:01:01.000 (8)|CODE_UNIT_FINISHED|MyNs.VFRemote: MyNs.MyController invoke(save)\n' +
      '01:01:01.000 (9)|CODE_UNIT_STARTED|[EXTERNAL]|apex://MyNs.MyLightningController/ACTION$load\n' +
      '01:01:01.000 (10)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (11)|CODE_UNIT_STARTED|[EXTERNAL]|01p2u000000H2Is|MyNs.MyLightningController.load(MyNs.MyLightningController.Config)\n' +
      '01:01:01.000 (12)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (13)|CODE_UNIT_STARTED|[EXTERNAL]|01p2u000000H2Is|MyNs.MyLightningController\n' +
      '01:01:01.000 (14)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (15)|CODE_UNIT_STARTED|[EXTERNAL]|DuplicateDetector\n' +
      '01:01:01.000 (16)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (17)|CODE_UNIT_STARTED|[EXTERNAL]|Flow:01I4J000001GaHW\n' +
      '01:01:01.000 (18)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (19)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:01I4J000001GaHW\n' +
      '01:01:01.000 (20)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (21)|CODE_UNIT_STARTED|[EXTERNAL]|Validation:MyObject:aAS8d000000kIiO\n' +
      '01:01:01.000 (22)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (23)|CODE_UNIT_STARTED|[EXTERNAL]|01q58000000352C|MyTrigger on MyObject trigger event BeforeInsert|__sfdc_trigger/MyTrigger\n' +
      '01:01:01.000 (24)|CODE_UNIT_FINISHED|MyTrigger on MyObject trigger event BeforeInsert|__sfdc_trigger/MyTrigger\n' +
      '01:01:01.000 (23)|CODE_UNIT_STARTED|[EXTERNAL]|EventService:MyObject\n' +
      '01:01:01.000 (24)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (25)|CODE_UNIT_STARTED|[EXTERNAL]|0664J000002uLqm|VF: /apex/MyObject\n' +
      '01:01:01.000 (26)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (27)|CODE_UNIT_STARTED|[EXTERNAL]|apex://MyLightningController/ACTION$load\n' +
      '01:01:01.000 (28)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (29)|CODE_UNIT_STARTED|[EXTERNAL]|0666C0000000bhK|VFRemote: MyController invoke(save)\n' +
      '01:01:01.000 (30)|CODE_UNIT_FINISHED|VFRemote: MyController invoke(save)\n' +
      '01:01:01.000 (31)|CODE_UNIT_STARTED|[EXTERNAL]|01p2u000000H2Is|MyLightningController.load(MyLightningController.Config)\n' +
      '01:01:01.000 (32)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (33)|CODE_UNIT_STARTED|[EXTERNAL]|01p2u000000H2Is|MyLightningController\n' +
      '01:01:01.000 (34)|CODE_UNIT_FINISHED\n';

    const apexLog = parse(log);
    expect(apexLog.namespaces).toEqual(['MyNS', 'MyNs', 'default']);
    expect(apexLog.children.length).toEqual(18);

    expect(apexLog.children[0]).toMatchObject({
      namespace: 'MyNS',
      text: 'MyNS.MyTrigger on MyObject trigger event BeforeInsert',
    });

    expect(apexLog.children[1]).toMatchObject({
      namespace: 'MyNS',
      text: 'EventService:MyNS__MyObject',
    });

    expect(apexLog.children[2]).toMatchObject({
      namespace: 'MyNs',
      text: 'VF: /apex/MyNs__MyObject',
    });

    expect(apexLog.children[3]).toMatchObject({
      namespace: 'MyNs',
      text: 'MyNs.VFRemote: MyNs.MyController invoke(save)',
    });

    expect(apexLog.children[4]).toMatchObject({
      namespace: 'MyNs',
      text: 'apex://MyNs.MyLightningController/ACTION$load',
    });

    expect(apexLog.children[5]).toMatchObject({
      namespace: 'MyNs',
      text: 'MyNs.MyLightningController.load(MyNs.MyLightningController.Config)',
    });

    expect(apexLog.children[6]).toMatchObject({
      namespace: 'MyNs',
      text: 'MyNs.MyLightningController',
    });

    expect(apexLog.children[7]).toMatchObject({
      namespace: 'default',
      text: 'DuplicateDetector',
    });

    expect(apexLog.children[8]).toMatchObject({
      namespace: 'default',
      text: 'Flow:01I4J000001GaHW',
    });

    expect(apexLog.children[9]).toMatchObject({
      namespace: 'default',
      text: 'Workflow:01I4J000001GaHW',
    });

    expect(apexLog.children[10]).toMatchObject({
      namespace: 'default',
      text: 'Validation:MyObject:aAS8d000000kIiO',
    });

    expect(apexLog.children[11]).toMatchObject({
      namespace: 'default',
      text: 'MyTrigger on MyObject trigger event BeforeInsert',
    });

    expect(apexLog.children[12]).toMatchObject({
      namespace: 'default',
      text: 'EventService:MyObject',
    });

    expect(apexLog.children[13]).toMatchObject({
      namespace: 'default',
      text: 'VF: /apex/MyObject',
    });

    expect(apexLog.children[14]).toMatchObject({
      namespace: 'default',
      text: 'apex://MyLightningController/ACTION$load',
    });

    expect(apexLog.children[15]).toMatchObject({
      namespace: 'default',
      text: 'VFRemote: MyController invoke(save)',
    });

    expect(apexLog.children[16]).toMatchObject({
      namespace: 'default',
      text: 'MyLightningController.load(MyLightningController.Config)',
    });

    expect(apexLog.children[17]).toMatchObject({
      namespace: 'default',
      text: 'MyLightningController',
    });
  });

  it('Method + constructor namespace parsing', () => {
    const log = [
      '07:09:40.0 (1)|EXECUTION_STARTED',
      '07:09:40.0 (2)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
      '07:09:40.0 (3)|CONSTRUCTOR_ENTRY|[1]|01pDS00000uYQmZ|<init>()|ns.OuterClass.InnerClass',
      '07:09:40.0 (4)|CONSTRUCTOR_EXIT|[1]|01pDS00000uYQmZ|<init>()|ns.OuterClass.InnerClass',
      '07:09:40.0 (5)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|ns.OuterClass.InnerClass.innerMethod(ns.OuterClass.Config)',
      '07:09:40.0 (6)|METHOD_EXIT|[1]|01pDS00000uYQmZ|ns.OuterClass.InnerClass.innerMethod(ns.OuterClass.Config)',
      '07:09:40.0 (7)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|ns.OuterClass.OuterClass()',
      '07:09:40.0 (8)|METHOD_EXIT|[1]|ns.OuterClass',
      '07:09:40.0 (9)|CONSTRUCTOR_ENTRY|[1]|01pDS00000uYQmZ|<init>()|ns.OuterClass',
      '07:09:40.0 (10)|CONSTRUCTOR_EXIT|[1]|01pDS00000uYQmZ|<init>()|ns.OuterClass',
      '07:09:40.0 (11)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|ns.OuterClass.myMethod(ns.OuterClass.Config)',
      '07:09:40.0 (12)|METHOD_EXIT|[1]|01pDS00000uYQmZ|ns.OuterClass.myMethod(ns.OuterClass.Config)',
      '07:09:40.0 (13)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|ns2.StaticOuter.StaticOuter()',
      '07:09:40.0 (14)|METHOD_EXIT|[1]|ns2.StaticOuter',
      '07:09:40.0 (15)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config)',
      '07:09:40.0 (16)|METHOD_EXIT|[1]|01pDS00000uYQmZ|ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config)',
      '07:09:40.0 (17)|CONSTRUCTOR_ENTRY|[1]|01pDS00000uYQmZ|<init>()|OuterClass.InnerClass',
      '07:09:40.0 (18)|CONSTRUCTOR_EXIT|[1]|01pDS00000uYQmZ|<init>()|OuterClass.InnerClass',
      '07:09:40.0 (19)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|OuterClass.InnerClass.innerMethod(OuterClass.Config)',
      '07:09:40.0 (20)|METHOD_EXIT|[1]|01pDS00000uYQmZ|OuterClass.InnerClass.innerMethod(OuterClass.Config)',
      '07:09:40.0 (21)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|OuterClass.OuterClass()',
      '07:09:40.0 (22)|METHOD_EXIT|[1]|OuterClass',
      '07:09:40.0 (23)|CONSTRUCTOR_ENTRY|[1]|01pDS00000uYQmZ|<init>()|OuterClass',
      '07:09:40.0 (24)|CONSTRUCTOR_EXIT|[1]|01pDS00000uYQmZ|<init>()|OuterClass',
      '07:09:40.0 (25)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|OuterClass.myMethod(OuterClass.Config)',
      '07:09:40.0 (26)|METHOD_EXIT|[1]|01pDS00000uYQmZ|OuterClass.myMethod(OuterClass.Config)',
      '07:09:40.0 (27)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|StaticOuter.StaticOuter()',
      '07:09:40.0 (28)|METHOD_EXIT|[1]|StaticOuter',
      '07:09:40.0 (29)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|StaticOuter.staticMethod(StaticOuter.Config)',
      '07:09:40.0 (30)|METHOD_EXIT|[1]|01pDS00000uYQmZ|StaticOuter.staticMethod(StaticOuter.Config)',
      '07:09:40.0 (30)|METHOD_ENTRY|[169]||Database.QueryLocatorIterator.hasNext()',
      '07:09:40.0 (31)|METHOD_EXIT|[169]||Database.QueryLocatorIterator.hasNext()',
      '07:09:40.0 (31)|CODE_UNIT_FINISHED|execute_anonymous_apex',
      '07:09:40.0 (32)|EXECUTION_FINISHED',
    ].join('\n');

    const apexLog = parse(log);
    expect(apexLog.namespaces).toEqual(['default', 'ns', 'ns2']);
    expect(apexLog.children.length).toEqual(1);
    expect(apexLog.children[0]).toMatchObject({
      namespace: 'default',
      text: 'EXECUTION_STARTED',
    });

    const execute = apexLog.children[0]!;
    expect(execute.children.length).toEqual(1);
    expect(execute.children[0]).toMatchObject({
      namespace: 'default',
      text: 'execute_anonymous_apex',
    });

    const codeUnit = execute.children[0]!;
    expect(codeUnit.children.length).toEqual(15);
    expect(codeUnit.children[0]).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass.InnerClass()',
    });

    expect(codeUnit.children[1]).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass.InnerClass.innerMethod(ns.OuterClass.Config)',
    });

    expect(codeUnit.children[2]).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass.OuterClass()',
    });

    expect(codeUnit.children[3]).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass()',
    });

    expect(codeUnit.children[4]).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass.myMethod(ns.OuterClass.Config)',
    });

    expect(codeUnit.children[5]).toMatchObject({
      namespace: 'ns2',
      text: 'ns2.StaticOuter.StaticOuter()',
    });

    expect(codeUnit.children[6]).toMatchObject({
      namespace: 'ns2',
      text: 'ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config)',
    });

    expect(codeUnit.children[7]).toMatchObject({
      namespace: 'default',
      text: 'OuterClass.InnerClass()',
    });

    expect(codeUnit.children[8]).toMatchObject({
      namespace: 'default',
      text: 'OuterClass.InnerClass.innerMethod(OuterClass.Config)',
    });

    expect(codeUnit.children[9]).toMatchObject({
      namespace: 'default',
      text: 'OuterClass.OuterClass()',
    });

    expect(codeUnit.children[10]).toMatchObject({
      namespace: 'default',
      text: 'OuterClass()',
    });

    expect(codeUnit.children[11]).toMatchObject({
      namespace: 'default',
      text: 'OuterClass.myMethod(OuterClass.Config)',
    });

    expect(codeUnit.children[12]).toMatchObject({
      namespace: 'default',
      text: 'StaticOuter.StaticOuter()',
    });

    expect(codeUnit.children[13]).toMatchObject({
      namespace: 'default',
      text: 'StaticOuter.staticMethod(StaticOuter.Config)',
    });

    expect(codeUnit.children[14]).toMatchObject({
      namespace: 'default',
      text: 'Database.QueryLocatorIterator.hasNext()',
    });
  });

  it('namespace should propagate', () => {
    const log1 = [
      '16:09:42.2 (0)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|OuterClass.OuterClass()',
      '16:09:42.2 (1)|METHOD_EXIT|[1]|OuterClass',
      '16:09:42.2 (1)|METHOD_ENTRY|[5]|01p4J00000L8iGZ|OuterClass.staticMethod()',
      '16:09:42.2 (1)|METHOD_ENTRY|[169]||Database.QueryLocatorIterator.hasNext()',
      '16:09:42.2 (1)|METHOD_EXIT|[169]||Database.QueryLocatorIterator.hasNext()',
      '16:09:42.2 (1)|SOQL_EXECUTE_BEGIN|[64]|Aggregations:0|SELECT ID FROM MyObject__c',
      '16:09:42.2 (1)|SOQL_EXECUTE_END|[64]|Rows:1',
      '16:09:42.2 (1)|METHOD_ENTRY|[1]|01pDS00000uYQmZ|ns.OuterClass.OuterClass()',
      '16:09:42.2 (1)|METHOD_EXIT|[1]|ns.OuterClass',
      '16:09:42.2 (2)|METHOD_ENTRY|[5]|01p4J00000L8iGZ|ns.OuterClass.staticMethod()',
      '16:09:42.2 (3)|DML_BEGIN|[180]|Op:Insert|Type:SObject|Rows:2',
      '16:09:42.2 (4)|CODE_UNIT_STARTED|[EXTERNAL]|01q4J000000bcrb|ns.MyObjectTrigger on MyObject trigger event BeforeUpdate|__sfdc_trigger/ns/MyObjectTrigger',
      '16:09:42.2 (5)|METHOD_ENTRY|[5]|01p4J00000L8iGZ|ns.OuterClass.OuterClass()',
      '16:09:42.2 (6)|CONSTRUCTOR_ENTRY|[14]|01p4J00000L8iGZ|<init>()|ns.OuterClass',
      '16:09:42.2 (7)|CONSTRUCTOR_EXIT|[14]|01p4J00000L8iGZ|<init>()|ns.OuterClass',
      '16:09:42.2 (8)|METHOD_EXIT|[5]|ns.OuterClass',
      '16:09:42.2 (9)|METHOD_ENTRY|[288]||System.Type.forName(String)',
      '16:09:42.2 (10)|METHOD_EXIT|[288]||System.Type.forName(String)',
      '16:09:42.2 (11)|METHOD_ENTRY|[288]|1|ns.Class1.method1()',
      '16:09:42.2 (12)|METHOD_ENTRY|[288]|1|ns.Class1.method2()',
      '16:09:42.2 (12)|METHOD_ENTRY|[169]||Database.QueryLocatorIterator.hasNext()',
      '16:09:42.2 (13)|METHOD_EXIT|[169]||Database.QueryLocatorIterator.hasNext()',
      '16:09:42.2 (13)|SOQL_EXECUTE_BEGIN|[64]|Aggregations:0|SELECT ID FROM MyObject__c',
      '16:09:42.2 (14)|SOQL_EXECUTE_END|[64]|Rows:1',
      '16:09:42.2 (15)|METHOD_EXIT|[288]|1|ns.Class1.method2()',
      '16:09:42.2 (16)|METHOD_EXIT|[288]|1|ns.Class1.method1()',
      '16:09:42.2 (17)|CODE_UNIT_FINISHED|ns.MyObjectTrigger on MyObject trigger event BeforeUpdate|__sfdc_trigger/ns/MyObjectTrigger',
      '16:09:42.2 (18)|DML_END|[180]',
      '16:09:42.2 (19)|METHOD_EXIT|[5]|01p4J00000L8iGZ|ns.OuterClass.staticMethod()',
      '16:09:42.2 (20)|METHOD_EXIT|[5]|01p4J00000L8iGZ|OuterClass.staticMethod()',
    ].join('\n');

    const apexLog = parse(log1);
    expect(apexLog.children.length).toEqual(2);
    expect(apexLog.children[0]).toMatchObject({
      namespace: 'default',
      text: 'OuterClass.OuterClass()',
    });

    let logLine = apexLog.children[1]!;
    expect(logLine).toMatchObject({
      namespace: 'default',
      text: 'OuterClass.staticMethod()',
    });

    expect(logLine.children.length).toEqual(4);

    expect(logLine.children[0]).toMatchObject({
      namespace: 'default',
      text: 'Database.QueryLocatorIterator.hasNext()',
    });

    expect(logLine.children[1]).toMatchObject({
      namespace: 'default',
      text: 'SELECT ID FROM MyObject__c',
    });

    expect(logLine.children[2]).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass.OuterClass()',
    });

    logLine = logLine.children[3]!;
    expect(logLine).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass.staticMethod()',
    });

    expect(logLine.children.length).toEqual(1);
    logLine = logLine.children[0]!;
    expect(logLine).toMatchObject({
      namespace: 'default',
      text: 'DML Op:Insert Type:SObject',
    });

    expect(logLine.children.length).toEqual(1);
    logLine = logLine.children[0]!;
    expect(logLine).toMatchObject({
      namespace: 'ns',
      text: 'ns.MyObjectTrigger on MyObject trigger event BeforeUpdate',
    });

    expect(logLine.children.length).toEqual(3);
    expect(logLine.children[0]).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass.OuterClass()',
    });

    expect(logLine.children[0]!.children.length).toEqual(1);
    expect(logLine.children[0]!.children[0]).toMatchObject({
      namespace: 'ns',
      text: 'ns.OuterClass()',
    });

    expect(logLine.children[1]).toMatchObject({
      namespace: 'ns',
      text: 'System.Type.forName(String)',
    });

    expect(logLine.children[2]).toMatchObject({
      namespace: 'ns',
      text: 'ns.Class1.method1()',
    });

    logLine = logLine.children[2]!;
    expect(logLine.children.length).toEqual(1);
    expect(logLine.children[0]).toMatchObject({
      namespace: 'ns',
      text: 'ns.Class1.method2()',
    });

    logLine = logLine.children[0]!;
    expect(logLine.children.length).toEqual(2);

    expect(logLine.children[0]).toMatchObject({
      namespace: 'ns',
      text: 'Database.QueryLocatorIterator.hasNext()',
    });

    expect(logLine.children[1]).toMatchObject({
      namespace: 'ns',
      text: 'SELECT ID FROM MyObject__c',
    });
  });
});

describe('Recalculate durations tests', () => {
  it('Recalculates parent node', () => {
    const parser = new ApexLogParser();
    const node = new Method(parser, ['14:32:07.563 (1)', 'DUMMY'], [], 'Method', '');
    node.exitStamp = 3;

    node.recalculateDurations();
    expect(node.timestamp).toEqual(1);
    expect(node.duration).toEqual({ self: 2, total: 2 });
  });
});

describe('Governor Limits Parsing', () => {
  it('should parse LIMIT_USAGE_FOR_NS lines and populate governorLimits for multiple namespaces', () => {
    const log = [
      '09:18:22.6 (6574780)|EXECUTION_STARTED',
      '12:43:02.105 (48105827767)|LIMIT_USAGE_FOR_NS|(default)|',
      '  Number of SOQL queries: 17 out of 100',
      '  Number of query rows: 121 out of 50000',
      '  Number of SOSL queries: 3 out of 20',
      '  Number of DML statements: 8 out of 150',
      '  Number of Publish Immediate DML: 5 out of 150',
      '  Number of DML rows: 113 out of 10000',
      '  Maximum CPU time: 15008 out of 10000 ******* CLOSE TO LIMIT',
      '  Maximum heap size: 300 out of 6000000',
      '  Number of callouts: 2 out of 100',
      '  Number of Email Invocations: 1 out of 10',
      '  Number of future calls: 2 out of 50',
      '  Number of queueable jobs added to the queue: 6 out of 50',
      '  Number of Mobile Apex push calls: 1 out of 10',
      '12:43:02.105 (48105827768)|LIMIT_USAGE_FOR_NS|myNS|',
      '  Number of SOQL queries: 2 out of 100',
      '  Number of query rows: 10 out of 50000',
      '  Number of SOSL queries: 1 out of 20',
      '  Number of DML statements: 1 out of 150',
      '  Number of Publish Immediate DML: 0 out of 150',
      '  Number of DML rows: 5 out of 10000',
      '  Maximum CPU time: 2000 out of 10000',
      '  Maximum heap size: 100 out of 6000000',
      '  Number of callouts: 1 out of 100',
      '  Number of Email Invocations: 5 out of 10',
      '  Number of future calls: 2 out of 50',
      '  Number of queueable jobs added to the queue: 3 out of 50',
      '  Number of Mobile Apex push calls: 0 out of 10',
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED',
    ].join('\n');

    const apexLog = parse(log);

    expect(apexLog.governorLimits).toBeDefined();
    expect([...apexLog.governorLimits.byNamespace.keys()]).toEqual(['default', 'myNS']);

    expect(apexLog.governorLimits.byNamespace.get('default')).toMatchObject({
      soqlQueries: { used: 17, limit: 100 },
      queryRows: { used: 121, limit: 50000 },
      soslQueries: { used: 3, limit: 20 },
      dmlStatements: { used: 8, limit: 150 },
      publishImmediateDml: { used: 5, limit: 150 },
      dmlRows: { used: 113, limit: 10000 },
      cpuTime: { used: 15008, limit: 10000 },
      heapSize: { used: 300, limit: 6000000 },
      callouts: { used: 2, limit: 100 },
      emailInvocations: { used: 1, limit: 10 },
      futureCalls: { used: 2, limit: 50 },
      queueableJobsAddedToQueue: { used: 6, limit: 50 },
      mobileApexPushCalls: { used: 1, limit: 10 },
    });

    expect(apexLog.governorLimits.byNamespace.get('myNS')).toMatchObject({
      soqlQueries: { used: 2, limit: 100 },
      queryRows: { used: 10, limit: 50000 },
      soslQueries: { used: 1, limit: 20 },
      dmlStatements: { used: 1, limit: 150 },
      publishImmediateDml: { used: 0, limit: 150 },
      dmlRows: { used: 5, limit: 10000 },
      cpuTime: { used: 2000, limit: 10000 },
      heapSize: { used: 100, limit: 6000000 },
      callouts: { used: 1, limit: 100 },
      emailInvocations: { used: 5, limit: 10 },
      futureCalls: { used: 2, limit: 50 },
      queueableJobsAddedToQueue: { used: 3, limit: 50 },
      mobileApexPushCalls: { used: 0, limit: 10 },
    });

    expect(apexLog.governorLimits).toMatchObject({
      soqlQueries: { used: 19, limit: 100 },
      queryRows: { used: 131, limit: 50000 },
      soslQueries: { used: 4, limit: 20 },
      dmlStatements: { used: 9, limit: 150 },
      publishImmediateDml: { used: 5, limit: 150 },
      dmlRows: { used: 118, limit: 10000 },
      cpuTime: { used: 17008, limit: 10000 },
      heapSize: { used: 400, limit: 6000000 },
      callouts: { used: 3, limit: 100 },
      emailInvocations: { used: 6, limit: 10 },
      futureCalls: { used: 4, limit: 50 },
      queueableJobsAddedToQueue: { used: 9, limit: 50 },
      mobileApexPushCalls: { used: 1, limit: 10 },
    });
  });

  it('should handle missing or partial LIMIT_USAGE_FOR_NS sections gracefully', () => {
    const log = [
      '09:18:22.6 (6574780)|EXECUTION_STARTED',
      '12:43:02.105 (48105827767)|LIMIT_USAGE_FOR_NS|(default)|',
      '  Number of SOQL queries: 5 out of 100',
      '  Number of query rows: 10 out of 50000',
      // missing other lines
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED',
    ].join('\n');

    const apexLog = parse(log);

    expect(apexLog.governorLimits).toBeDefined();
    const expected = {
      soqlQueries: { used: 5, limit: 100 },
      queryRows: { used: 10, limit: 50000 },
      soslQueries: { used: 0, limit: 0 },
      dmlStatements: { used: 0, limit: 0 },
      publishImmediateDml: { used: 0, limit: 0 },
      dmlRows: { used: 0, limit: 0 },
      cpuTime: { used: 0, limit: 0 },
      heapSize: { used: 0, limit: 0 },
      callouts: { used: 0, limit: 0 },
      emailInvocations: { used: 0, limit: 0 },
      futureCalls: { used: 0, limit: 0 },
      queueableJobsAddedToQueue: { used: 0, limit: 0 },
      mobileApexPushCalls: { used: 0, limit: 0 },
    };
    expect(apexLog.governorLimits.byNamespace.get('default')).toMatchObject(expected);
    expect(apexLog.governorLimits).toMatchObject(expected);
  });
});

describe('Line Type Tests', () => {
  it('Lines referenced by exitTypes should be exits', () => {
    const parser = new ApexLogParser();
    for (const [key, lineType] of lineTypeMap) {
      const line = new lineType(parser, [
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
            const exitLine = new exitCls!(parser, [
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
    const parser = new ApexLogParser();
    const qp = new SOQLExecuteExplainLine(parser, [
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

describe('Aggregating Totals', () => {
  it('should sum from child to parent', () => {
    const logArray = [
      '01:02:03.04 (0)|EXECUTION_STARTED',
      '01:02:03.04 (1)|METHOD_ENTRY|[1]|a00000000000000|ns.MyClass.myMethod()',
      '01:02:03.04 (2)|METHOD_ENTRY|[1]|a00000000000000|ns.MyClass.soql()',
      '01:02:03.04 (3)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT ID FROM MyObject__c',
      '01:02:03.04 (4)|SOQL_EXECUTE_END|[2]|Rows:1',
      '01:02:03.04 (5)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT ID FROM MyObject__c',
      '01:02:03.04 (6)|SOQL_EXECUTE_END|[2]|Rows:2',
      '01:02:03.04 (7)|METHOD_EXIT|[1]|a00000000000000|ns.MyClass.soql()',
      '01:02:03.04 (8)|METHOD_ENTRY|[1]|a00000000000000|ns.MyClass.dml()',
      '01:02:03.04 (9)|DML_BEGIN|[194]|Op:Update|Type:ns2__MyObject__c|Rows:1',
      '01:02:03.04 (10)|DML_END|[194]',
      '01:02:03.04 (11)|DML_BEGIN|[194]|Op:Update|Type:ns2__MyObject__c|Rows:4',
      '01:02:03.04 (12)|DML_END|[194]',
      '01:02:03.04 (13)|METHOD_EXIT|[1]|a00000000000000|ns.MyClass.dml()',
      '01:02:03.04 (14)|METHOD_ENTRY|[1]|a00000000000000|ns.MyClass.sosl()',
      "01:02:03.04 (15)|SOSL_EXECUTE_BEGIN|[1]|FIND 'hello*' IN ALL FIELDS RETURNING account(Id, Name)",
      '01:02:03.04 (16)|SOSL_EXECUTE_END|[1]|Rows:250',
      "01:02:03.04 (17)|SOSL_EXECUTE_BEGIN|[1]|FIND 'hello*' IN ALL FIELDS RETURNING account(Id, Name)",
      '01:02:03.04 (18)|SOSL_EXECUTE_END|[1]|Rows:150',
      '01:02:03.04 (19)|EXCEPTION_THROWN|[60]|System.LimitException: c2g:Too many SOQL queries: 101',
      '01:02:03.04 (20)|METHOD_EXIT|[1]|a00000000000000|ns.MyClass.sosl()',
      '01:02:03.04 (21)|EXCEPTION_THROWN|[60]|System.LimitException: c2g:Too many SOQL queries: 101',
      '01:02:03.04 (22)|EXCEPTION_THROWN|[60]|System.LimitException: c2g:Too many SOQL queries: 101',
      '01:02:03.04 (23)|METHOD_EXIT|[1]|a00000000000000|ns.MyClass.myMethod()',
      '01:02:03.04 (24)|EXECUTION_FINISHED',
    ];
    const log1 = logArray.join('\n');

    const defaultCounts = {
      dmlCount: { total: 0, self: 0 },
      soqlCount: { total: 0, self: 0 },
      soslCount: { total: 0, self: 0 },
      dmlRowCount: { total: 0, self: 0 },
      soqlRowCount: { total: 0, self: 0 },
      soslRowCount: { total: 0, self: 0 },
      totalThrownCount: 0,
    };

    const apexLog = parse(log1);
    expect(apexLog).toMatchObject(
      // EXECUTION_STARTED
      {
        duration: { total: 24, self: 0 },
        dmlCount: { total: 2, self: 0 },
        soqlCount: { total: 2, self: 0 },
        soslCount: { total: 2, self: 0 },
        dmlRowCount: { total: 5, self: 0 },
        soqlRowCount: { total: 3, self: 0 },
        soslRowCount: { total: 400, self: 0 },
        type: null,
        children: [
          {
            duration: { total: 24, self: 2 },
            dmlCount: { total: 2, self: 0 },
            soqlCount: { total: 2, self: 0 },
            soslCount: { total: 2, self: 0 },
            dmlRowCount: { total: 5, self: 0 },
            soqlRowCount: { total: 3, self: 0 },
            soslRowCount: { total: 400, self: 0 },
            totalThrownCount: 3,
            logLine: logArray[0],
            children: [
              // ns.MyClass.myMethod()
              {
                duration: { total: 22, self: 6 },
                dmlCount: { total: 2, self: 0 },
                soqlCount: { total: 2, self: 0 },
                soslCount: { total: 2, self: 0 },
                dmlRowCount: { total: 5, self: 0 },
                soqlRowCount: { total: 3, self: 0 },
                soslRowCount: { total: 400, self: 0 },
                totalThrownCount: 3,
                logLine: logArray[1],
                children: [
                  // ns.MyClass.soql()
                  {
                    ...defaultCounts,
                    duration: { total: 5, self: 3 },
                    logLine: logArray[2],
                    soqlCount: { total: 2, self: 0 },
                    soqlRowCount: { total: 3, self: 0 },
                    children: [
                      //SELECT ID FROM MyObject__c
                      {
                        ...defaultCounts,
                        duration: { total: 1, self: 1 },
                        soqlCount: { total: 1, self: 1 },
                        soqlRowCount: { total: 1, self: 1 },
                        logLine: logArray[3],
                      },
                      // SELECT ID FROM MyObject__c
                      {
                        ...defaultCounts,
                        duration: { total: 1, self: 1 },
                        soqlCount: { total: 1, self: 1 },
                        soqlRowCount: { total: 2, self: 2 },
                        logLine: logArray[5],
                      },
                    ],
                  },
                  // ns.MyClass.dml()
                  {
                    ...defaultCounts,
                    duration: { total: 5, self: 3 },
                    dmlCount: { total: 2, self: 0 },
                    dmlRowCount: { total: 5, self: 0 },
                    logLine: logArray[8],
                    children: [
                      {
                        ...defaultCounts,
                        duration: { total: 1, self: 1 },
                        dmlCount: { total: 1, self: 1 },
                        dmlRowCount: { total: 1, self: 1 },
                        logLine: logArray[9],
                      },
                      {
                        ...defaultCounts,
                        duration: { total: 1, self: 1 },
                        dmlCount: { total: 1, self: 1 },
                        dmlRowCount: { total: 4, self: 4 },
                        logLine: logArray[11],
                      },
                    ],
                  },
                  //ns.MyClass.sosl()
                  {
                    ...defaultCounts,
                    duration: { total: 6, self: 4 },
                    soslCount: { total: 2, self: 0 },
                    soslRowCount: { total: 400, self: 0 },
                    totalThrownCount: 1,
                    logLine: logArray[14],
                    children: [
                      {
                        ...defaultCounts,
                        duration: { total: 1, self: 1 },
                        soslCount: { total: 1, self: 1 },
                        soslRowCount: { total: 250, self: 250 },
                        totalThrownCount: 0,
                        logLine: logArray[15],
                      },
                      {
                        ...defaultCounts,
                        duration: { total: 1, self: 1 },
                        soslCount: { total: 1, self: 1 },
                        soslRowCount: { total: 150, self: 150 },
                        totalThrownCount: 0,
                        logLine: logArray[17],
                      },
                      // Exception
                      {
                        ...defaultCounts,
                        totalThrownCount: 1,
                      },
                    ],
                  },
                  // Exception
                  {
                    ...defaultCounts,
                    totalThrownCount: 1,
                  },
                  // Exception
                  {
                    ...defaultCounts,
                    totalThrownCount: 1,
                  },
                ],
              },
            ],
          },
        ],
      },
    );
  });
});
