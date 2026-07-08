import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { formatArtifactSummary } from '../../../desktop/artifactSummary.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { getWorksheetXml } from '../../../desktop/commands/workbook/getWorksheetXml.js';
import {
  buildInlineCapFileMessage,
  isOverInlineXmlCap,
  logInlineXmlCapHit,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Session ID from list-instances.'),
  worksheetName: z.string().describe('Existing worksheet name.'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe('file writes cache path; inline returns XML.'),
};

type InlineResult = {
  worksheetXml: string;
};

type FileResult = {
  file: string;
  instructions: string;
};

type GetWorksheetXmlToolResult = { message: string } & (InlineResult | FileResult);

const title = 'Get Worksheet XML';
export const getGetWorksheetXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorksheetXmlTool = new DesktopTool({
    server,
    name: 'get-worksheet-xml',
    title,
    description: [
      'Get XML for an existing worksheet. mode=file is default; mode=inline returns XML.',
      'IMPORTANT: only works for an existing worksheet (see list-worksheets). Prefer the field tools over editing XML directly. Use apply-worksheet to apply changes.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
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
          const executor = await extra.getExecutor(session);
          const result = await getWorksheetXml({ worksheetName, executor, signal: extra.signal });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'get-worksheet-xml-error':
                return new GetWorksheetXmlFailedError(error).toErr();
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(error).toErr();
              }
            }
          }

          const worksheetXml = result.value;
          const bytes = xmlByteLength(worksheetXml);
          const capBytes = extra.config.inlineXmlMaxBytes;
          const capFired = mode === 'inline' && isOverInlineXmlCap(bytes, capBytes);

          if (mode === 'inline' && !capFired) {
            return new Ok({
              message: `Worksheet XML returned inline (${bytes} bytes)`,
              worksheetXml,
            });
          }

          const safeName = worksheetName.replace(/[^a-zA-Z0-9]/g, '_');
          const cacheFile = new DesktopCache().getCacheFilePath({
            prefix: `worksheet-${safeName}`,
          });
          writeFileSync(cacheFile, worksheetXml, 'utf-8');

          if (capFired) {
            logInlineXmlCapHit({ tool: 'get-worksheet-xml', bytes, capBytes, file: cacheFile });
            return Ok({
              message: buildInlineCapFileMessage({
                kind: 'worksheet',
                label: `Worksheet "${worksheetName}"`,
                bytes,
                capBytes,
                xml: worksheetXml,
              }),
              file: cacheFile,
              instructions:
                'This worksheet exceeds the inline cap. Use read-cached-xml (with a worksheet ' +
                'selector or startByte/endByte to read a slice), write-cached-xml (same selector to ' +
                'splice edits back), then apply-worksheet with mode=file. Do not request mode=inline.',
            });
          }

          log({
            message: `Saved worksheet XML to cache file: ${cacheFile}`,
            level: 'info',
            logger: 'tool',
            data: {
              file: cacheFile,
              size: bytes,
            },
          });

          return Ok({
            message: `Worksheet "${worksheetName}" saved to cache file (${bytes} bytes)\n\nArtifact summary:\n${formatArtifactSummary('worksheet', worksheetXml)}`,
            file: cacheFile,
            instructions:
              'Use this file path with modification tools instead of passing XML directly.',
          });
        },
      });
    },
  });

  return getWorksheetXmlTool;
};
