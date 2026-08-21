/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Uri } from 'vscode';

import { getRuntime, getServicesApi } from './servicesRuntime.js';

/* eslint-disable @typescript-eslint/naming-convention -- Salesforce API field names are case-sensitive. */
export interface ApexLogListItem {
  Id: string;
  LogUser?: { Name?: string };
  Operation?: string;
  LogLength: number;
  StartTime: string;
  Status: string;
  DurationMilliseconds?: number;
}
/* eslint-enable @typescript-eslint/naming-convention */

export function listLogs(limit = 25): Promise<ApexLogListItem[]> {
  const { ApexLogService } = getServicesApi().services;
  return getRuntime().runPromise(ApexLogService.listLogs(limit));
}

export function getLogBody(logId: string): Promise<string> {
  const { ApexLogService } = getServicesApi().services;
  return getRuntime().runPromise(ApexLogService.getLogBody(logId));
}

export function readFile(uri: Uri | string): Promise<string> {
  const { FsService } = getServicesApi().services;
  return getRuntime().runPromise(FsService.readFile(uri));
}

export function writeFile(uri: Uri | string, content: string): Promise<void> {
  const { FsService } = getServicesApi().services;
  return getRuntime().runPromise(FsService.safeWriteFile(uri, content));
}

export function fileOrFolderExists(uri: Uri | string): Promise<boolean> {
  const { FsService } = getServicesApi().services;
  return getRuntime().runPromise(FsService.fileOrFolderExists(uri));
}
