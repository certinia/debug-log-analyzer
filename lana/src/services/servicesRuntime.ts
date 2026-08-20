/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import { extensions } from 'vscode';

import type { SalesforceVSCodeServicesApi } from '@salesforce/vscode-services';

const SERVICES_EXTENSION_ID = 'salesforce.salesforcedx-vscode-services';

type Services =
  SalesforceVSCodeServicesApi['services']['prebuiltServicesDependencies'] extends Context.Context<
    infer R
  >
    ? R
    : never;

type ServicesRuntime = ManagedRuntime.ManagedRuntime<Services, never>;

let servicesApi: SalesforceVSCodeServicesApi | undefined;
let runtime: ServicesRuntime | undefined;

export async function initServices(): Promise<void> {
  const extension = extensions.getExtension<SalesforceVSCodeServicesApi>(SERVICES_EXTENSION_ID);
  if (!extension) {
    throw new Error(
      `The '${SERVICES_EXTENSION_ID}' extension is required but was not found. Install the Salesforce Extension Pack and try again.`,
    );
  }

  servicesApi = extension.isActive ? extension.exports : await extension.activate();
  runtime = ManagedRuntime.make(
    Layer.succeedContext(servicesApi.services.prebuiltServicesDependencies),
  );
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
  const activeRuntime = runtime;
  runtime = undefined;
  servicesApi = undefined;
  await activeRuntime?.dispose();
}
