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

export class LineIterator {
  lines: LogLine[];
  index: number;

  constructor(lines: LogLine[]) {
    this.lines = lines;
    this.index = 0;
  }

  peek() {
    return this.index < this.lines.length ? this.lines[this.index] : null;
  }

  fetch() {
    return this.index < this.lines.length ? this.lines[this.index++] : null;
  }
}

// export abstract class TimeStampedNode {
//   timestamp: number = 0;
//   exitStamp: number | null = null;
//   duration: number | null = null;
//   selfTime: number | null = null;
//   children: TimeStampedNode[] = [];
// }

export abstract class LogLine {
	timestamp: number = 0;

	type: string = '';
	logLine: string = '';
	acceptsText: boolean = false;
	text: string = '';
	summaryCount: number = 0;

	isExit: boolean = false;
	isValid: boolean = true;
	hasValidSymbols: boolean = false;
	discontinuity: boolean = false;
	lineNumber: LineNumber = null;
	rowCount: number | null = null;
	group: string | null = null;
	containsDml: number = 0;
	containsSoql: number = 0;
	containsThrown: number = 0;
	value: string | null = null;
	suffix: string | null = null;
	prefix: string | null = null;
	namespace: string | null = null;
	declarative: boolean = false;

	get children(): LogLine[] {
		return [];
	}

	constructor(parts: string[] | null) {
		if (parts) {
			this.type = parts[1];
			this.timestamp = parseTimestamp(parts[0]);
		}
	}

	getDuration() {
		return 0;
	}

	loadContent(lineIter: LineIterator, stack: Method[]) {}

	onEnd(end: LogLine, stack: LogLine[]) {}

	onAfter(next: LogLine) {}
}

export type TimelineKey = 'method' | 'systemMethod' | 'codeUnit' | 'dml' | 'soql' | 'flow' | 'workflow' | 'dummy';

/**
 * Log lines extend this class if they have a duration (and hence can be shown on the timeline).
 */
export class TimedNode extends LogLine {
	timelineKey: TimelineKey;
	cpuType: string;
	exitStamp: number | null = null;
	duration: number | null = null;
	selfTime: number | null = null;

	constructor(parts: string[] | null, timelineKey: TimelineKey, cpuType: string) {
		super(parts);
		this.timelineKey = timelineKey;
		this.cpuType = cpuType;
	}

	getDuration() {
		return this.duration || 0;
	}

	recalculateDurations() {
		if (this.exitStamp) {
			this.selfTime = this.duration = this.exitStamp - this.timestamp;

			this.children.forEach(child => {
				this.selfTime! -= child.getDuration();
			});
		}
	}
}

/**
 * Log lines extend this class if they have a start-line and an end-line (and hence can have children in-between).
 * - The start-line should extend "Method" and collect any children.
 * - The end-line should extend "Detail" and terminate the method (also providing the "exitStamp").
 * The method will be rendered as "expandable" in the tree-view, if it has children.
 */
export class Method extends TimedNode {
	exitTypes: string[];
	classes: string;
	isTruncated = false;

	_children: LogLine[] = [];
	get children() {
	  return this._children;
	}
	set children(value) {
		this._children = value;
	}

	constructor(parts: string[] | null, exitTypes: string[], classes: string | null, timelineKey: TimelineKey, cpuType: string) {
		super(parts, timelineKey, cpuType);
		this.exitTypes = exitTypes;
		this.classes = classes ? 'node ' + classes : 'node';
	}

	addChild(line: LogLine) {
		this._children.push(line);
	}

	isMatchingEnd(endLine: LogLine) {
		return this.exitTypes.includes(endLine.type) &&
			(!endLine.lineNumber || !this.lineNumber || endLine.lineNumber === this.lineNumber);
	}
	
	endMethod(endLine: LogLine, lineIter: LineIterator, stack: Method[]) {
		this.exitStamp = endLine.timestamp;

		// is this a 'good' end line?
		if (this.isMatchingEnd(endLine)) {
			discontinuity = false; // end stack unwinding
			lineIter.fetch(); // consume the line
			return true; // success
		} else if (discontinuity) {
			return true; // exception - unwind
		} else {
			if (stack.some((m) => m.isMatchingEnd(endLine))) {
				return true; // we match a method further down the stack - unwind
			}
			// we found an exit event on its own e.g a `METHOD_EXIT` without a `METHOD_ENTRY`
			truncateLog(endLine.timestamp, 'Unexpected-Exit', 'unexpected');
			return false; // we have no matching method - ignore
		}
	}

