import { CeppSdkEventsModule, CeppSdkRootModule } from './sdkTypes.js';

// Non-literal specifiers, so TypeScript doesn't try to resolve a package that isn't a dependency
// of this public repo and esbuild leaves the import() for runtime.
const CEPP_SDK_ROOT_MODULE = '@tableau/activitylog-logging-client-ts';
const CEPP_SDK_EVENTS_MODULE = '@tableau/activitylog-logging-client-ts/events';

export type CeppSdk = {
  root: CeppSdkRootModule;
  events: CeppSdkEventsModule;
};

/**
 * Returns `null` when the SDK isn't installed: it ships only to Salesforce's internal registry,
 * so external installs and public CI never have it.
 */
export async function loadCeppSdk(): Promise<CeppSdk | null> {
  try {
    const [root, events] = await Promise.all([
      import(CEPP_SDK_ROOT_MODULE) as Promise<CeppSdkRootModule>,
      import(CEPP_SDK_EVENTS_MODULE) as Promise<CeppSdkEventsModule>,
    ]);
    return { root, events };
  } catch {
    return null;
  }
}
