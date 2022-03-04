/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import { recalculateDurations } from "../Util";
import { logLines, LogLine, BlockLines, truncateLog } from "./LineParser";

let lastTimestamp: number | null = null,
  discontinuity = false;

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

export class RootNode extends BlockLines {
  text = "Log Root";
  type = "ROOT";
  timestamp = 0;
}

function endMethod(method: LogLine, endLine: LogLine, lineIter: LineIterator) {
  method.exitStamp = endLine.timestamp;
  if (method.onEnd) {
    // the method wants to see the exit line
    method.onEnd(endLine);
  }

  // is this a 'good' end line?
  if (
    method.exitTypes &&
    method.exitTypes.includes(endLine.type) &&
    (!method.lineNumber || endLine.lineNumber === method.lineNumber)
  ) {
    discontinuity = false; // end stack unwinding
    lineIter.fetch(); // consume the line
  } else {
    if (!discontinuity) {
      // discontinuities should have been reported already
      truncateLog(endLine.timestamp, "Unexpected-Exit", "unexpected");
    }
  }
}

function getMethod(lineIter: LineIterator, method: LogLine) {
  lastTimestamp = method.timestamp;

  if (method.exitTypes) {
    let lines: LogLine[] = [],
      line: LogLine | null;

    while ((line = lineIter.peek())) {
      // eslint-disable-line no-cond-assign
      if (line.discontinuity) {
        // discontinuities are stack unwinding (caused by Exceptions)
        discontinuity = true; // start unwinding stack
      }
      if (line.isExit) {
        break;
      }

      lineIter.fetch(); // it's a child - consume the line
      lastTimestamp = line.timestamp;
      if (line.exitTypes || line.displayType === "method") {
        method.addBlock(lines);
        lines = [];
        method.addChild(getMethod(lineIter, line));
      } else {
        lines.push(line);
      }
    }

    if (line === null) {
      // truncated method - terminate at the end of the log
      method.exitStamp = lastTimestamp;
      method.duration = lastTimestamp - method.timestamp;
      truncateLog(lastTimestamp, "Unexpected-End", "unexpected");
    }

    if (lines.length) {
      method.addBlock(lines);
    }

    if (line?.isExit) {
      endMethod(method, line, lineIter);
    }
  }
  recalculateDurations(method);

  return method;
}

export function getRootMethod(): RootNode {
  const lineIter = new LineIterator(logLines),
    rootMethod = new RootNode([]);
  let lines: LogLine[] = [],
    line;

  while ((line = lineIter.fetch())) {
    // eslint-disable-line no-cond-assign
    if (line.exitTypes) {
      rootMethod.addBlock(lines);
      lines = [];
      rootMethod.addChild(getMethod(lineIter, line));
    } else {
      lines.push(line);
    }
  }
  rootMethod.addBlock(lines);
  rootMethod.exitStamp = getEndTime(rootMethod);
  return rootMethod;
}

function getEndTime(rootNode: RootNode) {
  const start = performance.now();
  if (!rootNode.children) {
    return 0;
  }

  // We could have multiple "EXECUTION_STARTED" entries so loop backwards until we find one.
  // We do not just want to use the last one because it is probably CUMULATIVE_USAGE which is not really part of the code execution time but does have a later time.
  let endTime;
  const len = rootNode.children.length - 1;
  for (let i = len; i >= 0; i--) {
    const child = rootNode.children[i];
    const duration = child.exitStamp;

    if (duration) {
      // Get the latest time of the last node (with a time) to use as a default
      // This helps to display something on the timeline if the log is malformed
      // e.g does not contain `EXECUTION_STARTED` + `EXECUTION_FINISED`
      endTime ??= duration;
      if (child.type === "EXECUTION_STARTED") {
        endTime = duration;
        break;
      }
    }
  }
  return endTime || 0;
}
