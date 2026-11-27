/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type ApexLog, type EventType, eventType } from '@apexdevtools/apex-log-parser';

import { DEFAULT_NAMESPACE } from '../utility/CallerNamespace.js';

/** Frames a composite key tells apart by namespace id, below this many namespaces. */
const NAMESPACE_SLOTS = 4096;
/** One past the largest type id, so a type id fits a composite key. */
const TYPE_SLOTS = 1024;

/**
 * Every event's signature — its type, namespace and text — interned to a small
 * int per log, so grouping by signature compares ints rather than strings.
 *
 * A frame's signature comes from the text and namespace ids of `log.columns`,
 * with no string read. A leaf's text has no id, so a leaf reads its text once.
 * Each event's signature is found on first ask, then held.
 */
export class Signatures {
  private readonly log: ApexLog;
  /** By event id: its signature + 1, so 0 is not yet found. */
  private readonly ofId: Int32Array;
  private readonly byFrame = new Map<number, number>();
  private readonly byText = new Map<string, number>();
  private readonly types: number[] = [];
  private readonly namespaces: string[] = [];
  private readonly texts: string[] = [];
  private readonly keys: (string | undefined)[] = [];
  private readonly stacks: number[] = [];
  private readonly stackIds = new Map<string, number>();

  constructor(log: ApexLog) {
    this.log = log;
    this.ofId = new Int32Array(log.eventCount + 1);
  }

  /** Event `id`'s signature. */
  of(id: number): number {
    const known = this.ofId[id]!;
    if (known) {
      return known - 1;
    }
    const { type, namespace, text } = this.log.columns;
    const typeId = type[id]!;
    const namespaceId = namespace.ids[id]!;
    const textId = text.ids[id]!;
    let signature: number | undefined;
    if (textId >= 0 && namespaceId < NAMESPACE_SLOTS - 1) {
      const composite = (textId * NAMESPACE_SLOTS + namespaceId + 1) * TYPE_SLOTS + typeId;
      signature = this.byFrame.get(composite);
      if (signature === undefined) {
        signature = this.add(typeId, namespace.at(id), text.at(id));
        this.byFrame.set(composite, signature);
      }
    } else {
      const label = text.at(id);
      const composite = `${typeId}|${namespaceId}|${label ?? ''}`;
      signature = this.byText.get(composite);
      if (signature === undefined) {
        signature = this.add(typeId, namespace.at(id), label);
        this.byText.set(composite, signature);
      }
    }
    this.ofId[id] = signature + 1;
    return signature;
  }

  /** The signature's event type. */
  type(signature: number): EventType {
    return eventType(this.types[signature]!)!.type; // every type id came from columns.type
  }

  /** The signature's namespace, {@link DEFAULT_NAMESPACE} where it states none. */
  namespace(signature: number): string {
    return this.namespaces[signature]!;
  }

  /** The signature's text, or its type where the event states none: what a row shows. */
  text(signature: number): string {
    return this.texts[signature]!;
  }

  /**
   * The canonical bucket key, `type|namespace|text`, shared by the aggregated,
   * bottom-up and analysis views. Including the type keeps a code unit and a
   * method of the same name apart.
   */
  key(signature: number): string {
    return (this.keys[signature] ??=
      `${this.type(signature)}|${this.namespaces[signature]}|${this.texts[signature]}`);
  }

  /**
   * The signature without its type, interned: it tells a recursive call from a
   * fresh one, so the same method matches whatever entry type it came in by.
   */
  stackOf(signature: number): number {
    return this.stacks[signature]!;
  }

  private add(typeId: number, namespace: string | null, text: string | null): number {
    const signature = this.types.length;
    const ns = namespace ?? DEFAULT_NAMESPACE;
    const label = text ?? eventType(typeId)!.type; // typeId came from columns.type
    this.types.push(typeId);
    this.namespaces.push(ns);
    this.texts.push(label);
    const stackKey = `${ns}|${label}`;
    let stack = this.stackIds.get(stackKey);
    if (stack === undefined) {
      stack = this.stackIds.size;
      this.stackIds.set(stackKey, stack);
    }
    this.stacks.push(stack);
    return signature;
  }
}

const tables = new WeakMap<ApexLog, Signatures>();

/** The signature table of `log`, shared by every view of it. */
export function signaturesOf(log: ApexLog): Signatures {
  let table = tables.get(log);
  if (!table) {
    table = new Signatures(log);
    tables.set(log, table);
  }
  return table;
}
