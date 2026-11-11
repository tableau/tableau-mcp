import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { parseXML } from '../../../desktop/metadata/parser.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import {
  artifactNameParam,
  deprecatedArtifactAliasParam,
  resolveArtifactNameArg,
  sessionParam,
  xmlModeParam,
} from '../params.js';
import { DesktopTool } from '../tool.js';
import { finishXmlRead, XmlReadFileResult } from './xmlReadResult.js';

const paramsSchema = {
  session: sessionParam(),
  storyboardName: artifactNameParam('storyboard').optional(),
  storyboard: deprecatedArtifactAliasParam('storyboard'),
  mode: xmlModeParam(),
};
const title = 'Get Storyboard Document';

type InlineResult = { storyboardXml: string };
type GetStoryboardXmlToolResult = ({ message: string } & InlineResult) | XmlReadFileResult;

export const getStoryboardXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getStoryboardXml = new DesktopTool({
    server,
    name: 'get-storyboard-xml',
    title,
    description: 'Return one storyboard document subtree.',
    paramsSchema,
    annotations: {
      readOnlyHint: false, // Writes to a cache file
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, storyboardName, storyboard, mode },
      extra,
    ): Promise<CallToolResult> => {
      return await getStoryboardXml.logAndExecute<GetStoryboardXmlToolResult>({
        extra,
        args: { session, storyboardName, storyboard, mode },
        callback: async () => {
          const nameResult = resolveArtifactNameArg('storyboard', storyboardName, storyboard);
          if (nameResult.isErr()) {
            return nameResult;
          }
          const resolvedStoryboardName = nameResult.value;
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read, resolvedSession) => {
              // A storyboard serializes as a `<dashboard type='storyboard'>`, and its
              // `/document` route returns that bare fragment directly. Resolve the name
              // to an id, then fetch the document.
              const listResult = await read(
                'storyboard list',
                async (executor, signal) => await executor.listStoryboards(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const storyboardResult = resolveItemByNameOrId(
                'Storyboard',
                resolvedStoryboardName,
                listResult.value.storyboards ?? [],
              );
              if (storyboardResult.isErr()) {
                return storyboardResult.error.toErr();
              }
              const resolved = storyboardResult.value;

              const documentResult = await read(
                'storyboard document',
                async (executor, signal) =>
                  await executor.getStoryboardDocument(resolved.id, signal),
              );
              if (documentResult.isErr()) {
                return documentResult;
              }

              const storyboardXml = documentResult.value.xml;
              if (!parseXML(storyboardXml).dashboard) {
                return new UnknownError(
                  `No storyboard document subtree found for "${resolvedStoryboardName}".`,
                ).toErr();
              }

              return finishXmlRead({
                kind: 'storyboard',
                // A storyboard has no dedicated ArtifactKind; it shares the dashboard summary shape.
                artifactKind: 'dashboard',
                label: `Storyboard "${resolved.name}"`,
                inlineKey: 'storyboardXml',
                toolName: 'get-storyboard-xml',
                applyTool: 'apply-storyboard',
                pathParam: 'storyboardFile',
                cacheName: resolved.name,
                xml: storyboardXml,
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

  return getStoryboardXml;
};
