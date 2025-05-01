/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

const typePattern = /^[A-Z_]*$/,
  settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;

type LineNumber = number | string | null; // an actual line-number or 'EXTERNAL'
type IssueType = 'unexpected' | 'error' | 'skip';

export type LogSubCategory =
  | 'Method'
  | 'System Method'
  | 'Code Unit'
  | 'DML'
  | 'SOQL'
  | 'Flow'
  | 'Workflow';

/**
 * Takes string input of a log and returns the ApexLog class, which represents a log tree
 * @param {string} logData
 * @returns {ApexLog}
 */
export function parse(logData: string): ApexLog {
  return new ApexLogParser().parse(logData);
}

/**
 * An Apex Log file can be parsed by passing the text.
 * You can either import the ApexLogParser class or import the parse method e.g.
 *
 * import ApexLogParser, { parse } from ./ApexLogParser.js
 * const apexLog = new ApexLogParser().parse(logText);
 * const apexLog = parse(logText);
 */
export class ApexLogParser {
  logIssues: LogIssue[] = [];
  parsingErrors: string[] = [];
  maxSizeTimestamp: number | null = null;
  reasons: Set<string> = new Set<string>();
  cpuUsed = 0;
  lastTimestamp = 0;
  discontinuity = false;
  namespaces = new Set<string>();

  /**
   * Takes string input of a log and returns the ApexLog class, which represents a log tree
   * @param {string} debugLog
   * @returns {ApexLog}
   */
  parse(debugLog: string): ApexLog {
    const lineGenerator = this.generateLogLines(debugLog);
    const apexLog = this.toLogTree(lineGenerator);
    apexLog.size = debugLog.length;
    apexLog.debugLevels = this.getDebugLevels(debugLog);
    apexLog.logIssues = this.logIssues;
    apexLog.parsingErrors = this.parsingErrors;
    apexLog.cpuTime = this.cpuUsed;
    apexLog.namespaces = Array.from(this.namespaces);

    return apexLog;
  }

  private parseLine(line: string, lastEntry: LogLine | null): LogLine | null {
    const parts = line.split('|');

    const type = parts[1] ?? '';

    const metaCtor = getLogEventClass(type as LogEventType);
    if (metaCtor) {
      const entry = new metaCtor(this, parts);
      entry.logLine = line;
      lastEntry?.onAfter?.(this, entry);
      if (entry.namespace) {
        this.namespaces.add(entry.namespace);
      }
      return entry;
    }

    const hasType = type && typePattern.test(type);
    if (!hasType && lastEntry?.acceptsText) {
      // wrapped text from the previous entry?
      lastEntry.text += '\n' + line;
    } else if (hasType) {
      const message = `Unsupported log event name: ${type}`;
      if (!this.parsingErrors.includes(message)) {
        this.parsingErrors.push(message);
      }
    } else if (lastEntry && line.startsWith('*** Skipped')) {
      this.addLogIssue(
        lastEntry.timestamp,
        'Skipped-Lines',
        `${line}. A section of the log has been skipped and the log has been truncated. Full details of this section of log can not be provided.`,
        'skip',
      );
    } else if (lastEntry && line.indexOf('MAXIMUM DEBUG LOG SIZE REACHED') !== -1) {
      this.addLogIssue(
        lastEntry.timestamp,
        'Max-Size-reached',
        'The maximum log size has been reached. Part of the log has been truncated.',
        'skip',
      );
      this.maxSizeTimestamp = lastEntry.timestamp;
    } else if (!hasType && settingsPattern.test(line)) {
      // skip an unexpected settings line
    } else {
      this.parsingErrors.push(`Invalid log line: ${line}`);
    }

    return null;
  }

  private *generateLogLines(log: string): Generator<LogLine> {
    const start = log.search(/^\d{2}:\d{2}:\d{2}.\d{1} \(\d+\)\|EXECUTION_STARTED$/m);
    if (start > -1) {
      log = log.slice(start);
    }

    const hascrlf = log.indexOf('\r\n') > -1;
    let lastEntry = null;
    let lfIndex = null;
    let eolIndex = (lfIndex = log.indexOf('\n'));
    let startIndex = 0;
    let crlfIndex = -1;

    while (eolIndex !== -1) {
      if (hascrlf && eolIndex > crlfIndex) {
        crlfIndex = log.indexOf('\r', eolIndex - 1);
        eolIndex = crlfIndex + 1 === eolIndex ? crlfIndex : lfIndex;
      }
      const line = log.slice(startIndex, eolIndex);
      if (line) {
        // ignore blank lines
        const entry = this.parseLine(line, lastEntry);
        if (entry) {
          lastEntry = entry;
          yield entry;
        }
      }
      startIndex = lfIndex + 1;
      lfIndex = eolIndex = log.indexOf('\n', startIndex);
    }

    // Parse the last line
    const line = log.slice(startIndex, log.length);
    if (line) {
      // ignore blank lines
      const entry = this.parseLine(line, lastEntry);
      if (entry) {
        entry?.onAfter?.(this);
        yield entry;
      }
    }
  }

  private toLogTree(lineGenerator: Generator<LogLine>) {
    const rootMethod = new ApexLog(this),
      stack: Method[] = [];
    let line: LogLine | null;

    const lineIter = new LineIterator(lineGenerator);

    while ((line = lineIter.fetch())) {
      if (line instanceof Method) {
        this.parseTree(line, lineIter, stack);
      }
      line.parent = rootMethod;
      rootMethod.addChild(line);
    }

    rootMethod.setTimes();
    this.insertPackageWrappers(rootMethod);
    this.aggregateTotals([rootMethod]);
    return rootMethod;
  }