	loadContent(lineIter: LineIterator, stack: Method[]) {
		lastTimestamp = this.timestamp;

		if (this.exitTypes.length > 0) {
			let line;
	
			stack.push(this);
	
			while ((line = lineIter.peek())) { // eslint-disable-line no-cond-assign
				if (line.discontinuity) {
					// discontinuities are stack unwinding (caused by Exceptions)
					discontinuity = true; // start unwinding stack
				}
	
				if (line.isExit && this.endMethod(line, lineIter, stack)) {
					if (this.onEnd) {
						// the method wants to see the exit line
						this.onEnd(line, stack);
					}
					break;
				}

				lineIter.fetch(); // it's a child - consume the line
				lastTimestamp = line.timestamp;
				if (line.isValid) {
					line.loadContent(lineIter, stack);
				}
				this.addChild(line);
			}
	
			if (line == null) {
				// truncated method - terminate at the end of the log
				this.exitStamp = lastTimestamp;
	
				// we found an entry event on its own e.g a `METHOD_ENTRY` without a `METHOD_EXIT`
				truncateLog(lastTimestamp, 'Unexpected-End', 'unexpected');
				this.isTruncated = true;
			}
	
			stack.pop();
		}
	
		this.recalculateDurations();
	}
}

/**
 * This class represents the single root node for the node tree.
 * Since it has children it extends "Method".
 */
export class RootNode extends Method {
	text = 'Log Root';
	type = 'ROOT';
	timestamp = 0;
	exitStamp = 0;

	constructor() {
		super(null, [], 'root', 'dummy', '');
	}

	setEndTime() {
		// We could have multiple "EXECUTION_STARTED" entries so loop backwards until we find one.
		// We do not just want to use the last one because it is probably CUMULATIVE_USAGE which is not really part of the code execution time but does have a later time.
		let endTime;
		const len = this.children.length - 1;
		for (let i = len; i >= 0; i--) {
			const child = this.children[i];
			if (child instanceof TimedNode) {
				// Get the latest time of the last node (with a time) to use as a default
				// This helps to display something on the timeline if the log is malformed
				// e.g does not contain `EXECUTION_STARTED` + `EXECUTION_FINISED`
				endTime ??= child.exitStamp;
				if (child.type === 'EXECUTION_STARTED') {
					endTime = child.exitStamp;
					break;
				}
			}
		}
		this.exitStamp = endTime || 0;
	}
}

/**
 * Log lines extend this class if they have no duration.
 */
export class Detail extends LogLine {
	hideable = true;

	constructor(parts: string[] | null) {
		super(parts);
	}
}

let logLines: LogLine[] = [],
  truncated: [string, number, string | undefined][],
  reasons: Set<string> = new Set<string>(),
  cpuUsed: number = 0,
	lastTimestamp = null,
	totalDuration = 0,		// the maximum display value (in nano-seconds)
	discontinuity = false;

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
    return !Number.isNaN(lineNumber) ? lineNumber : lineNumberStr;
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

class BulkHeapAllocateLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class CalloutRequestLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} : ${parts[2]}`;
  }
}

class CalloutResponseLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} : ${parts[2]}`;
  }
}
class NamedCredentialRequestLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class NamedCredentialResponseLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class NamedCredentialResponseDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} : ${parts[4]} ${parts[5]} : ${parts[6]} ${parts[7]}`;
  }
}

class ConstructorEntryLine extends Method {
	hasValidSymbols = true;
	suffix = ' (constructor)';

	constructor(parts: string[]) {
		super(parts, ['CONSTRUCTOR_EXIT'], null, 'method', 'method');
		this.lineNumber = parseLineNumber(parts[2]);
		const args = parts[4];
		this.text = parts[5] + args.substring(args.lastIndexOf('('));
	}
}

class ConstructorExitLine extends Detail {
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class EmailQueueLine extends Detail {
  lineNumber: LineNumber;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

export class MethodEntryLine extends Method {
	hasValidSymbols = true;

	constructor(parts: string[]) {
		super(parts, ['METHOD_EXIT'], null, 'method', 'method');
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = parts[4] || this.type;
		if (this.text === 'System.Type.forName(String, String)') {
			this.cpuType = 'loading'; // assume we are not charged for class loading (or at least not lengthy remote-loading / compiling)
			// no namespace or it will get charged...
		}
	}
}
class MethodExitLine extends Detail {
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class SystemConstructorEntryLine extends Method {
	suffix = '(system constructor)';

	constructor(parts: string[]) {
		super(parts, ['SYSTEM_CONSTRUCTOR_EXIT'], 'system', 'systemMethod', 'method');
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = parts[3];
	}
}

class SystemConstructorExitLine extends Detail {
  namespace = "system";
  timelineKey = "systemMethod";
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}
class SystemMethodEntryLine extends Method {
	constructor(parts: string[]) {
		super(parts, ['SYSTEM_METHOD_EXIT'], 'system', 'systemMethod', 'method');
		this.lineNumber = parseLineNumber(parts[2]);
		this.text = parts[3];
	}
}

class SystemMethodExitLine extends Detail {
  namespace = "system";
  timelineKey = "systemMethod";
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

const cpuMap: Map<string, string> = new Map([
	['EventService', 'method'],
	['Validation', 'custom'],
	['Workflow', 'custom'],
	['Flow', 'custom']
]);

export class CodeUnitStartedLine extends Method {
  suffix = " (entrypoint)";

  constructor(parts: string[]) {
		super(parts, ['CODE_UNIT_FINISHED'], null, 'codeUnit', CodeUnitStartedLine.getCpuType(parts));
    const subParts = parts[3].split(":"),
      name = parts[4] || parts[3];

    const codeUnitType = subParts[0];
    switch (codeUnitType) {
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
        this.text = name || codeUnitType + ":" + subParts[1];
        break;
      case "Workflow":
        this.cpuType = "custom";
        this.declarative = true;
        this.group = codeUnitType;
        this.text = name || codeUnitType;
        break;
      case "Flow":
        this.cpuType = "custom";
        this.declarative = true;
        this.group = codeUnitType;
        this.text = name || codeUnitType;
        break;
      default:
        this.cpuType = "method";
        if (name?.startsWith("VF:")) {
          this.namespace = parseVfNamespace(name);
        }
        this.text = name || parts[3];
        break;
    }
  }

	static getCpuType(parts: string[]) {
		const subParts = parts[3].split(':'),
			codeUnitType = subParts[0],
			cpuType = cpuMap.get(codeUnitType);
		
		return cpuType ?? 'method';
	}
}
export class CodeUnitFinishedLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class VFApexCallStartLine extends Method {
  suffix = " (VF APEX)";

  constructor(parts: string[]) {
		super(parts, ['VF_APEX_CALL_END'], null, 'method', 'method');
    this.lineNumber = parseLineNumber(parts[2]);

    const classText = parts[5] || parts[3];
    let methodtext = parts[4] || "";
    if (!methodtext && classText.toLowerCase().includes("pagemessagescomponentcontroller")) {
      // we have s system entry and they do not have exits
      // e.g |VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex <init>
      // and they really mess with the logs so skip handling them.
      this.isValid = false;
    } else if (methodtext) {
      this.hasValidSymbols = true;
      // method call
      const methodIndex = methodtext.indexOf("(");
      const constructorIndex = methodtext.indexOf("<init>");
      if (methodIndex > -1) {
        // Method
        methodtext = "." + methodtext.substring(methodIndex).slice(1, -1) + "()";
      } else if (constructorIndex > -1) {
        // Constructor
        methodtext = methodtext.substring(constructorIndex + 6) + "()";
      } else {
        // Property
        methodtext = "." + methodtext;
      }
    } else {
      this.hasValidSymbols = true;
    }
    this.text = classText + methodtext;
  }
}

class VFApexCallEndLine extends Detail {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class VFDeserializeViewstateBeginLine extends Method {
  constructor(parts: string[]) {
		super(parts, ['VF_DESERIALIZE_VIEWSTATE_END'], null, 'systemMethod', 'method');
    this.text = this.type;
  }
}

class VFDeserializeViewstateEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class VFFormulaStartLine extends Method {
  suffix = " (VF FORMULA)";

  constructor(parts: string[]) {
		super(parts, ['VF_EVALUATE_FORMULA_END'], 'formula', 'systemMethod', 'custom');
    this.text = parts[3];
    this.group = this.type;
  }
}

class VFFormulaEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class VFSeralizeViewStateStartLine extends Method {
  namespace = "system";

  constructor(parts: string[]) {
		super(parts, ['VF_SERIALIZE_VIEWSTATE_END'], null, 'systemMethod', 'method');
    this.text = this.type;
  }
}

class VFSeralizeViewStateEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class VFPageMessageLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class DMLBeginLine extends Method {
  group = "DML";

  constructor(parts: string[]) {
		super(parts, ['DML_END'], null, 'dml', 'free');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = "DML " + parts[3] + " " + parts[4];
    this.rowCount = parseRows(parts[5]);
  }
}

class DMLEndLine extends Detail {
  isExit = true;
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class IdeasQueryExecuteLine extends Detail {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

interface EndLine {
  rowCount: number;
}

class SOQLExecuteBeginLine extends Method {
  group = "SOQL";

  constructor(parts: string[]) {
		super(parts, ['SOQL_EXECUTE_END'], null, 'soql', 'free');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = "SOQL: " + parts[3] + " - " + parts[4];
  }

  onEnd(end: SOQLExecuteEndLine, stack: LogLine[]) {
    this.rowCount = end.rowCount;
  }
}

class SOQLExecuteEndLine extends Detail {
  isExit = true;
  lineNumber: LineNumber;
  rowCount: number;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.rowCount = parseRows(parts[3]);
  }
}

class SOQLExecuteExplainLine extends Detail {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line:${this.lineNumber}`;
  }
}

