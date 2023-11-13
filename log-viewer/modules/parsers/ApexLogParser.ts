/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
// todo: js doc comments

// todo: regsiter multiple aggregaters classes so we do not have to loop multiple times.
// todo: Each type should have namesapces assocated (default of unmanagd) - **NEW FEAT**

/**
 * An Apex Log file can be parsed by passing the text.
 * You can either import the ApexLogParser class or import the parse method e.g.
 *
 * import ApexLogParser, { parse } from ./ApexLogParser.js
 * const apexLog = new ApexLogParser().parse(logText);
 * const apexLog = parse(logText);
 */

type LineNumber = number | string | null; // an actual line-number or 'EXTERNAL'
type IssueType = 'unexpected' | 'error' | 'skip';

export type TimelineKey =
  | 'method'
  | 'systemMethod'
  | 'codeUnit'
  | 'dml'
  | 'soql'
  | 'flow'
  | 'workflow';

const typePattern = /^[A-Z_]*$/,
  newlineRegex = /\r?\n/,
  settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;

export function parse(logData: string): ApexLog {
  return new ApexLogParser().parse(logData);
}

export default class ApexLogParser {
  logIssues: LogIssue[] = [];
  parsingErrors: string[] = [];
  maxSizeTimestamp: number | null = null;
  reasons: Set<string> = new Set<string>();
  cpuUsed = 0;
  lastTimestamp = 0;
  discontinuity = false;

  parse(debugLog: string): ApexLog {
    const logLines = this.parseLog(debugLog);

    const apexLog = this.toLogTree(logLines);
    apexLog.size = debugLog.length;
    apexLog.debugLevels = this.getDebugLevels(debugLog);
    apexLog.logIssues = this.logIssues;
    apexLog.parsingErrors = this.parsingErrors;
    apexLog.cpuTime = this.cpuUsed;

    return apexLog;
  }

  private parseLine(line: string, lastEntry: LogLine | null): LogLine | null {
    const parts = line.split('|'),
      type = parts[1],
      metaCtor = getLogEventClass(type || '');

    if (metaCtor) {
      const entry = new metaCtor(parts);
      entry.logLine = line;
      lastEntry?.onAfter?.(this, entry);
      return entry;
    }

    if ((!type || !typePattern.test(type)) && lastEntry && lastEntry.acceptsText) {
      // wrapped text from the previous entry?
      lastEntry.text += `\n${line}`;
    } else if (type) {
      const message = `Unknown log line: ${type}`;
      !this.parsingErrors.includes(message) && this.parsingErrors.push(message);
    } else {
      if (lastEntry && line.startsWith('*** Skipped')) {
        this.truncateLog(
          lastEntry.timestamp,
          'Skipped-Lines',
          `${line}. A section of the log has been skipped and the log has been truncated. Full details of this section of log can not be provided.`,
          'skip',
        );
      } else if (lastEntry && line.indexOf('MAXIMUM DEBUG LOG SIZE REACHED') >= 0) {
        this.truncateLog(
          lastEntry.timestamp,
          'Max-Size-reached',
          'The maximum log size has been reached. Part of the log has been truncated.',
          'skip',
        );
      } else if (settingsPattern.test(line)) {
        // skip an unexpected settings line
      } else {
        this.parsingErrors.push(`Bad log line: ${line}`);
      }
    }

    return null;
  }

  // Matches CRLF (\r\n) + LF (\n)
  // the ? matches the previous token 0 or 1 times.
  private parseLog(log: string): LogLine[] {
    const start = log.match(/^.*EXECUTION_STARTED.*$/m)?.index || -1;
    const rawLines = log.substring(start).split(newlineRegex);

    // reset global variables to be captured during parsing
    this.logIssues = [];
    this.reasons = new Set<string>();
    this.cpuUsed = 0;
    this.discontinuity = false;

    const logLines = [];
    let lastEntry = null;
    const len = rawLines.length;
    for (let i = 0; i < len; i++) {
      const line = rawLines[i];
      if (line) {
        // ignore blank lines
        const entry = this.parseLine(line, lastEntry);
        if (entry) {
          logLines.push(entry);
          lastEntry = entry;
        }
      }
    }

    lastEntry?.onAfter?.(this);

    return logLines;
  }

  private toLogTree(logLines: LogLine[]) {
    const lineIter = new LineIterator(logLines),
      rootMethod = new ApexLog(),
      stack: Method[] = [];
    let line: LogLine | null;

    this.lastTimestamp = 0;
    while ((line = lineIter.fetch())) {
      if (line instanceof Method) {
        this.parseTree(line, lineIter, stack);
      }
      rootMethod.addChild(line);
    }
    rootMethod.setTimes();

    this.insertPackageWrappers(rootMethod);

    this.setNamespaces(rootMethod);
    this.aggregateTotals(rootMethod);
    return rootMethod;
  }

  private parseTree(currentLine: Method, lineIter: LineIterator, stack: Method[]) {
    this.lastTimestamp = currentLine.timestamp;

    if (currentLine.exitTypes.length > 0) {
      let nextLine;

      stack.push(currentLine);
      while ((nextLine = lineIter.peek())) {
        if (nextLine.discontinuity) {
          // discontinuities are stack unwinding (caused by Exceptions)
          this.discontinuity = true; // start unwinding stack
        }

        // Exit Line has been found no more work needed
        if (nextLine.isExit && this.endMethod(currentLine, nextLine, lineIter, stack)) {
          if (currentLine.onEnd) {
            // the method wants to see the exit line
            currentLine.onEnd(nextLine, stack);
          }
          break;
        }

        if (
          this.maxSizeTimestamp &&
          this.discontinuity &&
          nextLine.timestamp > this.maxSizeTimestamp
        ) {
          // The current line was truncated (we did not find the exit line before the end of log) and there was a discontinuity
          currentLine.isTruncated = true;
          break;
        }

        lineIter.fetch(); // it's a child - consume the line
        this.lastTimestamp = nextLine.timestamp;
        if (nextLine instanceof Method) {
          this.parseTree(nextLine, lineIter, stack);
        }

        currentLine.addChild(nextLine);
      }

      // End of line error handling. We have finished processing this log line and either got to the end
      // of the log without finding an exit line or the current line was truncated)
      if (!nextLine || currentLine.isTruncated) {
        // truncated method - terminate at the end of the log
        currentLine.exitStamp = this.lastTimestamp;

        // we found an entry event on its own e.g a `METHOD_ENTRY` without a `METHOD_EXIT` and got to the end of the log
        this.truncateLog(
          this.lastTimestamp,
          'Unexpected-End',
          'An entry event was found without a corresponding exit event e.g a `METHOD_ENTRY` event without a `METHOD_EXIT`',
          'unexpected',
        );

        if (currentLine.isTruncated) {
          this.updateTruncated(
            this.lastTimestamp,
            'Max-Size-reached',
            'The maximum log size has been reached. Part of the log has been truncated.',
            'skip',
          );
        }
        currentLine.isTruncated = true;
      }

      stack.pop();
      currentLine.recalculateDurations();
    }
  }

  private isMatchingEnd(startMethod: Method, endLine: LogLine) {
    return (
      startMethod.exitTypes.includes(endLine.type) &&
      (!endLine.lineNumber ||
        !startMethod.lineNumber ||
        endLine.lineNumber === startMethod.lineNumber)
    );
  }