  private parseTree(currentLine: Method, lineIter: LineIterator, stack: Method[]) {
    this.lastTimestamp = currentLine.timestamp;
    currentLine.namespace ||= 'default';

    const isEntry = currentLine.exitTypes.length;
    if (isEntry) {
      const exitOnNextLine = currentLine.nextLineIsExit;
      let nextLine;

      stack.push(currentLine);

      while ((nextLine = lineIter.peek())) {
        // discontinuities are stack unwinding (caused by Exceptions)
        this.discontinuity ||= nextLine.discontinuity; // start unwinding stack

        // Exit Line has been found no more work needed
        if (
          !exitOnNextLine &&
          !nextLine.nextLineIsExit &&
          nextLine.isExit &&
          !nextLine.exitTypes.length &&
          this.endMethod(currentLine, nextLine, lineIter, stack)
        ) {
          // the method wants to see the exit line
          currentLine.onEnd?.(nextLine, stack);
          break;
        } else if (
          exitOnNextLine &&
          (nextLine.nextLineIsExit || nextLine.isExit || nextLine.exitTypes.length > 0)
        ) {
          currentLine.exitStamp = nextLine.timestamp;
          currentLine.onEnd?.(nextLine, stack);
          break;
        } else if (
          this.discontinuity &&
          this.maxSizeTimestamp &&
          nextLine.timestamp > this.maxSizeTimestamp
        ) {
          // The current line was truncated (we did not find the exit line before the end of log) and there was a discontinuity
          currentLine.isTruncated = true;
          break;
        }

        nextLine.namespace ||= currentLine.namespace || 'default';
        lineIter.fetch(); // it's a child - consume the line
        this.lastTimestamp = nextLine.timestamp;

        if (nextLine instanceof Method) {
          this.parseTree(nextLine, lineIter, stack);
        }

        nextLine.parent = currentLine;
        currentLine.children.push(nextLine);
      }

      // End of line error handling. We have finished processing this log line and either got to the end
      // of the log without finding an exit line or the current line was truncated)
      if (!nextLine || currentLine.isTruncated) {
        // truncated method - terminate at the end of the log
        currentLine.exitStamp = this.lastTimestamp;

        // we found an entry event on its own e.g a `METHOD_ENTRY` without a `METHOD_EXIT` and got to the end of the log
        this.addLogIssue(
          this.lastTimestamp,
          'Unexpected-End',
          'An entry event was found without a corresponding exit event e.g a `METHOD_ENTRY` event without a `METHOD_EXIT`',
          'unexpected',
        );

        if (currentLine.isTruncated) {
          this.updateLogIssue(
            this.lastTimestamp,
            'Max-Size-reached',
            'The maximum log size has been reached. Part of the log has been truncated.',
            'skip',
          );
          this.maxSizeTimestamp = this.lastTimestamp;
        }
        currentLine.isTruncated = true;
      }

      stack.pop();
      currentLine.recalculateDurations();
    }
  }

  private isMatchingEnd(startMethod: Method, endLine: LogLine) {
    return (
      endLine.type &&
      startMethod.exitTypes.includes(endLine.type) &&
      (endLine.lineNumber === startMethod.lineNumber ||
        !endLine.lineNumber ||
        !startMethod.lineNumber)
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
      this.addLogIssue(
        endLine.timestamp,
        'Unexpected-Exit',
        'An exit event was found without a corresponding entry event e.g a `METHOD_EXIT` event without a `METHOD_ENTRY`',
        'unexpected',
      );
      return false; // we have no matching method - ignore
    }
  }

  private flattenByDepth(nodes: LogLine[]) {
    const result = new Map<number, LogLine[]>();
    result.set(0, nodes);

    let currentDepth = 1;

    let currentNodes = nodes;
    let len = currentNodes.length;
    while (len) {
      result.set(currentDepth, []);
      while (len--) {
        const node = currentNodes[len];
        if (node?.children) {
          const children = result.get(currentDepth)!;
          node.children.forEach((c) => {
            if (c.children.length) {
              children.push(c);
            }
          });
        }
      }
      currentNodes = result.get(currentDepth++) ?? [];
      len = currentNodes.length;
    }

    return result;
  }

