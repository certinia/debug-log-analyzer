/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type * as Context from 'effect/Context';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import { extensions } from 'vscode';

// Type-only import: the salesforcedx-vscode-services extension is resolved at
// runtime via the VS Code extensions API (see extensionDependencies in
// package.json). We only need its API shape at compile time, so nothing from
// this package is bundled into lana.
import type { SalesforceVSCodeServicesApi } from '@salesforce/vscode-services';

const SERVICES_EXT_ID = 'salesforce.salesforcedx-vscode-services';

/** The set of services provided by `prebuiltServicesDependencies`. */
type Services =
  SalesforceVSCodeServicesApi['services']['prebuiltServicesDependencies'] extends Context.Context<
    infer R
  >
    ? R
    : never;

type ServicesRuntime = ManagedRuntime.ManagedRuntime<Services, never>;

// Module-level singletons; set once during activation.
let servicesApi: SalesforceVSCodeServicesApi | undefined;
// Lazy singleton runtime built from the services context.
let runtime: ServicesRuntime | undefined;

/**
 * Resolve (activating if needed) the salesforcedx-vscode-services extension API
 * and build a ManagedRuntime that provides all of its prebuilt services. Must
 * be awaited during extension activation before any service wrapper is used.
 */
export async function initServices(): Promise<void> {
  const ext = extensions.getExtension<SalesforceVSCodeServicesApi>(SERVICES_EXT_ID);
  if (!ext) {
    throw new Error(
      `The '${SERVICES_EXT_ID}' extension is required but was not found. It is declared as an extension dependency and should be installed automatically.`,
    );
  }

  servicesApi = ext.isActive ? ext.exports : await ext.activate();
  runtime = ManagedRuntime.make(
    Layer.succeedContext(servicesApi.services.prebuiltServicesDependencies),
  );
}

/** The resolved services API. Throws if `initServices()` has not completed. */
export function getServicesApi(): SalesforceVSCodeServicesApi {
  if (!servicesApi) {
    throw new Error(
      'salesforcedx-vscode-services API not initialized. Call initServices() during activation.',
    );
  }
  return servicesApi;
}

/** The ManagedRuntime that provides the prebuilt services. Throws if uninitialized. */
export function getRuntime(): ServicesRuntime {
  if (!runtime) {
    throw new Error('Services runtime not initialized. Call initServices() during activation.');
  }
  return runtime;
}

/** Tear down the runtime on extension deactivation. */
export async function disposeServices(): Promise<void> {
  const rt = runtime;
  runtime = undefined;
  servicesApi = undefined;
  if (rt) {
    await rt.dispose();
  }
}
