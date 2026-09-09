/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import { commands, extensions, window } from 'vscode';

import type { SalesforceVSCodeServicesApi } from '@salesforce/vscode-services';

const SERVICES_EXTENSION_ID = 'salesforce.salesforcedx-vscode-services';
const INSTALL_ACTION = 'Install or Update Salesforce Services';

type Services =
  SalesforceVSCodeServicesApi['services']['prebuiltServicesDependencies'] extends Context.Context<
    infer R
  >
    ? R
    : never;

type ServicesRuntime = ManagedRuntime.ManagedRuntime<Services, never>;

let servicesApi: SalesforceVSCodeServicesApi | undefined;
let runtime: ServicesRuntime | undefined;
let initialization: Promise<void> | undefined;

class SalesforceServicesUnavailableError extends Error {}

export async function initServices(): Promise<void> {
  if (runtime) {
    return;
  }

  initialization ??= initializeServices();
  try {
    await initialization;
  } catch (error: unknown) {
    initialization = undefined;
    throw error;
  }
}

async function initializeServices(): Promise<void> {
  const extension = extensions.getExtension<unknown>(SERVICES_EXTENSION_ID);
  if (!extension) {
    throw new SalesforceServicesUnavailableError(
      'Salesforce Services is required to retrieve Apex logs. Install it from the Salesforce Extension Pack and try again.',
    );
  }

  const api: unknown = extension.isActive ? extension.exports : await extension.activate();
  if (!isSalesforceServicesApi(api)) {
    throw new SalesforceServicesUnavailableError(
      'The installed Salesforce Services extension does not expose the required Apex log API. Update it and try again.',
    );
  }

  const activeRuntime = ManagedRuntime.make(
    Layer.succeedContext(api.services.prebuiltServicesDependencies),
  );
  servicesApi = api;
  runtime = activeRuntime;
}

export async function ensureServicesAvailable(): Promise<boolean> {
  try {
    await initServices();
    return true;
  } catch (error: unknown) {
    if (!(error instanceof SalesforceServicesUnavailableError)) {
      throw error;
    }

    const selection = await window.showErrorMessage(error.message, INSTALL_ACTION);
    if (selection === INSTALL_ACTION) {
      await commands.executeCommand('workbench.extensions.installExtension', SERVICES_EXTENSION_ID);
    }
    return false;
  }
}

export function isSalesforceServicesApi(value: unknown): value is SalesforceVSCodeServicesApi {
  const services = getProperty(value, 'services');
  const dependencies = getProperty(services, 'prebuiltServicesDependencies');
  const apexLogService = getProperty(services, 'ApexLogService');
  const fsService = getProperty(services, 'FsService');
  return (
    isObject(dependencies) &&
    typeof getProperty(apexLogService, 'listLogs') === 'function' &&
    typeof getProperty(apexLogService, 'getLogBody') === 'function' &&
    typeof getProperty(fsService, 'safeWriteFile') === 'function' &&
    typeof getProperty(fsService, 'fileOrFolderExists') === 'function'
  );
}

function getProperty(value: unknown, key: string): unknown {
  return isObject(value) || typeof value === 'function' ? Reflect.get(value, key) : undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

export function getServicesApi(): SalesforceVSCodeServicesApi {
  if (!servicesApi) {
    throw new Error('Salesforce Services is not initialized.');
  }
  return servicesApi;
}

export function getRuntime(): ServicesRuntime {
  if (!runtime) {
    throw new Error('Salesforce Services runtime is not initialized.');
  }
  return runtime;
}

export async function disposeServices(): Promise<void> {
  try {
    await initialization;
  } catch {
    // Failed initialization has no runtime to dispose.
  }
  const activeRuntime = runtime;
  initialization = undefined;
  runtime = undefined;
  servicesApi = undefined;
  await activeRuntime?.dispose();
}