  private aggregateTotals(nodes: LogLine[]) {
    const len = nodes.length;
    if (!len) {
      return;
    }

    // This method purposely processes the children at the lowest depth first in bulk to avoid as much recursion as possible. This increases performance to be just over ~3 times faster or ~70% faster.

    // collect all children for the supplied nodes by depth.
    const nodesByDepth = this.flattenByDepth(nodes);
    let depth = nodesByDepth.size;
    while (depth--) {
      const nds = nodesByDepth.get(depth) ?? [];
      let i = nds.length;
      while (i--) {
        const parent = nds[i];
        parent?.children.forEach((child) => {
          parent.dmlCount.total += child.dmlCount.total;
          parent.soqlCount.total += child.soqlCount.total;
          parent.soslCount.total += child.soslCount.total;
          parent.dmlRowCount.total += child.dmlRowCount.total;
          parent.soqlRowCount.total += child.soqlRowCount.total;
          parent.soslRowCount.total += child.soslRowCount.total;
          parent.duration.self -= child.duration.total;
          parent.totalThrownCount += child.totalThrownCount;
        });
      }
      nodesByDepth.delete(depth);
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
        const isPkgType = child.type === 'ENTERING_MANAGED_PKG';
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

  public addLogIssue(startTime: number, summary: string, description: string, type: IssueType) {
    if (!this.reasons.has(summary)) {
      this.reasons.add(summary);
      this.logIssues.push({
        startTime: startTime,
        summary: summary,
        description: description,
        type: type,
      });

      this.logIssues.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    }
  }

  private updateLogIssue(startTime: number, summary: string, description: string, type: IssueType) {
    const elem = this.logIssues.findIndex((item) => {
      return item.summary === summary;
    });
    if (elem > -1) {
      this.logIssues.splice(elem, 1);
    }
    this.reasons.delete(summary);

    this.addLogIssue(startTime, summary, description, type);
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

interface SelfTotal {
  self: number;
  total: number;
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
  next: LogLine | null;
  lineGenerator: Generator<LogLine>;

  constructor(lineGenerator: Generator<LogLine>) {
    this.lineGenerator = lineGenerator;
    this.next = this.lineGenerator.next().value;
  }

  peek(): LogLine | null {
    return this.next;
  }

  fetch(): LogLine | null {
    const result = this.next;
    this.next = this.lineGenerator.next().value;
    return result;
  }
}

export interface LogIssue {
  startTime?: number;
  summary: string;
  description: string;
  type: IssueType;
}

/**
 * All log lines extend this base class.
 */
export abstract class LogLine {
  logParser: ApexLogParser;

  // common metadata (available for all lines)

  parent: LogLine | null = null;

  /**
   * All child nodes of the current node
   */
  children: LogLine[] = [];

  /**
   * The type of this log line from the log file e.g METHOD_ENTRY
   */
  type: LogEventType | null = null;

  /**
   * The full raw text of this log line
   */
  logLine = ''; // the raw text of this log line

  /**
   * A parsed version of the log line text useful for display in UIs
   */
  text;

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
   * Should the exitstamp be the timestamp of the next line?
   * These kind of lines can not be used as exit lines for anything othe than other pseudo exits.
   */
  nextLineIsExit = false;

  /**
   * The line number within the containing class
   */
  lineNumber: LineNumber = null;

  /**
   * The package namespace associated with this log line
   * @default default
   */
  namespace: string | 'default' = '';

  /**
   * The variable value
   */
  value: string | null = null;

  /**
   * Could match to a corresponding symbol in a file in the workspace?
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
   * The timestamp of this log line, in nanoseconds
   */
  timestamp;

  /**
   * The time spent.
   */
  duration: SelfTotal = {
    /**
     * The net (wall) time spent in the node (when not inside children)
     */
    self: 0,
    /**
     * The total (wall) time spent in the node
     */
    total: 0,
  };

  /**
   * Total + self row counts for DML
   */
  dmlRowCount: SelfTotal = {
    /**
     * The net number of DML rows for this node, excluding child nodes
     */
    self: 0,
    /**
     * The total number of DML rows for this node and child nodes
     */
    total: 0,
  };

  /**
   * Total + self row counts for SOQL
   */
  soqlRowCount: SelfTotal = {
    /**
     * The net number of SOQL rows for this node, excluding child nodes
     */
    self: 0,
    /**
     * The total number of SOQL rows for this node and child nodes
     */
    total: 0,
  };

  /**
   * Total + self row counts for SOSL
   */
  soslRowCount: SelfTotal = {
    /**
     * The net number of SOSL rows for this node, excluding child nodes
     */
    self: 0,
    /**
     * The total number of SOSL rows for this node and child nodes
     */
    total: 0,
  };

  dmlCount: SelfTotal = {
    /**
     * The net number of DML operations (DML_BEGIN) in this node.
     */
    self: 0,
    /**
     * The total number of DML operations (DML_BEGIN) in this node and child nodes
     */
    total: 0,
  };

  soqlCount: SelfTotal = {
    /**
     * The net number of SOQL operations (SOQL_EXECUTE_BEGIN) in this node.
     */
    self: 0,
    /**
     * The total number of SOQL operations (SOQL_EXECUTE_BEGIN) in this node and child nodes
     */
    total: 0,
  };

  soslCount: SelfTotal = {
    /**
     * The net number of SOSL operations (SOSL_EXECUTE_BEGIN) in this node.
     */
    self: 0,
    /**
     * The total number of SOSL operations (SOSL_EXECUTE_BEGIN) in this node and child nodes
     */
    total: 0,
  };

  /**
   * The total number of exceptions thrown (EXCEPTION_THROWN) in this node and child nodes
   */
  totalThrownCount = 0;

  /**
   * The line types which would legitimately end this method
   */
  exitTypes: LogEventType[] = [];

  constructor(parser: ApexLogParser, parts: string[] | null) {
    this.logParser = parser;
    if (parts) {
      const [timeData, type] = parts;
      this.text = this.type = type as LogEventType;
      this.timestamp = timeData ? this.parseTimestamp(timeData) : 0;
    } else {
      this.timestamp = 0;
      this.text = '';
    }
  }

  /** Called if a corresponding end event is found during tree parsing*/
  onEnd?(end: LogLine, stack: LogLine[]): void;

  /** Called when the Log event after this one is created in the line parser*/
  onAfter?(parser: ApexLogParser, next?: LogLine): void;

  private parseTimestamp(text: string): number {
    const start = text.indexOf('(');
    if (start !== -1) {
      return Number(text.slice(start + 1, -1));
    }
    throw new Error(`Unable to parse timestamp: '${text}'`);
  }

  protected parseLineNumber(text: string | null | undefined): string | number {
    switch (true) {
      case text === '[EXTERNAL]':
        return 'EXTERNAL';
      case !!text: {
        const lineNumberStr = text.slice(1, -1);
        if (lineNumberStr) {
          return Number(lineNumberStr);
        }
        throw new Error(`Unable to parse line number: '${text}'`);
      }
      default:
        return 0;
    }
  }
}

class BasicLogLine extends LogLine {}
class BasicExitLine extends LogLine {
  isExit = true;
}

type CPUType = 'loading' | 'custom' | 'method' | 'free' | 'system' | 'pkg' | '';

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
   * The log sub category this event belongs to
   */
  subCategory: LogSubCategory;

  /**
   * The CPU type, e.g loading, method, custom
   */
  cpuType: CPUType; // the category key to collect our cpu usage

  constructor(
    parser: ApexLogParser,
    parts: string[] | null,
    timelineKey: LogSubCategory,
    cpuType: CPUType,
  ) {
    super(parser, parts);
    this.subCategory = timelineKey;
    this.cpuType = cpuType;
  }

  addChild(line: LogLine) {
    this.children.push(line);
  }

  recalculateDurations() {
    if (this.exitStamp) {
      this.duration.total = this.duration.self = this.exitStamp - this.timestamp;
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
   * Whether the log event was truncated when the log ended, e,g no matching end event
   */
  isTruncated = false;

  constructor(
    parser: ApexLogParser,
    parts: string[] | null,
    exitTypes: string[],
    timelineKey: LogSubCategory,
    cpuType: CPUType,
  ) {
    super(parser, parts, timelineKey, cpuType);
    this.exitTypes = exitTypes as LogEventType[];
  }
}

/**
 * This class represents the single root node for the node tree.
 * It is a "pseudo" node and not present in the log.
 * Since it has children it extends "Method".
 */
export class ApexLog extends Method {
  type = null;
  text = 'LOG_ROOT';
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
   * All the namespaces that appear in this log.
   */
  public namespaces: string[] = [];

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

  constructor(parser: ApexLogParser) {
    super(parser, null, [], 'Code Unit', '');
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
    this.recalculateDurations();
  }
}

export function parseObjectNamespace(text: string | null | undefined): string {
  if (!text) {
    return '';
  }

  const sep = text.indexOf('__');
  if (sep === -1) {
    return 'default';
  }
  return text.slice(0, sep);
}

export function parseVfNamespace(text: string): string {
  const sep = text.indexOf('__');
  if (sep === -1) {
    return 'default';
  }
  const firstSlash = text.indexOf('/');
  if (firstSlash === -1) {
    return 'default';
  }
  const secondSlash = text.indexOf('/', firstSlash + 1);
  if (secondSlash < 0) {
    return 'default';
  }
  return text.substring(secondSlash + 1, sep);
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
  logCategory: 'Apex Code';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
    this.logCategory = 'Apex Code';
  }
}

class CalloutRequestLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[3]} : ${parts[2]}`;
  }
}

class CalloutResponseLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[3]} : ${parts[2]}`;
  }
}
class NamedCredentialRequestLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class NamedCredentialResponseLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

class NamedCredentialResponseDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[3]} : ${parts[4]} ${parts[5]} : ${parts[6]} ${parts[7]}`;
  }
}

class ConstructorEntryLine extends Method {
  hasValidSymbols = true;
  suffix = ' (constructor)';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['CONSTRUCTOR_EXIT'], 'Method', 'method');
    this.lineNumber = this.parseLineNumber(parts[2]);
    const [, , , , args, className] = parts;

    this.text = className + (args ? args.substring(args.lastIndexOf('(')) : '');
    const possibleNS = this._parseConstructorNamespace(className || '');
    if (possibleNS) {
      this.namespace = possibleNS;
    }
  }

  _parseConstructorNamespace(className: string): string {
    let possibleNs = className.slice(0, className.indexOf('.'));
    if (this.logParser.namespaces.has(possibleNs)) {
      return possibleNs;
    }

    const constructorParts = (className ?? '').split('.');
    possibleNs = constructorParts[0] || '';
    // inmner class with a namespace
    if (constructorParts.length === 3) {
      return possibleNs;
    }

    return '';
  }
}

class ConstructorExitLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

class EmailQueueLine extends LogLine {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class MethodEntryLine extends Method {
  hasValidSymbols = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['METHOD_EXIT'], 'Method', 'method');
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[4] || this.type || this.text;
    if (this.text.indexOf('System.Type.forName(') !== -1) {
      // assume we are not charged for class loading (or at least not lengthy remote-loading / compiling)
      this.cpuType = 'loading';
    } else {
      const possibleNs = this._parseMethodNamespace(parts[4]);
      if (possibleNs) {
        this.namespace = possibleNs;
      }
    }
  }

  onEnd(end: MethodExitLine, _stack: LogLine[]): void {
    if (end.namespace && !end.text.endsWith(')')) {
      this.namespace = end.namespace;
    }
  }

  _parseMethodNamespace(methodName: string | undefined): string {
    if (!methodName) {
      return '';
    }

    const methodBracketIndex = methodName.indexOf('(');
    if (methodBracketIndex === -1) {
      return '';
    }

    const nsSeparator = methodName.indexOf('.');
    if (nsSeparator === -1) {
      return '';
    }

    const possibleNs = methodName.slice(0, nsSeparator);
    if (this.logParser.namespaces.has(possibleNs)) {
      return possibleNs;
    }

    const methodNameParts = methodName.slice(0, methodBracketIndex)?.split('.');
    if (methodNameParts.length === 4) {
      return methodNameParts[0] ?? '';
    } else if (methodNameParts.length === 2) {
      return 'default';
    }

    return '';
  }
}
class MethodExitLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[4] ?? parts[3] ?? this.text;

    /*A method will end with ')'. Without that this it represents the first reference to a class, outer or inner. One of the few reliable ways to determine valid namespaces. The first reference to a class (outer or inner) will always have an METHOD_EXIT containing the Outer class name with namespace if present. Other events will follow, CONSTRUCTOR_ENTRY etc. But this case will only ever have 2 parts ns.Outer even if the first reference was actually an inner class e.g new ns.Outer.Inner();*/
    // If does not end in ) then we have a reference to the class, either via outer or inner.
    if (!this.text.endsWith(')')) {
      // if there is a . the we have a namespace e.g ns.Outer
      const index = this.text.indexOf('.');
      if (index !== -1) {
        this.namespace = this.text.slice(0, index);
      }
    }
  }
}

class SystemConstructorEntryLine extends Method {
  suffix = '(system constructor)';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SYSTEM_CONSTRUCTOR_EXIT'], 'System Method', 'method');
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

class SystemConstructorExitLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}
class SystemMethodEntryLine extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SYSTEM_METHOD_EXIT'], 'System Method', 'method');
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

class SystemMethodExitLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class CodeUnitStartedLine extends Method {
  suffix = ' (entrypoint)';
  codeUnitType = '';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['CODE_UNIT_FINISHED'], 'Code Unit', 'custom');

    const typeString = parts[5] || parts[4] || parts[3] || '';
    let sepIndex = typeString.indexOf(':');
    if (sepIndex === -1) {
      sepIndex = typeString.indexOf('/');
    }
    this.codeUnitType = sepIndex !== -1 ? typeString.slice(0, sepIndex) : '';

    const name = parts[4] || parts[3] || this.codeUnitType || '';
    switch (this.codeUnitType) {
      case 'EventService':
        this.cpuType = 'method';
        this.namespace = parseObjectNamespace(typeString.slice(sepIndex + 1));
        this.text = name;
        break;
      case 'Validation':
        this.cpuType = 'custom';
        this.declarative = true;

        this.text = name;
        break;
      case 'Workflow':
        this.cpuType = 'custom';
        this.declarative = true;
        this.text = name;
        break;
      case 'Flow':
        this.cpuType = 'custom';
        this.declarative = true;
        this.text = name;
        break;
      case 'VF':
        this.cpuType = 'method';
        this.namespace = parseVfNamespace(name);
        this.text = name;
        break;
      case 'apex': {
        this.cpuType = 'method';
        const namespaceIndex = name.indexOf('.');
        this.namespace =
          namespaceIndex !== -1
            ? name.slice(name.indexOf('apex://') + 7, namespaceIndex)
            : 'default';
        this.text = name;
        break;
      }
      case '__sfdc_trigger': {
        this.cpuType = 'method';
        this.text = name || parts[4] || '';
        const triggerParts = parts[5]?.split('/') || '';
        this.namespace = triggerParts.length === 3 ? triggerParts[1] || 'default' : 'default';
        break;
      }
      default: {
        this.cpuType = 'method';
        this.text = name;
        const openBracket = name.lastIndexOf('(');
        const methodName =
          openBracket !== -1 ? name.slice(0, openBracket + 1).split('.') : name.split('.');
        if (methodName.length === 3 || (methodName.length === 2 && !methodName[1]?.endsWith('('))) {
          this.namespace = methodName[0] || 'default';
        }
        break;
      }
    }

    this.namespace ||= 'default';
  }
}
export class CodeUnitFinishedLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
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

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['VF_APEX_CALL_END'], 'Method', 'method');
    this.lineNumber = this.parseLineNumber(parts[2]);

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

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class VFDeserializeViewstateBeginLine extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['VF_DESERIALIZE_VIEWSTATE_END'], 'System Method', 'method');
  }
}

class VFFormulaStartLine extends Method {
  suffix = ' (VF FORMULA)';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['VF_EVALUATE_FORMULA_END'], 'System Method', 'custom');
    this.text = parts[3] || '';
  }
}

class VFFormulaEndLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class VFSeralizeViewStateStartLine extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['VF_SERIALIZE_VIEWSTATE_END'], 'System Method', 'method');
  }
}

class VFPageMessageLine extends LogLine {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class DMLBeginLine extends Method {
  dmlCount = {
    self: 1,
    total: 1,
  };

  namespace = 'default';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['DML_END'], 'DML', 'free');
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = 'DML ' + parts[3] + ' ' + parts[4];
    const rowCountString = parts[5];
    this.dmlRowCount.total = this.dmlRowCount.self = rowCountString ? parseRows(rowCountString) : 0;
  }
}

class DMLEndLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

class IdeasQueryExecuteLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

class SOQLExecuteBeginLine extends Method {
  aggregations = 0;
  soqlCount = {
    self: 1,
    total: 1,
  };

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SOQL_EXECUTE_END'], 'SOQL', 'free');
    this.lineNumber = this.parseLineNumber(parts[2]);

    const [, , , aggregations, soqlString] = parts;

    const aggregationText = aggregations || '';
    if (aggregationText) {
      const aggregationIndex = aggregationText.indexOf('Aggregations:');
      this.aggregations = Number(aggregationText.slice(aggregationIndex + 13));
    }
    this.text = soqlString || '';
  }

  onEnd(end: SOQLExecuteEndLine, _stack: LogLine[]): void {
    this.soqlRowCount.total = this.soqlRowCount.self = end.soqlRowCount.total;
  }
}

class SOQLExecuteEndLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.soqlRowCount.total = this.soqlRowCount.self = parseRows(parts[3] || '');
  }
}

class SOQLExecuteExplainLine extends LogLine {
  cardinality: number | null = null; // The estimated number of records that the leading operation type would return
  fields: string[] | null = null; //The indexed field(s) used by the Query Optimizer. If the leading operation type is Index, the fields value is Index. Otherwise, the fields value is null.
  leadingOperationType: string | null = null; // The primary operation type that Salesforce will use to optimize the query.
  relativeCost: number | null = null; // The cost of the query compared to the Force.com Query Optimizer’s selectivity threshold. Values above 1 mean that the query won’t be selective.
  sObjectCardinality: number | null = null; // The approximate record count for the queried object.
  sObjectType: string | null = null; //T he name of the queried SObject

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);

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
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SOSL_EXECUTE_END'], 'SOQL', 'free');
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `SOSL: ${parts[3]}`;

    this.soslCount = {
      self: 1,
      total: 1,
    };
  }

  onEnd(end: SOSLExecuteEndLine, _stack: LogLine[]): void {
    this.soslRowCount.total = this.soslRowCount.self = end.soslRowCount.total;
  }
}

class SOSLExecuteEndLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.soslRowCount.total = this.soslRowCount.self = parseRows(parts[3] || '');
  }
}

class HeapAllocateLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

class HeapDeallocateLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

class StatementExecuteLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

class VariableScopeBeginLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}

class VariableAssignmentLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}
class UserInfoLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] + ' ' + parts[4];
  }
}

class UserDebugLine extends LogLine {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}

class CumulativeLimitUsageLine extends Method {
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['CUMULATIVE_LIMIT_USAGE_END'], 'System Method', 'system');
  }
}

class CumulativeProfilingLine extends LogLine {
  acceptsText = true;
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] + ' ' + (parts[3] ?? '');
  }
}

class CumulativeProfilingBeginLine extends Method {
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['CUMULATIVE_PROFILING_END'], 'System Method', 'custom');
  }
}

class LimitUsageLine extends LogLine {
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] + ' ' + parts[4] + ' out of ' + parts[5];
  }
}

class LimitUsageForNSLine extends LogLine {
  acceptsText = true;
  namespace = 'default';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
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
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['NBA_NODE_END'], 'System Method', 'method');
    this.text = parts.slice(2).join(' | ');
  }
}

class NBANodeDetail extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBANodeEnd extends LogLine {
  isExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBANodeError extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBAOfferInvalid extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBAStrategyBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['NBA_STRATEGY_END'], 'System Method', 'method');
    this.text = parts.slice(2).join(' | ');
  }
}
class NBAStrategyEnd extends LogLine {
  isExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
class NBAStrategyError extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}

class PushTraceFlagsLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[4] + ', line:' + this.lineNumber + ' - ' + parts[5];
  }
}

class PopTraceFlagsLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[4] + ', line:' + this.lineNumber + ' - ' + parts[5];
  }
}

class QueryMoreBeginLine extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['QUERY_MORE_END'], 'SOQL', 'custom');
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}

class QueryMoreEndLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}
class QueryMoreIterationsLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}, iterations:${parts[3]}`;
  }
}

class SavepointRollbackLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

class SavePointSetLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

class TotalEmailRecipientsQueuedLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class StackFrameVariableListLine extends LogLine {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
  }
}

class StaticVariableListLine extends LogLine {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
  }
}

// This looks like a method, but the exit line is often missing...
class SystemModeEnterLine extends LogLine {
  // namespace = "system";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class SystemModeExitLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class ExecutionStartedLine extends Method {
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['EXECUTION_FINISHED'], 'Method', 'method');
  }
}

class EnteringManagedPackageLine extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, [], 'Method', 'pkg');
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
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['EVENT_SERVICE_PUB_END'], 'Flow', 'custom');
    this.text = parts[2] || '';
  }
}

class EventSericePubEndLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class EventSericePubDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] + ' ' + parts[3] + ' ' + parts[4];
  }
}

class EventSericeSubBeginLine extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['EVENT_SERVICE_SUB_END'], 'Flow', 'custom');
    this.text = `${parts[2]} ${parts[3]}`;
  }
}

class EventSericeSubEndLine extends LogLine {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} ${parts[3]}`;
  }
}

class EventSericeSubDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} ${parts[3]} ${parts[4]} ${parts[6]} ${parts[6]}`;
  }
}

export class FlowStartInterviewsBeginLine extends Method {
  declarative = true;
  text = 'FLOW_START_INTERVIEWS : ';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['FLOW_START_INTERVIEWS_END'], 'Flow', 'custom');
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
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} - ${parts[4]}`;
  }
}

class FlowStartInterviewBeginLine extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['FLOW_START_INTERVIEW_END'], 'Flow', 'custom');
    this.text = parts[3] || '';
  }
}

class FlowStartInterviewLimitUsageLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class FlowStartScheduledRecordsLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class FlowCreateInterviewErrorLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowElementBeginLine extends Method {
  declarative = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['FLOW_ELEMENT_END'], 'Flow', 'custom');
    this.text = parts[3] + ' ' + parts[4];
  }
}

class FlowElementDeferredLine extends LogLine {
  declarative = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] + ' ' + parts[3];
  }
}

class FlowElementAssignmentLine extends LogLine {
  declarative = true;
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] + ' ' + parts[4];
  }
}

class FlowWaitEventResumingDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowWaitEventWaitingDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class FlowWaitResumingDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowWaitWaitingDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowInterviewFinishedLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] || '';
  }
}

class FlowInterviewResumedLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class FlowInterviewPausedLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowElementErrorLine extends LogLine {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[1] || '' + parts[2] + ' ' + parts[3] + ' ' + parts[4];
  }
}

class FlowElementFaultLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowElementLimitUsageLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

class FlowInterviewFinishedLimitUsageLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

class FlowSubflowDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class FlowActionCallDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5] + ' : ' + parts[6];
  }
}

class FlowAssignmentDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5];
  }
}

class FlowLoopDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] + ' : ' + parts[4];
  }
}

class FlowRuleDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] + ' : ' + parts[4];
  }
}

class FlowBulkElementBeginLine extends Method {
  declarative = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['FLOW_BULK_ELEMENT_END'], 'Flow', 'custom');
    this.text = `${parts[2]} - ${parts[3]}`;
  }
}

class FlowBulkElementDetailLine extends LogLine {
  declarative = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] + ' : ' + parts[3] + ' : ' + parts[4];
  }
}

class FlowBulkElementNotSupportedLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class FlowBulkElementLimitUsageLine extends LogLine {
  declarative = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class PNInvalidAppLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}

class PNInvalidCertificateLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}
class PNInvalidNotificationLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]} : ${parts[8]}`;
  }
}
class PNNoDevicesLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}

class PNSentLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

class SLAEndLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

class SLAEvalMilestoneLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

class SLAProcessCaseLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

class TestingLimitsLine extends LogLine {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
  }
}

class ValidationRuleLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] || '';
  }
}

class ValidationErrorLine extends LogLine {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class ValidationFormulaLine extends LogLine {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    const extra = parts.length > 3 ? ' ' + parts[3] : '';

    this.text = parts[2] + extra;
  }
}

class ValidationPassLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] || '';
  }
}

class WFFlowActionErrorLine extends LogLine {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[1] + ' ' + parts[4];
  }
}

class WFFlowActionErrorDetailLine extends LogLine {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[1] + ' ' + parts[2];
  }
}

class WFFieldUpdateLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_FIELD_UPDATE'], 'Workflow', 'custom');
    this.text = ' ' + parts[2] + ' ' + parts[3] + ' ' + parts[4] + ' ' + parts[5] + ' ' + parts[6];
  }
}

class WFRuleEvalBeginLine extends Method {
  declarative = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_RULE_EVAL_END'], 'Workflow', 'custom');
    this.text = parts[2] || '';
  }
}

class WFRuleEvalValueLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class WFRuleFilterLine extends LogLine {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class WFCriteriaBeginLine extends Method {
  declarative = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED'], 'Workflow', 'custom');
    this.text = 'WF_CRITERIA : ' + parts[5] + ' : ' + parts[3];
  }
}

