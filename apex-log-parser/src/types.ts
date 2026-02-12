/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

export type CPUType = 'loading' | 'custom' | 'method' | 'free' | 'system' | 'pkg' | '';

export type IssueType = 'unexpected' | 'error' | 'skip';

export type LineNumber = number | 'EXTERNAL' | null; // an actual line-number or 'EXTERNAL'

/**
 * Original Salesforce debug log categories as defined in SF Setup > Debug Log Levels.
 * These are the categories users configure in the Salesforce UI.
 * See: https://help.salesforce.com/s/articleView?id=platform.code_setting_debug_log_levels.htm
 */
export const DEBUG_CATEGORY = {
  Database: 'Database',
  Workflow: 'Workflow',
  NBA: 'NBA',
  Validation: 'Validation',
  Callout: 'Callout',
  ApexCode: 'Apex Code',
  ApexProfiling: 'Apex Profiling',
  Visualforce: 'Visualforce',
  System: 'System',
} as const;

/** Original Salesforce debug log category (from Debug Log Levels UI). */
export type DebugCategory = (typeof DEBUG_CATEGORY)[keyof typeof DEBUG_CATEGORY] | '';

/**
 * Timeline display categories - our simplified/enhanced view of SF categories.
 * Split Database → DML + SOQL, merge Flow + Workflow → Automation.
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

export type LogCategory = (typeof LOG_CATEGORY)[keyof typeof LOG_CATEGORY] | '';

/** Readonly array of all category values (for building Sets, iterating, etc.) */
export const ALL_LOG_CATEGORIES: readonly LogCategory[] = Object.values(LOG_CATEGORY);

/** @deprecated Use LogCategory instead */
export type LogSubCategory = LogCategory;

export interface Limits {
  soqlQueries: { used: number; limit: number };
  soslQueries: { used: number; limit: number };
  queryRows: { used: number; limit: number };
  dmlStatements: { used: number; limit: number };
  publishImmediateDml: { used: number; limit: number };
  dmlRows: { used: number; limit: number };
  cpuTime: { used: number; limit: number };
  heapSize: { used: number; limit: number };
  callouts: { used: number; limit: number };
  emailInvocations: { used: number; limit: number };
  futureCalls: { used: number; limit: number };
  queueableJobsAddedToQueue: { used: number; limit: number };
  mobileApexPushCalls: { used: number; limit: number };
}

/**
 * A single governor limit usage snapshot at a point in time.
 */
export interface GovernorSnapshot {
  /** Timestamp in nanoseconds when this limit snapshot was recorded. */
  timestamp: number;
  /** Namespace the limits apply to (e.g., 'default', 'MyPackage'). */
  namespace: string;
  /** The limit values at this timestamp. */
  limits: Limits;
}

export interface GovernorLimits extends Limits {
  byNamespace: Map<string, Limits>;
  /** Point-in-time snapshots of governor limit usage, ordered by timestamp ascending. */
  snapshots: GovernorSnapshot[];
}

export interface LogIssue {
  startTime?: number;
  summary: string;
  description: string;
  type: IssueType;
}

export type LogLineConstructor<P, T> = new (parser: P, parts: string[]) => T;

export type LogEventType = (typeof _logEventNames)[number];

export interface SelfTotal {
  self: number;
  total: number;
}

