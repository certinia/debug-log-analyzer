/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
const typePattern = /^[A-Z_]*$/,
  truncateColor: Map<string, string> = new Map([
    ["error", "rgba(255, 128, 128, 0.2)"],
    ["skip", "rgba(128, 255, 128, 0.2)"],
    ["unexpected", "rgba(128, 128, 255, 0.2)"],
  ]);

type LineNumber = number | string | null;

export abstract class TimeStampedNode {
  timestamp: number = 0;
  exitStamp: number | null = null;
  duration: number | null = null;
  selfTime: number | null = null;
  children: TimeStampedNode[] | null = null;
}

export abstract class LogLine extends TimeStampedNode {
  type: string = "";
  logLine: string = "";
  acceptsText: boolean = false;
  text: string = "";
  displayType: string = "";
  children: LogLine[] | null = null;

  isExit: boolean = false;
  isValid: boolean = true;
  hasValidSymbols: boolean = false;
  discontinuity: boolean = false;
  exitTypes: string[] | null = null;
  lineNumber: LineNumber = null;
  rowCount: number | null = null;
  classes: string | null = null;
  group: string | null = null;
  truncated: boolean | null = null;
  hideable: boolean | null = null;
  containsDml: boolean = false;
  containsSoql: boolean = false;
  value: string | null = null;
  suffix: string | null = null;
  prefix: string | null = null;
  namespace: string | null = null;
  cpuType: string | null = null;
  timelineKey: string | null = null;

  constructor(parts?: string[]) {
    super();
    if (parts) {
      this.type = parts[1];
      this.timestamp = parseTimestamp(parts[0]);
    }
  }

  onEnd(end: LogLine) {}

  after(next: LogLine) {}

  addBlock(lines: LogLine[]): void {
    if (lines.length > 0) {
      if (this.children === null) {
        this.children = [];
      }
      this.children.push(new BlockLines(lines));
    }
  }

  addChild(line: LogLine): void {
    if (this.children === null) {
      this.children = [];
    }

    this.children.push(line);
  }

  setChildren(lines: LogLine[]): void {
    this.children = lines;
  }
}

export class BlockLines extends LogLine {
  displayType = "block";

  constructor(children: LogLine[]) {
    super();
    this.children = children;
  }
}

let logLines: LogLine[] = [],
  truncated: [string, number, string | undefined][],
  reasons: Set<string> = new Set<string>(),
  cpuUsed: number = 0;

export function truncateLog(timestamp: number, reason: string, color: string) {
  if (!reasons.has(reason)) {
    reasons.add(reason);
    truncated.push([reason, timestamp, truncateColor.get(color)]);
  }
}

export function parseObjectNamespace(text: string): string {
  const sep = text.indexOf("__");
  if (sep < 0) {
    return "unmanaged";
  }
  return text.substring(0, sep);
}

export function parseVfNamespace(text: string): string {
  const sep = text.indexOf("__");
  if (sep < 0) {
    return "unmanaged";
  }
  const firstSlash = text.indexOf("/");
  if (firstSlash < 0) {
    return "unmanaged";
  }
  const secondSlash = text.indexOf("/", firstSlash + 1);
  if (secondSlash < 0) {
    return "unmanaged";
  }
  return text.substring(secondSlash + 1, sep);
}

export function parseTimestamp(text: string): number {
  const timestamp = text.slice(text.indexOf("(") + 1, -1);
  if (timestamp) {
    return Number(timestamp);
  }
  throw new Error(`Unable to parse timestamp: '${text}'`);
}

export function parseLineNumber(text: string): string | number {
  const lineNumberStr = text.slice(1, -1);
  if (lineNumberStr) {
    const lineNumber = Number(lineNumberStr);
    return isNaN(lineNumber) ? lineNumberStr : lineNumber;
  }
  throw new Error(`Unable to parse line number: '${text}'`);
}

export function parseRows(text: string): number {
  const rowCount = text.slice(text.indexOf("Rows:") + 5);
  if (rowCount) {
    return Number(rowCount);
  }
  throw new Error(`Unable to parse row count: '${text}'`);
}

/* Log line entry Parsers */

class BulkHeapAllocateLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class CalloutRequestLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} : ${parts[2]}`;
  }
}

class CalloutResponseLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} : ${parts[2]}`;
  }
}
class NamedCredentialRequestLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class NamedCredentialResponseLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class NamedCredentialResponseDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} : ${parts[4]} ${parts[5]} : ${parts[6]} ${parts[7]}`;
  }
}

class ConstructorEntryLine extends LogLine {
  exitTypes = ["CONSTRUCTOR_EXIT"];
  hasValidSymbols = true;
  displayType = "method";
  cpuType = "method";
  suffix = " (constructor)";
  timelineKey = "method";
  classes = "node";
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    const args = parts[4];
    this.text = parts[5] + args.substring(args.lastIndexOf("("));
  }
}

class ConstructorExitLine extends LogLine {
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class EmailQueueLine extends LogLine {
  lineNumber: LineNumber;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

export class MethodEntryLine extends LogLine {
  exitTypes = ["METHOD_EXIT"];
  hasValidSymbols = true;
  displayType = "method";
  cpuType = "method";
  timelineKey = "method";
  classes = "node";
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[4] || this.type;
    if (this.text === "System.Type.forName(String, String)") {
      this.cpuType = "loading"; // assume we are not charged for class loading (or at least not lengthy remote-loading / compiling)
      // no namespace or it will get charged...
    }
  }
}
class MethodExitLine extends LogLine {
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class SystemConstructorEntryLine extends LogLine {
  exitTypes = ["SYSTEM_CONSTRUCTOR_EXIT"];
  displayType = "method";
  cpuType = "method";
  namespace = "system";
  suffix = "(system constructor)";
  timelineKey = "systemMethod";
  classes = "node system";
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3];
  }
}

class SystemConstructorExitLine extends LogLine {
  namespace = "system";
  timelineKey = "systemMethod";
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}
class SystemMethodEntryLine extends LogLine {
  exitTypes = ["SYSTEM_METHOD_EXIT"];
  displayType = "method";
  cpuType = "method";
  namespace = "system";
  timelineKey = "systemMethod";
  classes = "node system";
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3];
  }
}

class SystemMethodExitLine extends LogLine {
  namespace = "system";
  timelineKey = "systemMethod";
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

export class CodeUnitStartedLine extends LogLine {
  exitTypes = ["CODE_UNIT_FINISHED"];
  displayType = "method";
  suffix = " (entrypoint)";
  timelineKey = "codeUnit";
  classes = "node";
  declarative: boolean | undefined;

  constructor(parts: string[]) {
    super(parts);
    const subParts = parts[3].split(":"),
      name = parts[4] || parts[3];

    switch (subParts[0]) {
      case "EventService":
        this.cpuType = "method";
        this.namespace = parseObjectNamespace(subParts[1]);
        this.group = "EventService " + this.namespace;
        this.text = parts[3];
        break;
      case "Validation":
        this.cpuType = "custom";
        this.declarative = true;
        this.group = "Validation";
        this.text = name || subParts[0] + ":" + subParts[1];
        break;
      case "Workflow":
        this.cpuType = "custom";
        this.declarative = true;
        this.group = "Workflow";
        this.text = name || subParts[0];
        break;
      default:
        this.cpuType = "method";
        if (name?.startsWith("VF:")) {
          this.namespace = parseVfNamespace(name);
        }
        this.text = name || parts[3]; // ???
        break;
    }
  }
}
export class CodeUnitFinishedLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class VFApexCallStartLine extends LogLine {
  classes = "node";
  cpuType = "method";
  displayType = "method";
  exitTypes = ["VF_APEX_CALL_END"];
  suffix = " (VF APEX)";
  timelineKey = "method";

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);

    const classText = parts[5] || parts[3];
    let methodtext = parts[4] || "";
    if (methodtext) {
      this.hasValidSymbols = true;
      // method call
      const methodIndex = methodtext.indexOf("(");
      const constructorIndex = methodtext.indexOf("<init>");
      if (methodIndex > -1) {
        // Method
        methodtext =
          "." + methodtext.substring(methodIndex).slice(1, -1) + "()";
      } else if (constructorIndex > -1) {
        // Constructor
        methodtext = methodtext.substring(constructorIndex + 6) + "()";
      } else {
        // Property
        methodtext = "." + methodtext;
      }
    } else {
      // we have s system entry and they do not have exits
      // e.g |VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex <init>
      // and they really mess with the logs so skip handling them.
      this.isValid = false;
    }
    this.text = classText + methodtext;
  }
}

class VFApexCallEndLine extends LogLine {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class VFDeserializeViewstateBeginLine extends LogLine {
  exitTypes = ["VF_DESERIALIZE_VIEWSTATE_END"];
  displayType = "method";
  cpuType = "method";
  namespace = "system";
  timelineKey = "systemMethod";

  constructor(parts: string[]) {
    super(parts);
    this.text = this.type;
  }
}

class VFDeserializeViewstateEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class VFFormulaStartLine extends LogLine {
  exitTypes = ["VF_EVALUATE_FORMULA_END"];
  cpuType = "custom";
  displayType = "method";
  suffix = " (VF FORMULA)";
  classes = "node formula";
  group: string;
  timelineKey = "systemMethod";

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class VFFormulaEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class VFSeralizeViewStateStartLine extends LogLine {
  exitTypes = ["VF_SERIALIZE_VIEWSTATE_END"];
  displayType = "method";
  cpuType = "method";
  namespace = "system";
  timelineKey = "systemMethod";

  constructor(parts: string[]) {
    super(parts);
    this.text = this.type;
  }
}

class VFSeralizeViewStateEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class VFPageMessageLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class DMLBeginLine extends LogLine {
  exitTypes = ["DML_END"];
  displayType = "method";
  cpuType = "free";
  timelineKey = "dml";
  group = "DML";
  lineNumber: LineNumber;
  rowCount: number;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = "DML " + parts[3] + " " + parts[4];
    this.rowCount = parseRows(parts[5]);
  }
}

class DMLEndLine extends LogLine {
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class IdeasQueryExecuteLine extends LogLine {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

interface EndLine {
  rowCount: number;
}

class SOQLExecuteBeginLine extends LogLine {
  exitTypes = ["SOQL_EXECUTE_END"];
  displayType = "method";
  cpuType = "free";
  timelineKey = "soql";
  group: string;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.group = "SOQL";
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = "SOQL: " + parts[3] + " - " + parts[4];
  }

  onEnd(end: LogLine) {
    this.rowCount = end.rowCount;
  }
}

class SOQLExecuteEndLine extends LogLine {
  isExit = true;
  lineNumber: LineNumber;
  rowCount: number;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.rowCount = parseRows(parts[3]);
  }
}

class SOQLExecuteExplainLine extends LogLine {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line:${this.lineNumber}`;
  }
}