class WFFormulaLine extends Method {
  acceptsText = true;
  isExit = true;
  nextLineIsExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_FORMULA'], 'Workflow', 'custom');
    this.text = parts[2] + ' : ' + parts[3];
  }
}

class WFActionLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class WFActionsEndLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class WFActionTaskLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

class WFApprovalLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_APPROVAL'], 'Workflow', 'custom');
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFApprovalRemoveLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

class WFApprovalSubmitLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_APPROVAL_SUBMIT'], 'Workflow', 'custom');
    this.text = `${parts[2]}`;
  }
}

class WFApprovalSubmitterLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFAssignLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFEmailAlertLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_EMAIL_ALERT'], 'Workflow', 'custom');
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFEmailSentLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_EMAIL_SENT'], 'Workflow', 'custom');
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFEnqueueActionsLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class WFEscalationActionLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFEvalEntryCriteriaLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_EVAL_ENTRY_CRITERIA'], 'Workflow', 'custom');
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFFlowActionDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    const optional = parts[4] ? ` : ${parts[4]} :${parts[5]}` : '';
    this.text = `${parts[2]} : ${parts[3]}` + optional;
  }
}

class WFNextApproverLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_NEXT_APPROVER'], 'Workflow', 'custom');
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

class WFOutboundMsgLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFProcessFoundLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_PROCESS_FOUND'], 'Workflow', 'custom');
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFProcessNode extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_PROCESS_NODE'], 'Workflow', 'custom');
    this.text = parts[2] || '';
  }
}

class WFReassignRecordLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

class WFResponseNotifyLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFRuleEntryOrderLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class WFRuleInvocationLine extends Method {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['WF_RULE_INVOCATION'], 'Workflow', 'custom');
    this.text = parts[2] || '';
  }
}

class WFSoftRejectLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class WFTimeTriggerLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

class WFSpoolActionBeginLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class ExceptionThrownLine extends LogLine {
  discontinuity = true;
  acceptsText = true;
  totalThrownCount = 1;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }

  onAfter(parser: ApexLogParser, _next?: LogLine): void {
    if (this.text.indexOf('System.LimitException') >= 0) {
      const isMultiLine = this.text.indexOf('\n');
      const len = isMultiLine < 0 ? 99 : isMultiLine;
      const truncateText = this.text.length > len;
      const summary = this.text.slice(0, len + 1) + (truncateText ? '…' : '');
      const message = truncateText ? this.text : '';
      parser.addLogIssue(this.timestamp, summary, message, 'error');
    }
  }
}

