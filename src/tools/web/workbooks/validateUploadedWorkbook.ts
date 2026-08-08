import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WorkbookValidationResult } from '../../../sdks/tableau/types/workbookValidation.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  uploadSessionId: z
    .string()
    .describe(
      'The ID of the file upload session containing the workbook to validate. Obtained from a prior file-upload session (Initiate File Upload).',
    ),
};

export const getValidateUploadedWorkbookTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const validateUploadedWorkbookTool = new WebTool({
    server,
    name: 'validate-uploaded-workbook',
    description:
      'Validates a workbook that has been uploaded to the site via a file upload session. Returns the structural errors and warnings found by validation. An empty (or absent) errors list means the workbook is valid; a populated errors list is a normal validation outcome, not a tool failure.',
    paramsSchema,
    annotations: {
      title: 'Validate Uploaded Workbook',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    callback: async ({ uploadSessionId }, extra): Promise<CallToolResult> => {
      await extra.getConfigWithOverrides();

      return await validateUploadedWorkbookTool.logAndExecute<WorkbookValidationResult>({
        extra,
        args: { uploadSessionId },
        callback: async () => {
          const result = await useRestApi({
            ...extra,
            jwtScopes: validateUploadedWorkbookTool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.workbooksMethods.validateUploadedWorkbook({
                siteId: restApi.siteId,
                uploadSessionId,
              }),
          });

          return new Ok(result);
        },
        // Both an errors-present and an errors-absent result are legitimate validation
        // outcomes, so this always resolves to success — a populated `errors` array is
        // structured data for the model, not a tool failure.
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return validateUploadedWorkbookTool;
};
