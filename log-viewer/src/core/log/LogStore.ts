/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  type ApexLog,
  DMLBeginLine,
  type LogEvent,
  SOQLExecuteBeginLine,
  SOSLExecuteBeginLine,
} from 'apex-log-parser';

import { getEventKey, getStackKey } from './eventKeys.js';
import { KeyPathIds } from './keyPathIds.js';

export type Stack = LogEvent[];

/**
 * A parsed log and the lookups every view takes from it.
 *
 * One store per log, so a store is immutable and a new log is a new value —
 * which is what lets a context consumer see the change. The statement lists come
 * from one walk of the whole tree, taken once and kept.
 */
export class LogStore {
  readonly log: ApexLog;

  private _statements: Statements | null = null;
  private _keyPathIds: KeyPathIds | null = null;
  private _keyIds: Int32Array | null = null;
  private _stackIds: Int32Array | null = null;

  constructor(log: ApexLog) {
    this.log = log;
  }

  /** The parser event for an eventIndex, or null if the log has no such event. */
  eventByIndex(eventIndex: number): LogEvent | null {
    return this.log.eventsById[eventIndex] ?? null;
  }

  /**
   * The parent frames from the log's root down to `eventIndex`, the event itself
   * last. Empty if the log has no such event.
   */
  stackByEventIndex(eventIndex: number): Stack {
    // O(depth) up the parent pointers, rather than a scan of the whole tree.
    const stack: Stack = [];
    let node: LogEvent | null = this.eventByIndex(eventIndex);
    while (node && node !== this.log) {
      if (node.isParent) {
        stack.push(node);
      }
      node = node.parent;
    }
    return stack.reverse();
  }

  /** Every SOQL statement in the log, in log order. */
  soqlLines(): SOQLExecuteBeginLine[] {
    return this.statements().soql;
  }

  /** Every DML statement in the log, in log order. */
  dmlLines(): DMLBeginLine[] {
    return this.statements().dml;
  }

  /** Every SOSL statement in the log, in log order. */
  soslLines(): SOSLExecuteBeginLine[] {
    return this.statements().sosl;
  }

  /** The interned bucket paths of this log, shared by every view that marks a row
   *  whose occurrences are merged. */
  keyPathIds(): KeyPathIds {
    return (this._keyPathIds ??= new KeyPathIds());
  }

  /**
   * The event's interned bucket key, kept per event.
   *
   * A mark walks the caller chain of every occurrence a pick names, and those
   * occurrences share their ancestors, so building the key string per frame was
   * most of what a mark cost.
   */
  keyIdOf(event: LogEvent): number {
    const cache = (this._keyIds ??= idCache(this.log));
    const at = event.eventIndex;
    if (at >= 0 && at < cache.length) {
      let id = cache[at]!;
      if (id < 0) {
        id = this.keyPathIds().keyId(getEventKey(event));
        cache[at] = id;
      }
      return id;
    }
    // An event the log's own index does not cover, so there is no slot to keep.
    return this.keyPathIds().keyId(getEventKey(event));
  }

  /**
   * The event's interned stack key, which tells a recursive call from a fresh
   * one. Interned in the same table as {@link keyIdOf}, since the two vocabularies
   * are never compared with each other.
   */
  stackIdOf(event: LogEvent): number {
    const cache = (this._stackIds ??= idCache(this.log));
    const at = event.eventIndex;
    if (at >= 0 && at < cache.length) {
      let id = cache[at]!;
      if (id < 0) {
        id = this.keyPathIds().keyId(getStackKey(event));
        cache[at] = id;
      }
      return id;
    }
    // An event the log's own index does not cover, so there is no slot to keep.
    return this.keyPathIds().keyId(getStackKey(event));
  }

  private statements(): Statements {
    return (this._statements ??= collectStatements(this.log));
  }
}

/** One slot per event, -1 until the event is asked about. */
function idCache(log: ApexLog): Int32Array {
  return new Int32Array(log.eventsById.length).fill(-1);
}

interface Statements {
  soql: SOQLExecuteBeginLine[];
  dml: DMLBeginLine[];
  sosl: SOSLExecuteBeginLine[];
}

/** The three statement kinds below `root`, in log order, from one walk. */
function collectStatements(root: LogEvent): Statements {
  const found: Statements = { soql: [], dml: [], sosl: [] };
  const walk = (event: LogEvent): void => {
    for (const child of event.children) {
      if (child instanceof SOQLExecuteBeginLine) {
        found.soql.push(child);
      } else if (child instanceof DMLBeginLine) {
        found.dml.push(child);
      } else if (child instanceof SOSLExecuteBeginLine) {
        found.sosl.push(child);
      }
      if (child.isParent) {
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}

const stores = new WeakMap<ApexLog, LogStore>();

/** The store for a parsed log — the same store every time, so the walks it keeps
 *  are shared however the log is reached. */
export function logStoreFor(log: ApexLog): LogStore {
  let store = stores.get(log);
  if (!store) {
    store = new LogStore(log);
    stores.set(log, store);
  }
  return store;
}

let current: LogStore | null = null;

/** Makes `log` the log on screen. Returns its store, to provide to the views. */
export function setCurrentLog(log: ApexLog): LogStore {
  current = logStoreFor(log);
  return current;
}

/**
 * The store for the log on screen, or null before the first parse.
 *
 * For code a component cannot hand a store to. A component takes its store from
 * the log context instead, so it re-renders when the log changes.
 */
export function currentLogStore(): LogStore | null {
  return current;
}
