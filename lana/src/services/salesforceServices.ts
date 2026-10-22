/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import * as Effect from 'effect/Effect';
import * as SubscriptionRef from 'effect/SubscriptionRef';
import type { Uri } from 'vscode';

import { getRuntime, getServicesApi } from './servicesRuntime.js';

export { disposeServices, ensureServicesAvailable } from './servicesRuntime.js';

/** The previous LogService query set no LIMIT, so it returned a full Tooling API page. */
const MAX_LOG_RECORDS = 2000;

export interface ApexLogListItem {
  Id: string;
  LogUser?: { Name?: string };
  Operation?: string;
  LogLength: number;
  StartTime: string;
  Status: string;
  DurationMilliseconds?: number;
}

export function listLogs(
  signal?: AbortSignal,
  limit = MAX_LOG_RECORDS,
): Promise<ApexLogListItem[]> {
  const { ApexLogService } = getServicesApi().services;
  return getRuntime().runPromise(ApexLogService.listLogs(limit), { signal });
}

export interface TargetOrg {
  orgId?: string;
  username?: string;
  alias?: string;
}

/** The default org Salesforce Services is connected to. Fields are unset until it connects. */
export function getTargetOrg(): Promise<TargetOrg> {
  const { TargetOrgRef } = getServicesApi().services;
  const targetOrgRef: Effect.Effect<SubscriptionRef.SubscriptionRef<TargetOrg>> = TargetOrgRef();
  return getRuntime().runPromise(Effect.flatMap(targetOrgRef, SubscriptionRef.get));
}

export function getLogBody(logId: string): Promise<string> {
  const { ApexLogService } = getServicesApi().services;
  return getRuntime().runPromise(ApexLogService.getLogBody(logId));
}

export function writeFile(uri: Uri | string, content: string): Promise<void> {
  const { FsService } = getServicesApi().services;
  return getRuntime().runPromise(FsService.safeWriteFile(uri, content));
}
