/**
 * Zodios / axios wiring for the route-safety guards.
 *
 * `installRouteGuards` applies two independent layers to a client:
 *  - a Zodios plugin that rejects any unsafe path-parameter value before URL interpolation,
 *  - an axios request interceptor that rejects any final URL containing traversal segments.
 */
import { ZodiosEndpointDefinitions, ZodiosInstance, ZodiosPlugin } from '@zodios/core';

import { assertNoTraversal, assertSafePathSegment } from './core.js';

export const pathParamGuardPlugin: ZodiosPlugin = {
  name: 'path-param-guard',
  request: async (_api, config) => {
    for (const [k, v] of Object.entries(config.params ?? {})) {
      assertSafePathSegment(k, v);
    }
    return config;
  },
};

// Clients that already carry the guards. Idempotency matters because the guards are installed from
// the `Methods` constructor: a client shared by several `*Methods` instances (or a subclass that
// re-runs construction) would otherwise stack duplicate plugins and interceptors.
const guardedClients = new WeakSet<object>();

/**
 * Installs the route-safety guards on a Zodios client. Every endpoint of the client inherits them.
 * Idempotent: repeated calls for the same client are no-ops.
 */
export function installRouteGuards<T extends ZodiosEndpointDefinitions>(
  client: ZodiosInstance<T>,
): void {
  if (guardedClients.has(client)) return;
  guardedClients.add(client);
  client.use(pathParamGuardPlugin);
  client.axios.interceptors.request.use((c) => {
    assertNoTraversal(c.url ?? '');
    return c;
  });
}
