/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  type ApexEvent,
  type DebugCategory,
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

/** An event's timeline category; '' only for a type the parser does not know. */
export type LogCategory = (typeof LOG_CATEGORY)[keyof typeof LOG_CATEGORY] | '';

// Where one debug category holds more than one of ours, as Database holds SOQL and DML.
const BY_KIND: Partial<Record<Kind, LogCategory>> = {
  'code-unit': LOG_CATEGORY.CodeUnit,
  soql: LOG_CATEGORY.SOQL,
  sosl: LOG_CATEGORY.SOQL,
  dml: LOG_CATEGORY.DML,
};

const BY_DEBUG_CATEGORY: Partial<Record<DebugCategory, LogCategory>> = {
  apexCode: LOG_CATEGORY.Apex,
  database: LOG_CATEGORY.DML,
  workflow: LOG_CATEGORY.Automation,
  nba: LOG_CATEGORY.Automation,
  callout: LOG_CATEGORY.Callout,
  validation: LOG_CATEGORY.Validation,
};

function typeCategory(info: EventTypeInfo): LogCategory {
  // An Apex call, such as a VF_APEX_CALL_START logged under Visualforce.
  if (info.kind === 'method') {
    return info.debugCategory === 'system' ? LOG_CATEGORY.System : LOG_CATEGORY.Apex;
  }
  return BY_KIND[info.kind] ?? BY_DEBUG_CATEGORY[info.debugCategory] ?? LOG_CATEGORY.System;
}

/** Each type's category, by type id, as `columns.type` holds it. */
export const TYPE_CATEGORY: readonly LogCategory[] = EVENT_TYPES.map(typeCategory);

/** `event`'s category, by its type. */
export function eventCategory(event: ApexEvent): LogCategory {
  return TYPE_CATEGORY[eventType(event.type)?.typeId ?? -1] ?? '';
}
