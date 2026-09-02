import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { artifactNameParam, sessionParam, xmlModeParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveDatasourceRef } from './resolveDatasourceRef.js';
import { finishXmlRead, XmlReadFileResult } from './xmlReadResult.js';

const paramsSchema = {
  session: sessionParam(),
  datasourceName: artifactNameParam('datasource'),
  mode: xmlModeParam(),
};

type InlineResult = { datasourceXml: string };
type GetDatasourceXmlToolResult = ({ message: string } & InlineResult) | XmlReadFileResult;

const title = 'Reading datasource';
export const getGetDatasourceXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-datasource-xml',
    title,
    description: 'Get the local workbook definition for one datasource by name or inventory id.',
    paramsSchema,
    minApiVersion: '0.2.10',
    annotations: {
      readOnlyHint: false, // Writes to a cache file
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async ({ session, datasourceName, mode }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<GetDatasourceXmlToolResult>({
        extra,
        args: { session, datasourceName, mode },
        callback: async () => {
          const datasource = await resolveDatasourceRef({ session, datasourceName, extra });
          if (datasource.isErr()) {
            return datasource;
          }
          const resolved = datasource.value;

          return await runExternalApiReadTool({
            session: resolved.resolvedSession,
            extra,
            callback: async (_executor, _signal, read, resolvedSession) => {
              const document = await read(
                'datasource document',
                async (executor, signal) =>
                  await executor.getDatasourceDocument(resolved.id, signal),
              );
              if (document.isErr()) {
                return document;
              }

              return finishXmlRead({
                kind: 'datasource',
                artifactKind: 'datasource',
                label: `Datasource "${resolved.name}"`,
                inlineKey: 'datasourceXml',
                toolName: 'get-datasource-xml',
                applyTool: 'apply-datasource',
                pathParam: 'datasourceFile',
                cacheName: resolved.name,
                xml: document.value.xml,
                mode,
                capBytes: extra.config.inlineXmlMaxBytes,
                resolvedSession,
              });
            },
          });
        },
      });
    },
  });

  return tool;
};
