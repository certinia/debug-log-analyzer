/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type ApexLog, DEFAULT_NAMESPACE } from '@apexdevtools/apex-log-parser';

import { type LogIndex, NO_ROW } from '../log/LogIndex.js';
import type { LogStore } from '../log/LogStore.js';

// Re-exported so timeline/optimised, which must not import the parser, shares the parser's value.
export { DEFAULT_NAMESPACE };

/** Event `id`'s namespace, {@link DEFAULT_NAMESPACE} where it states none. */
export function namespaceOf(log: ApexLog, id: number): string {
  return log.columns.namespace.at(id) ?? DEFAULT_NAMESPACE;
}

/**
 * The namespace of event `id`'s direct caller: the shown frame above it.
 *
 * No skip past platform or glue frames: a caller behind one resolves to
 * 'default', matching "who literally invoked this?" semantics.
 */
export function getCallerNamespace(store: LogStore, id: number): string {
  const parent = store.parentOf(id);
  return parent > 0 ? namespaceOf(store.log, parent) : DEFAULT_NAMESPACE;
}

/** {@link getCallerNamespace} for a row: the namespace of the shown frame above it. */
export function callerNamespaceOfRow(index: LogIndex, row: number): string {
  const above = index.parent[row]!;
  return above === NO_ROW ? DEFAULT_NAMESPACE : namespaceOf(index.log, index.eventId[above]!);
}