class FatalErrorLine extends LogLine {
  acceptsText = true;
  hideable = false;
  discontinuity = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }

  onAfter(parser: ApexLogParser, _next?: LogLine): void {
    const newLineIndex = this.text.indexOf('\n');
    const summary = newLineIndex > -1 ? this.text.slice(0, newLineIndex + 1) : this.text;
    const detailText = summary.length !== this.text.length ? this.text : '';
    parser.addLogIssue(this.timestamp, 'FATAL ERROR! cause=' + summary, detailText, 'error');
  }
}

class XDSDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class XDSResponseLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}
class XDSResponseDetailLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

class XDSResponseErrorLine extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

// e.g. "09:45:31.888 (38889007737)|DUPLICATE_DETECTION_BEGIN"
class DuplicateDetectionBegin extends Method {
  declarative = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['DUPLICATE_DETECTION_END'], 'Workflow', 'custom');
  }
}

// e.g. "09:45:31.888 (38889067408)|DUPLICATE_DETECTION_RULE_INVOCATION|DuplicateRuleId:0Bm20000000CaSP|DuplicateRuleName:Duplicate Account|DmlType:UPDATE"
class DuplicateDetectionRule extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[3]} - ${parts[4]}`;
  }
}

/**
 * NOTE: These can be found in the org on the create new debug level page but are not found in the docs here
 * https://help.salesforce.com/s/articleView?id=sf.code_setting_debug_log_levels.htm
 */
class BulkDMLEntry extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

/**
 * DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS|EntityType:Account|ActionTaken:Allow_[Alert,Report]|DuplicateRecordIds:
 */
class DuplicateDetectionDetails extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}

/**
 * DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY|EntityType:Account|NumRecordsToBeSaved:200|NumRecordsToBeSavedWithDuplicates:0|NumDuplicateRecordsFound:0
 */
class DuplicateDetectionSummary extends LogLine {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}

class SessionCachePutBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SESSION_CACHE_PUT_END'], 'Method', 'method');
  }
}
class SessionCacheGetBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SESSION_CACHE_GET_END'], 'Method', 'method');
  }
}

class SessionCacheRemoveBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SESSION_CACHE_REMOVE_END'], 'Method', 'method');
  }
}

class OrgCachePutBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['ORG_CACHE_PUT_END'], 'Method', 'method');
  }
}

class OrgCacheGetBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['ORG_CACHE_GET_END'], 'Method', 'method');
  }
}

class OrgCacheRemoveBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['ORG_CACHE_REMOVE_END'], 'Method', 'method');
  }
}

class VFSerializeContinuationStateBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['VF_SERIALIZE_CONTINUATION_STATE_END'], 'Method', 'method');
  }
}

class VFDeserializeContinuationStateBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['VF_SERIALIZE_CONTINUATION_STATE_END'], 'Method', 'method');
  }
}

class MatchEngineBegin extends Method {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['MATCH_ENGINE_END'], 'Method', 'method');
  }
}

function getLogEventClass(eventName: LogEventType): LogLineConstructor | null | undefined {
  if (!eventName) {
    return null;
  }

  // Fast path for the most commonly occuring types
  switch (eventName) {
    case 'METHOD_ENTRY':
      return MethodEntryLine;

    case 'METHOD_EXIT':
      return MethodExitLine;

    case 'CONSTRUCTOR_ENTRY':
      return ConstructorEntryLine;

    case 'CONSTRUCTOR_EXIT':
      return ConstructorExitLine;

    default:
      break;
  }

  // Handle all other types
  const logType = lineTypeMap.get(eventName);
  if (logType) {
    return logType;
  } else if (basicLogEvents.indexOf(eventName) !== -1) {
    return BasicLogLine;
  } else if (basicExitLogEvents.indexOf(eventName) !== -1) {
    return BasicExitLine;
  }

  return null;
}

type LogLineConstructor<T extends LogLine = LogLine> = new (
  parser: ApexLogParser,
  parts: string[],
) => T;
export const lineTypeMap: ReadonlyMap<LogEventType, LogLineConstructor> = new Map<
  LogEventType,
  LogLineConstructor
>([
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

const basicLogEvents: LogEventType[] = [
  'BULK_COUNTABLE_STATEMENT_EXECUTE',
  'TEMPLATE_PROCESSING_ERROR',
  'EXTERNAL_SERVICE_REQUEST',
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

const basicExitLogEvents: LogEventType[] = [
  'FLOW_START_INTERVIEW_END',
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

const _logEventNames = [
  'BULK_DML_RETRY',
  'BULK_HEAP_ALLOCATE',
  'CALLOUT_REQUEST',
  'CALLOUT_RESPONSE',
  'NAMED_CREDENTIAL_REQUEST',
  'NAMED_CREDENTIAL_RESPONSE',
  'NAMED_CREDENTIAL_RESPONSE_DETAIL',
  'CONSTRUCTOR_ENTRY',
  'CONSTRUCTOR_EXIT',
  'EMAIL_QUEUE',
  'METHOD_ENTRY',
  'METHOD_EXIT',
  'SYSTEM_CONSTRUCTOR_ENTRY',
  'SYSTEM_CONSTRUCTOR_EXIT',
  'SYSTEM_METHOD_ENTRY',
  'SYSTEM_METHOD_EXIT',
  'CODE_UNIT_STARTED',
  'CODE_UNIT_FINISHED',
  'VF_APEX_CALL_START',
  'VF_APEX_CALL_END',
  'VF_DESERIALIZE_VIEWSTATE_BEGIN',
  'VF_EVALUATE_FORMULA_BEGIN',
  'VF_EVALUATE_FORMULA_END',
  'VF_SERIALIZE_CONTINUATION_STATE_BEGIN',
  'VF_DESERIALIZE_CONTINUATION_STATE_BEGIN',
  'VF_SERIALIZE_VIEWSTATE_BEGIN',
  'VF_PAGE_MESSAGE',
  'DML_BEGIN',
  'DML_END',
  'IDEAS_QUERY_EXECUTE',
  'SOQL_EXECUTE_BEGIN',
  'SOQL_EXECUTE_END',
  'SOQL_EXECUTE_EXPLAIN',
  'SOSL_EXECUTE_BEGIN',
  'SOSL_EXECUTE_END',
  'HEAP_ALLOCATE',
  'HEAP_DEALLOCATE',
  'STATEMENT_EXECUTE',
  'VARIABLE_SCOPE_BEGIN',
  'VARIABLE_ASSIGNMENT',
  'USER_INFO',
  'USER_DEBUG',
  'CUMULATIVE_LIMIT_USAGE',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
  'LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'NBA_NODE_BEGIN',
  'NBA_NODE_DETAIL',
  'NBA_NODE_END',
  'NBA_NODE_ERROR',
  'NBA_OFFER_INVALID',
  'NBA_STRATEGY_BEGIN',
  'NBA_STRATEGY_END',
  'NBA_STRATEGY_ERROR',
  'POP_TRACE_FLAGS',
  'PUSH_TRACE_FLAGS',
  'QUERY_MORE_BEGIN',
  'QUERY_MORE_END',
  'QUERY_MORE_ITERATIONS',
  'TOTAL_EMAIL_RECIPIENTS_QUEUED',
  'SAVEPOINT_ROLLBACK',
  'SAVEPOINT_SET',
  'STACK_FRAME_VARIABLE_LIST',
  'STATIC_VARIABLE_LIST',
  'SYSTEM_MODE_ENTER',
  'SYSTEM_MODE_EXIT',
  'EXECUTION_STARTED',
  'ENTERING_MANAGED_PKG',
  'EVENT_SERVICE_PUB_BEGIN',
  'EVENT_SERVICE_PUB_END',
  'EVENT_SERVICE_PUB_DETAIL',
  'EVENT_SERVICE_SUB_BEGIN',
  'EVENT_SERVICE_SUB_DETAIL',
  'EVENT_SERVICE_SUB_END',
  'FLOW_START_INTERVIEWS_BEGIN',
  'FLOW_START_INTERVIEWS_ERROR',
  'FLOW_START_INTERVIEW_BEGIN',
  'FLOW_START_INTERVIEW_LIMIT_USAGE',
  'FLOW_START_SCHEDULED_RECORDS',
  'FLOW_CREATE_INTERVIEW_ERROR',
  'FLOW_ELEMENT_BEGIN',
  'FLOW_ELEMENT_DEFERRED',
  'FLOW_ELEMENT_ERROR',
  'FLOW_ELEMENT_FAULT',
  'FLOW_ELEMENT_LIMIT_USAGE',
  'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE',
  'FLOW_SUBFLOW_DETAIL',
  'FLOW_VALUE_ASSIGNMENT',
  'FLOW_WAIT_EVENT_RESUMING_DETAIL',
  'FLOW_WAIT_EVENT_WAITING_DETAIL',
  'FLOW_WAIT_RESUMING_DETAIL',
  'FLOW_WAIT_WAITING_DETAIL',
  'FLOW_INTERVIEW_FINISHED',
  'FLOW_INTERVIEW_PAUSED',
  'FLOW_INTERVIEW_RESUMED',
  'FLOW_ACTIONCALL_DETAIL',
  'FLOW_ASSIGNMENT_DETAIL',
  'FLOW_LOOP_DETAIL',
  'FLOW_RULE_DETAIL',
  'FLOW_BULK_ELEMENT_BEGIN',
  'FLOW_BULK_ELEMENT_DETAIL',
  'FLOW_BULK_ELEMENT_LIMIT_USAGE',
  'FLOW_BULK_ELEMENT_NOT_SUPPORTED',
  'MATCH_ENGINE_BEGIN',
  'ORG_CACHE_PUT_BEGIN',
  'ORG_CACHE_GET_BEGIN',
  'ORG_CACHE_REMOVE_BEGIN',
  'PUSH_NOTIFICATION_INVALID_APP',
  'PUSH_NOTIFICATION_INVALID_CERTIFICATE',
  'PUSH_NOTIFICATION_INVALID_NOTIFICATION',
  'PUSH_NOTIFICATION_NO_DEVICES',
  'PUSH_NOTIFICATION_SENT',
  'SESSION_CACHE_PUT_BEGIN',
  'SESSION_CACHE_GET_BEGIN',
  'SESSION_CACHE_REMOVE_BEGIN',
  'SLA_END',
  'SLA_EVAL_MILESTONE',
  'SLA_PROCESS_CASE',
  'TESTING_LIMITS',
  'VALIDATION_ERROR',
  'VALIDATION_FORMULA',
  'VALIDATION_PASS',
  'VALIDATION_RULE',
  'WF_FLOW_ACTION_ERROR',
  'WF_FLOW_ACTION_ERROR_DETAIL',
  'WF_FIELD_UPDATE',
  'WF_RULE_EVAL_BEGIN',
  'WF_RULE_EVAL_VALUE',
  'WF_RULE_FILTER',
  'WF_CRITERIA_BEGIN',
  'WF_FORMULA',
  'WF_ACTION',
  'WF_ACTIONS_END',
  'WF_ACTION_TASK',
  'WF_APPROVAL',
  'WF_APPROVAL_REMOVE',
  'WF_APPROVAL_SUBMIT',
  'WF_APPROVAL_SUBMITTER',
  'WF_ASSIGN',
  'WF_EMAIL_ALERT',
  'WF_EMAIL_SENT',
  'WF_ENQUEUE_ACTIONS',
  'WF_ESCALATION_ACTION',
  'WF_EVAL_ENTRY_CRITERIA',
  'WF_FLOW_ACTION_DETAIL',
  'WF_NEXT_APPROVER',
  'WF_OUTBOUND_MSG',
  'WF_PROCESS_FOUND',
  'WF_PROCESS_NODE',
  'WF_REASSIGN_RECORD',
  'WF_RESPONSE_NOTIFY',
  'WF_RULE_ENTRY_ORDER',
  'WF_RULE_INVOCATION',
  'WF_SOFT_REJECT',
  'WF_SPOOL_ACTION_BEGIN',
  'WF_TIME_TRIGGER',
  'EXCEPTION_THROWN',
  'FATAL_ERROR',
  'XDS_DETAIL',
  'XDS_RESPONSE',
  'XDS_RESPONSE_DETAIL',
  'XDS_RESPONSE_ERROR',
  'DUPLICATE_DETECTION_BEGIN',
  'DUPLICATE_DETECTION_RULE_INVOCATION',
  'DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS',
  'DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY',
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
] as const;

export type LogEventType = (typeof _logEventNames)[number];

export { DMLBeginLine, SOQLExecuteBeginLine, SOQLExecuteExplainLine };
