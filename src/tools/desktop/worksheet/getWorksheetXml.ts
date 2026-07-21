import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { formatArtifactSummary } from '../../../desktop/artifactSummary.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import {
  getWorksheetXml,
  isRouteMissing,
} from '../../../desktop/commands/workbook/getWorksheetXml.js';
import {
  buildInlineCapFileMessage,
  isOverInlineXmlCap,
  logInlineXmlCapHit,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  McpToolError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional(),
  worksheetName: z.string(),
  mode: z.enum(['file', 'inline']).optional().default('file'),
};

type InlineResult = {
  worksheetXml: string;
};

type FileResult = {
  file: string;
  instructions: string;
};

type GetWorksheetXmlToolResult = { message: string } & (InlineResult | FileResult);

const title = 'Get Worksheet Structure';
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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const result = await getWorksheetXml({ worksheetName, executor, signal: extra.signal });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'get-worksheet-xml-error':
                return new GetWorksheetXmlFailedError(error).toErr();
              case 'execute-command-error':
                if (isRouteMissing(error)) {
                  return new McpToolError({
                    type: 'endpoint-not-in-this-build',
                    message:
                      'This Tableau Desktop build does not serve the worksheet document endpoint yet. ' +
                      'Use get-app-info to identify the build; this read lights up on a newer Desktop update. Do not retry.',
                    statusCode: 404,
                  }).toErr();
                }
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
              message: `Worksheet content returned inline (${bytes} bytes)`,
              worksheetXml,
            });
          }

          const safeName = worksheetName.replace(/[^a-zA-Z0-9]/g, '_');
          const cacheFile = new DesktopCache().getCacheFilePath({
            prefix: `worksheet-${safeName}`,
          });
          writeFileSync(cacheFile, worksheetXml, 'utf-8');
          // Stamp the producing session so apply-worksheet can refuse a cache from a
          // different (or restarted) Desktop instance — cross-instance bleed guard (W9).
          writeSidecar(cacheFile, resolvedSession);

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
                'This worksheet exceeds the inline cap. Use the cache read tool (with a worksheet ' +
                'selector or startByte/endByte to read a slice), the cache write tool (same selector to ' +
                'splice edits back), then apply-worksheet with mode=file. Do not request mode=inline.',
            });
          }

          log({
            message: `Saved worksheet content to cache file: ${cacheFile}`,
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
              'Use this file path with modification tools instead of passing content directly.',
          });
        },
      });
    },
  });

  return getWorksheetXmlTool;
};
