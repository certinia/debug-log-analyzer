/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { type ApexLog, DMLBeginLine, type LogEvent, SOQLExecuteBeginLine } from 'apex-log-parser';

export type Stack = LogEvent[];

export class DatabaseAccess {
  private static _instance: DatabaseAccess | null = null;
  private static _treeRoot: ApexLog;

  static async create(rootMethod: ApexLog): Promise<DatabaseAccess> {
    const databaseAccess = new DatabaseAccess();
    this._treeRoot = rootMethod;
    this._instance = databaseAccess;
    return this._instance;
  }

  static instance(): DatabaseAccess | null {
    return DatabaseAccess._instance;
  }

  public getStackByEventIndex(eventIndex: number): Stack {
    const root = DatabaseAccess._treeRoot;
    const event = root?.eventsById[eventIndex];
    if (!event) {
      return [];
    }

    // Walk parent pointers from the event up to (but excluding) the tree root.
    // O(depth) using the parser-assigned eventsById index, vs the previous
    // O(n) full-tree scan. Returns the same top-down stack of parent events.
    const stack: Stack = [];
    let node: LogEvent | null = event;
    while (node && node !== root) {
      if (node.isParent) {
        stack.push(node);
      }
      node = node.parent;
    }
    stack.reverse();
    return stack;
  }

  public getSOQLLines(line: LogEvent = DatabaseAccess._treeRoot): SOQLExecuteBeginLine[] {
    const results: SOQLExecuteBeginLine[] = [];

    const children = line.children;
    const len = children.length;
    for (let i = 0; i < len; ++i) {
      const child = children[i];
      if (child instanceof SOQLExecuteBeginLine) {
        results.push(child);
      }

      if (child?.isParent) {
        Array.prototype.push.apply(results, this.getSOQLLines(child));
      }
    }

    return results;
  }

  public getDMLLines(line: LogEvent = DatabaseAccess._treeRoot): DMLBeginLine[] {
    const results: DMLBeginLine[] = [];

    const children = line.children;
    const len = children.length;
    for (let i = 0; i < len; ++i) {
      const child = children[i];
      if (child instanceof DMLBeginLine) {
        results.push(child);
      }

      if (child?.isParent) {
        // results = results.concat(this.getDMLLines(child));
        Array.prototype.push.apply(results, this.getDMLLines(child));
      }
    }

    return results;
  }
}