  private endMethod(
    startMethod: Method,
    endLine: LogLine,
    lineIter: LineIterator,
    stack: Method[],
  ) {
    startMethod.exitStamp = endLine.timestamp;

    // is this a 'good' end line?
    if (this.isMatchingEnd(startMethod, endLine)) {
      this.discontinuity = false; // end stack unwinding
      lineIter.fetch(); // consume the line
      return true; // success
    } else if (this.discontinuity) {
      return true; // exception - unwind
    } else {
      if (stack.some((m) => this.isMatchingEnd(m, endLine))) {
        return true; // we match a method further down the stack - unwind
      }
      // we found an exit event on its own e.g a `METHOD_EXIT` without a `METHOD_ENTRY`
      this.truncateLog(
        endLine.timestamp,
        'Unexpected-Exit',
        'An exit event was found without a corresponding entry event e.g a `METHOD_EXIT` event without a `METHOD_ENTRY`',
        'unexpected',
      );
      return false; // we have no matching method - ignore
    }
  }

  private aggregateTotals(node: TimedNode) {
    const children = node.children,
      len = children.length;

    for (let i = 0; i < len; ++i) {
      const child = children[i];
      if (child) {
        if (child instanceof TimedNode) {
          this.aggregateTotals(child);
        }
        node.totalDmlCount += child.totalDmlCount;
        node.totalSoqlCount += child.totalSoqlCount;
        node.totalThrownCount += child.totalThrownCount;
        node.totalRowCount += child.totalRowCount;
      }
    }
  }

  private insertPackageWrappers(node: Method) {
    const children = node.children;
    let lastPkg: TimedNode | null = null;

    const newChildren: LogLine[] = [];
    const len = children.length;
    for (let i = 0; i < len; i++) {
      const child = children[i];
      if (child) {
        const childType = child.type,
          isPkgType = childType === 'ENTERING_MANAGED_PKG';

        if (lastPkg && child instanceof TimedNode) {
          if (isPkgType && child.namespace === lastPkg.namespace) {
            // combine adjacent (like) packages
            lastPkg.exitStamp = child.exitStamp || child.timestamp;
            continue; // skip any more child processing (it's gone)
          } else if (!isPkgType) {
            // we are done merging adjacent `ENTERING_MANAGED_PKG` of the same namesapce
            lastPkg.recalculateDurations();
            lastPkg = null;
          }
        }

        if (child instanceof Method) {
          this.insertPackageWrappers(child);
        }

        // It is a ENTERING_MANAGED_PKG line that does not match the last one
        // or we have not come across a ENTERING_MANAGED_PKG line yet.
        if (isPkgType) {
          lastPkg?.recalculateDurations();
          lastPkg = child as TimedNode;
        }
        newChildren.push(child);
      }
    }

    lastPkg?.recalculateDurations();
    node.children = newChildren;
  }

  private collectNamespaces(node: ApexLog): Set<string> {
    const namespaces = new Set<string>();
    let i = 0;
    const children = node.children;
    while (i < children.length) {
      const child = children[i];
      if (child) {
        const childType = child.type;

        if (childType === 'ENTERING_MANAGED_PKG') {
          namespaces.add(child.text);
        }
      }
      ++i;
    }
    return namespaces;
  }

  private extractNamespace(namespaces: Set<string>, text: string) {
    const [namespace] = text.split('.');
    if (namespace && namespaces.has(namespace)) {
      return namespace;
    } else {
      return null;
    }
  }

  /**
   * TODO: This does not work correctly and does not recursively navigate the tree, needs a rework when we get the the namespace ticket
   * @param node
   * @returns
   */
  private setNamespaces(node: ApexLog) {
    const namespaces = this.collectNamespaces(node);
    const children = node.children;

    let i = 0;
    while (i < children.length) {
      const child = children[i];
      if (child) {
        const childType = child.type;

        if (childType === 'CODE_UNIT_STARTED' && child.type === 'method' && !child.namespace) {
          child.namespace = this.extractNamespace(namespaces, child.text);
        } else if (childType === 'EXCEPTION_THROWN') {
          child.namespace = this.extractNamespace(namespaces, child.text);
        } else if (childType === 'CONSTRUCTOR_ENTRY') {
          child.namespace = this.extractNamespace(namespaces, child.text);
        } else if (childType === 'METHOD_ENTRY') {
          child.namespace = this.extractNamespace(namespaces, child.text);
        }
      }
      ++i;
    }
    return namespaces;
  }

  public truncateLog(startTime: number, summary: string, description: string, type: IssueType) {
    if (!this.reasons.has(summary)) {
      this.reasons.add(summary);
      // default to error is probably the safest if we have no matching color for the type
      this.logIssues.push({
        startTime: startTime,
        summary: summary,
        description: description,
        type: type,
      });

      if (summary === 'Max-Size-reached') {
        this.maxSizeTimestamp = startTime;
      }

      this.logIssues.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    }
  }

  public updateTruncated(startTime: number, summary: string, description: string, type: IssueType) {
    const elem = this.logIssues.findIndex((item) => {
      return item.summary === summary;
    });
    if (elem > -1) {
      this.logIssues.splice(elem, 1);
    }
    this.reasons.delete(summary);

    this.truncateLog(startTime, summary, description, type);
  }

  private getDebugLevels(log: string): DebugLevel[] {
    const match = log.match(settingsPattern);
    if (!match) {
      return [];
    }

    const settings = match[0],
      settingList = settings.substring(settings.indexOf(' ') + 1).split(';');

    return settingList.map((entry) => {
      const parts = entry.split(',');
      return new DebugLevel(parts[0] || '', parts[1] || '');
    });
  }
}

export class DebugLevel {
  logCategory: string;
  logLevel: string;

  constructor(category: string, level: string) {
    this.logCategory = category;
    this.logLevel = level;
  }
}

export class LineIterator {
  lines: LogLine[];
  index: number;
  length: number;

  constructor(lines: LogLine[]) {
    this.lines = lines;
    this.index = 0;
    this.length = lines.length;
  }

  peek(): LogLine | null {
    return this.index < this.length ? this.lines[this.index] || null : null;
  }

  fetch(): LogLine | null {
    return this.index < this.length ? this.lines[this.index++] || null : null;
  }
}

interface LogIssue {
  startTime?: number;
  summary: string;
  description: string;
  type: IssueType;
}

export class TruncationEntry {
  timestamp: number;
  reason: string;
  description: string;
  color: string;

  constructor(timestamp: number, reason: string, description: string, color: string) {
    this.timestamp = timestamp;
    this.reason = reason;
    this.description = description;
    this.color = color;
  }
}

/**
 * All log lines extend this base class.
 */
export abstract class LogLine {
  // common metadata (available for all lines)
  /**
   * The net (wall) time spent in the node (when not inside children)
   */
  selfTime = 0;

  /**
   * The total (wall) time spent in the node
   */
  duration = 0;

  /**
   * The timestamp of this log line, in nanoseconds
   */
  timestamp = 0;

  /**
   * The type of this log line from the log file e.g METHOD_ENTRY
   */
  type = '';

  /**
   * The full raw text of this log line
   */
  logLine = ''; // the raw text of this log line

  /**
   * A parsed version of the log line text useful for display in UIs
   */
  text = '';

  // optional metadata
  /**
   * Should this log entry pull in following text lines (as the log entry can contain newlines)?
   */
  acceptsText = false;

  /**
   * Is this log entry generated by a declarative process?
   */
  declarative = false;
  /**
   * Is a method exit line?
   */
  isExit = false;

  /**
   * The line number within the containing class
   */
  lineNumber: LineNumber = null;

  /**
   * The package namespace associated with this log line
   */
  namespace: string | null = null;

  /**
   * The variable value
   */
  value: string | null = null;

  /**
   * Could have a corresponding file in the workspace?
   */
  hasValidSymbols = false;

  /**
   * Extra description context
   */
  suffix: string | null = null;

  /**
   * Does this line cause a discontinuity in the call stack? e.g an exception causing stack unwinding
   */
  discontinuity = false;

  /**
   * The total number of rows in all database operations for this node and child nodes
   */
  totalRowCount = 0;

