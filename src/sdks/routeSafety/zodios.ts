/**
 * Zodios / axios wiring for the route-safety guards.
 *
 * `installRouteGuards` applies two independent layers to a client:
 *  - a Zodios plugin that rejects any unsafe path-parameter value before URL interpolation,
 *  - an axios request interceptor that rejects any final URL that is not a safe path under the
 *    client's base URL (see `assertSafeRequestUrl`). This also covers raw `client.axios` calls.
 *
 * Construct every Zodios client with `createGuardedZodios` (ESLint bans a bare `new Zodios(`).
 */
import {
  Zodios,
  ZodiosEndpointDefinitions,
  ZodiosInstance,
  ZodiosOptions,
  ZodiosPlugin,
} from '@zodios/core';

import { assertSafePathSegment, assertSafeRequestUrl } from './core.js';

export const pathParamGuardPlugin: ZodiosPlugin = {
  name: 'path-param-guard',
  request: async (_api, config) => {
    for (const [k, v] of Object.entries(config.params ?? {})) {
      assertSafePathSegment(k, v);
    }
    return config;
  },
};

// Clients whose axios instance already carries the URL interceptor. `createGuardedZodios` installs
// the guards and the `Methods` base constructor installs them again as a backstop for clients built
// elsewhere (e.g. test doubles). Re-registering the plugin is harmless (`ZodiosPlugins.use` replaces
// a plugin with the same name), but axios would stack a duplicate interceptor.
const guardedClients = new WeakSet<object>();

/**
 * Installs the route-safety guards on a Zodios client. Every endpoint of the client, and every raw
 * request made through `client.axios`, inherits them. Repeated calls for the same client are no-ops.
 */
export function installRouteGuards<T extends ZodiosEndpointDefinitions>(
  client: ZodiosInstance<T>,
): void {
  if (guardedClients.has(client)) return;
  guardedClients.add(client);
  client.use(pathParamGuardPlugin);
  client.axios.interceptors.request.use((c) => {
    assertSafeRequestUrl(c.url, c.baseURL);
    return c;
  });
}

type ZodiosApiArg<Api extends ZodiosEndpointDefinitions> = ConstructorParameters<
  typeof Zodios<Api>
>[1];

/** The only sanctioned way to construct a Zodios client: `new Zodios(...)` plus the route guards. */
export function createGuardedZodios<Api extends ZodiosEndpointDefinitions>(
  baseUrl: string,
  api: ZodiosApiArg<Api>,
  options?: ZodiosOptions,
): ZodiosInstance<Api> {
  // eslint-disable-next-line no-restricted-syntax -- the one sanctioned construction site
  const client = new Zodios<Api>(baseUrl, api, options);
  installRouteGuards(client);
  return client;
}
