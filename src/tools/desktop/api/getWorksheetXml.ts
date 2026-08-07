import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { endpointNotInThisBuild } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { getWorksheetXml, isRouteMissing } from '../../../desktop/wrappers/getWorksheetXml.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam, xmlModeParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { finishXmlRead, XmlReadFileResult } from './xmlReadResult.js';

const paramsSchema = {
  session: sessionParam(),
  worksheetName: artifactNameParam('worksheet'),
  mode: xmlModeParam(),
};

type InlineResult = {
  worksheetXml: string;
};

type GetWorksheetXmlToolResult = ({ message: string } & InlineResult) | XmlReadFileResult;

const title = 'Reading worksheet';
export const getGetWorksheetXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorksheetXmlTool = new DesktopTool({
    server,
    name: 'get-worksheet-xml',
    title,
    description: 'Get structure for an EXISTING worksheet.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // Writes to a cache file
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false, // A new cache file is created for each tool call
    },
    callback: async ({ session, worksheetName, mode }, extra): Promise<CallToolResult> => {
      return await getWorksheetXmlTool.logAndExecute<GetWorksheetXmlToolResult>({
        extra,
        args: { session, worksheetName, mode },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const result = await getWorksheetXml({
            worksheetName,
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'get-worksheet-xml-error':
                return new GetWorksheetXmlFailedError(error).toErr();
              case 'execute-command-error':
                if (isRouteMissing(error)) {
                  return endpointNotInThisBuild('worksheet document').toErr();
                }
                return new DesktopCommandExecutionError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }

          return finishXmlRead({
            kind: 'worksheet',
            artifactKind: 'worksheet',
            label: `Worksheet "${worksheetName}"`,
            inlineKey: 'worksheetXml',
            toolName: 'get-worksheet-xml',
            applyTool: 'apply-worksheet',
            pathParam: 'worksheetFile',
            cacheName: worksheetName,
            xml: result.value,
            mode,
            capBytes: extra.config.inlineXmlMaxBytes,
            resolvedSession,
          });
        },
      });
    },
  });

  return getWorksheetXmlTool;
};
