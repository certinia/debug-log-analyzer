/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { EVENT_TYPES, eventType } from '@apexdevtools/apex-log-parser';

import { categoryOf, FRAME_CATEGORY } from '../category.js';

// Every frame type's category as v0.3 of the parser stated it, so the timeline keeps its colours.
const V03_FRAME_CATEGORIES: Record<string, readonly string[]> = {
  Callout: ['CALLOUT_REQUEST'],
  'Code Unit': ['CODE_UNIT_STARTED'],
  Apex: [
    'CONSTRUCTOR_ENTRY',
    'ENTERING_MANAGED_PKG',
    'EXECUTION_STARTED',
    'FORMULA_EVALUATE_BEGIN',
    'METHOD_ENTRY',
    'ORG_CACHE_GET_BEGIN',
    'ORG_CACHE_PUT_BEGIN',
    'ORG_CACHE_REMOVE_BEGIN',
    'SESSION_CACHE_GET_BEGIN',
    'SESSION_CACHE_PUT_BEGIN',
    'SESSION_CACHE_REMOVE_BEGIN',
    'VF_APEX_CALL_START',
    'VF_DESERIALIZE_CONTINUATION_STATE_BEGIN',
    'VF_SERIALIZE_CONTINUATION_STATE_BEGIN',
  ],
  System: [
    'CUMULATIVE_LIMIT_USAGE',
    'CUMULATIVE_PROFILING_BEGIN',
    'DUPLICATE_DETECTION_BEGIN',
    'MATCH_ENGINE_BEGIN',
    'RLM_CONFIGURATOR_BEGIN',
    'RLM_PRICING_BEGIN',
    'SYSTEM_CONSTRUCTOR_ENTRY',
    'SYSTEM_METHOD_ENTRY',
    'VF_DESERIALIZE_VIEWSTATE_BEGIN',
    'VF_EVALUATE_FORMULA_BEGIN',
    'VF_SERIALIZE_VIEWSTATE_BEGIN',
  ],
  SOQL: ['CURSOR_CREATE_BEGIN', 'QUERY_MORE_BEGIN', 'SOQL_EXECUTE_BEGIN', 'SOSL_EXECUTE_BEGIN'],
  DML: ['DML_BEGIN'],
  Automation: [
    'EVENT_SERVICE_PUB_BEGIN',
    'EVENT_SERVICE_SUB_BEGIN',
    'FLOW_BULK_ELEMENT_BEGIN',
    'FLOW_ELEMENT_BEGIN',
    'FLOW_START_INTERVIEW_BEGIN',
    'FLOW_START_INTERVIEWS_BEGIN',
    'NBA_NODE_BEGIN',
    'NBA_STRATEGY_BEGIN',
    'WF_APPROVAL',
    'WF_APPROVAL_SUBMIT',
    'WF_CRITERIA_BEGIN',
    'WF_EMAIL_ALERT',
    'WF_EMAIL_SENT',
    'WF_EVAL_ENTRY_CRITERIA',
    'WF_FIELD_UPDATE',
    'WF_FORMULA',
    'WF_NEXT_APPROVER',
    'WF_PROCESS_FOUND',
    'WF_PROCESS_NODE',
    'WF_RULE_EVAL_BEGIN',
    'WF_RULE_INVOCATION',
  ],
};

describe('category', () => {
  it('gives every frame type the category v0.3 of the parser gave it', () => {
    const expected = new Map(
      Object.entries(V03_FRAME_CATEGORIES).flatMap(([category, types]) =>
        types.map((type) => [type, category]),
      ),
    );
    const frames = EVENT_TYPES.filter((info) => info.shape === 'frame');
    const actual = new Map(frames.map((info) => [info.type, FRAME_CATEGORY[info.typeId]]));
    expect(actual).toEqual(expected);
  });

  it('gives a leaf no category, whatever its type', () => {
    const soql = eventType('SOQL_EXECUTE_BEGIN').typeId;
    expect(categoryOf(soql, false)).toBe('');
    expect(categoryOf(soql, true)).toBe('SOQL');
  });
});
