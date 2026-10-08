/** Public API of the REST route-safety module. */
export {
  assertNoTraversal,
  assertSafePathSegment,
  buildRestPath,
  fullyDecode,
  RouteSafetyError,
} from './core.js';
export {
  type IdKind,
  idSchema,
  isRouteSafeSchema,
  luidPathParam,
  luidSchema,
  pathParam,
} from './ids.js';
export { installRouteGuards, pathParamGuardPlugin } from './zodios.js';
