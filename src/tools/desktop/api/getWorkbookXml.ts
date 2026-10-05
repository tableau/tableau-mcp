import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { getWorkbookXml } from '../../../desktop/wrappers/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam, xmlModeParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { finishXmlRead, XmlReadFileResult } from './xmlReadResult.js';

const paramsSchema = {
  session: sessionParam(),
  mode: xmlModeParam(),
};

type InlineResult = {
  workbookXml: string;
};

type GetWorkbookXmlToolResult = ({ message: string } & InlineResult) | XmlReadFileResult;

const title = 'Reading workbook';
export const getGetWorkbookXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorkbookXmlTool = new DesktopTool({
    server,
    name: 'get-workbook-xml',
    title,
    description: 'Get current workbook structure.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // Writes to a cache file
      openWorldHint: false,
      destructiveHint: false, // A new cache file is created for each tool call
      idempotentHint: false, // A new cache file is created for each tool call
    },
    callback: async ({ session, mode }, extra): Promise<CallToolResult> => {
      return await getWorkbookXmlTool.logAndExecute<GetWorkbookXmlToolResult>({
        extra,
        args: { session, mode },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const result = await getWorkbookXml({ executor, signal: extra.signal });

          if (result.isErr()) {
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return finishXmlRead({
            kind: 'workbook',
            artifactKind: 'workbook',
            label: 'Workbook',
            inlineKey: 'workbookXml',
            toolName: 'get-workbook-xml',
            applyTool: 'apply-workbook',
            pathParam: 'workbookFile',
            xml: result.value,
            mode,
            capBytes: extra.config.inlineXmlMaxBytes,
            resolvedSession,
          });
        },
      });
    },
  });

  return getWorkbookXmlTool;
};
