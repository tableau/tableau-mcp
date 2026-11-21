import { acceptedContent, CallToolResult, inputRequired } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { UnknownError } from '../../../errors/mcpToolError.js';
import { isAdminToolsEnabled } from '../../../features/adminTools.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RouteSafetyError } from '../../../sdks/routeSafety/core.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { MIN_ADMIN_SITE_ROLE } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { clientSupportsFormElicitation } from '../_lib/elicitation.js';
import {
  ElicitationApprovalEvidence,
  ElicitationApprovalState,
  elicitationApprovalStateSchema,
  RegistryEvidence,
} from '../_lib/evidence.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
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
        'the proposed role change without applying it, returning a single-use confirmation token. ' +
        'When true, applies the role change — but only if the confirmationToken from a prior ' +
        'preview of this same userId and siteRole is supplied.',
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'The single-use confirmation token returned by a prior preview call for this userId and ' +
        'siteRole. Required when confirm is true; ignored otherwise.',
    ),
};

const elicitedConfirmSchema = z.object({
  confirm: z.boolean().describe('Apply this site role change?'),
});

const isElicitationEnabled = (): Promise<boolean> =>
  getFeatureGate().isFeatureEnabled('update-user-elicitation');

export const getUpdateUserTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const updateUserTool = new WebTool({
    server,
    name: 'update-user',
    minRequiredRole: MIN_ADMIN_SITE_ROLE,
    disabled: new Provider(async () => !(await isAdminToolsEnabled(config))),
    description: new Provider(
      async () => `
  Updates the site role of a user on the Tableau site. Primary use case: downgrade inactive users to "Unlicensed" to reclaim licenses.

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` environment variable to be enabled.

  This tool is **two-phase** to protect against accidental role changes:

  1. **Preview (default — \`confirm\` omitted or false):** looks up the user, reports the current and proposed site role, and returns a single-use confirmation token. Nothing is changed.
  2. **Update (\`confirm: true\`):** applies the role change. Requires the \`confirmationToken\` from a prior preview of this same \`userId\` and \`siteRole\` (the server verifies and consumes it).

  The token is server-generated and bound to the previewed \`userId\` and \`siteRole\`: a token minted while previewing role A cannot confirm an update to role B. Present the change to the user and get explicit approval before confirming.
${
  (await isElicitationEnabled())
    ? `
  If the client supports form elicitation, the preview call instead asks the user to approve the change directly and applies it once they accept, so no second call or token is needed.
`
    : ''
}
  **Required human confirmation:** After preview, present the change to the user and get explicit approval before calling again with \`confirm: true\`. Do not auto-confirm.

  **Parameters:**
  - \`userId\` (required) – The LUID of the user to update. Obtain from \`list-users\`.
  - \`siteRole\` (required) – The new site role. Valid values: Creator, Explorer, ExplorerCanPublish, SiteAdministratorCreator, SiteAdministratorExplorer, Viewer, Unlicensed.
  - \`confirm\` (optional) – Set \`true\` to apply the change (requires confirmationToken).
  - \`confirmationToken\` (optional) – The single-use token from the preview. Required when \`confirm\` is true.

  **Response:** Confirmation message with the user's updated site role.

  Tableau REST API scopes: \`tableau:users:update\`, \`tableau:users:read\`.
  `,
    ),
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

              // The retry of an elicited preview carries the signed state and the human's answer.
              // With the flag off, an echoed state is ignored and the call is a plain preview.
              const elicitationEnabled = !args.confirm && (await isElicitationEnabled());
              const approvalState = elicitationEnabled
                ? elicitationApprovalStateSchema.safeParse(extra.requestState()).data
                : undefined;
              const elicit =
                approvalState !== undefined ||
                (elicitationEnabled && clientSupportsFormElicitation(extra));
              let accepted = false;
              if (approvalState !== undefined) {
                accepted =
                  acceptedContent(extra.inputResponses, 'confirm', elicitedConfirmSchema)
                    ?.confirm === true;
                if (!accepted) {
                  return new Ok(
                    `No change made: the user did not approve changing user '${args.userId}' ` +
                      `to ${args.siteRole}.`,
                  );
                }
              }
              const evidence = elicit
                ? new ElicitationApprovalEvidence({ state: approvalState, accepted })
                : new RegistryEvidence();
              const phase = args.confirm || accepted ? 'confirm' : 'preview';

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
                };
              };

              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'update-user',
                action: 'update',
                mode: 'preview-confirm',
                phase,
                evidence,
                resolveTarget,
                confirmationToken: args.confirmationToken,
                binding,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }
              const { target, recordOutcome } = guardResult.value;

              if (phase === 'preview') {
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
                if (evidence instanceof ElicitationApprovalEvidence) {
                  const state: ElicitationApprovalState = {
                    tool: 'update-user',
                    targetId: target.id,
                    binding,
                  };
                  await extra.requestInput(
                    {
                      confirm: inputRequired.elicit({
                        message:
                          `Change user '${target.name ?? args.userId}' ` +
                          `(${user.email ?? 'no email'}) from ${currentRole} to ${args.siteRole}?`,
                        requestedSchema: elicitedConfirmSchema,
                      }),
                    },
                    state,
                  );
                  // Replaced by the input_required result; the client answers and retries.
                  return new Ok("Awaiting the user's approval to change the site role.");
                }
                const nonce = evidence.getEstablishedNonce()!;
                return new Ok(
                  `Preview — user '${target.name ?? args.userId}' (${user.email ?? 'no email'}) ` +
                    `would be changed from ${currentRole} → ${args.siteRole}. ` +
                    'No change has been made. ' +
                    'NEXT STEP — REQUIRED: present this change to the user and ask them to explicitly ' +
                    "confirm it. Do NOT apply without the user's approval. " +
                    `Once approved, call again with confirm: true and confirmationToken: "${nonce}" ` +
                    '(the server will verify and consume this single-use token before applying the update).',
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
                recordOutcome({ ok: false, failureDetail: message });
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
