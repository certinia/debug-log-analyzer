/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Uri } from 'vscode';

import { getRuntime, getServicesApi } from './servicesRuntime.js';

/**
 * Thin Promise-returning adapters over the Effect-based salesforcedx-vscode-services
 * API. These isolate Effect to the org/filesystem boundary so the rest of lana can
 * stay plain async/await. Each wrapper runs a short Effect program on the shared
 * ManagedRuntime and resolves/rejects like any Promise.
 */

/**
 * Apex log record from Tooling API (ApexLog sObject).
 * Property names match Salesforce API PascalCase convention.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export interface ApexLogListItem {
  Id: string;
  LogUser: { Name: string };
  Operation: string;
  LogLength: number;
  StartTime: string;
  Status: string;
  DurationMilliseconds: number;
}
/* eslint-enable @typescript-eslint/naming-convention */

/** List the most recent ApexLog records for the current org (Tooling API). */
export function listLogs(limit = 25): Promise<ApexLogListItem[]> {
  const { ApexLogService } = getServicesApi().services;
  return getRuntime().runPromise(ApexLogService.listLogs(limit));
}

/** Fetch the raw body of a single ApexLog by id. */
export function getLogBody(logId: string): Promise<string> {
  const { ApexLogService } = getServicesApi().services;
  return getRuntime().runPromise(ApexLogService.getLogBody(logId));
}

/** Read a file as UTF-8 text (web-safe via vscode.workspace.fs). */
export function readFile(uri: Uri | string): Promise<string> {
  const { FsService } = getServicesApi().services;
  return getRuntime().runPromise(FsService.readFile(uri.toString()));
}

/** Write UTF-8 text to a file, creating parent directories if needed. */
export function writeFile(uri: Uri | string, content: string): Promise<void> {
  const { FsService } = getServicesApi().services;
  return getRuntime().runPromise(FsService.safeWriteFile(uri.toString(), content));
}

/** True if the file or folder exists. */
export function fileOrFolderExists(uri: Uri | string): Promise<boolean> {
  const { FsService } = getServicesApi().services;
  return getRuntime().runPromise(FsService.fileOrFolderExists(uri.toString()));
}

/** Find files matching a glob, honoring the active (desktop or web) filesystem. */
export function findFiles(include: string, maxResults?: number): Promise<Uri[]> {
  const { FsService } = getServicesApi().services;
  return getRuntime().runPromise(FsService.findFiles(include, undefined, maxResults));
}

/** Workspace info that works on desktop and web (uri, path, isEmpty, isVirtualFs). */
export function getWorkspaceInfo() {
  const { WorkspaceService } = getServicesApi().services;
  return getRuntime().runPromise(WorkspaceService.getWorkspaceInfo());
}