class SOSLExecuteBeginLine extends LogLine {
  exitTypes = ["SOSL_EXECUTE_END"];
  displayType = "method";
  cpuType = "free";
  timelineKey = "soql";
  group = "SOQL";
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `SOSL: ${parts[3]}`;
  }

  onEnd(end: SOSLExecuteEndLine) {
    this.rowCount = end.rowCount;
  }
}

class SOSLExecuteEndLine extends LogLine {
  isExit = true;
  lineNumber: LineNumber;
  rowCount: number;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.rowCount = parseRows(parts[3]);
  }
}

class HeapAllocateLine extends LogLine {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class HeapDeallocateLine extends LogLine {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class StatementExecuteLine extends LogLine {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class VariableScopeBeginLine extends LogLine {
  prefix = "ASSIGN ";
  classes = "node detail";
  lineNumber: LineNumber;
  group: string;
  value: string;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3];
    this.group = this.type;
    this.value = parts[4];
  }

  onEnd(end: any) {
    this.value = end.value;
  }
}

class VariableScopeEndLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}
class VariableAssignmentLine extends LogLine {
  lineNumber: LineNumber;
  group: string;
  value: string;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3];
    this.group = this.type;
    this.value = parts[4];
  }
}
class UserInfoLine extends LogLine {
  lineNumber: LineNumber;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = this.type + ":" + parts[3] + " " + parts[4];
    this.group = this.type;
  }
}

class UserDebugLine extends LogLine {
  lineNumber: LineNumber;
  group: string;
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = this.type + ":" + parts[3] + " " + parts[4];
    this.group = this.type;
  }
}

class CumulativeLimitUsageLine extends LogLine {
  exitTypes = ["CUMULATIVE_LIMIT_USAGE_END"];
  displayType = "method";
  cpuType = "system";
  timelineKey = "systemMethod";
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = this.type;
    this.group = this.type;
  }
}

class CumulativeLimitUsageEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class CumulativeProfilingLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " " + (parts[3] ?? "");
  }
}

class CumulativeProfilingBeginLine extends LogLine {
  exitTypes = ["CUMULATIVE_PROFILING_END"];
  constructor(parts: string[]) {
    super(parts);
  }
}

class CumulativeProfilingEndLine extends LogLine {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
  }
}

class LimitUsageLine extends LogLine {
  lineNumber: LineNumber;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3] + " " + parts[4] + " out of " + parts[5];
    this.group = this.type;
  }
}

class LimitUsageForNSLine extends LogLine {
  acceptsText = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }

  after(next: LogLine) {
    const matched = this.text.match(/Maximum CPU time: (\d+)/),
      cpuText = matched ? matched[1] : "0",
      cpuTime = parseInt(cpuText, 10) * 1000000; // convert from milli-seconds to nano-seconds

    if (!cpuUsed || cpuTime > cpuUsed) {
      cpuUsed = cpuTime;
    }
  }
}

class PushTraceFlagsLine extends LogLine {
  namespace = "system";
  timelineKey = "systemMethod";
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[4] + ", line:" + this.lineNumber + " - " + parts[5];
  }
}

class PopTraceFlagsLine extends LogLine {
  namespace = "system";
  timelineKey = "systemMethod";
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[4] + ", line:" + this.lineNumber + " - " + parts[5];
  }
}

