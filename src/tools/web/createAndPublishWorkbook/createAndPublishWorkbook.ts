import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BuildTwbxError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import {
  checkUnder64Mb,
  PublishResult,
  resolveTargetProject,
  toPublishResult,
} from '../_lib/publishShared.js';
import { WebTool } from '../tool.js';
import { buildParamsSchema, buildParamsToInput } from './buildParams.js';
import { buildTwbx, sanitizeFileNameBase } from './buildTwbx.js';

// The build inputs plus the publish-target inputs. projectId is an explicit LUID (no projectName) —
// the resolver only understands an explicit LUID or the site default.
const paramsSchema = {
  ...buildParamsSchema,
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

// Success adds the non-fatal builder warnings onto the standard publish result so the agent can
// surface e.g. "that .parquet asset may 404 when fetched" without the publish having failed.
// `appView` is an MCP-Apps discriminator: the shared client bundle (handleToolResult) reads only
// content[0].text and has no per-tool dispatch, so this field is how the bundle tells our result
// apart from the always-embed-a-viz path and renders the published-workbook card instead. It is
// additive and harmless to non-app hosts, which simply ignore the extra JSON key.
type CreateAndPublishResult = PublishResult & {
  warnings: string[];
  appView: 'published-workbook-card';
};

export const getCreateAndPublishWorkbookTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const createAndPublishWorkbookTool = new WebTool({
    server,
    name: 'create-and-publish-workbook',
    description: `
Builds a Tableau workbook package (\`.twbx\`) from HTML/JS content **in memory** and publishes it to
the current Tableau site in a single call — nothing is written to disk.

This is the hosted-safe path: use it when the build and publish must happen together (for example a
cloud/browser Claude session offering to "publish this to Tableau?"). The package embeds the HTML as
a workspace-extension so the published workbook renders your content.

**Target:**
- **Default project (default):** omit \`projectId\` to publish into the site's default project.
- **Project:** pass \`projectId\` to publish directly into that project.

**Parameters:**
- \`packageId\` (required) – Reverse-domain extension id; also the package folder name.
- \`workbookName\` (required) – Published workbook name and \`.twb\` base name.
- \`html\` (required) – The extension entrypoint (index.html).
- \`assets\` (optional) – Extra content files as base64.
- \`toolbarLabel\` (optional) – Toolbar button label.
- \`projectId\` (optional) – Publish into this project instead of the site default.
- \`showTabs\` (optional) – Show sheets as tabs. Defaults to true.
- \`overwrite\` (optional) – Overwrite an existing workbook of the same name. Defaults to false.

The built package must be under 64 MB (the single-request publish limit).

**Result:** on success the result includes a \`url\` field — the canonical link to the published
workbook. When you surface a link to the user, copy \`url\` **verbatim**: do not rewrite or shorten
it, never substitute the host (e.g. a placeholder like \`your-tableau-server\`), and preserve the
\`#/\` routing. If \`url\` is absent, do not invent one — report the workbook \`name\` and \`id\` instead.
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
          // Build in memory. buildTwbx throws BuildTwbxError on bad input; convert to a returned Err
          // so it renders as a clean 400 instead of the generic catch's noisier stack line.
          let bytes: Uint8Array;
          let warnings: string[];
          try {
            const built = buildTwbx(buildParamsToInput(args));
            bytes = built.bytes;
            warnings = built.warnings;
          } catch (error) {
            if (error instanceof BuildTwbxError) {
              return error.toErr();
            }
            throw error;
          }

          // The SDK sets maxBodyLength/maxContentLength to Infinity, so this in-memory guard is the
          // only 64 MB backstop on the built buffer.
          const sizeError = checkUnder64Mb(bytes.byteLength);
          if (sizeError) {
            return sizeError.toErr();
          }

          const fileContents = Buffer.from(bytes);
          const { workbookName, projectId, showTabs, overwrite } = args;

          return await useRestApi({
            ...extra,
            jwtScopes: createAndPublishWorkbookTool.requiredApiScopes,
            callback: async (restApi) => {
              const targetProject = await resolveTargetProject(restApi, projectId);
              if (targetProject.isErr()) {
                return targetProject;
              }
              const target = targetProject.value;

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
                showTabs: showTabs ?? true,
                overwrite: overwrite ?? false,
              });

              return new Ok({
                ...toPublishResult(published, target),
                warnings,
                appView: 'published-workbook-card' as const,
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return createAndPublishWorkbookTool;
};
