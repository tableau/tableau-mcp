import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { useRestApi } from '../../../restApiInstance.js';
import { MAX_FILE_UPLOAD_CHUNK_BYTES } from '../../../sdks/tableau/methods/publishingMethods.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import {
  buildClientWorkbookUploadId,
  getWorkbookFileType,
  RequestClientWorkbookUploadResult,
} from './stagedWorkbookUpload.js';

const paramsSchema = {
  fileName: z
    .string()
    .min(1)
    .describe('Name of the Tableau workbook file to upload. Must end in .twb or .twbx.'),
};

export const getRequestWorkbookUploadTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'request-workbook-upload',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description: [
      'Starts a Tableau file upload session for a TWB or TWBX workbook so the client can upload the bytes directly to Tableau.',
      'PUT the workbook to uploadUrl with requiredHeaders and a multipart/mixed body (not multipart/form-data) of two parts: "request_payload" (text/xml, empty) and "tableau_file" (application/octet-stream, with the file name). For example:',
      "curl -fsS -X PUT -H 'Content-Type: multipart/mixed' -H '<each requiredHeaders entry>' -F 'request_payload=;type=text/xml' -F 'tableau_file=@<workbook file>;type=application/octet-stream' '<uploadUrl>'",
      'Files larger than maxChunkBytes must be split and PUT in order, one chunk per request, to the same uploadUrl. Then call publish-workbook with the returned workbookUploadId.',
    ].join('\n\n'),
    paramsSchema,
    annotations: {
      title: 'Request Workbook Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(async () => !(await isAuthoringAllowedForClient(server.clientId))),
    callback: async ({ fileName }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RequestClientWorkbookUploadResult>({
        extra,
        args: {
          fileName,
        },
        callback: async () => {
          if (extra.tableauAuthInfo?.type === 'Passthrough') {
            throw new UnknownError(
              'Staged workbook upload is not available for Passthrough authentication. Use OAuth or server-side authentication so the upload flow can enforce MCP authorization before issuing a signed upload URL.',
            );
          }

          const fileType = getWorkbookFileType(fileName);
          if (!fileType) {
            throw new ArgsValidationError('Workbook upload filename must end in .twb or .twbx.');
          }

          const { uploadSessionId, uploadUrl, authHeaders } = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            // The client appends with this session's token, so it must outlive the tool call.
            keepSignedIn: true,
            callback: async (restApi) =>
              restApi.publishingMethods.initiateClientFileUpload({ siteId: restApi.siteId }),
          });

          return new Ok({
            workbookUploadId: buildClientWorkbookUploadId(fileType, uploadSessionId),
            uploadUrl,
            requiredHeaders: authHeaders,
            maxChunkBytes: MAX_FILE_UPLOAD_CHUNK_BYTES,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};
