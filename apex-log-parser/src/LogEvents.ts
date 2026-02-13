/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import type { ApexLogParser, DebugLevel } from './ApexLogParser';
import type {
  CPUType,
  DebugCategory,
  GovernorLimits,
  Limits,
  LineNumber,
  LogCategory,
  LogEventType,
  LogIssue,
  SelfTotal,
} from './types.js';
import { DEBUG_CATEGORY, LOG_CATEGORY } from './types.js';

/**
 * All log lines extend this base class.
 */
export abstract class LogEvent {
  logParser: ApexLogParser;

  parent: LogEvent | null = null;

  /**
   * All child nodes of the current node
   */
  children: LogEvent[] = [];

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
  text = '';

  /**
   * Should this log entry pull in following text lines (as the log entry can contain newlines)?
   */
  acceptsText = false;

  /**
   * Is a method exit line?
   */
  isExit = false;

  /**
   * Indicates whether the current log event could have children.
   * It is possible this is true but there are no defined exit events or children.
   */
  isParent = false;

  /**
   * Whether the log event was truncated when the log ended, e,g no matching end event
   */
  isTruncated = false;

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
  timestamp = 0;

  /**
   * The timestamp when the node finished, in nanoseconds
   */
  exitStamp: number | null = null;

  /**
   * The timeline display category this event belongs to.
   */
  category: LogCategory = '';

  /**
   * The original Salesforce debug log category.
   */
  debugCategory: DebugCategory = '';

  /**
   * The CPU type, e.g loading, method, custom
   */
  cpuType: CPUType = ''; // the category key to collect our cpu usage

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

  constructor(parser: ApexLogParser, parts: string[]) {
    this.logParser = parser;
    // Now set actual values from parts
    const [timeData, type] = parts;
    if (type) {
      this.text = this.type = type as LogEventType;
    }
    if (timeData) {
      this.timestamp = this.parseTimestamp(timeData);
    }
  }

  /** Called if a corresponding end event is found during tree parsing*/
  onEnd?(end: LogEvent, stack: LogEvent[]): void;

  /** Called when the Log event after this one is created in the line parser*/
  onAfter?(parser: ApexLogParser, next?: LogEvent): void;

  public recalculateDurations() {
    if (this.exitStamp) {
      this.duration.total = this.duration.self = this.exitStamp - this.timestamp;
    }
  }

  private parseTimestamp(text: string): number {
    const start = text.indexOf('(');
    if (start !== -1) {
      return Number(text.slice(start + 1, -1));
    }
    throw new Error(`Unable to parse timestamp: '${text}'`);
  }

