/**
 * Derives a trusted {@link WorkspaceScope} for a data-app tool call from server-verified request
 * signals only (`extra`). Every data-app tool must call this instead of trusting any scope-shaped
 * value a caller could supply as a tool argument — `resolveWorkspaceScope` (Task 2) is the single
 * source of truth for the actor-scoping policy; this module only extracts its inputs from `extra`.
 */

import { Result } from 'ts-results-es';

import type { WorkspaceScope } from '../../../dataApps/types.js';
import { resolveWorkspaceScope } from '../../../dataApps/workspaceScope.js';
import { DataAppWorkspaceAccessDeniedError } from '../../../errors/mcpToolError.js';
import type { TableauWebRequestHandlerExtra } from '../toolContext.js';

export function resolveScopeFromExtra(
  extra: TableauWebRequestHandlerExtra,
): Result<WorkspaceScope, DataAppWorkspaceAccessDeniedError> {
  return resolveWorkspaceScope({
    transport: extra.config.transport,
    // Prefer the per-request authenticated server origin (set by the auth middleware that
    // validated this call) over the process-wide config default, which can be blank in
    // multi-tenant OAuth deployments.
    server: extra.tableauAuthInfo?.server || extra.config.server,
    siteId: extra.tableauAuthInfo?.siteId,
    userId: extra.tableauAuthInfo?.userId,
    sessionId: extra.sessionId,
  });
}
