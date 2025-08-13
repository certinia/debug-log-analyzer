/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import {
  type ApexLog,
  DMLBeginLine,
  type LogEvent,
  SOQLExecuteBeginLine,
} from './parsers/LogEvents.js';

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

  public getStack(
    timestamp: number,
    stack: Stack = [],
    line: LogEvent = DatabaseAccess._treeRoot,
  ): Stack {
    const children = line.children;
    const len = children.length;
    for (let i = 0; i < len; ++i) {
      const child = children[i];
      if (child && !child.isDetail) {
        stack.push(child);
        if (child.timestamp === timestamp) {
          return stack;
        }

        const childStack = this.getStack(timestamp, stack, child);
        if (childStack.length > 0) {
          return childStack;
        }
        stack.pop();
      }
    }
    return [];
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

      if (child && !child.isDetail) {
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

      if (child && !child.isDetail) {
        // results = results.concat(this.getDMLLines(child));
        Array.prototype.push.apply(results, this.getDMLLines(child));
      }
    }

    return results;
  }
}