  /**
   * The number of rows in all database operations for this node, excluding child nodes
   */
  selfRowCount = 0;

  /**
   * The total number of DML operations (DML_BEGIN) in this node and child nodes
   */
  totalDmlCount = 0;

  /**
   * The total number of SOQL operations (SOQL_EXECUTE_BEGIN) in this node and child nodes
   */
  totalSoqlCount = 0;

  /**
   * The total number of exceptoin thrown (EXCEPTION_THROWN) in this node and child nodes
   */
  totalThrownCount = 0;

  constructor(parts: string[] | null) {
    if (parts) {
      this.type = parts[1] || '';
      this.text = this.type;
      this.timestamp = parseTimestamp(parts[0] || '');
    }
  }

  /** Called if a corresponding end event is found during tree parsing*/
  onEnd?(end: LogLine, stack: LogLine[]): void;

  /** Called when the Log event after this one is created in the line parser*/
  onAfter?(parser: ApexLogParser, next?: LogLine): void;
}

class BasicLogLine extends LogLine {}
class BasicExitLine extends LogLine {
  isExit = true;
}

/**
 * Log lines extend this class if they have a duration (and hence can be shown on the timeline).
 * There are no real children (as there is no exit line), but children can get reparented here...
 */
export class TimedNode extends LogLine {
  /**
   * The timestamp when the node finished, in nanoseconds
   */
  exitStamp: number | null = null;

  /**
   * All child nodes of the current node
   */
  children: LogLine[] = [];

  /**
   * The log category this evebt belongs to
   */
  timelineKey: TimelineKey;

  /**
   * The CPU type, e.g loading, method, custom
   */
  cpuType: string; // the category key to collect our cpu usage

  constructor(parts: string[] | null, timelineKey: TimelineKey, cpuType: string) {
    super(parts);
    this.timelineKey = timelineKey;
    this.cpuType = cpuType;
  }

  addChild(line: LogLine) {
    this.children.push(line);
  }

  recalculateDurations() {
    if (this.exitStamp) {
      this.duration = this.exitStamp - this.timestamp;

      let childDuration = 0;
      this.children.forEach((child) => {
        childDuration += child.duration;
      });
      this.selfTime = this.duration - childDuration;
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
  /**
   * The line types which would legitimately end this method
   */
  exitTypes: string[];

  /**
   * Whether the log event was truncated when the log ended, e,g no matching end event
   */
  isTruncated = false;

  constructor(
    parts: string[] | null,
    exitTypes: string[],
    timelineKey: TimelineKey,
    cpuType: string,
  ) {
    super(parts, timelineKey, cpuType);
    this.exitTypes = exitTypes;
  }
}

/**
 * This class represents the single root node for the node tree.
 * It is a "pseudo" node and not present in the log.
 * Since it has children it extends "Method".
 */
export class ApexLog extends Method {
  text = 'Log Root';
  type = 'ROOT';
  timestamp = 0;
  exitStamp = 0;
  /**
   * The size of the log, in bytes
   */
  public size = 0;

  /**
   * The total CPU time consumed, in ms
   */
  public cpuTime: number = 0;

  /**
   * The Apex Debug Logging Levels for the current log
   */
  public debugLevels: DebugLevel[] = [];

  /**
   * Any issues within the log, such as cpu time exceeded or max log size reached.
   */
  public logIssues: LogIssue[] = [];

  /**
   * Any issues that occurred during the parsing of the log, such as an unrecognized log event type.
   */
  public parsingErrors: string[] = [];

  /**
   * The endtime with nodes of 0 duration excluded
   */
  executionEndTime = 0;

  constructor() {
    super(null, [], 'codeUnit', '');
  }

  setTimes() {
    this.timestamp =
      this.children.find((child) => {
        return child.timestamp;
      })?.timestamp || 0;
    // We do not just want to use the very last exitStamp because it could be CUMULATIVE_USAGE which is not really part of the code execution time but does have a later time.
    let endTime;
    const reverseLen = this.children.length - 1;
    for (let i = reverseLen; i >= 0; i--) {
      const child = this.children[i];
      // If there is no duration on a node then it is not going to be shown on the timeline anyway
      if (child instanceof TimedNode && child.exitStamp) {
        endTime ??= child.exitStamp;
        if (child.duration) {
          this.executionEndTime = child.exitStamp;
          break;
        }
      }
      endTime ??= child?.timestamp;
    }
    this.exitStamp = endTime || 0;
    this.duration = this.exitStamp - this.timestamp;
  }
}

export function parseObjectNamespace(text: string | null | undefined): string {
  if (!text) {
    return '';
  }

  const sep = text.indexOf('__');
  if (sep < 0) {
    return 'unmanaged';
  }
  return text.substring(0, sep);
}

export function parseVfNamespace(text: string): string {
  const sep = text.indexOf('__');
  if (sep < 0) {
    return 'unmanaged';
  }
  const firstSlash = text.indexOf('/');
  if (firstSlash < 0) {
    return 'unmanaged';
  }
  const secondSlash = text.indexOf('/', firstSlash + 1);
  if (secondSlash < 0) {
    return 'unmanaged';
  }
  return text.substring(secondSlash + 1, sep);
}

export function parseTimestamp(text: string): number {
  const timestamp = text.slice(text.indexOf('(') + 1, -1);
  if (timestamp) {
    return Number(timestamp);
  }
  throw new Error(`Unable to parse timestamp: '${text}'`);
}

export function parseLineNumber(text: string | null | undefined): string | number {
  if (!text) {
    return 0;
  }

  const lineNumberStr = text.slice(1, -1);
  if (lineNumberStr) {
    const lineNumber = Number(lineNumberStr);
    return !Number.isNaN(lineNumber) ? lineNumber : lineNumberStr;
  }
  throw new Error(`Unable to parse line number: '${text}'`);
}

export function parseRows(text: string | null | undefined): number {
  if (!text) {
    return 0;
  }

  const rowCount = text.slice(text.indexOf('Rows:') + 5);
  if (rowCount) {
    return Number(rowCount);
  }
  throw new Error(`Unable to parse row count: '${text}'`);
}

/* Log line entry Parsers */

class BulkHeapAllocateLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
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

class ConstructorEntryLine extends Method {
  hasValidSymbols = true;
  suffix = ' (constructor)';

  constructor(parts: string[]) {
    super(parts, ['CONSTRUCTOR_EXIT'], 'method', 'method');
    this.lineNumber = parseLineNumber(parts[2]);
    const args = parts[4];

    this.text = parts[5] + (args ? args.substring(args.lastIndexOf('(')) : '');
  }
}

class ConstructorExitLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class EmailQueueLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

export class MethodEntryLine extends Method {
  hasValidSymbols = true;

  constructor(parts: string[]) {
    super(parts, ['METHOD_EXIT'], 'method', 'method');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[4] || this.type;
    if (this.text === 'System.Type.forName(String, String)') {
      this.cpuType = 'loading'; // assume we are not charged for class loading (or at least not lengthy remote-loading / compiling)
      // no namespace or it will get charged...
    }
  }
}
class MethodExitLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class SystemConstructorEntryLine extends Method {
  suffix = '(system constructor)';

  constructor(parts: string[]) {
    super(parts, ['SYSTEM_CONSTRUCTOR_EXIT'], 'systemMethod', 'method');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

class SystemConstructorExitLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}
class SystemMethodEntryLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['SYSTEM_METHOD_EXIT'], 'systemMethod', 'method');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

class SystemMethodExitLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

const cpuMap: Map<string, string> = new Map([
  ['EventService', 'method'],
  ['Validation', 'custom'],
  ['Workflow', 'custom'],
  ['Flow', 'custom'],
]);

export class CodeUnitStartedLine extends Method {
  suffix = ' (entrypoint)';
  codeUnitType = '';

  constructor(parts: string[]) {
    super(parts, ['CODE_UNIT_FINISHED'], 'codeUnit', CodeUnitStartedLine.getCpuType(parts));

    const subParts = parts[3]?.split(':') || [],
      name = parts[4] || parts[3] || '';

    this.codeUnitType = subParts[0] || parts[4]?.split('/')[0] || '';
    switch (this.codeUnitType) {
      case 'EventService':
        this.cpuType = 'method';
        this.namespace = parseObjectNamespace(subParts[1]);

        this.text = parts[3] || '';
        break;
      case 'Validation':
        this.cpuType = 'custom';
        this.declarative = true;

        this.text = name || this.codeUnitType + ':' + subParts[1];
        break;
      case 'Workflow':
        this.cpuType = 'custom';
        this.declarative = true;
        this.text = name || this.codeUnitType;
        break;
      case 'Flow':
        this.cpuType = 'custom';
        this.declarative = true;
        this.text = name || this.codeUnitType;
        break;
      default:
        this.cpuType = 'method';
        if (name?.startsWith('VF:')) {
          this.namespace = parseVfNamespace(name);
        }
        this.text = name || parts[3] || '';
        break;
    }
  }

  static getCpuType(parts: string[]) {
    const subParts = parts[3]?.split(':') || [],
      codeUnitType = subParts[0] || '',
      cpuType = cpuMap.get(codeUnitType);

    return cpuType ?? 'method';
  }
}
export class CodeUnitFinishedLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class VFApexCallStartLine extends Method {
  suffix = ' (VF APEX)';
  invalidClasses = [
    'pagemessagescomponentcontroller',
    'pagemessagecomponentcontroller',
    'severitymessages',
  ];

  constructor(parts: string[]) {
    super(parts, ['VF_APEX_CALL_END'], 'method', 'method');
    this.lineNumber = parseLineNumber(parts[2]);

    const classText = parts[5] || parts[3] || '';
    let methodtext = parts[4] || '';
    if (
      !methodtext &&
      (!classText.includes(' ') ||
        this.invalidClasses.some((invalidCls: string) =>
          classText.toLowerCase().includes(invalidCls),
        ))
    ) {
      // we have a system entry and they do not have exits
      // e.g |VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex <init>
      // and they really mess with the logs so skip handling them.
      this.exitTypes = [];
    } else if (methodtext) {
      this.hasValidSymbols = true;
      // method call
      const methodIndex = methodtext.indexOf('(');
      const constructorIndex = methodtext.indexOf('<init>');
      if (methodIndex > -1) {
        // Method
        methodtext = '.' + methodtext.substring(methodIndex).slice(1, -1) + '()';
      } else if (constructorIndex > -1) {
        // Constructor
        methodtext = methodtext.substring(constructorIndex + 6) + '()';
      } else {
        // Property
        methodtext = '.' + methodtext;
      }
    } else {
      this.hasValidSymbols = true;
    }
    this.text = classText + methodtext;
  }
}

class VFApexCallEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class VFDeserializeViewstateBeginLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['VF_DESERIALIZE_VIEWSTATE_END'], 'systemMethod', 'method');
  }
}