class SOSLExecuteBeginLine extends Method {
  group = "SOQL";

  constructor(parts: string[]) {
		super(parts, ['SOSL_EXECUTE_END'], null, 'soql', 'free');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `SOSL: ${parts[3]}`;
  }

  onEnd(end: SOSLExecuteEndLine, stack: Detail[]) {
    this.rowCount = end.rowCount;
  }
}

class SOSLExecuteEndLine extends Detail {
  isExit = true;
  lineNumber: LineNumber;
  rowCount: number;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.rowCount = parseRows(parts[3]);
  }
}

class HeapAllocateLine extends Detail {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class HeapDeallocateLine extends Detail {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class StatementExecuteLine extends Detail {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class VariableScopeBeginLine extends Detail {
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

  onEnd(end: LogLine, stack: LogLine[]) {
    if (end.value) {
      this.value = end.value;
    }
    console.debug("NEVER HIT?");
  }
}

class VariableScopeEndLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}
class VariableAssignmentLine extends Detail {
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
class UserInfoLine extends Detail {
  lineNumber: LineNumber;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = this.type + ":" + parts[3] + " " + parts[4];
    this.group = this.type;
  }
}

class UserDebugLine extends Detail {
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

class CumulativeLimitUsageLine extends Method {
  constructor(parts: string[]) {
		super(parts, ['CUMULATIVE_LIMIT_USAGE_END'], null, 'systemMethod', 'system');
    this.text = this.type;
    this.group = this.type;
  }
}

class CumulativeLimitUsageEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class CumulativeProfilingLine extends Detail {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " " + (parts[3] ?? "");
  }
}

class CumulativeProfilingBeginLine extends Method {
  constructor(parts: string[]) {
		super(parts, ['CUMULATIVE_PROFILING_END'], null, 'systemMethod', 'custom');
  }
}

class CumulativeProfilingEndLine extends Detail {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
  }
}

class LimitUsageLine extends Detail {
  lineNumber: LineNumber;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3] + " " + parts[4] + " out of " + parts[5];
    this.group = this.type;
  }
}

