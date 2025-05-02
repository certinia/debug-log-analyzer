/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { ApexLog, type LogEvent } from './LogEvents.js';
import { getLogEventClass } from './LogLineMapping.js';
import type { IssueType, LogEventType, LogIssue } from './types.js';

const typePattern = /^[A-Z_]*$/,
  settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;

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

  private parseLine(line: string, lastEntry: LogEvent | null): LogEvent | null {
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

    const hasType = !!(type && typePattern.test(type));
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

  private *generateLogLines(log: string): Generator<LogEvent> {
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

  private toLogTree(lineGenerator: Generator<LogEvent>) {
    const rootMethod = new ApexLog(this),
      stack: LogEvent[] = [];
    let line: LogEvent | null;

    const lineIter = new LineIterator(lineGenerator);

    while ((line = lineIter.fetch())) {
      if (line.exitTypes.length) {
        this.parseTree(line, lineIter, stack);
      }
      line.parent = rootMethod;
      rootMethod.children.push(line);
    }

    rootMethod.setTimes();
    this.insertPackageWrappers(rootMethod);
    this.aggregateTotals([rootMethod]);
    return rootMethod;
  }

  private parseTree(currentLine: LogEvent, lineIter: LineIterator, stack: LogEvent[]) {
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

        lineIter.fetch(); // it's a child - consume the line
        this.lastTimestamp = nextLine.timestamp;
        nextLine.namespace ||= currentLine.namespace || 'default';
        nextLine.parent = currentLine;
        currentLine.children.push(nextLine);

        if (nextLine.exitTypes.length) {
          this.parseTree(nextLine, lineIter, stack);
        }
      }

      // End of line error handling. We have finished processing this log line and either got to the end
      // of the log without finding an exit line or the current line was truncated)
      if (!nextLine || currentLine.isTruncated) {
        // truncated method - terminate at the end of the log
        currentLine.exitStamp = this.lastTimestamp ?? currentLine.timestamp;

        // we found an entry event on its own e.g a `METHOD_ENTRY` without a `METHOD_EXIT` and got to the end of the log
        this.addLogIssue(
          currentLine.exitStamp,
          'Unexpected-End',
          'An entry event was found without a corresponding exit event e.g a `METHOD_ENTRY` event without a `METHOD_EXIT`',
          'unexpected',
        );

        if (currentLine.isTruncated) {
          this.updateLogIssue(
            currentLine.exitStamp,
            'Max-Size-reached',
            'The maximum log size has been reached. Part of the log has been truncated.',
            'skip',
          );
          this.maxSizeTimestamp = currentLine.exitStamp;
        }
        currentLine.isTruncated = true;
      }

      stack.pop();
      currentLine.recalculateDurations();
    }
  }

  private isMatchingEnd(startMethod: LogEvent, endLine: LogEvent) {
    return !!(
      endLine.type &&
      startMethod.exitTypes.includes(endLine.type) &&
      (endLine.lineNumber === startMethod.lineNumber ||
        !endLine.lineNumber ||
        !startMethod.lineNumber)
    );
  }

  private endMethod(
    startMethod: LogEvent,
    endLine: LogEvent,
    lineIter: LineIterator,
    stack: LogEvent[],
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

  private flattenByDepth(nodes: LogEvent[]) {
    const result = new Map<number, LogEvent[]>();

    let currentDepth = 0;

    let currentNodes = nodes;
    let len = currentNodes.length;
    while (len) {
      result.set(currentDepth, currentNodes);

      const children: LogEvent[] = [];
      while (len--) {
        const node = currentNodes[len];
        if (node?.children) {
          node.children.forEach((c) => {
            if (c.children.length) {
              children.push(c);
            }
          });
        }
      }
      currentDepth++;
      currentNodes = children;
      len = currentNodes.length;
    }

    return result;
  }

  private aggregateTotals(nodes: LogEvent[]) {
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

  private insertPackageWrappers(node: LogEvent) {
    const children = node.children;
    let lastPkg: LogEvent | null = null;

    const newChildren: LogEvent[] = [];
    const len = children.length;
    for (let i = 0; i < len; i++) {
      const child = children[i];
      if (!child) {
        continue;
      }
      const isPkgType = child.type === 'ENTERING_MANAGED_PKG';
      if (lastPkg) {
        if (isPkgType && child.namespace === lastPkg.namespace) {
          // combine adjacent (like) packages
          lastPkg.exitStamp = child.exitStamp || child.timestamp;
          continue; // skip any more child processing (it's gone)
        } else if (!isPkgType && child.exitStamp) {
          // we are done merging adjacent `ENTERING_MANAGED_PKG` of the same namesapce
          lastPkg.recalculateDurations();
          lastPkg = null;
        }
      }

      if (child.exitTypes.length) {
        this.insertPackageWrappers(child);
      }

      // It is a ENTERING_MANAGED_PKG line that does not match the last one
      // or we have not come across a ENTERING_MANAGED_PKG line yet.
      if (isPkgType) {
        lastPkg?.recalculateDurations();
        lastPkg = child;
      }
      newChildren.push(child);
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

export class DebugLevel {
  logCategory: string;
  logLevel: string;

  constructor(category: string, level: string) {
    this.logCategory = category;
    this.logLevel = level;
  }
}

export class LineIterator {
  next: LogEvent | null;
  lineGenerator: Generator<LogEvent>;

  constructor(lineGenerator: Generator<LogEvent>) {
    this.lineGenerator = lineGenerator;
    this.next = this.lineGenerator.next().value;
  }

  peek(): LogEvent | null {
    return this.next;
  }

  fetch(): LogEvent | null {
    const result = this.next;
    this.next = this.lineGenerator.next().value;
    return result;
  }
}
