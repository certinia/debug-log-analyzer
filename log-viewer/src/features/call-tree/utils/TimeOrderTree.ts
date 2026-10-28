/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { eventType } from '@apexdevtools/apex-log-parser';

import type { LogCategory } from '#core/log/category.js';
import { rowKinds } from '#core/log/eventKind.js';
import { childRows, rowCategory, type LogIndex, NO_ROW } from '#core/log/LogIndex.js';
import { type Signatures, signaturesOf } from '#core/log/signatures.js';
import { namespaceOf } from '#core/utility/CallerNamespace.js';
import type { RowFilter, TreeSource } from '../../../grid/index.js';

/** One shown event in the Time Order view: a row of the log index. */
export interface TimeOrderNode {
  readonly row: number;
}

interface HeldNode extends TimeOrderNode {
  children?: readonly HeldNode[] | null;
}

/**
 * The Time Order rows: one node per shown event, read from the index rows.
 *
 * The grid tells rows apart by object, so a node is made once: a parent's child
 * nodes on the first ask, then held. Nothing is built for a subtree no one opens.
 */
export class TimeOrderSource implements TreeSource<TimeOrderNode> {
  readonly index: LogIndex;
  readonly roots: readonly TimeOrderNode[];
  /** The rows shown with Details off: frames and pinned details. */
  readonly withoutDetails: RowFilter<TimeOrderNode>;
  private readonly signatures: Signatures;
  private readonly types: Uint16Array;

  constructor(index: LogIndex) {
    this.index = index;
    this.signatures = signaturesOf(index.log);
    this.roots = this.nodesUnder(NO_ROW);
    this.types = index.column(index.log.columns.type);
    const kindOf = rowKinds(index);
    // No keepAncestors: a row with children is a frame or a pinned block, and both pass.
    this.withoutDetails = { test: ({ row }) => kindOf(row) !== 'detail' };
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

  // Namespace and type read their columns: the signature reads text, and its first read builds the whole log's.
  /** The node's namespace. */
  readonly namespace = (node: TimeOrderNode): string =>
    namespaceOf(this.index.log, this.index.eventIndex[node.row]!);

  /** The node's event type. */
  readonly type = ({ row }: TimeOrderNode): string => eventType(this.types[row]!)!.type; // every type id came from columns.type

  /** The timeline category of the node's event. */
  readonly category = ({ row }: TimeOrderNode): LogCategory => rowCategory(this.index, row);

  private nodesUnder(row: number): HeldNode[] {
    // `children` declared up front: added later, it costs each node a second property store.
    return childRows(this.index, row).map((child) => ({ row: child, children: undefined }));
  }
}