class VFFormulaStartLine extends Method {
  suffix = ' (VF FORMULA)';

  constructor(parts: string[]) {
    super(parts, ['VF_EVALUATE_FORMULA_END'], 'systemMethod', 'custom');
    this.text = parts[3] || '';
  }
}

class VFFormulaEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class VFSeralizeViewStateStartLine extends Method {
  namespace = 'system';

  constructor(parts: string[]) {
    super(parts, ['VF_SERIALIZE_VIEWSTATE_END'], 'systemMethod', 'method');
  }
}

class VFPageMessageLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class DMLBeginLine extends Method {
  totalDmlCount = 1;
  constructor(parts: string[]) {
    super(parts, ['DML_END'], 'dml', 'free');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = 'DML ' + parts[3] + ' ' + parts[4];
    const rowCountString = parts[5];
    this.totalRowCount = this.selfRowCount = rowCountString ? parseRows(rowCountString) : 0;
  }
}

class DMLEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class IdeasQueryExecuteLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class SOQLExecuteBeginLine extends Method {
  aggregations = 0;
  totalSoqlCount = 1;

  constructor(parts: string[]) {
    super(parts, ['SOQL_EXECUTE_END'], 'soql', 'free');
    this.lineNumber = parseLineNumber(parts[2]);

    const [, , , aggregations, soqlString] = parts;

    const aggregationText = aggregations || '';
    if (aggregationText) {
      const aggregationIndex = aggregationText.indexOf('Aggregations:');
      this.aggregations = Number(aggregationText.slice(aggregationIndex + 13));
    }
    this.text = soqlString || '';
  }

  onEnd(end: SOQLExecuteEndLine, _stack: LogLine[]): void {
    this.totalRowCount = this.selfRowCount = end.totalRowCount;
  }
}

class SOQLExecuteEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.totalRowCount = this.selfRowCount = parseRows(parts[3] || '');
  }
}

class SOQLExecuteExplainLine extends LogLine {
  cardinality: number | null = null; // The estimated number of records that the leading operation type would return
  fields: string[] | null = null; //The indexed field(s) used by the Query Optimizer. If the leading operation type is Index, the fields value is Index. Otherwise, the fields value is null.
  leadingOperationType: string | null = null; // The primary operation type that Salesforce will use to optimize the query.
  relativeCost: number | null = null; // The cost of the query compared to the Force.com Query Optimizer’s selectivity threshold. Values above 1 mean that the query won’t be selective.
  sObjectCardinality: number | null = null; // The approximate record count for the queried object.
  sObjectType: string | null = null; //T he name of the queried SObject

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);

    const queryPlanDetails = parts[3] || '';
    this.text = queryPlanDetails;

    const queryplanParts = queryPlanDetails.split('],');
    if (queryplanParts.length > 1) {
      const planExplain = queryplanParts[0] || '';
      const [cardinalityText, sobjCardinalityText, costText] = (queryplanParts[1] || '').split(',');

      const onIndex = planExplain.indexOf(' on');
      this.leadingOperationType = planExplain.slice(0, onIndex);

      const colonIndex = planExplain.indexOf(' :');
      this.sObjectType = planExplain.slice(onIndex + 4, colonIndex);

      // remove whitespace if there is any. we could have [ field1__c, field2__c ]
      // I am not 100% sure of format when we have multiple fields so this is safer
      const fieldsAsString = planExplain.slice(planExplain.indexOf('[') + 1).replace(/\s+/g, '');
      this.fields = fieldsAsString === '' ? [] : fieldsAsString.split(',');

      this.cardinality = cardinalityText
        ? Number(cardinalityText.slice(cardinalityText.indexOf('cardinality: ') + 13))
        : null;
      this.sObjectCardinality = sobjCardinalityText
        ? Number(
            sobjCardinalityText.slice(sobjCardinalityText.indexOf('sobjectCardinality: ') + 20),
          )
        : null;
      this.relativeCost = costText
        ? Number(costText.slice(costText.indexOf('relativeCost ') + 13))
        : null;
    }
  }
}

class SOSLExecuteBeginLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['SOSL_EXECUTE_END'], 'soql', 'free');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `SOSL: ${parts[3]}`;
  }

  onEnd(end: SOSLExecuteEndLine, _stack: LogLine[]): void {
    this.totalRowCount = this.selfRowCount = end.totalRowCount;
  }
}

class SOSLExecuteEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.totalRowCount = this.selfRowCount = parseRows(parts[3] || '');
  }
}

class HeapAllocateLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

class HeapDeallocateLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class StatementExecuteLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
  }
}

class VariableScopeBeginLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}

class VariableAssignmentLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}
class UserInfoLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3] + ' ' + parts[4];
  }
}