  protected parseLineNumber(text: string | null | undefined): LineNumber {
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

export class DurationLogEvent extends LogEvent {
  isParent = true;
  constructor(
    parser: ApexLogParser,
    parts: string[],
    exitTypes: LogEventType[],
    category: LogCategory,
    cpuType: CPUType,
    debugCategory: DebugCategory = '',
  ) {
    super(parser, parts);
    this.exitTypes = exitTypes;
    this.category = category;
    this.cpuType = cpuType;
    this.debugCategory = debugCategory;
  }
}

export class BasicLogLine extends LogEvent {}
export class BasicExitLine extends LogEvent {
  isExit = true;
}

/**
 * This export class represents the single root node for the node tree.
 * It is a "pseudo" node and not present in the log.
 * Since it has children it extends "Method".
 */
export class ApexLog extends LogEvent {
  type = null;
  text = 'LOG_ROOT';
  timestamp = 0;
  exitStamp = 0;
  exitTypes = [];
  override category: LogCategory = '';
  cpuType: CPUType = '';

  /**
   * The size of the log, in bytes
   */
  public size = 0;

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

  public governorLimits: GovernorLimits = {
    soqlQueries: { used: 0, limit: 0 },
    soslQueries: { used: 0, limit: 0 },
    queryRows: { used: 0, limit: 0 },
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
    byNamespace: new Map<string, Limits>(),
    snapshots: [],
  };

  /**
   * The wall-clock time of the first event, in milliseconds since midnight.
   * Parsed from the `HH:MM:SS.f` portion of the first log line.
   * Null if no wall-clock time could be parsed.
   */
  startTime: number | null = null;

  /**
   * The endtime with nodes of 0 duration excluded
   */
  executionEndTime = 0;

  constructor(parser: ApexLogParser) {
    super(parser, []);
  }

  setTimes() {
    const firstChild = this.children.find((child) => {
      return child.timestamp;
    });
    this.timestamp = firstChild?.timestamp || 0;

    // Parse wall-clock time from the first child's log line (HH:MM:SS.f before the '(')
    if (firstChild?.logLine) {
      this.startTime = parseWallClockTime(firstChild.logLine);
    }

    // We do not just want to use the very last exitStamp because it could be CUMULATIVE_USAGE which is not really part of the code execution time but does have a later time.
    let endTime;
    const reverseLen = this.children.length - 1;
    for (let i = reverseLen; i >= 0; i--) {
      const child = this.children[i];
      // If there is no duration on a node then it is not going to be shown on the timeline anyway
      if (child?.exitStamp) {
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

/**
 * Parses the wall-clock time from a log line's timestamp portion.
 * Log lines start with `HH:MM:SS.f (nanoseconds)|...`
 * Returns milliseconds since midnight, or null if parsing fails.
 */
function parseWallClockTime(logLine: string): number | null {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d+)\s/.exec(logLine);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number(match[4]!.padEnd(3, '0'));

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + fraction;
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

export class BulkHeapAllocateLine extends LogEvent {
  logCategory = 'Apex Code';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class CalloutRequestLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['CALLOUT_RESPONSE'],
      LOG_CATEGORY.Callout,
      'free',
      DEBUG_CATEGORY.Callout,
    );
    this.text = parts[3] ?? '';
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class CalloutResponseLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[3] ?? '';
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}
export class NamedCredentialRequestLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    this.text = `${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

export class NamedCredentialResponseLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    this.text = `${parts[2]}`;
  }
}

export class NamedCredentialResponseDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Callout;
    this.text = `${parts[3]} : ${parts[4]} ${parts[5]} : ${parts[6]} ${parts[7]}`;
  }
}

export class ConstructorEntryLine extends DurationLogEvent {
  hasValidSymbols = true;
  suffix = ' (constructor)';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['CONSTRUCTOR_EXIT'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
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
    // inner  class with a namespace
    if (constructorParts.length === 3) {
      return possibleNs;
    }

    return '';
  }
}

export class ConstructorExitLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class EmailQueueLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class MethodEntryLine extends DurationLogEvent {
  hasValidSymbols = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['METHOD_EXIT'], LOG_CATEGORY.Apex, 'method', DEBUG_CATEGORY.ApexCode);
    const [, , lineNumber, , methodName] = parts;
    this.lineNumber = this.parseLineNumber(lineNumber);
    this.text = methodName || this.type || this.text;
    if (this.text.startsWith('System.Type.forName(')) {
      // assume we are not charged for export class loading (or at least not lengthy remote-loading / compiling)
      this.cpuType = 'loading';
    } else {
      const possibleNs = this._parseMethodNamespace(methodName);
      if (possibleNs) {
        this.namespace = possibleNs;
      }
    }
  }

  onEnd(end: MethodExitLine, _stack: LogEvent[]): void {
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
export class MethodExitLine extends LogEvent {
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

export class SystemConstructorEntryLine extends DurationLogEvent {
  suffix = '(system constructor)';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['SYSTEM_CONSTRUCTOR_EXIT'],
      LOG_CATEGORY.System,
      'method',
      DEBUG_CATEGORY.System,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

export class SystemConstructorExitLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}
export class SystemMethodEntryLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['SYSTEM_METHOD_EXIT'],
      LOG_CATEGORY.System,
      'method',
      DEBUG_CATEGORY.System,
    );
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

export class SystemMethodExitLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class CodeUnitStartedLine extends DurationLogEvent {
  suffix = ' (entrypoint)';
  codeUnitType = '';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['CODE_UNIT_FINISHED'],
      LOG_CATEGORY.CodeUnit,
      'custom',
      DEBUG_CATEGORY.ApexCode,
    );

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
        this.text = name;
        break;
      case 'Workflow':
        this.cpuType = 'custom';
        this.text = name;
        break;
      case 'Flow':
        this.cpuType = 'custom';
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
export class CodeUnitFinishedLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class VFApexCallStartLine extends DurationLogEvent {
  hasValidSymbols = true;
  suffix = ' (VF APEX)';
  invalidClasses = [
    'pagemessagescomponentcontroller',
    'pagemessagecomponentcontroller',
    'severitymessages',
  ];

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['VF_APEX_CALL_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
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
      this.hasValidSymbols = false;
    } else if (methodtext) {
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
    }
    this.text = classText + methodtext;
  }
}

export class VFApexCallEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class VFDeserializeViewstateBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['VF_DESERIALIZE_VIEWSTATE_END'],
      LOG_CATEGORY.System,
      'method',
      DEBUG_CATEGORY.Visualforce,
    );
  }
}

export class VFFormulaStartLine extends DurationLogEvent {
  suffix = ' (VF FORMULA)';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['VF_EVALUATE_FORMULA_END'],
      LOG_CATEGORY.System,
      'custom',
      DEBUG_CATEGORY.Visualforce,
    );
    this.text = parts[3] || '';
  }
}

export class VFFormulaEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Visualforce;
    this.text = parts[2] || '';
  }
}

export class VFSeralizeViewStateStartLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['VF_SERIALIZE_VIEWSTATE_END'],
      LOG_CATEGORY.System,
      'method',
      DEBUG_CATEGORY.Visualforce,
    );
  }
}

export class VFPageMessageLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexCode;
    this.text = parts[2] || '';
  }
}

export class DMLBeginLine extends DurationLogEvent {
  dmlCount = {
    self: 1,
    total: 1,
  };
  namespace = 'default';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['DML_END'], LOG_CATEGORY.DML, 'free', DEBUG_CATEGORY.Database);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = 'DML ' + parts[3] + ' ' + parts[4];
    const rowCountString = parts[5];
    this.dmlRowCount.total = this.dmlRowCount.self = rowCountString ? parseRows(rowCountString) : 0;
  }
}

export class DMLEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class IdeasQueryExecuteLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class SOQLExecuteBeginLine extends DurationLogEvent {
  aggregations = 0;
  children: SOQLExecuteExplainLine[] = [];
  soqlCount = {
    self: 1,
    total: 1,
  };

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SOQL_EXECUTE_END'], LOG_CATEGORY.SOQL, 'free', DEBUG_CATEGORY.Database);
    this.lineNumber = this.parseLineNumber(parts[2]);

    const [, , , aggregations, soqlString] = parts;

    const aggregationText = aggregations || '';
    if (aggregationText) {
      const aggregationIndex = aggregationText.indexOf('Aggregations:');
      this.aggregations = Number(aggregationText.slice(aggregationIndex + 13));
    }
    this.text = soqlString || '';
  }

  onEnd(end: SOQLExecuteEndLine, _stack: LogEvent[]): void {
    this.soqlRowCount.total = this.soqlRowCount.self = end.soqlRowCount.total;
  }
}

export class SOQLExecuteEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.soqlRowCount.total = this.soqlRowCount.self = parseRows(parts[3] || '');
  }
}

export class SOQLExecuteExplainLine extends LogEvent {
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

export class SOSLExecuteBeginLine extends DurationLogEvent {
  soslCount = {
    self: 1,
    total: 1,
  };

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['SOSL_EXECUTE_END'], LOG_CATEGORY.SOQL, 'free', DEBUG_CATEGORY.Database);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `SOSL: ${parts[3]}`;
  }

  onEnd(end: SOSLExecuteEndLine, _stack: LogEvent[]): void {
    this.soslRowCount.total = this.soslRowCount.self = end.soslRowCount.total;
  }
}

export class SOSLExecuteEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.soslRowCount.total = this.soslRowCount.self = parseRows(parts[3] || '');
  }
}

export class HeapAllocateLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }
}

export class HeapDeallocateLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class StatementExecuteLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
  }
}

export class VariableScopeBeginLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}

export class VariableAssignmentLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}
export class UserInfoLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] + ' ' + parts[4];
  }
}

export class UserDebugLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts.slice(3).join(' | ');
  }
}

export class CumulativeLimitUsageLine extends DurationLogEvent {
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['CUMULATIVE_LIMIT_USAGE_END'],
      LOG_CATEGORY.System,
      'system',
      DEBUG_CATEGORY.ApexProfiling,
    );
  }
}

export class CumulativeProfilingLine extends LogEvent {
  acceptsText = true;
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] + ' ' + (parts[3] ?? '');
  }
}

export class CumulativeProfilingBeginLine extends DurationLogEvent {
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['CUMULATIVE_PROFILING_END'],
      LOG_CATEGORY.System,
      'custom',
      DEBUG_CATEGORY.ApexProfiling,
    );
  }
}

export class LimitUsageLine extends LogEvent {
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] + ' ' + parts[4] + ' out of ' + parts[5];
  }
}

export class LimitUsageForNSLine extends LogEvent {
  static limitsKeys = new Map<string, string>([
    ['Number of SOQL queries', 'soqlQueries'],
    ['Number of query rows', 'queryRows'],
    ['Number of SOSL queries', 'soslQueries'],
    ['Number of DML statements', 'dmlStatements'],
    ['Number of Publish Immediate DML', 'publishImmediateDml'],
    ['Number of DML rows', 'dmlRows'],
    ['Maximum CPU time', 'cpuTime'],
    ['Maximum heap size', 'heapSize'],
    ['Number of callouts', 'callouts'],
    ['Number of Email Invocations', 'emailInvocations'],
    ['Number of future calls', 'futureCalls'],
    ['Number of queueable jobs added to the queue', 'queueableJobsAddedToQueue'],
    ['Number of Mobile Apex push calls', 'mobileApexPushCalls'],
  ]);

  namespace = 'default';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
    this.acceptsText = true;
    this.text = parts[2] || '';
  }

  onAfter(parser: ApexLogParser, _next?: LogEvent): void {
    // Parse the namespace from the first line (before any newline)
    this.namespace = this.text.slice(0, this.text.indexOf('\n')).replace(/\(|\)/g, '');

    // Clean up the text for easier parsing
    const cleanedText = this.text
      .replace(/^\s+/gm, '')
      .replaceAll('******* CLOSE TO LIMIT', '')
      .replaceAll(' out of ', '/');
    this.text = cleanedText;

    // Split into lines and parse each line for limits
    const lines = cleanedText.split('\n');
    const limits: Limits = {
      soqlQueries: { used: 0, limit: 0 },
      soslQueries: { used: 0, limit: 0 },
      queryRows: { used: 0, limit: 0 },
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

    for (const line of lines) {
      // Match lines like: "Maximum CPU time: 15008/10000"
      const match = line.match(/^(.+?):\s*([\d,]+)\/([\d,]+)/);
      if (match) {
        const key: keyof Limits = LimitUsageForNSLine.limitsKeys.get(
          match[1]!.trim(),
        ) as keyof Limits;
        if (key) {
          const used = parseInt(match[2]!.replace(/,/g, ''), 10);
          const limit = parseInt(match[3]!.replace(/,/g, ''), 10);
          if (key) {
            limits[key] = { used, limit };
          }
        }
      }
    }

    parser.governorLimits.byNamespace.set(this.namespace, limits);

    // Track snapshots for governor limit visualization
    parser.governorLimits.snapshots.push({
      timestamp: this.timestamp,
      namespace: this.namespace,
      limits,
    });
  }
}

export class NBANodeBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['NBA_NODE_END'], LOG_CATEGORY.Automation, 'method', DEBUG_CATEGORY.NBA);
    this.text = parts.slice(2).join(' | ');
  }
}

export class NBANodeDetail extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
export class NBANodeEnd extends LogEvent {
  isExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
export class NBANodeError extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
export class NBAOfferInvalid extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
export class NBAStrategyBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['NBA_STRATEGY_END'],
      LOG_CATEGORY.Automation,
      'method',
      DEBUG_CATEGORY.NBA,
    );
    this.text = parts.slice(2).join(' | ');
  }
}
export class NBAStrategyEnd extends LogEvent {
  isExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}
export class NBAStrategyError extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}

export class PushTraceFlagsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[4] + ', line:' + this.lineNumber + ' - ' + parts[5];
  }
}

export class PopTraceFlagsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[4] + ', line:' + this.lineNumber + ' - ' + parts[5];
  }
}

export class QueryMoreBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, ['QUERY_MORE_END'], LOG_CATEGORY.SOQL, 'custom', DEBUG_CATEGORY.Database);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}

export class QueryMoreEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}`;
  }
}
export class QueryMoreIterationsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `line: ${this.lineNumber}, iterations:${parts[3]}`;
  }
}

export class SavepointRollbackLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

export class SavePointSetLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = `${parts[3]}, line: ${this.lineNumber}`;
  }
}

export class TotalEmailRecipientsQueuedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class StackFrameVariableListLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
  }
}

export class StaticVariableListLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
  }
}

// This looks like a method, but the exit line is often missing...
export class SystemModeEnterLine extends LogEvent {
  // namespace = "system";

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class SystemModeExitLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class ExecutionStartedLine extends DurationLogEvent {
  namespace = 'default';
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['EXECUTION_FINISHED'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class EnteringManagedPackageLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts, [], LOG_CATEGORY.Apex, 'pkg', DEBUG_CATEGORY.ApexCode);
    const rawNs = parts[2] || '',
      lastDot = rawNs.lastIndexOf('.');

    this.text = this.namespace = lastDot < 0 ? rawNs : rawNs.substring(lastDot + 1);
  }

  onAfter(parser: ApexLogParser, end?: LogEvent): void {
    if (end) {
      this.exitStamp = end.timestamp;
    }
  }
}

export class EventSericePubBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['EVENT_SERVICE_PUB_END'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] || '';
  }
}

export class EventSericePubEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class EventSericePubDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] + ' ' + parts[3] + ' ' + parts[4];
  }
}

export class EventSericeSubBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['EVENT_SERVICE_SUB_END'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} ${parts[3]}`;
  }
}

export class EventSericeSubEndLine extends LogEvent {
  isExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} ${parts[3]}`;
  }
}

