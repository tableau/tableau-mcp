import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { findElement, sliceBytes } from '../../../desktop/xmlElement.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { getCacheDir, isWithinCacheDir } from './cachePath.js';

const paramsSchema = {
  filePath: z.string().describe('Cached working-copy file path.'),
  worksheet: z
    .string()
    .optional()
    .describe('Optional worksheet slice selector. One selector at a time.'),
  dashboard: z.string().optional().describe('Optional dashboard slice selector.'),
  startByte: z.number().int().min(0).optional().describe('Optional raw byte-slice start.'),
  endByte: z.number().int().min(0).optional().describe('Optional raw byte-slice end.'),
};

const toolTitle = 'Read Cached Working Copy';
export const getReadCachedXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'read-cached-xml',
    title: toolTitle,
    description:
      'Read cached worksheet, dashboard, or workbook content. For large files, pass exactly ONE selector: ' +
      'worksheet, dashboard, or startByte/endByte range.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { filePath, worksheet, dashboard, startByte, endByte },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { filePath, worksheet, dashboard, startByte, endByte },
        callback: async () => {
          const absolutePath = resolve(filePath);
          const cacheDir = getCacheDir();

          if (!isWithinCacheDir(absolutePath, cacheDir)) {
            return new ArgsValidationError(
              `Security error: file path must be within cache directory.\n\nCache directory: ${cacheDir}\nRequested: ${absolutePath}`,
            ).toErr();
          }

          // Reject ambiguous slice requests instead of silently prioritizing one selector.
          const selectorsReceived: string[] = [];
          if (worksheet !== undefined) selectorsReceived.push(`worksheet="${worksheet}"`);
          if (dashboard !== undefined) selectorsReceived.push(`dashboard="${dashboard}"`);
          if (startByte !== undefined || endByte !== undefined) {
            selectorsReceived.push(
              `byte range (startByte=${startByte ?? 0}, endByte=${endByte ?? 'end'})`,
            );
          }
          if (selectorsReceived.length > 1) {
            return new ArgsValidationError(
              `Multiple selectors provided: ${selectorsReceived.join(', ')}. Pass exactly one of ` +
                'worksheet, dashboard, or a startByte/endByte byte range so the slice is unambiguous — ' +
                're-call with a single selector.',
            ).toErr();
          }

          if (!existsSync(absolutePath)) {
            return new FileNotFoundError(filePath).toErr();
          }

          let fileContent: string;
          try {
            fileContent = readFileSync(absolutePath, 'utf-8');
          } catch (err) {
            return new FileReadError(err).toErr();
          }

          // Optional slice selectors keep large cached files out of context.
          let slice = fileContent;
          let sliceLabel = '';
          if (worksheet !== undefined) {
            const match = findElement(fileContent, 'worksheet', worksheet);
            if (!match) {
              return new ArgsValidationError(
                `No <worksheet name="${worksheet}"> element found in ${filePath}.`,
              ).toErr();
            }
            slice = match.text;
            sliceLabel = ` (worksheet "${worksheet}")`;
          } else if (dashboard !== undefined) {
            const match = findElement(fileContent, 'dashboard', dashboard);
            if (!match) {
              return new ArgsValidationError(
                `No <dashboard name="${dashboard}"> element found in ${filePath}.`,
              ).toErr();
            }
            slice = match.text;
            sliceLabel = ` (dashboard "${dashboard}")`;
          } else if (startByte !== undefined || endByte !== undefined) {
            slice = sliceBytes(fileContent, startByte, endByte);
            sliceLabel = ` (bytes ${startByte ?? 0}-${endByte ?? 'end'})`;
          }

          return new Ok({ filePath, bytes: slice.length, xml: slice, sliceLabel });
        },
        getSuccessResult: ({ filePath, bytes, xml, sliceLabel }) => ({
          content: [
            { type: 'text', text: `Read ${bytes} bytes from ${filePath}${sliceLabel}\n\n${xml}` },
          ],
        }),
      });
    },
  });
  return tool;
};
