import { CallToolResult } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { UnknownError } from '../../../errors/mcpToolError.js';
import { isAdminToolsEnabled } from '../../../features/adminTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RouteSafetyError } from '../../../sdks/routeSafety/core.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { MIN_ADMIN_SITE_ROLE } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getHttpStatusCode } from '../../../utils/getHttpStatus.js';
import { Provider } from '../../../utils/provider.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
import { SignedConfirmation } from '../_lib/signedConfirmation.js';
import { WebTool } from '../tool.js';

// ServerAdministrator is server-scoped (not assignable via PUT /sites/.../users/...).
// SupportUser is internal/support-only and not a valid assignment target for customers.
const VALID_SITE_ROLES = [
  'Creator',
  'Explorer',
  'ExplorerCanPublish',
  'SiteAdministratorCreator',
  'SiteAdministratorExplorer',
  'Viewer',
  'Unlicensed',
] as const;

const paramsSchema = {
  userId: luidSchema.describe('The LUID of the user to update. Obtain from list-users.'),
  siteRole: z
    .enum(VALID_SITE_ROLES)
    .describe(
      'The new site role to assign. Common values: Creator, Explorer, ExplorerCanPublish, ' +
        'SiteAdministratorCreator, SiteAdministratorExplorer, Viewer, Unlicensed. ' +
        'Use "Unlicensed" to reclaim a license from an inactive user.',
    ),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: looks up the user and reports ' +
        'the proposed role change without applying it, returning a short-lived confirmation token bound to this change. ' +
        'When true, applies the role change — but only if the confirmationToken from a prior ' +
        'preview of this same userId and siteRole is supplied.',
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'The short-lived confirmation token returned by a prior preview call for this userId and ' +
        'siteRole. Required when confirm is true; ignored otherwise.',
    ),
};

export const getUpdateUserTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const updateUserTool = new WebTool({
    server,
    name: 'update-user',
    minRequiredRole: MIN_ADMIN_SITE_ROLE,
    disabled: new Provider(async () => !(await isAdminToolsEnabled(config))),
    description: `
  Updates the site role of a user on the Tableau site. Primary use case: downgrade inactive users to "Unlicensed" to reclaim licenses.

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` environment variable to be enabled.

  This tool is **two-phase** to protect against accidental role changes:

  1. **Preview (default — \`confirm\` omitted or false):** looks up the user, reports the current and proposed site role, and returns a short-lived confirmation token bound to this change. Nothing is changed.
  2. **Update (\`confirm: true\`):** applies the role change. Requires the \`confirmationToken\` from a prior preview of this same \`userId\` and \`siteRole\` (the server verifies it).

  The token is server-signed and bound to the previewed \`userId\`, \`siteRole\` and the user's current role: a token minted while previewing role A cannot confirm role B, and it is rejected if the user's role changed since the preview. Present the change to the user and get explicit approval before confirming.

  **Required human confirmation:** After preview, present the change to the user and get explicit approval before calling again with \`confirm: true\`. Do not auto-confirm.

  **Parameters:**
  - \`userId\` (required) – The LUID of the user to update. Obtain from \`list-users\`.
  - \`siteRole\` (required) – The new site role. Valid values: Creator, Explorer, ExplorerCanPublish, SiteAdministratorCreator, SiteAdministratorExplorer, Viewer, Unlicensed.
  - \`confirm\` (optional) – Set \`true\` to apply the change (requires confirmationToken).
  - \`confirmationToken\` (optional) – The token from the preview. Required when \`confirm\` is true.

  **Response:** Confirmation message with the user's updated site role.

  Tableau REST API scopes: \`tableau:users:update\`, \`tableau:users:read\`.
  `,
    paramsSchema,
    annotations: {
      title: 'Update User',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await updateUserTool.logAndExecute<string>({
        extra,
        args,
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: updateUserTool.requiredApiScopes,
            callback: async (restApi) => {
              const binding = `${args.userId}:${args.siteRole}`;
              // Pre-state comes from resolveTarget().state (the role seen by the guard's lookup).
              const confirmation = new SignedConfirmation({
                tool: 'update-user',
                targetId: args.userId,
                targetKind: 'user',
                binding,
                text: {
                  subject: 'present this change',
                  approvalClause: 'confirm it. Do NOT apply',
                  tail: ' before applying the update).',
                },
              });

              let cachedUser: Awaited<
                ReturnType<typeof restApi.usersMethods.queryUserOnSite>
              > | null = null;

              const resolveTarget = async (): Promise<MutationTarget> => {
                cachedUser = await restApi.usersMethods.queryUserOnSite({
                  siteId: restApi.siteId,
                  userId: args.userId,
                });
                return {
                  id: args.userId,
                  name: cachedUser.name,
                  kind: 'user',
                  // Bind the token to the role seen at preview: a role change in between (by anyone)
                  // invalidates the confirmation. Read from the same lookup, no extra REST call.
                  state: cachedUser.siteRole ?? '',
                };
              };

              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'update-user',
                action: 'update',
                mode: 'preview-confirm',
                phase: args.confirm ? 'confirm' : 'preview',
                evidence: confirmation.evidence,
                resolveTarget,
                confirmationToken: args.confirmationToken,
                binding,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }
              const { target, recordOutcome } = guardResult.value;

              if (!args.confirm) {
                // In production, guardMutation always calls resolveTarget on success, so
                // cachedUser is guaranteed set. Fallback retained for unit tests that mock
                // guardMutation (bypassing resolveTarget).
                const user =
                  cachedUser ??
                  (await restApi.usersMethods.queryUserOnSite({
                    siteId: restApi.siteId,
                    userId: args.userId,
                  }));
                const currentRole = user.siteRole ?? 'unknown';
                return new Ok(
                  `Preview — user '${target.name ?? args.userId}' (${user.email ?? 'no email'}) ` +
                    `would be changed from ${currentRole} → ${args.siteRole}. ` +
                    'No change has been made. ' +
                    confirmation.nextStep(),
                );
              }

              try {
                const updatedUser = await restApi.usersMethods.updateUser({
                  siteId: restApi.siteId,
                  userId: args.userId,
                  siteRole: args.siteRole,
                });
                recordOutcome({ ok: true });
                return new Ok(
                  `User '${target.name ?? args.userId}' has been successfully updated. ` +
                    `New site role: ${updatedUser.siteRole ?? args.siteRole}.`,
                );
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                recordOutcome({
                  ok: false,
                  failureDetail: message,
                  httpStatus: getHttpStatusCode(err),
                });
                // Let the shared tool error path map it to a 400 args-validation error.
                if (err instanceof RouteSafetyError) throw err;
                return new UnknownError(
                  `Failed to update user '${args.userId}': ${message}`,
                ).toErr();
              }
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return updateUserTool;
};