export class EventSericeSubDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} ${parts[3]} ${parts[4]} ${parts[6]} ${parts[6]}`;
  }
}

export class FlowStartInterviewsBeginLine extends DurationLogEvent {
  text = 'FLOW_START_INTERVIEWS : ';

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['FLOW_START_INTERVIEWS_END'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
  }

  onEnd(end: LogEvent, stack: LogEvent[]) {
    const flowType = this.getFlowType(stack);
    this.suffix = ` (${flowType})`;
    this.text += this.getFlowName();
  }

  getFlowType(stack: LogEvent[]) {
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

export class FlowStartInterviewsErrorLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} - ${parts[4]}`;
  }
}

export class FlowStartInterviewBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['FLOW_START_INTERVIEW_END'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[3] || '';
  }
}

export class FlowStartInterviewLimitUsageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class FlowStartScheduledRecordsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class FlowCreateInterviewErrorLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class FlowElementBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['FLOW_ELEMENT_END'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[3] + ' ' + parts[4];
  }
}

export class FlowElementDeferredLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] + ' ' + parts[3];
  }
}

export class FlowElementAssignmentLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + ' ' + parts[4];
  }
}

export class FlowWaitEventResumingDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class FlowWaitEventWaitingDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

export class FlowWaitResumingDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class FlowWaitWaitingDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class FlowInterviewFinishedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] || '';
  }
}

