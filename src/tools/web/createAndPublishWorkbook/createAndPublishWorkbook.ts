import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import type { ValidatedPackage } from '../../../dataApps/types.js';
import { McpToolError, PublishWorkbookError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import {
  buildPublishActor,
  checkUnder64Mb,
  emitPublishAudit,
  PublishResult,
  resolveTargetProject,
  toPublishResult,
} from '../_lib/publishShared.js';
import { resolveScopeFromExtra } from '../dataApps/scopeFromExtra.js';
import { WebTool } from '../tool.js';
import { sanitizeFileNameBase } from './buildTwbx.js';

// Publish consumes ONLY an approved validation receipt plus the publish-target options. It never
// accepts HTML/assets/build params: those were consumed by validate-workbook-package, which stored
// the exact validated bytes under an opaque, scoped, expiring `validationId`. projectId is an
// explicit LUID (no projectName) — the resolver only understands an explicit LUID or the site
// default.
const paramsSchema = {
  validationId: z
    .string()
    .describe(
      'The opaque receipt returned by validate-workbook-package. Publication uploads the exact ' +
        'validated bytes stored under this id — it never rebuilds from source.',
    ),
  projectId: z
    .string()
    .optional()
    .describe(
      'LUID of the project to publish into. If omitted, the workbook is published to the ' +
        "site's default project.",
    ),
  showTabs: z
    .boolean()
    .optional()
    .describe('Whether the published workbook shows its sheets as tabs. Defaults to true.'),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      'Overwrite an existing workbook of the same name in the target project. Defaults to false.',
    ),
};

// Success adds the non-fatal builder warnings (preserved from the validation receipt) onto the
// standard publish result, plus the validation/package `digest` for traceability. `appView` is an
// MCP-Apps discriminator: the shared client bundle (handleToolResult) reads only content[0].text
// and has no per-tool dispatch, so this field is how the bundle tells our result apart from the
// always-embed-a-viz path and renders the published-workbook card instead. It is additive and
// harmless to non-app hosts, which simply ignore the extra JSON keys.
type CreateAndPublishResult = PublishResult & {
  warnings: string[];
  validationId: string;
  digest: string;
  appView: 'published-workbook-card';
};

export const getCreateAndPublishWorkbookTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const createAndPublishWorkbookTool = new WebTool({
    server,
    name: 'create-and-publish-workbook',
    description: `
Publishes an **already-validated** workbook package (\`.twbx\`) to the current Tableau site by
consuming a \`validationId\` receipt from \`validate-workbook-package\`. It uploads the exact bytes
that were validated — it never rebuilds from source, so what you validated (and previewed) is
precisely what is published.

Run \`validate-workbook-package\` first to produce the receipt. That step packages the data-app
workspace in memory, checks structure/size/asset-references, and — on success — stores the exact
validated bytes under an opaque, scoped, expiring \`validationId\`. This tool then publishes those
bytes. A missing, expired, or out-of-scope \`validationId\` is rejected before any Tableau REST call.

Publishing content is a consequential action: obtain explicit human confirmation (per the skill
contract) before calling this tool. The validation receipt is server-authoritative evidence that a
preflight actually ran; it does not replace human consent.

**Target:**
- **Default project (default):** omit \`projectId\` to publish into the site's default project.
- **Project:** pass \`projectId\` to publish directly into that project.

**Parameters:**
- \`validationId\` (required) – The receipt from \`validate-workbook-package\`.
- \`projectId\` (optional) – Publish into this project instead of the site default.
- \`showTabs\` (optional) – Show sheets as tabs. Defaults to true.
- \`overwrite\` (optional) – Overwrite an existing workbook of the same name. Defaults to false.

**Result:** on success the result includes a \`url\` field — the canonical link to the published
workbook — plus the package \`digest\` for traceability. When you surface a link to the user, copy
\`url\` **verbatim**: do not rewrite or shorten it, never substitute the host (e.g. a placeholder
like \`your-tableau-server\`), and preserve the \`#/\` routing. If \`url\` is absent, do not invent one —
report the workbook \`name\` and \`id\` instead.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Create and Publish Workbook',
      readOnlyHint: false,
      // Publishing creates content; it overwrites only when overwrite:true is passed.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    // Renders a published-workbook result card in MCP-Apps-capable hosts (gated on the `mcp-apps`
    // feature; degrades to plain JSON otherwise). The XOR union in tool.ts means we set `app` and
    // never `meta`. Do NOT add a `disabled` line here — when the gate is off the tool must still
    // register normally so the non-app publish path keeps working.
    app: getAppConfig('create-and-publish-workbook'),
    callback: async (args, extra): Promise<CallToolResult> => {
      return await createAndPublishWorkbookTool.logAndExecute<CreateAndPublishResult>({
        extra,
        args,
        callback: async () => {
          // Derive the trusted actor scope from server-verified signals only (never a tool arg).
          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          const store = getDataAppWorkspaceStore();

          // Load the immutable validation receipt. A missing / expired / wrong-scope validationId
          // surfaces as a clean not-found error BEFORE any Tableau REST call is made.
          let validation: ValidatedPackage;
          try {
            validation = await store.getValidation(scope.value, args.validationId);
          } catch (error) {
            if (error instanceof McpToolError) {
              return error.toErr();
            }
            throw error;
          }

          const { bytes, digest, appId } = validation;
          const warnings = validation.warnings ?? [];
          const workbookName = validation.workbookName;
          // A receipt with no display name predates the metadata contract and cannot be published
          // deterministically; refuse rather than guess a name.
          if (!workbookName) {
            return new PublishWorkbookError(
              'This validation receipt is missing its workbook name and cannot be published. ' +
                'Re-run validate-workbook-package to produce a current receipt.',
            ).toErr();
          }

          // Backstop the 64 MB single-request limit against the stored bytes. validate-workbook-
          // package already enforced this, but the SDK sets maxBodyLength/maxContentLength to
          // Infinity, so this remains the last guard before upload.
          const sizeError = checkUnder64Mb(bytes.byteLength);
          if (sizeError) {
            return sizeError.toErr();
          }

          const fileContents = Buffer.from(bytes);
          const { projectId, showTabs, overwrite } = args;
          const showTabsFlag = showTabs ?? true;
          const overwriteFlag = overwrite ?? false;
          const actor = buildPublishActor(extra);
          let auditProjectId = projectId;
          let auditOutcome: 'published' | 'failed' = 'failed';
          let failureCode:
            | 'rest-api-setup-failed'
            | 'target-project-query-failed'
            | 'target-project-not-found'
            | 'publish-workbook-failed' = 'rest-api-setup-failed';

          // A valid receipt starts one publish attempt. Emit its terminal audit exactly once from
          // this finally block, including failures before publishWorkbook (authentication/default
          // project resolution). The stage-specific code is fixed and non-sensitive; raw exception
          // messages never enter durable audit data.
          try {
            return await useRestApi({
              ...extra,
              jwtScopes: createAndPublishWorkbookTool.requiredApiScopes,
              callback: async (restApi) => {
                failureCode = 'target-project-query-failed';
                const targetProject = await resolveTargetProject(restApi, projectId);
                if (targetProject.isErr()) {
                  failureCode = 'target-project-not-found';
                  return targetProject;
                }
                const target = targetProject.value;
                auditProjectId = target.id;
                failureCode = 'publish-workbook-failed';

                const published = await restApi.publishingMethods.publishWorkbook({
                  siteId: restApi.siteId,
                  projectId: target.id,
                  name: workbookName,
                  // The .twbx base name becomes an on-disk filename when the server extracts the
                  // package (Windows is the strict case), so it must be filesystem-safe. The display
                  // `name` above stays verbatim. Same sanitizer as the inner .twb in buildTwbx.
                  fileName: `${sanitizeFileNameBase(workbookName)}.twbx`,
                  workbookType: 'twbx',
                  fileContents,
                  showTabs: showTabsFlag,
                  overwrite: overwriteFlag,
                });

                auditOutcome = 'published';
                return new Ok({
                  ...toPublishResult(published, target),
                  warnings,
                  validationId: args.validationId,
                  digest,
                  appView: 'published-workbook-card' as const,
                });
              },
            });
          } finally {
            emitPublishAudit({
              tool: 'create-and-publish-workbook',
              actor,
              appId,
              validationId: args.validationId,
              digest,
              workbookName,
              projectId: auditProjectId,
              showTabs: showTabsFlag,
              overwrite: overwriteFlag,
              outcome: auditOutcome,
              ...(auditOutcome === 'failed' ? { failureCode } : {}),
            });
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return createAndPublishWorkbookTool;
};