class UserDebugLine extends LogLine {
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}

class CumulativeLimitUsageLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['CUMULATIVE_LIMIT_USAGE_END'], 'systemMethod', 'system');
  }
}

class CumulativeProfilingLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + ' ' + (parts[3] ?? '');
  }
}

class CumulativeProfilingBeginLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['CUMULATIVE_PROFILING_END'], 'systemMethod', 'custom');
  }
}

class LimitUsageLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3] + ' ' + parts[4] + ' out of ' + parts[5];
  }
}

class LimitUsageForNSLine extends LogLine {
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }

  onAfter(parser: ApexLogParser, _next?: LogLine): void {
    const matched = this.text.match(/Maximum CPU time: (\d+)/),
      cpuText = matched?.[1] || '0',
      cpuTime = parseInt(cpuText, 10) * 1000000; // convert from milli-seconds to nano-seconds

    if (!parser.cpuUsed || cpuTime > parser.cpuUsed) {
      parser.cpuUsed = cpuTime;
    }
  }
}

class NBANodeBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['NBA_NODE_END'], 'systemMethod', 'method');
    this.text = parts.slice(2).join(' | ');
  }
}

class NBANodeDetail extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBANodeEnd extends LogLine {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBANodeError extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBAOfferInvalid extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBAStrategyBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['NBA_STRATEGY_END'], 'systemMethod', 'method');
    this.text = parts.slice(2).join(' | ');
  }
}
class NBAStrategyEnd extends LogLine {
  isExit = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBAStrategyError extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts.slice(2).join(' | ');
  }
}

class PushTraceFlagsLine extends LogLine {
  namespace = 'system';

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[4] + ', line:' + this.lineNumber + ' - ' + parts[5];
  }
}

class PopTraceFlagsLine extends LogLine {
  namespace = 'system';

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[4] + ', line:' + this.lineNumber + ' - ' + parts[5];
  }
}

class QueryMoreBeginLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['QUERY_MORE_END'], 'soql', 'custom');
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}

class QueryMoreEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}
class QueryMoreIterationsLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}, iterations:${parts[3]}`;
  }
}

class SavepointRollbackLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

class SavePointSetLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

class TotalEmailRecipientsQueuedLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
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

// This looks like a method, but the exit line is often missing...
class SystemModeEnterLine extends LogLine {
  // namespace = "system";

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class SystemModeExitLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

export class ExecutionStartedLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['EXECUTION_FINISHED'], 'method', 'method');
  }
}

class EnteringManagedPackageLine extends Method {
  constructor(parts: string[]) {
    super(parts, [], 'method', 'pkg');
    const rawNs = parts[2] || '',
      lastDot = rawNs.lastIndexOf('.');

    this.text = this.namespace = lastDot < 0 ? rawNs : rawNs.substring(lastDot + 1);
  }

  onAfter(parser: ApexLogParser, end?: LogLine): void {
    if (end) {
      this.exitStamp = end.timestamp;
    }
  }
}

class EventSericePubBeginLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['EVENT_SERVICE_PUB_END'], 'flow', 'custom');
    this.text = parts[2] || '';
  }
}

class EventSericePubEndLine extends LogLine {
  isExit = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class EventSericePubDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + ' ' + parts[3] + ' ' + parts[4];
  }
}

class EventSericeSubBeginLine extends Method {
  constructor(parts: string[]) {
    super(parts, ['EVENT_SERVICE_SUB_END'], 'flow', 'custom');
    this.text = `${parts[2]} ${parts[3]}`;
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
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} ${parts[3]} ${parts[4]} ${parts[6]} ${parts[6]}`;
  }
}

export class FlowStartInterviewsBeginLine extends Method {
  declarative = true;
  text = 'FLOW_START_INTERVIEWS : ';

  constructor(parts: string[]) {
    super(parts, ['FLOW_START_INTERVIEWS_END'], 'flow', 'custom');
  }

  onEnd(end: LogLine, stack: LogLine[]) {
    const flowType = this.getFlowType(stack);
    this.suffix = ` (${flowType})`;
    this.text += this.getFlowName();
  }

  getFlowType(stack: LogLine[]) {
    let flowType;
    // ignore the last one on stack is it will be this FlowStartInterviewsBeginLine
    const len = stack.length - 2;
    for (let i = len; i >= 0; i--) {
      const elem = stack[i];
      // type = "CODE_UNIT_STARTED" a flow or Processbuilder was started directly
      // type = "FLOW_START_INTERVIEWS_BEGIN" a flow was started from a process builder
      if (elem instanceof CodeUnitStartedLine) {
        flowType = elem.codeUnitType === 'Flow' ? 'Flow' : 'Process Builder';
        break;
      } else if (elem && elem.type === 'FLOW_START_INTERVIEWS_BEGIN') {
        flowType = 'Flow';
        break;
      }
    }
    return flowType || '';
  }

  getFlowName() {
    if (this.children.length) {
      return this.children[0]?.text || '';
    }
    return '';
  }
}

class FlowStartInterviewsErrorLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} - ${parts[4]}`;
  }
}

class FlowStartInterviewBeginLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] || '';
  }
}

class FlowStartInterviewLimitUsageLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class FlowStartScheduledRecordsLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class FlowCreateInterviewErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowElementBeginLine extends Method {
  declarative = true;

  constructor(parts: string[]) {
    super(parts, ['FLOW_ELEMENT_END'], 'flow', 'custom');
    this.text = parts[3] + ' ' + parts[4];
  }
}

class FlowElementDeferredLine extends LogLine {
  declarative = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + ' ' + parts[3];
  }
}

class FlowElementAssignmentLine extends LogLine {
  declarative = true;
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + ' ' + parts[4];
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
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] || '';
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
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] || '' + parts[2] + ' ' + parts[3] + ' ' + parts[4];
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
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5] + ' : ' + parts[6];
  }
}

class FlowAssignmentDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5];
  }
}

class FlowLoopDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + ' : ' + parts[4];
  }
}

class FlowRuleDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] + ' : ' + parts[4];
  }
}

class FlowBulkElementBeginLine extends Method {
  declarative = true;

  constructor(parts: string[]) {
    super(parts, ['FLOW_BULK_ELEMENT_END'], 'flow', 'custom');
    this.text = `${parts[2]} - ${parts[3]}`;
  }
}

class FlowBulkElementDetailLine extends LogLine {
  declarative = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + ' : ' + parts[3] + ' : ' + parts[4];
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

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
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
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] || '';
  }
}

class ValidationErrorLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class ValidationFormulaLine extends LogLine {
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
    const extra = parts.length > 3 ? ' ' + parts[3] : '';

    this.text = parts[2] + extra;
  }
}

class ValidationPassLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[3] || '';
  }
}

class WFFlowActionErrorLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + ' ' + parts[4];
  }
}

class WFFlowActionErrorDetailLine extends LogLine {
  acceptsText = true;
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[1] + ' ' + parts[2];
  }
}

class WFFieldUpdateLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = ' ' + parts[2] + ' ' + parts[3] + ' ' + parts[4] + ' ' + parts[5] + ' ' + parts[6];
  }
}

class WFRuleEvalBeginLine extends Method {
  declarative = true;

  constructor(parts: string[]) {
    super(parts, ['WF_RULE_EVAL_END'], 'workflow', 'custom');
    this.text = parts[2] || '';
  }
}

class WFRuleEvalValueLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class WFRuleFilterLine extends LogLine {
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class WFCriteriaBeginLine extends Method {
  declarative = true;

  constructor(parts: string[]) {
    super(parts, ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED'], 'workflow', 'custom');
    this.text = 'WF_CRITERIA : ' + parts[5] + ' : ' + parts[3];
  }
}

class WFFormulaLine extends LogLine {
  acceptsText = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] + ' : ' + parts[3];
  }
}

class WFActionLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class WFActionsEndLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
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
    this.text = parts[2] || '';
  }
}

class WFEscalationActionLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]}`;
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
    const optional = parts[4] ? ` : ${parts[4]} :${parts[5]}` : '';
    this.text = `${parts[2]} : ${parts[3]}` + optional;
  }
}

class WFNextApproverLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
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

class WFProcessNode extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
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
    this.text = parts[2] || '';
  }
}

class WFRuleInvocationLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

class WFSoftRejectLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
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
    this.text = parts[2] || '';
  }
}

class ExceptionThrownLine extends LogLine {
  discontinuity = true;
  acceptsText = true;
  totalThrownCount = 1;

  constructor(parts: string[]) {
    super(parts);
    this.lineNumber = parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }

  onAfter(parser: ApexLogParser, _next?: LogLine): void {
    if (this.text.indexOf('System.LimitException') >= 0) {
      const isMultiLine = this.text.indexOf('\n');
      const len = isMultiLine < 0 ? 99 : isMultiLine;
      const truncateText = this.text.length > len;
      const summary = this.text.slice(0, len + 1) + (truncateText ? '…' : '');
      const message = truncateText ? this.text : '';
      parser.truncateLog(this.timestamp, summary, message, 'error');
    }
  }
}

class FatalErrorLine extends LogLine {
  acceptsText = true;
  hideable = false;
  discontinuity = true;

  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }

  onAfter(parser: ApexLogParser, _next?: LogLine): void {
    const newLineIndex = this.text.indexOf('\n');
    const summary = newLineIndex > -1 ? this.text.slice(0, newLineIndex + 1) : this.text;
    const detailText = summary.length !== this.text.length ? this.text : '';
    parser.truncateLog(this.timestamp, 'FATAL ERROR! cause=' + summary, detailText, 'error');
  }
}

class XDSDetailLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
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
    this.text = parts[2] || '';
  }
}

class XDSResponseErrorLine extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

// e.g. "09:45:31.888 (38889007737)|DUPLICATE_DETECTION_BEGIN"
class DuplicateDetectionBegin extends Method {
  declarative = true;

  constructor(parts: string[]) {
    super(parts, ['DUPLICATE_DETECTION_END'], 'workflow', 'custom');
  }
}

// e.g. "09:45:31.888 (38889067408)|DUPLICATE_DETECTION_RULE_INVOCATION|DuplicateRuleId:0Bm20000000CaSP|DuplicateRuleName:Duplicate Account|DmlType:UPDATE"
class DuplicateDetectionRule extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = `${parts[3]} - ${parts[4]}`;
  }
}

/**
 * NOTE: These can be found in the org on the create new debug level page but are not found in the docs here
 * https://help.salesforce.com/s/articleView?id=sf.code_setting_debug_log_levels.htm
 */
class BulkDMLEntry extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts[2] || '';
  }
}

/**
 * DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS|EntityType:Account|ActionTaken:Allow_[Alert,Report]|DuplicateRecordIds:
 */
class DuplicateDetectionDetails extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts.slice(2).join(' | ');
  }
}

/**
 * DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY|EntityType:Account|NumRecordsToBeSaved:200|NumRecordsToBeSavedWithDuplicates:0|NumDuplicateRecordsFound:0
 */
class DuplicateDetectionSummary extends LogLine {
  constructor(parts: string[]) {
    super(parts);
    this.text = parts.slice(2).join(' | ');
  }
}

class SessionCachePutBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['SESSION_CACHE_PUT_END'], 'method', 'method');
  }
}
class SessionCacheGetBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['SESSION_CACHE_GET_END'], 'method', 'method');
  }
}

class SessionCacheRemoveBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['SESSION_CACHE_REMOVE_END'], 'method', 'method');
  }
}

class OrgCachePutBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['ORG_CACHE_PUT_END'], 'method', 'method');
  }
}

class OrgCacheGetBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['ORG_CACHE_GET_END'], 'method', 'method');
  }
}

class OrgCacheRemoveBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['ORG_CACHE_REMOVE_END'], 'method', 'method');
  }
}

class VFSerializeContinuationStateBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['VF_SERIALIZE_CONTINUATION_STATE_END'], 'method', 'method');
  }
}

class VFDeserializeContinuationStateBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['VF_SERIALIZE_CONTINUATION_STATE_END'], 'method', 'method');
  }
}

class MatchEngineBegin extends Method {
  constructor(parts: string[]) {
    super(parts, ['MATCH_ENGINE_END'], 'method', 'method');
  }
}

function getLogEventClass(eventName: string): LogLineConstructor | null | undefined {
  if (lineTypeMap.has(eventName)) {
    return lineTypeMap.get(eventName);
  } else if (basicLogEvents.includes(eventName)) {
    return BasicLogLine;
  } else if (basicExitLogEvents.includes(eventName)) {
    return BasicExitLine;
  }

  return null;
}