export class FlowInterviewResumedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class FlowInterviewPausedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class FlowElementErrorLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[1] || '' + parts[2] + ' ' + parts[3] + ' ' + parts[4];
  }
}

export class FlowElementFaultLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class FlowElementLimitUsageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]}`;
  }
}

export class FlowInterviewFinishedLimitUsageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]}`;
  }
}

export class FlowSubflowDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class FlowActionCallDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5] + ' : ' + parts[6];
  }
}

export class FlowAssignmentDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + ' : ' + parts[4] + ' : ' + parts[5];
  }
}

export class FlowLoopDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + ' : ' + parts[4];
  }
}

export class FlowRuleDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[3] + ' : ' + parts[4];
  }
}

export class FlowBulkElementBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['FLOW_BULK_ELEMENT_END'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} - ${parts[3]}`;
  }
}

export class FlowBulkElementDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] + ' : ' + parts[3] + ' : ' + parts[4];
  }
}

export class FlowBulkElementNotSupportedLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class FlowBulkElementLimitUsageLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class PNInvalidAppLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}

export class PNInvalidCertificateLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}
export class PNInvalidNotificationLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]} : ${parts[8]}`;
  }
}
export class PNNoDevicesLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]}`;
  }
}

export class PNSentLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}.${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

export class SLAEndLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}

export class SLAEvalMilestoneLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

export class SLAProcessCaseLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]}`;
  }
}

