import { AsyncLocalStorage } from 'node:async_hooks';

import { TableauAuthInfo } from './oauth/schemas.js';

const tableauAuthStorage = new AsyncLocalStorage<TableauAuthInfo | undefined>();

/**
 * Per-HTTP-request Tableau auth (e.g. username from JWT_SUB_CLAIM_HEADER). Lets JWT sign-in use the
 * current request's header even when MCP tools were registered with stale auth from initialize
 * (session mode).
 */
export function runWithTableauAuthInfo<T>(auth: TableauAuthInfo | undefined, fn: () => T): T {
  return tableauAuthStorage.run(auth, fn);
}

export function getTableauAuthInfoFromRequestContext(): TableauAuthInfo | undefined {
  return tableauAuthStorage.getStore();
}
