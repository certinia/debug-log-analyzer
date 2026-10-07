/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '@apexdevtools/apex-log-parser';

/**
 * Generates a unique key for grouping events by signature.
 * Includes event type so different entry types (e.g. CODE_UNIT_STARTED vs METHOD_ENTRY)
 * are displayed as separate rows. Field order (type|namespace|text) is the shared
 * canonical bucket-key shape used by aggregated, bottom-up, and analysis views.
 */
export function getEventKey(event: LogEvent): string {
  return `${event.type ?? ''}|${event.namespace}|${event.text}`;
}

/**
 * Generates a key for call-stack tracking to detect recursive calls.
 * Excludes event type so the same method is recognised regardless of entry type
 * (e.g. CODE_UNIT_STARTED at the top level, METHOD_ENTRY for recursive calls).
 */
export function getStackKey(event: LogEvent): string {
  return `${event.namespace}|${event.text}`;
}

/**
 * The bucket keys from `event` out to its outermost frame, innermost first. The
 * log root heads no row in any view, so the walk stops below it.
 */
export function eventKeyChain(event: LogEvent): string[] {
  const keys: string[] = [];
  for (let node: LogEvent | null = event; node?.parent; node = node.parent) {
    keys.push(getEventKey(node));
  }
  return keys;
}

/** Events by signature: type, then namespace, then text, as {@link getEventKey} joins them. */
export type SignatureLookup<V> = Map<string, Map<string, Map<string, V>>>;

/**
 * The map from text to value that holds `event`'s signature, made if missing. A
 * signature found this way builds no key string.
 */
export function signatureSlot<V>(lookup: SignatureLookup<V>, event: LogEvent): Map<string, V> {
  const type = event.type ?? '';
  let byNamespace = lookup.get(type);
  if (!byNamespace) {
    byNamespace = new Map();
    lookup.set(type, byNamespace);
  }
  const namespace = `${event.namespace}`;
  let byText = byNamespace.get(namespace);
  if (!byText) {
    byText = new Map();
    byNamespace.set(namespace, byText);
  }
  return byText;
}