export class TestingLimitsLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.ApexProfiling;
  }
}

export class ValidationRuleLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Validation;
    this.text = parts[3] || '';
  }
}

export class ValidationErrorLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Validation;
    this.text = parts[2] || '';
  }
}

export class ValidationFormulaLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Validation;
    const extra = parts.length > 3 ? ' ' + parts[3] : '';

    this.text = parts[2] + extra;
  }
}

export class ValidationPassLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Validation;
    this.text = parts[3] || '';
  }
}

export class WFFlowActionErrorLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[1] + ' ' + parts[4];
  }
}

export class WFFlowActionErrorDetailLine extends LogEvent {
  acceptsText = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[1] + ' ' + parts[2];
  }
}

export class WFFieldUpdateLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_FIELD_UPDATE'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = ' ' + parts[2] + ' ' + parts[3] + ' ' + parts[4] + ' ' + parts[5] + ' ' + parts[6];
  }
}

export class WFRuleEvalBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_RULE_EVAL_END'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] || '';
  }
}

export class WFRuleEvalValueLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class WFRuleFilterLine extends LogEvent {
  acceptsText = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class WFCriteriaBeginLine extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = 'WF_CRITERIA : ' + parts[5] + ' : ' + parts[3];
  }
}

export class WFFormulaLine extends DurationLogEvent {
  acceptsText = true;
  isExit = true;
  nextLineIsExit = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_FORMULA'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] + ' : ' + parts[3];
  }
}

export class WFActionLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class WFActionsEndLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class WFActionTaskLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]} : ${parts[7]}`;
  }
}

export class WFApprovalLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_APPROVAL'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFApprovalRemoveLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]}`;
  }
}

export class WFApprovalSubmitLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_APPROVAL_SUBMIT'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]}`;
  }
}

export class WFApprovalSubmitterLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFAssignLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class WFEmailAlertLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_EMAIL_ALERT'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFEmailSentLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_EMAIL_SENT'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFEnqueueActionsLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class WFEscalationActionLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class WFEvalEntryCriteriaLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_EVAL_ENTRY_CRITERIA'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFFlowActionDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    const optional = parts[4] ? ` : ${parts[4]} :${parts[5]}` : '';
    this.text = `${parts[2]} : ${parts[3]}` + optional;
  }
}

export class WFNextApproverLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_NEXT_APPROVER'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]}`;
  }
}

export class WFOutboundMsgLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class WFProcessFoundLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_PROCESS_FOUND'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class WFProcessNode extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_PROCESS_NODE'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] || '';
  }
}