const _logEventNames = [
  'BULK_DML_RETRY',
  'BULK_HEAP_ALLOCATE',
  'CALLOUT_REQUEST',
  'CALLOUT_RESPONSE',
  'NAMED_CREDENTIAL_REQUEST',
  'NAMED_CREDENTIAL_RESPONSE',
  'NAMED_CREDENTIAL_RESPONSE_DETAIL',
  'CONSTRUCTOR_ENTRY',
  'CONSTRUCTOR_EXIT',
  'EMAIL_QUEUE',
  'METHOD_ENTRY',
  'METHOD_EXIT',
  'SYSTEM_CONSTRUCTOR_ENTRY',
  'SYSTEM_CONSTRUCTOR_EXIT',
  'SYSTEM_METHOD_ENTRY',
  'SYSTEM_METHOD_EXIT',
  'CODE_UNIT_STARTED',
  'CODE_UNIT_FINISHED',
  'VF_APEX_CALL_START',
  'VF_APEX_CALL_END',
  'VF_DESERIALIZE_VIEWSTATE_BEGIN',
  'VF_EVALUATE_FORMULA_BEGIN',
  'VF_EVALUATE_FORMULA_END',
  'VF_SERIALIZE_CONTINUATION_STATE_BEGIN',
  'VF_DESERIALIZE_CONTINUATION_STATE_BEGIN',
  'VF_SERIALIZE_VIEWSTATE_BEGIN',
  'VF_PAGE_MESSAGE',
  'DML_BEGIN',
  'DML_END',
  'IDEAS_QUERY_EXECUTE',
  'SOQL_EXECUTE_BEGIN',
  'SOQL_EXECUTE_END',
  'SOQL_EXECUTE_EXPLAIN',
  'SOSL_EXECUTE_BEGIN',
  'SOSL_EXECUTE_END',
  'HEAP_ALLOCATE',
  'HEAP_DEALLOCATE',
  'STATEMENT_EXECUTE',
  'VARIABLE_SCOPE_BEGIN',
  'VARIABLE_ASSIGNMENT',
  'USER_INFO',
  'USER_DEBUG',
  'CUMULATIVE_LIMIT_USAGE',
  'CUMULATIVE_PROFILING',
  'CUMULATIVE_PROFILING_BEGIN',
  'LIMIT_USAGE',
  'LIMIT_USAGE_FOR_NS',
  'NBA_NODE_BEGIN',
  'NBA_NODE_DETAIL',
  'NBA_NODE_END',
  'NBA_NODE_ERROR',
  'NBA_OFFER_INVALID',
  'NBA_STRATEGY_BEGIN',
  'NBA_STRATEGY_END',
  'NBA_STRATEGY_ERROR',
  'POP_TRACE_FLAGS',
  'PUSH_TRACE_FLAGS',
  'QUERY_MORE_BEGIN',
  'QUERY_MORE_END',
  'QUERY_MORE_ITERATIONS',
  'TOTAL_EMAIL_RECIPIENTS_QUEUED',
  'SAVEPOINT_ROLLBACK',
  'SAVEPOINT_SET',
  'STACK_FRAME_VARIABLE_LIST',
  'STATIC_VARIABLE_LIST',
  'SYSTEM_MODE_ENTER',
  'SYSTEM_MODE_EXIT',
  'EXECUTION_STARTED',
  'ENTERING_MANAGED_PKG',
  'EVENT_SERVICE_PUB_BEGIN',
  'EVENT_SERVICE_PUB_END',
  'EVENT_SERVICE_PUB_DETAIL',
  'EVENT_SERVICE_SUB_BEGIN',
  'EVENT_SERVICE_SUB_DETAIL',
  'EVENT_SERVICE_SUB_END',
  'FLOW_START_INTERVIEWS_BEGIN',
  'FLOW_START_INTERVIEWS_ERROR',
  'FLOW_START_INTERVIEW_BEGIN',
  'FLOW_START_INTERVIEW_LIMIT_USAGE',
  'FLOW_START_SCHEDULED_RECORDS',
  'FLOW_CREATE_INTERVIEW_ERROR',
  'FLOW_ELEMENT_BEGIN',
  'FLOW_ELEMENT_DEFERRED',
  'FLOW_ELEMENT_ERROR',
  'FLOW_ELEMENT_FAULT',
  'FLOW_ELEMENT_LIMIT_USAGE',
  'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE',
  'FLOW_SUBFLOW_DETAIL',
  'FLOW_VALUE_ASSIGNMENT',
  'FLOW_WAIT_EVENT_RESUMING_DETAIL',
  'FLOW_WAIT_EVENT_WAITING_DETAIL',
  'FLOW_WAIT_RESUMING_DETAIL',
  'FLOW_WAIT_WAITING_DETAIL',
  'FLOW_INTERVIEW_FINISHED',
  'FLOW_INTERVIEW_PAUSED',
  'FLOW_INTERVIEW_RESUMED',
  'FLOW_ACTIONCALL_DETAIL',
  'FLOW_ASSIGNMENT_DETAIL',
  'FLOW_LOOP_DETAIL',
  'FLOW_RULE_DETAIL',
  'FLOW_BULK_ELEMENT_BEGIN',
  'FLOW_BULK_ELEMENT_DETAIL',
  'FLOW_BULK_ELEMENT_LIMIT_USAGE',
  'FLOW_BULK_ELEMENT_NOT_SUPPORTED',
  'MATCH_ENGINE_BEGIN',
  'ORG_CACHE_PUT_BEGIN',
  'ORG_CACHE_GET_BEGIN',
  'ORG_CACHE_REMOVE_BEGIN',
  'PUSH_NOTIFICATION_INVALID_APP',
  'PUSH_NOTIFICATION_INVALID_CERTIFICATE',
  'PUSH_NOTIFICATION_INVALID_NOTIFICATION',
  'PUSH_NOTIFICATION_NO_DEVICES',
  'PUSH_NOTIFICATION_SENT',
  'SESSION_CACHE_PUT_BEGIN',
  'SESSION_CACHE_GET_BEGIN',
  'SESSION_CACHE_REMOVE_BEGIN',
  'SLA_END',
  'SLA_EVAL_MILESTONE',
  'SLA_PROCESS_CASE',
  'TESTING_LIMITS',
  'VALIDATION_ERROR',
  'VALIDATION_FORMULA',
  'VALIDATION_PASS',
  'VALIDATION_RULE',
  'WF_FLOW_ACTION_ERROR',
  'WF_FLOW_ACTION_ERROR_DETAIL',
  'WF_FIELD_UPDATE',
  'WF_RULE_EVAL_BEGIN',
  'WF_RULE_EVAL_VALUE',
  'WF_RULE_FILTER',
  'WF_CRITERIA_BEGIN',
  'WF_FORMULA',
  'WF_ACTION',
  'WF_ACTIONS_END',
  'WF_ACTION_TASK',
  'WF_APPROVAL',
  'WF_APPROVAL_REMOVE',
  'WF_APPROVAL_SUBMIT',
  'WF_APPROVAL_SUBMITTER',
  'WF_ASSIGN',
  'WF_EMAIL_ALERT',
  'WF_EMAIL_SENT',
  'WF_ENQUEUE_ACTIONS',
  'WF_ESCALATION_ACTION',
  'WF_EVAL_ENTRY_CRITERIA',
  'WF_FLOW_ACTION_DETAIL',
  'WF_NEXT_APPROVER',
  'WF_OUTBOUND_MSG',
  'WF_PROCESS_FOUND',
  'WF_PROCESS_NODE',
  'WF_REASSIGN_RECORD',
  'WF_RESPONSE_NOTIFY',
  'WF_RULE_ENTRY_ORDER',
  'WF_RULE_INVOCATION',
  'WF_SOFT_REJECT',
  'WF_SPOOL_ACTION_BEGIN',
  'WF_TIME_TRIGGER',
  'EXCEPTION_THROWN',
  'FATAL_ERROR',
  'XDS_DETAIL',
  'XDS_RESPONSE',
  'XDS_RESPONSE_DETAIL',
  'XDS_RESPONSE_ERROR',
  'DUPLICATE_DETECTION_BEGIN',
  'DUPLICATE_DETECTION_RULE_INVOCATION',
  'DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS',
  'DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY',
  'BULK_COUNTABLE_STATEMENT_EXECUTE',
  'TEMPLATE_PROCESSING_ERROR',
  'EXTERNAL_SERVICE_REQUEST',
  'FLOW_START_INTERVIEW_END',
  'FLOW_CREATE_INTERVIEW_BEGIN',
  'FLOW_CREATE_INTERVIEW_END',
  'VARIABLE_SCOPE_END',
  'PUSH_NOTIFICATION_NOT_ENABLED',
  'SLA_NULL_START_DATE',
  'TEMPLATE_PROCESSING_ERROR',
  'VALIDATION_FAIL',
  `WF_FLOW_ACTION_BEGIN`,
  'WF_FLOW_ACTION_END',
  'WF_ESCALATION_RULE',
  'WF_HARD_REJECT',
  'WF_NO_PROCESS_FOUND',
  'WF_TIME_TRIGGERS_BEGIN',
  'WF_KNOWLEDGE_ACTION',
  'WF_SEND_ACTION',
  'WAVE_APP_LIFECYCLE',
  'WF_QUICK_CREATE',
  'WF_APEX_ACTION',
  'INVOCABLE_ACTION_DETAIL',
  'INVOCABLE_ACTION_ERROR',
  'FLOW_COLLECTION_PROCESSOR_DETAIL',
  'FLOW_SCHEDULED_PATH_QUEUED',
  'ROUTE_WORK_ACTION',
  'ADD_SKILL_REQUIREMENT_ACTION',
  'ADD_SCREEN_POP_ACTION',
  'CALLOUT_REQUEST_PREPARE',
  'CALLOUT_REQUEST_FINALIZE',
  'FUNCTION_INVOCATION_REQUEST',
  'APP_CONTAINER_INITIATED',
  'FUNCTION_INVOCATION_RESPONSE',
  'XDS_REQUEST_DETAIL',
  'EXTERNAL_SERVICE_RESPONSE',
  'DATAWEAVE_USER_DEBUG',
  'USER_DEBUG_FINER',
  'USER_DEBUG_FINEST',
  'USER_DEBUG_FINE',
  'USER_DEBUG_DEBUG',
  'USER_DEBUG_INFO',
  'USER_DEBUG_WARN',
  'USER_DEBUG_ERROR',
  'VF_APEX_CALL',
  'HEAP_DUMP',
  'SCRIPT_EXECUTION',
  'SESSION_CACHE_MEMORY_USAGE',
  'ORG_CACHE_MEMORY_USAGE',
  'AE_PERSIST_VALIDATION',
  'REFERENCED_OBJECT_LIST',
  'DUPLICATE_RULE_FILTER',
  'DUPLICATE_RULE_FILTER_RESULT',
  'DUPLICATE_RULE_FILTER_VALUE',
  'TEMPLATED_ASSET',
  'TRANSFORMATION_SUMMARY',
  'RULES_EXECUTION_SUMMARY',
  'ASSET_DIFF_SUMMARY',
  'ASSET_DIFF_DETAIL',
  'RULES_EXECUTION_DETAIL',
  'JSON_DIFF_SUMMARY',
  'JSON_DIFF_DETAIL',
  'MATCH_ENGINE_INVOCATION',
  'VF_DESERIALIZE_VIEWSTATE_END',
  'VF_SERIALIZE_VIEWSTATE_END',
  'CUMULATIVE_LIMIT_USAGE_END',
  'CUMULATIVE_PROFILING_END',
  'EXECUTION_FINISHED',
  'FLOW_START_INTERVIEWS_END',
  'FLOW_ELEMENT_END',
  'FLOW_BULK_ELEMENT_END',
  'WF_RULE_EVAL_END',
  'WF_RULE_NOT_EVALUATED',
  'WF_CRITERIA_END',
  'DUPLICATE_DETECTION_END',
  'VF_SERIALIZE_CONTINUATION_STATE_END',
  'VF_DESERIALIZE_CONTINUATION_STATE_END',
  'MATCH_ENGINE_END',
  'ORG_CACHE_PUT_END',
  'ORG_CACHE_GET_END',
  'ORG_CACHE_REMOVE_END',
  'SESSION_CACHE_PUT_END',
  'SESSION_CACHE_GET_END',
  'SESSION_CACHE_REMOVE_END',
] as const;
