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
  netDuration: number | null = null;
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
  totalDuration: number = 0,
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

class ConstructorEntryLine extends LogLine {
  exitTypes = ["CONSTRUCTOR_EXIT"];
  displayType = "method";
  hasLineNumber = true;
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

export class MethodEntryLine extends LogLine {
  exitTypes = ["METHOD_EXIT"];
  displayType = "method";
  hasLineNumber = true;
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
  hasLineNumber = true;
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
  hasLineNumber = true;
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
  hasLineNumber = false;
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
  exitTypes = ["VF_APEX_CALL_END"];
  displayType = "method";
  hasLineNumber = true;
  cpuType = "method";
  suffix = " (VF APEX)";
  classes = "node";
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class VFApexCallEndLine extends LogLine {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class VFFormulaStartLine extends LogLine {
  exitTypes = ["VF_EVALUATE_FORMULA_END"];
  cpuType = "custom";
  suffix = " (VF FORMULA)";
  classes = "node formula";
  group: string;

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

class DMLBeginLine extends LogLine {
  exitTypes = ["DML_END"];
  displayType = "method";
  hasLineNumber = true;
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

interface EndLine {
  rowCount: number;
}

class SOQLExecuteBeginLine extends LogLine {
  exitTypes = ["SOQL_EXECUTE_END"];
  displayType = "method";
  hasLineNumber = true;
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

class HeapAllocateLine extends LogLine {
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

class TotalEmailRecipientsQueuedLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class StaticVariableListLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class SystemModeEnterLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class SystemModeExitLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

export class ExecutionStartedLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

export class ExecutionFinishedLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
  }
}

class EnteringManagedPackageLine extends LogLine {
  displayType = "method";
  cpuType = "pkg";
  timelineKey = "method";
  name: string;
  namespace: string;
  exitStamp: any;
  duration: any;
  netDuration: any;

  constructor(parts: string[]) {
    super(parts);
    const rawNs = parts[2],
      lastDot = rawNs.lastIndexOf("."),
      ns = lastDot < 0 ? rawNs : rawNs.substring(lastDot + 1);

    this.text = this.namespace = ns;
    this.name = this.type + ": " + parts[2];
  }

  after(next: LogLine) {
    this.exitStamp = next.timestamp;
    this.duration = this.netDuration = this.exitStamp - this.timestamp;
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

class FlowInterviewFinishedLine extends LogLine {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class FlowElementErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + parts[2] + " " + parts[3] + " " + parts[4];
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

class FlowBulkElementLimitUsage extends LogLine {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
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
  }
}

class WFSpoolActionBeginLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
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

const lineTypeMap = new Map<string, new (parts: string[]) => LogLine>([
  ["CONSTRUCTOR_ENTRY", ConstructorEntryLine],
  ["CONSTRUCTOR_EXIT", ConstructorExitLine],
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
  ["VF_EVALUATE_FORMULA_BEGIN", VFFormulaStartLine],
  ["VF_EVALUATE_FORMULA_END", VFFormulaEndLine],
  ["VF_SERIALIZE_VIEWSTATE_BEGIN", VFSeralizeViewStateStartLine],
  ["VF_SERIALIZE_VIEWSTATE_END", VFSeralizeViewStateEndLine],
  ["DML_BEGIN", DMLBeginLine],
  ["DML_END", DMLEndLine],
  ["SOQL_EXECUTE_BEGIN", SOQLExecuteBeginLine],
  ["SOQL_EXECUTE_END", SOQLExecuteEndLine],
  ["HEAP_ALLOCATE", HeapAllocateLine],
  ["STATEMENT_EXECUTE", StatementExecuteLine],
  ["VARIABLE_SCOPE_BEGIN", VariableScopeBeginLine],
  ["VARIABLE_ASSIGNMENT", VariableAssignmentLine],
  ["USER_INFO", UserInfoLine],
  ["USER_DEBUG", UserDebugLine],
  ["CUMULATIVE_LIMIT_USAGE", CumulativeLimitUsageLine],
  ["CUMULATIVE_LIMIT_USAGE_END", CumulativeLimitUsageEndLine],
  ["LIMIT_USAGE", LimitUsageLine],
  ["LIMIT_USAGE_FOR_NS", LimitUsageForNSLine],
  ["TOTAL_EMAIL_RECIPIENTS_QUEUED", TotalEmailRecipientsQueuedLine],
  ["STATIC_VARIABLE_LIST", StaticVariableListLine],
  ["SYSTEM_MODE_ENTER", SystemModeEnterLine],
  ["SYSTEM_MODE_EXIT", SystemModeExitLine],
  ["EXECUTION_STARTED", ExecutionStartedLine],
  ["EXECUTION_FINISHED", ExecutionFinishedLine],
  ["ENTERING_MANAGED_PKG", EnteringManagedPackageLine],
  ["EVENT_SERVICE_PUB_BEGIN", EventSericePubBeginLine],
  ["EVENT_SERVICE_PUB_END", EventSericePubEndLine],
  ["EVENT_SERVICE_PUB_DETAIL", EventSericePubDetailLine],
  ["SAVEPOINT_SET", SavePointSetLine],
  ["FLOW_START_INTERVIEWS_BEGIN", FlowStartInterviewsBeginLine],
  ["FLOW_START_INTERVIEWS_END", FlowStartInterviewsEndLine],
  ["FLOW_START_INTERVIEW_BEGIN", FlowStartInterviewBeginLine],
  ["FLOW_START_INTERVIEW_END", FlowStartInterviewEndLine],
  ["FLOW_START_INTERVIEW_LIMIT_USAGE", FlowStartInterviewLimitUsageLine],
  ["FLOW_CREATE_INTERVIEW_BEGIN", FlowCreateInterviewBeginLine],
  ["FLOW_CREATE_INTERVIEW_END", FlowCreateInterviewEndLine],
  ["FLOW_ELEMENT_BEGIN", FlowElementBeginLine],
  ["FLOW_ELEMENT_END", FlowElementEndLine],
  ["FLOW_ELEMENT_DEFERRED", FlowElementDeferredLine],
  ["FLOW_VALUE_ASSIGNMENT", FlowElementAssignmentLine],
  ["FLOW_INTERVIEW_FINISHED", FlowInterviewFinishedLine],
  ["FLOW_ELEMENT_ERROR", FlowElementErrorLine],
  ["FLOW_ACTIONCALL_DETAIL", FlowActionCallDetailLine],
  ["FLOW_ASSIGNMENT_DETAIL", FlowAssignmentDetailLine],
  ["FLOW_LOOP_DETAIL", FlowLoopDetailLine],
  ["FLOW_RULE_DETAIL", FlowRuleDetailLine],
  ["FLOW_BULK_ELEMENT_BEGIN", FlowBulkElementBeginLine],
  ["FLOW_BULK_ELEMENT_END", FlowBulkElementEndLine],
  ["FLOW_BULK_ELEMENT_DETAIL", FlowBulkElementDetailLine],
  ["FLOW_BULK_ELEMENT_LIMIT_USAGE", FlowBulkElementLimitUsage],
  ["VALIDATION_RULE", ValidationRuleLine],
  ["VALIDATION_FORMULA", ValidationFormulaLine],
  ["VALIDATION_PASS", ValidationPassLine],
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
  ["WF_SPOOL_ACTION_BEGIN", WFSpoolActionBeginLine],
  ["WF_TIME_TRIGGERS_BEGIN", WFTimeTriggersBeginLine],
  ["EXCEPTION_THROWN", ExceptionThrownLine],
  ["FATAL_ERROR", FatalErrorLine],
]);

export function parseLine(line: string, lastEntry: LogLine | null): LogLine | null {
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
      if (type !== 'DUMMY') /* Used by tests */
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
  const start = log.indexOf("EXECUTION_STARTED");
  const rawLines = log.substring(start).split("\n");
  // strip the "EXECUTION_STARTED" and "EXECUTION_FINISHED" lines
  rawLines.pop();
  rawLines.shift();

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

  const linLen = logLines.length;
  const endTime = linLen ? logLines[logLines.length - 1].timestamp : 0;
  const startTime = linLen ? logLines[0].timestamp : 0;
  totalDuration = endTime - startTime;
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

export { logLines, totalDuration, truncated, cpuUsed };
