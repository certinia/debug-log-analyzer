/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import type { LogStore } from '../log/LogStore.js';

/** What an empty/unset namespace normalizes to, here and in every comparison against a namespace. */
export const DEFAULT_NAMESPACE = 'default';

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