class QueryMoreBeginLine extends LogLine {
  lineNumber: LineNumber;
  exitTypes = ["QUERY_MORE_END"];
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}
class QueryMoreEndLine extends LogLine {
  lineNumber: LineNumber;
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}
class QueryMoreIterationsLine extends LogLine {
  lineNumber: LineNumber;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}, iterations:${parts[3]}`;
  }
}

class SavepointRollbackLine extends LogLine {
  lineNumber: LineNumber;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

class SavepointSetLine extends LogLine {
  lineNumber: LineNumber;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

class TotalEmailRecipientsQueuedLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class StackFrameVariableListLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
  }
}

class StaticVariableListLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
  }
}

class SystemModeEnterLine extends LogLine {
  namespace = "system";
  timelineKey = "systemMethod";
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class SystemModeExitLine extends LogLine {
  namespace = "system";
  timelineKey = "systemMethod";
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

export class ExecutionStartedLine extends LogLine {
  exitTypes = ["EXECUTION_FINISHED"];
  displayType = "method";
  timelineKey = "method";
  classes = "node";
  constructor(parts: string[]) {
    super(parts);
    this.text = this.type;
  }
}

export class ExecutionFinishedLine extends LogLine {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = this.type;
  }
}

class EnteringManagedPackageLine extends LogLine {
  displayType = "method";
  cpuType = "pkg";
  timelineKey = "method";
  namespace: string;
  exitStamp: any;
  duration: any;
  selfTime: any;

  constructor(parts: string[]) {
    super(parts);
    const rawNs = parts[2],
      lastDot = rawNs.lastIndexOf("."),
      ns = lastDot < 0 ? rawNs : rawNs.substring(lastDot + 1);

    this.text = this.namespace = ns;
  }

  after(next: LogLine) {
    this.exitStamp = next.timestamp;
    this.duration = this.selfTime = this.exitStamp - this.timestamp;
  }
}

class EventSericePubBeginLine extends LogLine {
  exitTypes = ["EVENT_SERVICE_PUB_END"];
  displayType = "method";
  cpuType = "custom";
  timelineKey = "flow";
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.group = this.type;
    this.text = parts[2];
  }
}

class EventSericePubEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class EventSericePubDetailLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " " + parts[3] + " " + parts[4];
    this.group = this.type;
  }
}

class EventSericeSubBeginLine extends LogLine {
  exitTypes = ["EVENT_SERVICE_SUB_END"];
  displayType = "method";
  cpuType = "custom";
  timelineKey = "flow";
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} ${parts[3]}`;
    this.group = this.type;
  }
}

class EventSericeSubEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} ${parts[3]}`;
  }
}

class EventSericeSubDetailLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} ${parts[3]} ${parts[4]} ${parts[6]} ${parts[6]}`;
    this.group = this.type;
  }
}

class SavePointSetLine extends LogLine {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3];
  }
}

class FlowStartInterviewsBeginLine extends LogLine {
  exitTypes = ["FLOW_START_INTERVIEWS_END"];
  displayType = "method";
  cpuType = "custom";
  declarative = true;
  timelineKey = "flow";
  group = "FLOW_START_INTERVIEWS";

  constructor(parts: string[]) {
    super(parts);
    this.text = "FLOW_START_INTERVIEWS : " + parts[2];
  }

  onEnd(end: LogLine) {
    if (this.children) {
      let interviewBegin = this.children[0];
      if (interviewBegin.displayType === "block" && interviewBegin.children) {
        interviewBegin = interviewBegin.children[0];
      }
      this.text += " - " + interviewBegin.text;
    }
  }
}

class FlowStartInterviewsEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowStartInterviewsErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} - ${parts[4]}`;
  }
}

class FlowStartInterviewBeginLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class FlowStartInterviewEndLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowStartInterviewLimitUsageLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class FlowStartScheduledRecordsLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}
class FlowCreateInterviewBeginLine extends LogLine {
  text = "";

  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowCreateInterviewEndLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowCreateInterviewErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowElementBeginLine extends LogLine {
  exitTypes = ["FLOW_ELEMENT_END"];
  displayType = "method";
  cpuType = "custom";
  declarative = true;
  timelineKey = "flow";
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.group = this.type;
    this.text = this.type + " - " + parts[3] + " " + parts[4];
  }
}

class FlowElementEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowElementDeferredLine extends LogLine {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " " + parts[3];
    this.group = this.type;
  }
}

class FlowElementAssignmentLine extends LogLine {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " " + parts[4];
    this.group = this.type;
  }
}

class FlowWaitEventResumingDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowWaitEventWaitingDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class FlowWaitResumingDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowWaitWaitingDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowInterviewFinishedLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class FlowInterviewResumedLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class FlowInterviewPausedLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowElementErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + parts[2] + " " + parts[3] + " " + parts[4];
  }
}

class FlowElementFaultLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowElementLimitUsageLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class FlowInterviewFinishedLimitUsageLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class FlowSubflowDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowActionCallDetailLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text =
      parts[3] + " : " + parts[4] + " : " + parts[5] + " : " + parts[6];
    this.group = this.type;
  }
}

class FlowAssignmentDetailLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " : " + parts[4] + " : " + parts[5];
    this.group = this.type;
  }
}

class FlowLoopDetailLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " : " + parts[4];
    this.group = this.type;
  }
}

class FlowRuleDetailLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " : " + parts[4];
    this.group = this.type;
  }
}

class FlowBulkElementBeginLine extends LogLine {
  exitTypes = ["FLOW_BULK_ELEMENT_END"];
  displayType = "method";
  cpuType = "custom";
  declarative = true;
  timelineKey = "flow";
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = this.type + " - " + parts[2];
    this.group = this.type;
  }
}

class FlowBulkElementEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowBulkElementDetailLine extends LogLine {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " : " + parts[3] + " : " + parts[4];
    this.group = this.type;
  }
}

class FlowBulkElementNotSupportedLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowBulkElementLimitUsageLine extends LogLine {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class PNInvalidAppLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}

class PNInvalidCertificateLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}
class PNInvalidNotificationLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]} : ${parts[8]}`;
  }
}
class PNNoDevicesLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}
class PNNotEnabledLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}
class PNSentLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

class SLAEndLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class SLAEvalMilestoneLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class SLANullStartDateLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class SLAProcessCaseLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class TestingLimitsLine extends LogLine {
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class ValidationRuleLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class ValidationErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class ValidationFailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class ValidationFormulaLine extends LogLine {
  acceptsText = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    const extra = parts.length > 3 ? " " + parts[3] : "";

    this.text = parts[2] + extra;
    this.group = this.type;
  }
}

class ValidationPassLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class WFFlowActionBeginLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFFlowActionEndLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFFlowActionErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + " " + parts[4];
  }
}

class WFFlowActionErrorDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + " " + parts[2];
  }
}

class WFFieldUpdateLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text =
      " " +
      parts[2] +
      " " +
      parts[3] +
      " " +
      parts[4] +
      " " +
      parts[5] +
      " " +
      parts[6];
    this.group = this.type;
  }
}

class WFRuleEvalBeginLine extends LogLine {
  exitTypes = ["WF_RULE_EVAL_END"];
  displayType = "method";
  cpuType = "custom";
  declarative = true;
  timelineKey = "workflow";

  constructor(parts: string[]) {
    super(parts);
    this.text = this.type;
  }
}

class WFRuleEvalEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class WFRuleEvalValueLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class WFRuleFilterLine extends LogLine {
  acceptsText = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class WFRuleNotEvaluatedLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class WFCriteriaBeginLine extends LogLine {
  exitTypes = ["WF_CRITERIA_END", "WF_RULE_NOT_EVALUATED"];
  displayType = "method";
  cpuType = "custom";
  declarative = true;
  timelineKey = "workflow";
  group = "WF_CRITERIA";

  constructor(parts: string[]) {
    super(parts);
    this.text = "WF_CRITERIA : " + parts[5] + " : " + parts[3];
  }
}

class WFCriteriaEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class WFFormulaLine extends LogLine {
  acceptsText = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " : " + parts[3];
    this.group = this.type;
  }
}

class WFActionLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class WFActionsEndLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFActionTaskLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

class WFApprovalLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFApprovalRemoveLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class WFApprovalSubmitLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class WFApprovalSubmitterLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFAssignLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFEmailAlertLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFEmailSentLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFEnqueueActionsLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFEscalationActionLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFEscalationRuleLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFEvalEntryCriteriaLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFFlowActionDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    const optional = parts[4] ? ` : ${parts[4]} :${parts[5]}` : "";
    this.text = `${parts[2]} : ${parts[3]}` + optional;
  }
}

class WFHardRejectLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFNextApproverLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFNoProcessFoundLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFOutboundMsgLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFProcessFoundLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFReassignRecordLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFResponseNotifyLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFRuleEntryOrderLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFRuleInvocationLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFSoftRejectLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFTimeTriggerLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFSpoolActionBeginLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFTimeTriggersBeginLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class ExceptionThrownLine extends LogLine {
  discontinuity = true;
  lineNumber: LineNumber;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    const text = parts[3];
    if (text.indexOf("System.LimitException") >= 0) {
      truncateLog(this.timestamp, text, "error");
    }

    this.lineNumber = parseLineNumber(parts[2]);
    this.text = text;
    this.group = this.type;
  }
}

class FatalErrorLine extends LogLine {
  acceptsText = true;
  hideable = false;
  discontinuity = true;

  constructor(parts: string[]) {
    super(parts);
    truncateLog(this.timestamp, "FATAL ERROR! cause=" + parts[2], "error");

    this.text = parts[2];
  }
}

class XDSDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class XDSResponseLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}
class XDSResponseDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class XDSResponseErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