class LimitUsageForNSLine extends Detail {
  acceptsText = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }

  onAfter(next: LogLine) {
    const matched = this.text.match(/Maximum CPU time: (\d+)/),
      cpuText = matched ? matched[1] : "0",
      cpuTime = parseInt(cpuText, 10) * 1000000; // convert from milli-seconds to nano-seconds

    if (!cpuUsed || cpuTime > cpuUsed) {
      cpuUsed = cpuTime;
    }
  }
}

class PushTraceFlagsLine extends Detail {
  namespace = "system";
  timelineKey = "systemMethod";
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[4] + ", line:" + this.lineNumber + " - " + parts[5];
  }
}

class PopTraceFlagsLine extends Detail {
  namespace = "system";
  timelineKey = "systemMethod";
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[4] + ", line:" + this.lineNumber + " - " + parts[5];
  }
}

class QueryMoreBeginLine extends Method {
  constructor(parts: string[]) {
		super(parts, ['QUERY_MORE_END'], null, 'soql', 'custom');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}
class QueryMoreEndLine extends Detail {
  lineNumber: LineNumber;
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}
class QueryMoreIterationsLine extends Detail {
  lineNumber: LineNumber;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}, iterations:${parts[3]}`;
  }
}

class SavepointRollbackLine extends Detail {
  lineNumber: LineNumber;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

class SavepointSetLine extends Detail {
  lineNumber: LineNumber;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

class TotalEmailRecipientsQueuedLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class StackFrameVariableListLine extends Detail {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
  }
}

class StaticVariableListLine extends Detail {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
  }
}

class SystemModeEnterLine extends Detail {
  namespace = "system";
  timelineKey = "systemMethod";
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class SystemModeExitLine extends Detail {
  namespace = "system";
  timelineKey = "systemMethod";
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

export class ExecutionStartedLine extends Method {
  constructor(parts: string[]) {
		super(parts, ['EXECUTION_FINISHED'], null, 'method', 'method');
    this.text = this.type;
  }
}

export class ExecutionFinishedLine extends Detail {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = this.type;
  }
}

class EnteringManagedPackageLine extends TimedNode {
  constructor(parts: string[]) {
		super(parts, 'method', 'pkg');
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

class EventSericePubBeginLine extends Method {
  constructor(parts: string[]) {
		super(parts, ['EVENT_SERVICE_PUB_END'], null, 'flow', 'custom');
    this.group = this.type;
    this.text = parts[2];
  }
}

class EventSericePubEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class EventSericePubDetailLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " " + parts[3] + " " + parts[4];
    this.group = this.type;
  }
}

class EventSericeSubBeginLine extends Method {
  constructor(parts: string[]) {
		super(parts, ['EVENT_SERVICE_SUB_END'], null, 'flow', 'custom');
    this.text = `${parts[2]} ${parts[3]}`;
    this.group = this.type;
  }
}

class EventSericeSubEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} ${parts[3]}`;
  }
}

class EventSericeSubDetailLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} ${parts[3]} ${parts[4]} ${parts[6]} ${parts[6]}`;
    this.group = this.type;
  }
}

class SavePointSetLine extends Detail {
  lineNumber: LineNumber;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3];
  }
}

class FlowStartInterviewsBeginLine extends Method {
  declarative = true;
  text = "FLOW_START_INTERVIEWS : ";

  constructor(parts: string[]) {
		super(parts, ['FLOW_START_INTERVIEWS_END'], null, 'flow', 'custom');
  }

  onEnd(end: FlowStartInterviewEndLine, stack: LogLine[]) {
    const flowType = this.getFlowType(stack);
    this.group = flowType;
    this.suffix = ` (${flowType})`;
    this.text += this.getFlowName();
  }

  getFlowType(stack: LogLine[]) {
    let flowType;
    const len = stack.length - 1;
    for (let i = len; i >= 0; i--) {
      const elem = stack[i];
      if (elem.type === "CODE_UNIT_STARTED" && elem.group === "Flow") {
        flowType = "Flow";
        break;
      }
    }
    return flowType || "Process Builder";
  }

  getFlowName() {
    if (this.children.length) {
      let interviewBegin = this.children[0];
      return interviewBegin.text;
    }
    return "";
  }
}

class FlowStartInterviewsEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowStartInterviewsErrorLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} - ${parts[4]}`;
  }
}

class FlowStartInterviewBeginLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class FlowStartInterviewEndLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowStartInterviewLimitUsageLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class FlowStartScheduledRecordsLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}
class FlowCreateInterviewBeginLine extends Detail {
  text = "";

  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowCreateInterviewEndLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowCreateInterviewErrorLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowElementBeginLine extends Method {
  declarative = true;

  constructor(parts: string[]) {
		super(parts, ['FLOW_ELEMENT_END'], null, 'flow', 'custom');
    this.group = this.type;
    this.text = this.type + " : " + parts[3] + " " + parts[4];
  }
}

class FlowElementEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowElementDeferredLine extends Detail {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " " + parts[3];
    this.group = this.type;
  }
}

class FlowElementAssignmentLine extends Detail {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " " + parts[4];
    this.group = this.type;
  }
}

class FlowWaitEventResumingDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowWaitEventWaitingDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class FlowWaitResumingDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowWaitWaitingDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowInterviewFinishedLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class FlowInterviewResumedLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class FlowInterviewPausedLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowElementErrorLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + parts[2] + " " + parts[3] + " " + parts[4];
  }
}

class FlowElementFaultLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowElementLimitUsageLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class FlowInterviewFinishedLimitUsageLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class FlowSubflowDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowActionCallDetailLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " : " + parts[4] + " : " + parts[5] + " : " + parts[6];
    this.group = this.type;
  }
}

class FlowAssignmentDetailLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " : " + parts[4] + " : " + parts[5];
    this.group = this.type;
  }
}

class FlowLoopDetailLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " : " + parts[4];
    this.group = this.type;
  }
}

class FlowRuleDetailLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + " : " + parts[4];
    this.group = this.type;
  }
}

class FlowBulkElementBeginLine extends Method {
  declarative = true;

  constructor(parts: string[]) {
		super(parts, ['FLOW_BULK_ELEMENT_END'], null, 'flow', 'custom');
    this.text = this.type + " : " + parts[2];
    this.group = this.type;
  }
}

class FlowBulkElementEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class FlowBulkElementDetailLine extends Detail {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " : " + parts[3] + " : " + parts[4];
    this.group = this.type;
  }
}

class FlowBulkElementNotSupportedLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowBulkElementLimitUsageLine extends Detail {
  declarative = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class PNInvalidAppLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}

class PNInvalidCertificateLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}
class PNInvalidNotificationLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]} : ${parts[8]}`;
  }
}
class PNNoDevicesLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}
class PNNotEnabledLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}
class PNSentLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

class SLAEndLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class SLAEvalMilestoneLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class SLANullStartDateLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class SLAProcessCaseLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class TestingLimitsLine extends Detail {
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class ValidationRuleLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class ValidationErrorLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class ValidationFailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class ValidationFormulaLine extends Detail {
  acceptsText = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    const extra = parts.length > 3 ? " " + parts[3] : "";

    this.text = parts[2] + extra;
    this.group = this.type;
  }
}

class ValidationPassLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3];
    this.group = this.type;
  }
}

class WFFlowActionBeginLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFFlowActionEndLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFFlowActionErrorLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + " " + parts[4];
  }
}

class WFFlowActionErrorDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + " " + parts[2];
  }
}

class WFFieldUpdateLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = " " + parts[2] + " " + parts[3] + " " + parts[4] + " " + parts[5] + " " + parts[6];
    this.group = this.type;
  }
}

class WFRuleEvalBeginLine extends Method {
  declarative = true;

  constructor(parts: string[]) {
		super(parts, ['WF_RULE_EVAL_END'], null, 'workflow', 'custom');
    this.text = this.type + " : " + parts[2];
  }
}

class WFRuleEvalEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class WFRuleEvalValueLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class WFRuleFilterLine extends Detail {
  acceptsText = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class WFRuleNotEvaluatedLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class WFCriteriaBeginLine extends Method {
  declarative = true;
  group = "WF_CRITERIA";

  constructor(parts: string[]) {
		super(parts, ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED'], null, 'workflow', 'custom');
    this.text = "WF_CRITERIA : " + parts[5] + " : " + parts[3];
  }
}

class WFCriteriaEndLine extends Detail {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
  }
}

class WFFormulaLine extends Detail {
  acceptsText = true;
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + " : " + parts[3];
    this.group = this.type;
  }
}

class WFActionLine extends Detail {
  group: string;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
    this.group = this.type;
  }
}

class WFActionsEndLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFActionTaskLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

class WFApprovalLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFApprovalRemoveLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class WFApprovalSubmitLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]}`;
  }
}

class WFApprovalSubmitterLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFAssignLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFEmailAlertLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFEmailSentLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFEnqueueActionsLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFEscalationActionLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFEscalationRuleLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFEvalEntryCriteriaLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFFlowActionDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    const optional = parts[4] ? ` : ${parts[4]} :${parts[5]}` : "";
    this.text = `${parts[2]} : ${parts[3]}` + optional;
  }
}

class WFHardRejectLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFNextApproverLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFNoProcessFoundLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class WFOutboundMsgLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFProcessFoundLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFReassignRecordLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFResponseNotifyLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFRuleEntryOrderLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFRuleInvocationLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFSoftRejectLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFTimeTriggerLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFSpoolActionBeginLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class WFTimeTriggersBeginLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
  }
}

class ExceptionThrownLine extends Detail {
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

class FatalErrorLine extends Detail {
  acceptsText = true;
  hideable = false;
  discontinuity = true;

  constructor(parts: string[]) {
    super(parts);
    truncateLog(this.timestamp, "FATAL ERROR! cause=" + parts[2], "error");

    this.text = parts[2];
  }
}

class XDSDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class XDSResponseLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}
class XDSResponseDetailLine extends Detail {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2];
  }
}

class XDSResponseErrorLine extends Detail {
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

export function parseLine(line: string, lastEntry: LogLine | null): LogLine | null {
  const parts = line.split("|"),
    type = parts[1],
    metaCtor = lineTypeMap.get(type);

  if (metaCtor) {
    const entry = new metaCtor(parts);
    entry.logLine = line;
    if (lastEntry?.onAfter) {
      lastEntry?.onAfter(entry);
    }
    return entry;
  }

  if (!typePattern.test(type) && lastEntry?.acceptsText) {
    // wrapped text from the previous entry?
    lastEntry.text += ` | ${line}`;
  } else if (type) {
    if (type !== "DUMMY") {
      /* Used by tests */
      console.warn(`Unknown log line: ${type}`);
    }
  } else {
    if (lastEntry && line.startsWith("*** Skipped")) {
      truncateLog(lastEntry.timestamp, "Skipped-Lines", "skip");
    } else if (lastEntry && line.indexOf("MAXIMUM DEBUG LOG SIZE REACHED") >= 0) {
      truncateLog(lastEntry.timestamp, "Max-Size-reached", "skip");
		} else if (settingsPattern.test(line)) {
			// skip an unexpected settings line
    } else {
      console.warn(`Bad log line: ${line}`);
    }
  }

  return null;
}

// Matches CRLF (\r\n) + LF (\n)
// the ? matches the previous token 0 or 1 times.
const newlineRegex = /\r?\n/;
export default async function parseLog(log: string) {
  const start = log.match(/^.*EXECUTION_STARTED.*$/m)?.index || -1;
  const rawLines = log.substring(start).split(newlineRegex);

  // reset global variables to be captured during parsing
  logLines = [];
  truncated = [];
  reasons = new Set<string>();
  cpuUsed = 0;

  let lastEntry = null;
  const len = rawLines.length;
  for (let i = 0; i < len; i++) {
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

export function getRootMethod() {
	const lineIter = new LineIterator(logLines),
		rootMethod = new RootNode(),
		stack: Method[] = [];
	let line: LogLine | null;

	discontinuity = false;
	lastTimestamp = null;
	while ((line = lineIter.fetch())) { // eslint-disable-line no-cond-assign
		line.loadContent(lineIter, stack);
		rootMethod.addChild(line);
	}
	rootMethod.setEndTime();
	totalDuration = rootMethod.exitStamp || 0;
	return rootMethod;
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
