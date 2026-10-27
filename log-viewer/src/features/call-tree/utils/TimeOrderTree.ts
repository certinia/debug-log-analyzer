/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type EventType, eventType } from '@apexdevtools/apex-log-parser';

import type { LogCategory } from '#core/log/category.js';
import { childRows, rowCategory, type LogIndex, NO_ROW } from '#core/log/LogIndex.js';
import { type Signatures, signaturesOf } from '#core/log/signatures.js';
import type { RowFilter, TreeSource } from '../../../grid/index.js';
import { EXCLUDED_DETAIL_TYPES } from './DetailsFilter.js';

/** One shown event in the Time Order view: a row of the log index. */
export interface TimeOrderNode {
  readonly row: number;
}

interface HeldNode extends TimeOrderNode {
  children?: readonly HeldNode[] | null;
}

/** Type ids the Show Details filter keeps whatever their duration. */
const DETAIL_TYPE_IDS: ReadonlySet<number> = new Set(
  [...EXCLUDED_DETAIL_TYPES, 'EXCEPTION_THROWN', 'FATAL_ERROR'].map(
    (type) => eventType(type as EventType).typeId,
  ),
);

/**
 * The Time Order rows: one node per shown event, read from the index rows.
 *
 * The grid tells rows apart by object, so a node is made once: a parent's child
 * nodes on the first ask, then held. Nothing is built for a subtree no one opens.
 */
export class TimeOrderSource implements TreeSource<TimeOrderNode> {
  readonly index: LogIndex;
  readonly roots: readonly TimeOrderNode[];
  /** Show Details: frames, events that took time, exceptions and limit reports. */
  readonly details: RowFilter<TimeOrderNode>;
  private readonly signatures: Signatures;

  constructor(index: LogIndex) {
    this.index = index;
    this.signatures = signaturesOf(index.log);
    this.roots = this.nodesUnder(NO_ROW);
    const { total } = index;
    const isFrame = index.column(index.log.columns.isFrame);
    const types = index.column(index.log.columns.type);
    this.details = {
      test: ({ row }) => isFrame[row] === 1 || total[row]! > 0 || DETAIL_TYPE_IDS.has(types[row]!),
      keepAncestors: true,
    };
  }

  readonly children = (node: TimeOrderNode): readonly TimeOrderNode[] | null => {
    const held = node as HeldNode;
    if (held.children === undefined) {
      held.children =
        this.index.subtreeEnd[node.row]! > node.row + 1 ? this.nodesUnder(node.row) : null;
    }
    return held.children;
  };

  /** The node's event id. */
  readonly key = (node: TimeOrderNode): number => this.index.eventIndex[node.row]!;

  /** The signature id of the node's event. */
  private readonly signatureOf = ({ row }: TimeOrderNode): number =>
    this.signatures.of(this.index.eventIndex[row]!);

  /** The node's text, as its signature names it. */
  readonly text = (node: TimeOrderNode): string => this.signatures.text(this.signatureOf(node));

  /** The node's namespace. */
  readonly namespace = (node: TimeOrderNode): string =>
    this.signatures.namespace(this.signatureOf(node));

  /** The node's event type. */
  readonly type = (node: TimeOrderNode): string => this.signatures.type(this.signatureOf(node));

  /** The timeline category of the node's event. */
  readonly category = ({ row }: TimeOrderNode): LogCategory => rowCategory(this.index, row);

  private nodesUnder(row: number): HeldNode[] {
    return childRows(this.index, row).map((child) => ({ row: child }));
  }
}
