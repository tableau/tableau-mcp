import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { endpointNotInThisBuild } from '../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { getDashboardXml, isRouteMissing } from '../../../desktop/wrappers/getDashboardXml.js';
import {
  DesktopCommandExecutionError,
  GetDashboardXmlFailedError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam, xmlModeParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { finishXmlRead, XmlReadFileResult } from './xmlReadResult.js';

const paramsSchema = {
  session: sessionParam(),
  dashboardName: artifactNameParam('dashboard'),
  mode: xmlModeParam(),
};

type InlineResult = { dashboardXml: string };
type GetDashboardXmlToolResult = ({ message: string } & InlineResult) | XmlReadFileResult;

const title = 'Reading dashboard';
export const getGetDashboardXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getDashboardXmlTool = new DesktopTool({
    server,
    name: 'get-dashboard-xml',
    title,
    description: 'Get layout for an existing dashboard.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // Writes to a cache file
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async ({ session, dashboardName, mode }, extra): Promise<CallToolResult> => {
      return await getDashboardXmlTool.logAndExecute<GetDashboardXmlToolResult>({
        extra,
        args: { session, dashboardName, mode },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const result = await getDashboardXml({
            dashboardName,
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'get-dashboard-xml-error':
                return new GetDashboardXmlFailedError(error).toErr();
              case 'execute-command-error':
                if (isRouteMissing(error)) {
                  return endpointNotInThisBuild('dashboard document').toErr();
                }
                return new DesktopCommandExecutionError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(String(error)).toErr();
              }
            }
          }

          return finishXmlRead({
            kind: 'dashboard',
            artifactKind: 'dashboard',
            label: `Dashboard "${dashboardName}"`,
            inlineKey: 'dashboardXml',
            toolName: 'get-dashboard-xml',
            applyTool: 'apply-dashboard',
            pathParam: 'dashboardFile',
            cacheName: dashboardName,
            xml: result.value,
            mode,
            capBytes: extra.config.inlineXmlMaxBytes,
            resolvedSession,
          });
        },
      });
    },
  });

  return getDashboardXmlTool;
};