type LogLineConstructor<T extends LogLine = LogLine> = new (parts: string[]) => T;
export const lineTypeMap = new Map<string, LogLineConstructor>([
  ['BULK_DML_RETRY', BulkDMLEntry],
  ['BULK_HEAP_ALLOCATE', BulkHeapAllocateLine],
  ['CALLOUT_REQUEST', CalloutRequestLine],
  ['CALLOUT_RESPONSE', CalloutResponseLine],
  ['NAMED_CREDENTIAL_REQUEST', NamedCredentialRequestLine],
  ['NAMED_CREDENTIAL_RESPONSE', NamedCredentialResponseLine],
  ['NAMED_CREDENTIAL_RESPONSE_DETAIL', NamedCredentialResponseDetailLine],
  ['CONSTRUCTOR_ENTRY', ConstructorEntryLine],
  ['CONSTRUCTOR_EXIT', ConstructorExitLine],
  ['EMAIL_QUEUE', EmailQueueLine],
  ['METHOD_ENTRY', MethodEntryLine],
  ['METHOD_EXIT', MethodExitLine],
  ['SYSTEM_CONSTRUCTOR_ENTRY', SystemConstructorEntryLine],
  ['SYSTEM_CONSTRUCTOR_EXIT', SystemConstructorExitLine],
  ['SYSTEM_METHOD_ENTRY', SystemMethodEntryLine],
  ['SYSTEM_METHOD_EXIT', SystemMethodExitLine],
  ['CODE_UNIT_STARTED', CodeUnitStartedLine],
  ['CODE_UNIT_FINISHED', CodeUnitFinishedLine],
  ['VF_APEX_CALL_START', VFApexCallStartLine],
  ['VF_APEX_CALL_END', VFApexCallEndLine],
  ['VF_DESERIALIZE_VIEWSTATE_BEGIN', VFDeserializeViewstateBeginLine],
  ['VF_EVALUATE_FORMULA_BEGIN', VFFormulaStartLine],
  ['VF_EVALUATE_FORMULA_END', VFFormulaEndLine],
  ['VF_SERIALIZE_CONTINUATION_STATE_BEGIN', VFSerializeContinuationStateBegin],
  ['VF_DESERIALIZE_CONTINUATION_STATE_BEGIN', VFDeserializeContinuationStateBegin],
  ['VF_SERIALIZE_VIEWSTATE_BEGIN', VFSeralizeViewStateStartLine],
  ['VF_PAGE_MESSAGE', VFPageMessageLine],
  ['DML_BEGIN', DMLBeginLine],
  ['DML_END', DMLEndLine],
  ['IDEAS_QUERY_EXECUTE', IdeasQueryExecuteLine],
  ['SOQL_EXECUTE_BEGIN', SOQLExecuteBeginLine],
  ['SOQL_EXECUTE_END', SOQLExecuteEndLine],
  ['SOQL_EXECUTE_EXPLAIN', SOQLExecuteExplainLine],
  ['SOSL_EXECUTE_BEGIN', SOSLExecuteBeginLine],
  ['SOSL_EXECUTE_END', SOSLExecuteEndLine],
  ['HEAP_ALLOCATE', HeapAllocateLine],
  ['HEAP_DEALLOCATE', HeapDeallocateLine],
  ['STATEMENT_EXECUTE', StatementExecuteLine],
  ['VARIABLE_SCOPE_BEGIN', VariableScopeBeginLine],
  ['VARIABLE_ASSIGNMENT', VariableAssignmentLine],
  ['USER_INFO', UserInfoLine],
  ['USER_DEBUG', UserDebugLine],
  ['CUMULATIVE_LIMIT_USAGE', CumulativeLimitUsageLine],
  ['CUMULATIVE_PROFILING', CumulativeProfilingLine],
  ['CUMULATIVE_PROFILING_BEGIN', CumulativeProfilingBeginLine],
  ['LIMIT_USAGE', LimitUsageLine],
  ['LIMIT_USAGE_FOR_NS', LimitUsageForNSLine],
  ['NBA_NODE_BEGIN', NBANodeBegin],
  ['NBA_NODE_DETAIL', NBANodeDetail],
  ['NBA_NODE_END', NBANodeEnd],
  ['NBA_NODE_ERROR', NBANodeError],
  ['NBA_OFFER_INVALID', NBAOfferInvalid],
  ['NBA_STRATEGY_BEGIN', NBAStrategyBegin],
  ['NBA_STRATEGY_END', NBAStrategyEnd],
  ['NBA_STRATEGY_ERROR', NBAStrategyError],
  ['POP_TRACE_FLAGS', PopTraceFlagsLine],
  ['PUSH_TRACE_FLAGS', PushTraceFlagsLine],
  ['QUERY_MORE_BEGIN', QueryMoreBeginLine],
  ['QUERY_MORE_END', QueryMoreEndLine],
  ['QUERY_MORE_ITERATIONS', QueryMoreIterationsLine],
  ['TOTAL_EMAIL_RECIPIENTS_QUEUED', TotalEmailRecipientsQueuedLine],
  ['SAVEPOINT_ROLLBACK', SavepointRollbackLine],
  ['SAVEPOINT_SET', SavePointSetLine],
  ['STACK_FRAME_VARIABLE_LIST', StackFrameVariableListLine],
  ['STATIC_VARIABLE_LIST', StaticVariableListLine],
  ['SYSTEM_MODE_ENTER', SystemModeEnterLine],
  ['SYSTEM_MODE_EXIT', SystemModeExitLine],
  ['EXECUTION_STARTED', ExecutionStartedLine],
  ['ENTERING_MANAGED_PKG', EnteringManagedPackageLine],
  ['EVENT_SERVICE_PUB_BEGIN', EventSericePubBeginLine],
  ['EVENT_SERVICE_PUB_END', EventSericePubEndLine],
  ['EVENT_SERVICE_PUB_DETAIL', EventSericePubDetailLine],
  ['EVENT_SERVICE_SUB_BEGIN', EventSericeSubBeginLine],
  ['EVENT_SERVICE_SUB_DETAIL', EventSericeSubDetailLine],
  ['EVENT_SERVICE_SUB_END', EventSericeSubEndLine],
  ['FLOW_START_INTERVIEWS_BEGIN', FlowStartInterviewsBeginLine],
  ['FLOW_START_INTERVIEWS_ERROR', FlowStartInterviewsErrorLine],
  ['FLOW_START_INTERVIEW_BEGIN', FlowStartInterviewBeginLine],
  ['FLOW_START_INTERVIEW_LIMIT_USAGE', FlowStartInterviewLimitUsageLine],
  ['FLOW_START_SCHEDULED_RECORDS', FlowStartScheduledRecordsLine],
  ['FLOW_CREATE_INTERVIEW_ERROR', FlowCreateInterviewErrorLine],
  ['FLOW_ELEMENT_BEGIN', FlowElementBeginLine],
  ['FLOW_ELEMENT_DEFERRED', FlowElementDeferredLine],
  ['FLOW_ELEMENT_ERROR', FlowElementErrorLine],
  ['FLOW_ELEMENT_FAULT', FlowElementFaultLine],
  ['FLOW_ELEMENT_LIMIT_USAGE', FlowElementLimitUsageLine],
  ['FLOW_INTERVIEW_FINISHED_LIMIT_USAGE', FlowInterviewFinishedLimitUsageLine],
  ['FLOW_SUBFLOW_DETAIL', FlowSubflowDetailLine],
  ['FLOW_VALUE_ASSIGNMENT', FlowElementAssignmentLine],
  ['FLOW_WAIT_EVENT_RESUMING_DETAIL', FlowWaitEventResumingDetailLine],
  ['FLOW_WAIT_EVENT_WAITING_DETAIL', FlowWaitEventWaitingDetailLine],
  ['FLOW_WAIT_RESUMING_DETAIL', FlowWaitResumingDetailLine],
  ['FLOW_WAIT_WAITING_DETAIL', FlowWaitWaitingDetailLine],
  ['FLOW_INTERVIEW_FINISHED', FlowInterviewFinishedLine],
  ['FLOW_INTERVIEW_PAUSED', FlowInterviewPausedLine],
  ['FLOW_INTERVIEW_RESUMED', FlowInterviewResumedLine],
  ['FLOW_ACTIONCALL_DETAIL', FlowActionCallDetailLine],
  ['FLOW_ASSIGNMENT_DETAIL', FlowAssignmentDetailLine],
  ['FLOW_LOOP_DETAIL', FlowLoopDetailLine],
  ['FLOW_RULE_DETAIL', FlowRuleDetailLine],
  ['FLOW_BULK_ELEMENT_BEGIN', FlowBulkElementBeginLine],
  ['FLOW_BULK_ELEMENT_DETAIL', FlowBulkElementDetailLine],
  ['FLOW_BULK_ELEMENT_LIMIT_USAGE', FlowBulkElementLimitUsageLine],
  ['FLOW_BULK_ELEMENT_NOT_SUPPORTED', FlowBulkElementNotSupportedLine],
  ['MATCH_ENGINE_BEGIN', MatchEngineBegin],
  ['ORG_CACHE_PUT_BEGIN', OrgCachePutBegin],
  ['ORG_CACHE_GET_BEGIN', OrgCacheGetBegin],
  ['ORG_CACHE_REMOVE_BEGIN', OrgCacheRemoveBegin],
  ['PUSH_NOTIFICATION_INVALID_APP', PNInvalidAppLine],
  ['PUSH_NOTIFICATION_INVALID_CERTIFICATE', PNInvalidCertificateLine],
  ['PUSH_NOTIFICATION_INVALID_NOTIFICATION', PNInvalidNotificationLine],
  ['PUSH_NOTIFICATION_NO_DEVICES', PNNoDevicesLine],
  ['PUSH_NOTIFICATION_SENT', PNSentLine],
  ['SESSION_CACHE_PUT_BEGIN', SessionCachePutBegin],
  ['SESSION_CACHE_GET_BEGIN', SessionCacheGetBegin],
  ['SESSION_CACHE_REMOVE_BEGIN', SessionCacheRemoveBegin],
  ['SLA_END', SLAEndLine],
  ['SLA_EVAL_MILESTONE', SLAEvalMilestoneLine],
  ['SLA_PROCESS_CASE', SLAProcessCaseLine],
  ['TESTING_LIMITS', TestingLimitsLine],
  ['VALIDATION_ERROR', ValidationErrorLine],
  ['VALIDATION_FORMULA', ValidationFormulaLine],
  ['VALIDATION_PASS', ValidationPassLine],
  ['VALIDATION_RULE', ValidationRuleLine],
  ['WF_FLOW_ACTION_ERROR', WFFlowActionErrorLine],
  ['WF_FLOW_ACTION_ERROR_DETAIL', WFFlowActionErrorDetailLine],
  ['WF_FIELD_UPDATE', WFFieldUpdateLine],
  ['WF_RULE_EVAL_BEGIN', WFRuleEvalBeginLine],
  ['WF_RULE_EVAL_VALUE', WFRuleEvalValueLine],
  ['WF_RULE_FILTER', WFRuleFilterLine],
  ['WF_CRITERIA_BEGIN', WFCriteriaBeginLine],
  ['WF_FORMULA', WFFormulaLine],
  ['WF_ACTION', WFActionLine],
  ['WF_ACTIONS_END', WFActionsEndLine],
  ['WF_ACTION_TASK', WFActionTaskLine],
  ['WF_APPROVAL', WFApprovalLine],
  ['WF_APPROVAL_REMOVE', WFApprovalRemoveLine],
  ['WF_APPROVAL_SUBMIT', WFApprovalSubmitLine],
  ['WF_APPROVAL_SUBMITTER', WFApprovalSubmitterLine],
  ['WF_ASSIGN', WFAssignLine],
  ['WF_EMAIL_ALERT', WFEmailAlertLine],
  ['WF_EMAIL_SENT', WFEmailSentLine],
  ['WF_ENQUEUE_ACTIONS', WFEnqueueActionsLine],
  ['WF_ESCALATION_ACTION', WFEscalationActionLine],
  ['WF_EVAL_ENTRY_CRITERIA', WFEvalEntryCriteriaLine],
  ['WF_FLOW_ACTION_DETAIL', WFFlowActionDetailLine],
  ['WF_NEXT_APPROVER', WFNextApproverLine],
  ['WF_OUTBOUND_MSG', WFOutboundMsgLine],
  ['WF_PROCESS_FOUND', WFProcessFoundLine],
  ['WF_PROCESS_NODE', WFProcessNode],
  ['WF_REASSIGN_RECORD', WFReassignRecordLine],
  ['WF_RESPONSE_NOTIFY', WFResponseNotifyLine],
  ['WF_RULE_ENTRY_ORDER', WFRuleEntryOrderLine],
  ['WF_RULE_INVOCATION', WFRuleInvocationLine],
  ['WF_SOFT_REJECT', WFSoftRejectLine],
  ['WF_SPOOL_ACTION_BEGIN', WFSpoolActionBeginLine],
  ['WF_TIME_TRIGGER', WFTimeTriggerLine],
  ['EXCEPTION_THROWN', ExceptionThrownLine],
  ['FATAL_ERROR', FatalErrorLine],
  ['XDS_DETAIL', XDSDetailLine],
  ['XDS_RESPONSE', XDSResponseLine],
  ['XDS_RESPONSE_DETAIL', XDSResponseDetailLine],
  ['XDS_RESPONSE_ERROR', XDSResponseErrorLine],
  ['DUPLICATE_DETECTION_BEGIN', DuplicateDetectionBegin],
  ['DUPLICATE_DETECTION_RULE_INVOCATION', DuplicateDetectionRule],
  ['DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS', DuplicateDetectionDetails],
  ['DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY', DuplicateDetectionSummary],
]);