const lineTypeMap = new Map<string, new (parts: string[]) => LogLine>([
  ["BULK_HEAP_ALLOCATE", BulkHeapAllocateLine],
  ["CALLOUT_REQUEST", CalloutRequestLine],
  ["CALLOUT_RESPONSE", CalloutResponseLine],
  ["NAMED_CREDENTIAL_REQUEST", NamedCredentialRequestLine],
  ["NAMED_CREDENTIAL_RESPONSE", NamedCredentialResponseLine],
  ["NAMED_CREDENTIAL_RESPONSE_DETAIL", NamedCredentialResponseDetailLine],
  ["CONSTRUCTOR_ENTRY", ConstructorEntryLine],
  ["CONSTRUCTOR_EXIT", ConstructorExitLine],
  ["EMAIL_QUEUE", EmailQueueLine],
  ["METHOD_ENTRY", MethodEntryLine],
  ["METHOD_EXIT", MethodExitLine],
  ["SYSTEM_CONSTRUCTOR_ENTRY", SystemConstructorEntryLine],
  ["SYSTEM_CONSTRUCTOR_EXIT", SystemConstructorExitLine],
  ["SYSTEM_METHOD_ENTRY", SystemMethodEntryLine],
  ["SYSTEM_METHOD_EXIT", SystemMethodExitLine],
  ["CODE_UNIT_STARTED", CodeUnitStartedLine],
  ["CODE_UNIT_FINISHED", CodeUnitFinishedLine],
  ["VF_APEX_CALL_START", VFApexCallStartLine],
  ["VF_APEX_CALL_END", VFApexCallEndLine],
  ["VF_DESERIALIZE_VIEWSTATE_BEGIN", VFDeserializeViewstateBeginLine],
  ["VF_DESERIALIZE_VIEWSTATE_END", VFDeserializeViewstateEndLine],
  ["VF_EVALUATE_FORMULA_BEGIN", VFFormulaStartLine],
  ["VF_EVALUATE_FORMULA_END", VFFormulaEndLine],
  ["VF_SERIALIZE_VIEWSTATE_BEGIN", VFSeralizeViewStateStartLine],
  ["VF_SERIALIZE_VIEWSTATE_END", VFSeralizeViewStateEndLine],
  ["VF_PAGE_MESSAGE", VFPageMessageLine],
  ["DML_BEGIN", DMLBeginLine],
  ["DML_END", DMLEndLine],
  ["IDEAS_QUERY_EXECUTE", IdeasQueryExecuteLine],
  ["SOQL_EXECUTE_BEGIN", SOQLExecuteBeginLine],
  ["SOQL_EXECUTE_END", SOQLExecuteEndLine],
  ["SOQL_EXECUTE_EXPLAIN", SOQLExecuteExplainLine],
  ["SOSL_EXECUTE_BEGIN", SOSLExecuteBeginLine],
  ["SOSL_EXECUTE_END", SOSLExecuteEndLine],
  ["HEAP_ALLOCATE", HeapAllocateLine],
  ["HEAP_DEALLOCATE", HeapDeallocateLine],
  ["STATEMENT_EXECUTE", StatementExecuteLine],
  ["VARIABLE_SCOPE_BEGIN", VariableScopeBeginLine],
  ["VARIABLE_SCOPE_END", VariableScopeEndLine],
  ["VARIABLE_ASSIGNMENT", VariableAssignmentLine],
  ["USER_INFO", UserInfoLine],
  ["USER_DEBUG", UserDebugLine],
  ["CUMULATIVE_LIMIT_USAGE", CumulativeLimitUsageLine],
  ["CUMULATIVE_LIMIT_USAGE_END", CumulativeLimitUsageEndLine],
  ["CUMULATIVE_PROFILING", CumulativeProfilingLine],
  ["CUMULATIVE_PROFILING_BEGIN", CumulativeProfilingBeginLine],
  ["CUMULATIVE_PROFILING_END", CumulativeProfilingEndLine],
  ["LIMIT_USAGE", LimitUsageLine],
  ["LIMIT_USAGE_FOR_NS", LimitUsageForNSLine],
  ["POP_TRACE_FLAGS", PopTraceFlagsLine],
  ["PUSH_TRACE_FLAGS", PushTraceFlagsLine],
  ["QUERY_MORE_BEGIN", QueryMoreBeginLine],
  ["QUERY_MORE_END", QueryMoreEndLine],
  ["QUERY_MORE_ITERATIONS", QueryMoreIterationsLine],
  ["TOTAL_EMAIL_RECIPIENTS_QUEUED", TotalEmailRecipientsQueuedLine],
  ["SAVEPOINT_ROLLBACK", SavepointRollbackLine],
  ["SAVEPOINT_SET", SavepointSetLine],
  ["STACK_FRAME_VARIABLE_LIST", StackFrameVariableListLine],
  ["STATIC_VARIABLE_LIST", StaticVariableListLine],
  ["SYSTEM_MODE_ENTER", SystemModeEnterLine],
  ["SYSTEM_MODE_EXIT", SystemModeExitLine],
  ["EXECUTION_STARTED", ExecutionStartedLine],
  ["EXECUTION_FINISHED", ExecutionFinishedLine],
  ["ENTERING_MANAGED_PKG", EnteringManagedPackageLine],
  ["EVENT_SERVICE_PUB_BEGIN", EventSericePubBeginLine],
  ["EVENT_SERVICE_PUB_END", EventSericePubEndLine],
  ["EVENT_SERVICE_PUB_DETAIL", EventSericePubDetailLine],
  ["EVENT_SERVICE_SUB_BEGIN", EventSericeSubBeginLine],
  ["EVENT_SERVICE_SUB_DETAIL", EventSericeSubDetailLine],
  ["EVENT_SERVICE_SUB_END", EventSericeSubEndLine],
  ["SAVEPOINT_SET", SavePointSetLine],
  ["FLOW_START_INTERVIEWS_BEGIN", FlowStartInterviewsBeginLine],
  ["FLOW_START_INTERVIEWS_END", FlowStartInterviewsEndLine],
  ["FLOW_START_INTERVIEWS_ERROR", FlowStartInterviewsErrorLine],
  ["FLOW_START_INTERVIEW_BEGIN", FlowStartInterviewBeginLine],
  ["FLOW_START_INTERVIEW_END", FlowStartInterviewEndLine],
  ["FLOW_START_INTERVIEW_LIMIT_USAGE", FlowStartInterviewLimitUsageLine],
  ["FLOW_START_SCHEDULED_RECORDS", FlowStartScheduledRecordsLine],
  ["FLOW_CREATE_INTERVIEW_BEGIN", FlowCreateInterviewBeginLine],
  ["FLOW_CREATE_INTERVIEW_END", FlowCreateInterviewEndLine],
  ["FLOW_CREATE_INTERVIEW_ERROR", FlowCreateInterviewErrorLine],
  ["FLOW_ELEMENT_BEGIN", FlowElementBeginLine],
  ["FLOW_ELEMENT_END", FlowElementEndLine],
  ["FLOW_ELEMENT_DEFERRED", FlowElementDeferredLine],
  ["FLOW_ELEMENT_ERROR", FlowElementErrorLine],
  ["FLOW_ELEMENT_FAULT", FlowElementFaultLine],
  ["FLOW_ELEMENT_LIMIT_USAGE", FlowElementLimitUsageLine],
  ["FLOW_INTERVIEW_FINISHED_LIMIT_USAGE", FlowInterviewFinishedLimitUsageLine],
  ["FLOW_SUBFLOW_DETAIL", FlowSubflowDetailLine],
  ["FLOW_VALUE_ASSIGNMENT", FlowElementAssignmentLine],
  ["FLOW_WAIT_EVENT_RESUMING_DETAIL", FlowWaitEventResumingDetailLine],
  ["FLOW_WAIT_EVENT_WAITING_DETAIL", FlowWaitEventWaitingDetailLine],
  ["FLOW_WAIT_RESUMING_DETAIL", FlowWaitResumingDetailLine],
  ["FLOW_WAIT_WAITING_DETAIL", FlowWaitWaitingDetailLine],
  ["FLOW_INTERVIEW_FINISHED", FlowInterviewFinishedLine],
  ["FLOW_INTERVIEW_PAUSED", FlowInterviewPausedLine],
  ["FLOW_INTERVIEW_RESUMED", FlowInterviewResumedLine],
  ["FLOW_ACTIONCALL_DETAIL", FlowActionCallDetailLine],
  ["FLOW_ASSIGNMENT_DETAIL", FlowAssignmentDetailLine],
  ["FLOW_LOOP_DETAIL", FlowLoopDetailLine],
  ["FLOW_RULE_DETAIL", FlowRuleDetailLine],
  ["FLOW_BULK_ELEMENT_BEGIN", FlowBulkElementBeginLine],
  ["FLOW_BULK_ELEMENT_END", FlowBulkElementEndLine],
  ["FLOW_BULK_ELEMENT_DETAIL", FlowBulkElementDetailLine],
  ["FLOW_BULK_ELEMENT_LIMIT_USAGE", FlowBulkElementLimitUsageLine],
  ["FLOW_BULK_ELEMENT_NOT_SUPPORTED", FlowBulkElementNotSupportedLine],
  ["PUSH_NOTIFICATION_INVALID_APP", PNInvalidAppLine],
  ["PUSH_NOTIFICATION_INVALID_CERTIFICATE", PNInvalidCertificateLine],
  ["PUSH_NOTIFICATION_INVALID_NOTIFICATION", PNInvalidNotificationLine],
  ["PUSH_NOTIFICATION_NO_DEVICES", PNNoDevicesLine],
  ["PUSH_NOTIFICATION_NOT_ENABLED", PNNotEnabledLine],
  ["PUSH_NOTIFICATION_SENT", PNSentLine],
  ["SLA_END", SLAEndLine],
  ["SLA_EVAL_MILESTONE", SLAEvalMilestoneLine],
  ["SLA_NULL_START_DATE", SLANullStartDateLine],
  ["SLA_PROCESS_CASE", SLAProcessCaseLine],
  ["TESTING_LIMITS", TestingLimitsLine],
  ["VALIDATION_ERROR", ValidationErrorLine],
  ["VALIDATION_FAIL", ValidationFailLine],
  ["VALIDATION_FORMULA", ValidationFormulaLine],
  ["VALIDATION_PASS", ValidationPassLine],
  ["VALIDATION_RULE", ValidationRuleLine],
  ["WF_FLOW_ACTION_BEGIN", WFFlowActionBeginLine],
  ["WF_FLOW_ACTION_END", WFFlowActionEndLine],
  ["WF_FLOW_ACTION_ERROR", WFFlowActionErrorLine],
  ["WF_FLOW_ACTION_ERROR_DETAIL", WFFlowActionErrorDetailLine],
  ["WF_FIELD_UPDATE", WFFieldUpdateLine],
  ["WF_RULE_EVAL_BEGIN", WFRuleEvalBeginLine],
  ["WF_RULE_EVAL_END", WFRuleEvalEndLine],
  ["WF_RULE_EVAL_VALUE", WFRuleEvalValueLine],
  ["WF_RULE_FILTER", WFRuleFilterLine],
  ["WF_RULE_NOT_EVALUATED", WFRuleNotEvaluatedLine],
  ["WF_CRITERIA_BEGIN", WFCriteriaBeginLine],
  ["WF_CRITERIA_END", WFCriteriaEndLine],
  ["WF_FORMULA", WFFormulaLine],
  ["WF_ACTION", WFActionLine],
  ["WF_ACTIONS_END", WFActionsEndLine],
  ["WF_ACTION_TASK", WFActionTaskLine],
  ["WF_APPROVAL", WFApprovalLine],
  ["WF_APPROVAL_REMOVE", WFApprovalRemoveLine],
  ["WF_APPROVAL_SUBMIT", WFApprovalSubmitLine],
  ["WF_APPROVAL_SUBMITTER", WFApprovalSubmitterLine],
  ["WF_ASSIGN", WFAssignLine],
  ["WF_EMAIL_ALERT", WFEmailAlertLine],
  ["WF_EMAIL_SENT", WFEmailSentLine],
  ["WF_ENQUEUE_ACTIONS", WFEnqueueActionsLine],
  ["WF_ESCALATION_ACTION", WFEscalationActionLine],
  ["WF_ESCALATION_RULE", WFEscalationRuleLine],
  ["WF_EVAL_ENTRY_CRITERIA", WFEvalEntryCriteriaLine],
  ["WF_FLOW_ACTION_DETAIL", WFFlowActionDetailLine],
  ["WF_HARD_REJECT", WFHardRejectLine],
  ["WF_NEXT_APPROVER", WFNextApproverLine],
  ["WF_NO_PROCESS_FOUND", WFNoProcessFoundLine],
  ["WF_OUTBOUND_MSG", WFOutboundMsgLine],
  ["WF_PROCESS_FOUND", WFProcessFoundLine],
  ["WF_REASSIGN_RECORD", WFReassignRecordLine],
  ["WF_RESPONSE_NOTIFY", WFResponseNotifyLine],
  ["WF_RULE_ENTRY_ORDER", WFRuleEntryOrderLine],
  ["WF_RULE_INVOCATION", WFRuleInvocationLine],
  ["WF_SOFT_REJECT", WFSoftRejectLine],
  ["WF_SPOOL_ACTION_BEGIN", WFSpoolActionBeginLine],
  ["WF_TIME_TRIGGER", WFTimeTriggerLine],
  ["WF_TIME_TRIGGERS_BEGIN", WFTimeTriggersBeginLine],
  ["EXCEPTION_THROWN", ExceptionThrownLine],
  ["FATAL_ERROR", FatalErrorLine],
  ["XDS_DETAIL", XDSDetailLine],
  ["XDS_RESPONSE", XDSResponseLine],
  ["XDS_RESPONSE_DETAIL", XDSResponseDetailLine],
  ["XDS_RESPONSE_ERROR", XDSResponseErrorLine],
]);

