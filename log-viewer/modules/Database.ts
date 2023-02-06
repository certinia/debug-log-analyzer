/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import {
  DMLBeginLine,
  LogLine,
  Method,
  RootNode,
  SOQLExecuteBeginLine,
} from './parsers/TreeParser';

export class DatabaseEntry {
  readonly count: number;
  readonly rowCount: number;
  readonly stacks: number[];

  constructor(count: number, rowCount: number, stacks: number[]) {
    this.count = count;
    this.rowCount = rowCount;
    this.stacks = stacks;
  }

  expand(count: number, rowCount: number, stackIndex: number): DatabaseEntry {
    return new DatabaseEntry(
      this.count + count,
      this.rowCount + rowCount,
      this.stacks.concat([stackIndex])
    );
  }
}

export type Stack = Method[];
export type DatabaseEntryMap = Map<string, DatabaseEntry>;

export class DatabaseAccess {
  private static _instance: DatabaseAccess | null = null;
  private static _treeRoot: RootNode;

  readonly dmlMap: DatabaseEntryMap = new Map<string, DatabaseEntry>();
  readonly soqlMap: DatabaseEntryMap = new Map<string, DatabaseEntry>();
  readonly stacks: Stack[] = [];

  static async create(rootMethod: RootNode): Promise<DatabaseAccess> {
    const databaseAccess = new DatabaseAccess();
    DatabaseAccess.findDatabaseLines(databaseAccess, rootMethod, []);

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
    line: Method = DatabaseAccess._treeRoot
  ): Stack {
    const children = line.children;
    const len = children.length;
    for (let i = 0; i < len; ++i) {
      const child = children[i];
      if (child instanceof Method) {
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

  public getSOQLLines(line: Method = DatabaseAccess._treeRoot): SOQLExecuteBeginLine[] {
    let results: SOQLExecuteBeginLine[] = [];

    const children = line.children;
    const len = children.length;
    for (let i = 0; i < len; ++i) {
      const child = children[i];
      if (child instanceof SOQLExecuteBeginLine) {
        results.push(child);
      }

      if (child instanceof Method) {
        results = results.concat(this.getSOQLLines(child));
      }
    }

    return results;
  }

  public getDMLLines(line: Method = DatabaseAccess._treeRoot): DMLBeginLine[] {
    let results: DMLBeginLine[] = [];

    const children = line.children;
    const len = children.length;
    for (let i = 0; i < len; ++i) {
      const child = children[i];
      if (child instanceof DMLBeginLine) {
        results.push(child);
      }

      if (child instanceof Method) {
        results = results.concat(this.getDMLLines(child));
      }
    }

    return results;
  }

  private static findDatabaseLines(log: DatabaseAccess, node: Method, stack: Stack) {
    const children = node.children;
    const len = children.length;
    for (let i = 0; i < len; ++i) {
      const child = children[i];
      switch (child.type) {
        case 'DML_BEGIN':
          log.upsert(log.dmlMap, child, stack);
          break;
        case 'SOQL_EXECUTE_BEGIN':
          log.upsert(log.soqlMap, child, stack);
          break;
      }

      if (child instanceof Method) {
        stack.push(child);
        DatabaseAccess.findDatabaseLines(log, child, stack);
        stack.pop();
      }
    }
  }

  private upsert(map: Map<string, DatabaseEntry>, line: LogLine, stack: Stack) {
    const stackIndex = this.internStack(stack);
    const entry = map.get(line.text);
    if (!entry) {
      map.set(line.text, new DatabaseEntry(1, line.rowCount || 0, [stackIndex]));
    } else {
      map.set(line.text, entry.expand(1, line.rowCount || 0, stackIndex));
    }
  }

  private internStack(stack: Stack): number {
    this.stacks.push([...stack].reverse());
    return this.stacks.length - 1;
  }
}
