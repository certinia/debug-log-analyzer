/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import { ApexLog, type LogEvent } from './LogEvents.js';
import { getLogEventClass } from './LogLineMapping.js';
import type { GovernorLimits, IssueType, Limits, LogEventType, LogIssue } from './types.js';

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
  lastTimestamp = 0;
  discontinuity = false;
  namespaces = new Set<string>();
  governorLimits: GovernorLimits = {
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
    apexLog.namespaces = Array.from(this.namespaces);
    apexLog.governorLimits = this.governorLimits;

    this.addGovernorLimits(apexLog);

    return apexLog;
  }

  private addGovernorLimits(apexLog: ApexLog) {
    const totalLimits = apexLog.governorLimits;
    if (totalLimits) {
      for (const limitsForNs of apexLog.governorLimits.byNamespace.values()) {
        for (const [key, value] of Object.entries(limitsForNs) as Array<
          [keyof Limits, Limits[keyof Limits]]
        >) {
          if (!value) {
            continue;
          }

          const currentLimit = totalLimits[key];
          currentLimit.limit = value.limit;
          currentLimit.used += value.used;
        }
      }
    }
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
    let startIndex = log.search(/^\d{2}:\d{2}:\d{2}.\d{1} \(\d+\)\|EXECUTION_STARTED$/m);
    if (startIndex === -1) {
      startIndex = 0;
    }

    const hascrlf = log.indexOf('\r\n', startIndex) > -1;
    let lastEntry = null;
    let lfIndex = null;
    let eolIndex = (lfIndex = log.indexOf('\n', startIndex));
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
      if (line.isParent) {
        this.parseTree(line, lineIter, stack);
      }
      line.parent = rootMethod;
      rootMethod.children.push(line);
    }

    rootMethod.setTimes();
    this.mergeManagedPackageEvents(rootMethod);
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

        if (nextLine.isParent) {
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
    let currentNodes = nodes.filter((n) => n.children.length);
    let len = currentNodes.length;
    while (len) {
      result.set(currentDepth++, currentNodes);

      const children: LogEvent[] = [];
      while (len--) {
        const node = currentNodes[len];
        if (!node?.children) {
          continue;
        }

        let i = node.children.length;
        while (i--) {
          const c = node.children[i];
          if (c?.children.length) {
            children.push(c);
          }
        }
      }

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
      const nds = nodesByDepth.get(depth);
      if (!nds) {
        continue;
      }
      let i = nds.length;
      while (i--) {
        const parent = nds[i];
        if (!parent?.children) {
          continue;
        }

        let j = parent.children.length;
        while (j--) {
          const child = parent.children[j];
          if (!child) {
            continue;
          }
          parent.dmlCount.total += child.dmlCount.total;
          parent.soqlCount.total += child.soqlCount.total;
          parent.soslCount.total += child.soslCount.total;
          parent.dmlRowCount.total += child.dmlRowCount.total;
          parent.soqlRowCount.total += child.soqlRowCount.total;
          parent.soslRowCount.total += child.soslRowCount.total;
          parent.duration.self -= child.duration.total;
          parent.totalThrownCount += child.totalThrownCount;
        }
      }
    }
    nodesByDepth.clear();
  }

  private mergeManagedPackageEvents(root: LogEvent) {
    const stack: LogEvent[] = [root];

    while (stack.length) {
      const node = stack.pop()!;
      const children = node.children;
      const len = children.length;
      let write = 0;
      let lastPkg: LogEvent | null = null;

      for (let i = 0; i < len; i++) {
        const child = children[i];
        if (!child) {
          continue;
        }

        const isPkg = child.type === 'ENTERING_MANAGED_PKG';
        if (lastPkg && child.isParent) {
          // merge consecutive pkg events (same namespace)
          if (isPkg && child.namespace === lastPkg.namespace) {
            lastPkg.exitStamp = child.exitStamp || child.timestamp;

            // Currently pkg events can not have children (no exit event) but if they ever do we need to move the children to the lastPkg event. The commented code below does that.

            // // Move children from the discarded package to the kept package
            // for (const childOfDiscarded of child.children) {
            //   childOfDiscarded.parent = lastPkg;
            //   lastPkg.children.push(childOfDiscarded);

            //   // If the moved child is also a parent, we need to process it recursively
            //   if (childOfDiscarded.isParent) {
            //     stack.push(childOfDiscarded);
            //   }
            // }

            continue; // skip writing this child
          } else if (!isPkg && child.exitStamp) {
            // pkg merge sequence ends
            lastPkg.recalculateDurations();
            lastPkg = null;
          }
        }

        // First timing we see a pkg event or found a pkg event with a different namespace
        if (isPkg) {
          // done merging to the last pkg event, make sure the durations are correct
          lastPkg?.recalculateDurations();
          lastPkg = child;
        }

        if (child.isParent) {
          stack.push(child);
        }

        // keep this child by rewriting in place
        children[write++] = child;
      }

      // truncate array to new length
      if (write < children.length) {
        children.length = write;
        lastPkg?.recalculateDurations();
      }
    }
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
