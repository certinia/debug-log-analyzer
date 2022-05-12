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

function isMatchingEnd(method: LogLine, endLine: LogLine) {
  return (
    method.exitTypes &&
    method.exitTypes.includes(endLine.type) &&
    (!endLine.lineNumber || !method.lineNumber || endLine.lineNumber === method.lineNumber)
  );
}

function endMethod(method: LogLine, endLine: LogLine, lineIter: LineIterator, stack: LogLine[]) {
  method.exitStamp = endLine.timestamp;
  if (method.onEnd) {
    // the method wants to see the exit line
    method.onEnd(endLine, stack);
  }

  // is this a 'good' end line?
  if (isMatchingEnd(method, endLine)) {
    discontinuity = false; // end stack unwinding
    lineIter.fetch(); // consume the line
    return true; // success
  } else if (discontinuity) {
    return true; // exception - unwind
  } else {
    if (stack.some((m) => isMatchingEnd(m, endLine))) {
      return true; // we match a method further down the stack - unwind
    }
    // we found an exit event on its own e.g a `METHOD_EXIT` with an entry
    truncateLog(endLine.timestamp, "Unexpected-Exit", "unexpected");
    return false; // we have no matching method - ignore
  }
}

function getMethod(lineIter: LineIterator, method: LogLine, stack: LogLine[]) {
  lastTimestamp = method.timestamp;

  if (method.exitTypes) {
    const children = [];
    let lines: LogLine[] = [],
      line;

    stack.push(method);

    while ((line = lineIter.peek())) {
      // eslint-disable-line no-cond-assign
      if (line.discontinuity) {
        // discontinuities are stack unwinding (caused by Exceptions)
        discontinuity = true; // start unwinding stack
      }

      if (line.isExit && endMethod(method, line, lineIter, stack)) {
        break;
      }

      lineIter.fetch(); // it's a child - consume the line
      lastTimestamp = line.timestamp;
      if (line.isValid && (line.exitTypes || line.displayType === "method")) {
        method.addBlock(lines);
        lines = [];
        children.push(getMethod(lineIter, line, stack));
      } else {
        lines.push(line);
      }
    }

    if (line == null) {
      // truncated method - terminate at the end of the log
      method.exitStamp = lastTimestamp;
      method.duration = lastTimestamp - method.timestamp;

      // we found an entry event on its own e.g a `METHOD_ENTRY` without an exit )
      truncateLog(lastTimestamp, "Unexpected-End", "unexpected");
    }

    if (lines.length) {
      method.addBlock(lines);
    }

    stack.pop();
    method.children = children;
  }

  recalculateDurations(method);

  return method;
}

export function getRootMethod(): RootNode {
  const lineIter = new LineIterator(logLines),
    rootMethod = new RootNode([]),
    stack: LogLine[] = [];
  let lines: LogLine[] = [],
    line;

  while ((line = lineIter.fetch())) {
    // eslint-disable-line no-cond-assign
    if (line.exitTypes) {
      rootMethod.addBlock(lines);
      lines = [];
      rootMethod.addChild(getMethod(lineIter, line, stack));
    } else {
      lines.push(line);
    }
  }
  rootMethod.addBlock(lines);
  rootMethod.exitStamp = getEndTime(rootMethod);
  return rootMethod;
}

function getEndTime(rootNode: RootNode) {
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
