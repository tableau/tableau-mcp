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

/** Installs the route-safety guards on a Zodios client. Every endpoint of the client inherits them. */
export function installRouteGuards<T extends ZodiosEndpointDefinitions>(
  client: ZodiosInstance<T>,
): void {
  client.use(pathParamGuardPlugin);
  client.axios.interceptors.request.use((c) => {
    assertNoTraversal(c.url ?? '');
    return c;
  });
}