const basicLogEvents = [
  'BULK_COUNTABLE_STATEMENT_EXECUTE',
  'TEMPLATE_PROCESSING_ERROR',
  'EXTERNAL_SERVICE_REQUEST',
  'FLOW_START_INTERVIEW_END',
  'FLOW_CREATE_INTERVIEW_BEGIN',
  'FLOW_CREATE_INTERVIEW_END',
  'VARIABLE_SCOPE_END',
  'PUSH_NOTIFICATION_NOT_ENABLED',
  'SLA_NULL_START_DATE',
  'TEMPLATE_PROCESSING_ERROR',
  'VALIDATION_FAIL',
  `WF_FLOW_ACTION_BEGIN`,
  'WF_FLOW_ACTION_END',
  'WF_ESCALATION_RULE',
  'WF_HARD_REJECT',
  'WF_NO_PROCESS_FOUND',
  'WF_TIME_TRIGGERS_BEGIN',
  'WF_KNOWLEDGE_ACTION',
  'WF_SEND_ACTION',
  'WAVE_APP_LIFECYCLE',
  'WF_QUICK_CREATE',
  'WF_APEX_ACTION',
  'INVOCABLE_ACTION_DETAIL',
  'INVOCABLE_ACTION_ERROR',
  'FLOW_COLLECTION_PROCESSOR_DETAIL',
  'FLOW_SCHEDULED_PATH_QUEUED',
  'ROUTE_WORK_ACTION',
  'ADD_SKILL_REQUIREMENT_ACTION',
  'ADD_SCREEN_POP_ACTION',
  'CALLOUT_REQUEST_PREPARE',
  'CALLOUT_REQUEST_FINALIZE',
  'FUNCTION_INVOCATION_REQUEST',
  'APP_CONTAINER_INITIATED',
  'FUNCTION_INVOCATION_RESPONSE',
  'XDS_REQUEST_DETAIL',
  'EXTERNAL_SERVICE_RESPONSE',
  'DATAWEAVE_USER_DEBUG',
  'USER_DEBUG_FINER',
  'USER_DEBUG_FINEST',
  'USER_DEBUG_FINE',
  'USER_DEBUG_DEBUG',
  'USER_DEBUG_INFO',
  'USER_DEBUG_WARN',
  'USER_DEBUG_ERROR',
  'VF_APEX_CALL',
  'HEAP_DUMP',
  'SCRIPT_EXECUTION',
  'SESSION_CACHE_MEMORY_USAGE',
  'ORG_CACHE_MEMORY_USAGE',
  'AE_PERSIST_VALIDATION',
  'REFERENCED_OBJECT_LIST',
  'DUPLICATE_RULE_FILTER',
  'DUPLICATE_RULE_FILTER_RESULT',
  'DUPLICATE_RULE_FILTER_VALUE',
  'TEMPLATED_ASSET',
  'TRANSFORMATION_SUMMARY',
  'RULES_EXECUTION_SUMMARY',
  'ASSET_DIFF_SUMMARY',
  'ASSET_DIFF_DETAIL',
  'RULES_EXECUTION_DETAIL',
  'JSON_DIFF_SUMMARY',
  'JSON_DIFF_DETAIL',
  'MATCH_ENGINE_INVOCATION',
];

const basicExitLogEvents = [
  'VF_DESERIALIZE_VIEWSTATE_END',
  'VF_SERIALIZE_VIEWSTATE_END',
  'CUMULATIVE_LIMIT_USAGE_END',
  'CUMULATIVE_PROFILING_END',
  'EXECUTION_FINISHED',
  'FLOW_START_INTERVIEWS_END',
  'FLOW_ELEMENT_END',
  'FLOW_BULK_ELEMENT_END',
  'WF_RULE_EVAL_END',
  'WF_RULE_NOT_EVALUATED',
  'WF_CRITERIA_END',
  'DUPLICATE_DETECTION_END',
  'VF_SERIALIZE_CONTINUATION_STATE_END',
  'VF_DESERIALIZE_CONTINUATION_STATE_END',
  'MATCH_ENGINE_END',
  'ORG_CACHE_PUT_END',
  'ORG_CACHE_GET_END',
  'ORG_CACHE_REMOVE_END',
  'SESSION_CACHE_PUT_END',
  'SESSION_CACHE_GET_END',
  'SESSION_CACHE_REMOVE_END',
];

export { SOQLExecuteExplainLine, SOQLExecuteBeginLine, DMLBeginLine };
