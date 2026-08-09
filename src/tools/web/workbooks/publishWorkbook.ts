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
      'The validated upload session ID returned by start-web-authoring-session. The workbook file must already be fully staged into this session.',
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
Publishes a workbook to a Tableau site by committing the validated staged file associated with an \`uploadSessionId\` returned by \`start-web-authoring-session\`. This tool publishes \`.twb\` (unpackaged workbook XML) uploads specifically.

**This tool does NOT validate the workbook again before publishing.** Use the \`uploadSessionId\` from a successful \`start-web-authoring-session\` result, which is returned only after validation has no blocking errors. This publishes the staged TWB associated with that upload session; it does not capture later edits made in the browser's live Web Authoring session.

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
        args: { uploadSessionId: '<redacted>', name, projectId, overwrite },
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
