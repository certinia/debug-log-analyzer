/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import formatDuration, { recalculateDurations } from "../Util.js";
import { logLines, LogLine, BlockLines, truncateLog } from "./LineParser.js";

let lastTimestamp: number | null = null,
  discontinuity = false;

class LineIterator {
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
        endMethod(method, line, lineIter);
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

  return rootMethod;
}