export class WFReassignRecordLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]}`;
  }
}

export class WFResponseNotifyLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class WFRuleEntryOrderLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class WFRuleInvocationLine extends DurationLogEvent {
  isExit = true;
  nextLineIsExit = true;
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['WF_RULE_INVOCATION'],
      LOG_CATEGORY.Automation,
      'custom',
      DEBUG_CATEGORY.Workflow,
    );
    this.text = parts[2] || '';
  }
}

export class WFSoftRejectLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class WFTimeTriggerLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]}`;
  }
}

export class WFSpoolActionBeginLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.debugCategory = DEBUG_CATEGORY.Workflow;
    this.text = parts[2] || '';
  }
}

export class ExceptionThrownLine extends LogEvent {
  discontinuity = true;
  acceptsText = true;
  totalThrownCount = 1;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.lineNumber = this.parseLineNumber(parts[2]);
    this.text = parts[3] || '';
  }

  onAfter(parser: ApexLogParser, _next?: LogEvent): void {
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

export class FatalErrorLine extends LogEvent {
  acceptsText = true;
  discontinuity = true;

  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }

  onAfter(parser: ApexLogParser, _next?: LogEvent): void {
    const newLineIndex = this.text.indexOf('\n');
    const summary = newLineIndex > -1 ? this.text.slice(0, newLineIndex + 1) : this.text;
    const detailText = summary.length !== this.text.length ? this.text : '';
    parser.addLogIssue(this.timestamp, 'FATAL ERROR! cause=' + summary, detailText, 'error');
  }
}

export class XDSDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class XDSResponseLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[2]} : ${parts[3]} : ${parts[4]} : ${parts[5]} : ${parts[6]}`;
  }
}
export class XDSResponseDetailLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

export class XDSResponseErrorLine extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

// e.g. "09:45:31.888 (38889007737)|DUPLICATE_DETECTION_BEGIN"
export class DuplicateDetectionBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['DUPLICATE_DETECTION_END'],
      LOG_CATEGORY.System,
      'custom',
      DEBUG_CATEGORY.System,
    );
  }
}

// e.g. "09:45:31.888 (38889067408)|DUPLICATE_DETECTION_RULE_INVOCATION|DuplicateRuleId:0Bm20000000CaSP|DuplicateRuleName:Duplicate Account|DmlType:UPDATE"
export class DuplicateDetectionRule extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = `${parts[3]} - ${parts[4]}`;
  }
}

/**
 * NOTE: These can be found in the org on the create new debug level page but are not found in the docs here
 * https://help.salesforce.com/s/articleView?id=sf.code_setting_debug_log_levels.htm
 */
export class BulkDMLEntry extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts[2] || '';
  }
}

/**
 * DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS|EntityType:Account|ActionTaken:Allow_[Alert,Report]|DuplicateRecordIds:
 */
export class DuplicateDetectionDetails extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}

/**
 * DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY|EntityType:Account|NumRecordsToBeSaved:200|NumRecordsToBeSavedWithDuplicates:0|NumDuplicateRecordsFound:0
 */
export class DuplicateDetectionSummary extends LogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(parser, parts);
    this.text = parts.slice(2).join(' | ');
  }
}

export class SessionCachePutBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['SESSION_CACHE_PUT_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}
export class SessionCacheGetBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['SESSION_CACHE_GET_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class SessionCacheRemoveBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['SESSION_CACHE_REMOVE_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class OrgCachePutBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['ORG_CACHE_PUT_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class OrgCacheGetBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['ORG_CACHE_GET_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class OrgCacheRemoveBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['ORG_CACHE_REMOVE_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class VFSerializeContinuationStateBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['VF_SERIALIZE_CONTINUATION_STATE_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class VFDeserializeContinuationStateBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['VF_SERIALIZE_CONTINUATION_STATE_END'],
      LOG_CATEGORY.Apex,
      'method',
      DEBUG_CATEGORY.ApexCode,
    );
  }
}

export class MatchEngineBegin extends DurationLogEvent {
  constructor(parser: ApexLogParser, parts: string[]) {
    super(
      parser,
      parts,
      ['MATCH_ENGINE_END'],
      LOG_CATEGORY.System,
      'method',
      DEBUG_CATEGORY.System,
    );
  }
}