export function parseLine(
  line: string,
  lastEntry: LogLine | null
): LogLine | null {
  const parts = line.split("|"),
    type = parts[1],
    metaCtor = lineTypeMap.get(type);

  if (metaCtor) {
    const entry = new metaCtor(parts);
    entry.logLine = line;
    if (lastEntry?.after) {
      lastEntry?.after(entry);
    }
    return entry;
  } else {
    if (!typePattern.test(type) && lastEntry?.acceptsText) {
      // wrapped text from the previous entry?
      lastEntry.text += ` | ${line}`;
    } else if (type) {
      if (type !== "DUMMY")
        /* Used by tests */
        console.warn(`Unknown log line: ${type}`);
    } else {
      if (lastEntry && line.startsWith("*** Skipped")) {
        truncateLog(lastEntry.timestamp, "Skipped-Lines", "skip");
      } else if (
        lastEntry &&
        line.indexOf("MAXIMUM DEBUG LOG SIZE REACHED") >= 0
      ) {
        truncateLog(lastEntry.timestamp, "Max-Size-reached", "skip");
      } else {
        console.warn(`Bad log line: ${line}`);
      }
    }
  }
  return null;
}

export default async function parseLog(log: string) {
  const start = log.match(/^.*EXECUTION_STARTED.*$/m)?.index || -1;
  const rawLines = log.substring(start).split("\n");

  // reset global variables to be captured during parsing
  logLines = [];
  truncated = [];
  reasons = new Set<string>();
  cpuUsed = 0;

  let lastEntry = null;
  const len = rawLines.length;
  for (let i = 0; i < len; ++i) {
    const line = rawLines[i];
    if (line) {
      // ignore blank lines
      const entry = parseLine(line, lastEntry);
      if (entry) {
        logLines.push(entry);
        lastEntry = entry;
      }
    }
  }

  return logLines;
}

const settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;

export function getLogSettings(log: string): [string, string][] {
  const match = log.match(settingsPattern);
  if (!match) {
    return [];
  }

  const settings = match[0],
    settingList = settings.substring(settings.indexOf(" ") + 1).split(";");

  return settingList.map((entry) => {
    const parts = entry.split(",");
    return [parts[0], parts[1]];
  });
}

export { logLines, truncated, cpuUsed };
