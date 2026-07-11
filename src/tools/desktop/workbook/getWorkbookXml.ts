import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { formatArtifactSummary } from '../../../desktop/artifactSummary.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import {
  buildInlineCapFileMessage,
  isOverInlineXmlCap,
  logInlineXmlCapHit,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe('file writes cache path; inline returns XML.'),
};

type InlineResult = {
  workbookXml: string;
};

type FileResult = {
  file: string;
  instructions: string;
};
type GetWorkbookXmlToolResult = { message: string } & (InlineResult | FileResult);

const title = 'Get Workbook XML';
export const getGetWorkbookXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorkbookXmlTool = new DesktopTool({
    server,
    name: 'get-workbook-xml',
    title,
    description: [
      'Get current workbook XML. mode=file is default; mode=inline returns XML.',
      'PREFERRED: use the field tools (add-field/remove-field) or batch-create-and-cache-sheets instead of editing XML directly; edit XML only as a last resort. Use apply-workbook to apply changes.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
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

          const workbookXml = result.value;
          const bytes = xmlByteLength(workbookXml);
          const capBytes = extra.config.inlineXmlMaxBytes;
          // Server-enforced cap: inline requests over the cap are downgraded to file mode
          // so ~40KB documents never ride in the conversation (the measured token sink).
          const capFired = mode === 'inline' && isOverInlineXmlCap(bytes, capBytes);

          if (mode === 'inline' && !capFired) {
            return new Ok({
              message: `Workbook XML returned inline (${bytes} bytes)`,
              workbookXml,
            });
          }

          // Save to cache file (requested file mode, or forced by the cap).
          const cacheFile = new DesktopCache().getCacheFilePath({ prefix: 'workbook' });
          writeFileSync(cacheFile, workbookXml, 'utf-8');

          if (capFired) {
            logInlineXmlCapHit({ tool: 'get-workbook-xml', bytes, capBytes, file: cacheFile });
            return Ok({
              message: buildInlineCapFileMessage({
                kind: 'workbook',
                label: 'Workbook',
                bytes,
                capBytes,
                xml: workbookXml,
              }),
              file: cacheFile,
              instructions:
                'This workbook exceeds the inline cap. Use read-cached-xml (with a worksheet/dashboard ' +
                'selector or startByte/endByte to read a slice), write-cached-xml (same selector to ' +
                'splice edits back), then apply-workbook with mode=file. Do not request mode=inline.',
            });
          }

          log({
            message: `Saved workbook XML to cache file: ${cacheFile}`,
            level: 'info',
            logger: 'tool',
            data: {
              file: cacheFile,
              size: bytes,
            },
          });

          return Ok({
            message: `Workbook saved to cache file (${bytes} bytes)\n\nArtifact summary:\n${formatArtifactSummary('workbook', workbookXml)}`,
            file: cacheFile,
            instructions:
              'Use this file path with modification tools instead of passing XML directly.',
          });
        },
      });
    },
  });

  return getWorkbookXmlTool;
};
