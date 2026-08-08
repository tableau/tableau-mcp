import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { getDefaultViewWebUrl } from '../utils/viewUrlUtils.js';

const paramsSchema = {
  uploadSessionId: z
    .string()
    .describe(
      'The upload session ID returned by a prior Initiate File Upload / Append to File Upload sequence. The workbook file must already be fully staged into this session.',
    ),
  name: z.string().describe('The name to give the published workbook.'),
  projectId: z.string().describe('The LUID of the project to publish the workbook into.'),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      'Whether to overwrite an existing workbook with the same name in the target project. Defaults to false.',
    ),
};

export const getPublishWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const publishWorkbookTool = new WebTool({
    server,
    name: 'publish-workbook',
    description: `
Publishes a workbook to a Tableau site by committing a file that was already staged into an upload session via a prior Initiate File Upload / Append to File Upload sequence. This tool publishes \`.twb\` (unpackaged workbook XML) uploads specifically.

**This tool does NOT validate the workbook before publishing.** It commits the upload session as-is. Tableau's Publish Workbook REST endpoint does not itself check the TWB's structural or semantic correctness — it only enforces things like file size limits, that not all views are hidden, and that connections are reachable. If you want a safety check before publishing, call the \`validate-uploaded-workbook\` tool (or the equivalent SDK method) against the same \`uploadSessionId\` first, then call this tool only if validation passes.

Returns the published workbook's metadata (including its new LUID) and a URL to view it.`,
    paramsSchema,
    annotations: {
      title: 'Publish Workbook',
      readOnlyHint: false,
      // Publishing creates new content. It only overwrites an existing workbook when the caller
      // explicitly passes `overwrite: true`, so it is not destructive by default.
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { uploadSessionId, name, projectId, overwrite },
      extra,
    ): Promise<CallToolResult> => {
      return await publishWorkbookTool.logAndExecute<{ data: Workbook; url: string }>({
        extra,
        args: { uploadSessionId, name, projectId, overwrite },
        callback: async () => {
          const workbook = await useRestApi({
            ...extra,
            jwtScopes: publishWorkbookTool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.workbooksMethods.publishWorkbook({
                siteId: restApi.siteId,
                uploadSessionId,
                // This tool only publishes unpackaged `.twb` workbook XML uploads; every
                // upload-staging path in this codebase produces a `.twb`, so the file type is
                // hardcoded rather than exposed as a caller-supplied param.
                workbookType: 'twb',
                name,
                projectId,
                overwrite,
              }),
          });

          return new Ok({
            data: workbook,
            url: '', // Placeholder, will be computed in constrainSuccessResult
          });
        },
        constrainSuccessResult: (result) => {
          const { data: workbook } = result;

          const url =
            getDefaultViewWebUrl(workbook, extra.config.server, extra.getSiteName()) ??
            workbook.webpageUrl ??
            '';

          return {
            type: 'success',
            result: {
              data: workbook,
              url,
            },
          };
        },
      });
    },
  });

  return publishWorkbookTool;
};
