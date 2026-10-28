/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  type ApexEvent,
  EVENT_TYPES,
  eventType,
  type EventTypeInfo,
  type Kind,
} from '@apexdevtools/apex-log-parser';

/**
 * The timeline's categories: Salesforce's own, with Database split into DML and
 * SOQL and Flow merged with Workflow into Automation.
 */
export const LOG_CATEGORY = {
  Apex: 'Apex',
  System: 'System',
  CodeUnit: 'Code Unit',
  Automation: 'Automation',
  DML: 'DML',
  SOQL: 'SOQL',
  Validation: 'Validation',
  Callout: 'Callout',
} as const;

/** A frame's timeline category; '' for a leaf, which has none. */
export type LogCategory = (typeof LOG_CATEGORY)[keyof typeof LOG_CATEGORY] | '';

const BY_KIND: Partial<Record<Kind, LogCategory>> = {
  'code-unit': LOG_CATEGORY.CodeUnit,
  execution: LOG_CATEGORY.Apex,
  package: LOG_CATEGORY.Apex,
  cache: LOG_CATEGORY.Apex,
  soql: LOG_CATEGORY.SOQL,
  sosl: LOG_CATEGORY.SOQL,
  dml: LOG_CATEGORY.DML,
  callout: LOG_CATEGORY.Callout,
  flow: LOG_CATEGORY.Automation,
  workflow: LOG_CATEGORY.Automation,
  nba: LOG_CATEGORY.Automation,
};

// The frames v0.3 of the parser put in Apex against their kind; kept so the timeline reads the same.
const APEX_FRAMES = new Set([
  'FORMULA_EVALUATE_BEGIN',
  'VF_SERIALIZE_CONTINUATION_STATE_BEGIN',
  'VF_DESERIALIZE_CONTINUATION_STATE_BEGIN',
]);

function frameCategory(info: EventTypeInfo): LogCategory {
  if (info.kind === 'method') {
    return info.debugCategory === 'system' ? LOG_CATEGORY.System : LOG_CATEGORY.Apex;
  }
  if (APEX_FRAMES.has(info.type)) {
    return LOG_CATEGORY.Apex;
  }
  return BY_KIND[info.kind] ?? LOG_CATEGORY.System;
}

/** Each type's category when it opens a frame, by type id, as `columns.type` holds it. */
export const FRAME_CATEGORY: readonly LogCategory[] = EVENT_TYPES.map(frameCategory);

/** `event`'s category: '' unless it is a frame. */
export function eventCategory(event: ApexEvent): LogCategory {
  return event.isFrame ? (FRAME_CATEGORY[eventType(event.type)?.typeId ?? -1] ?? '') : '';
}
