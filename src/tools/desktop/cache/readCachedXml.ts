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
  filePath: z
    .string()
    .describe('Path to cached XML file (e.g., returned by batch-create-and-cache-sheets).'),
  worksheet: z
    .string()
    .optional()
    .describe(
      'Optional: return only the <worksheet name="..."> element (a slice), not the whole file. ' +
        'Use this to inspect one worksheet of a large cached workbook without pulling it all into context.',
    ),
  dashboard: z
    .string()
    .optional()
    .describe(
      'Optional: return only the <dashboard name="..."> element (a slice), not the whole file.',
    ),
  startByte: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional: return only bytes [startByte, endByte) of the file (a raw slice).'),
  endByte: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional: end (exclusive) of the byte range. Defaults to end of file.'),
};

const toolTitle = 'Read Cached XML';
export const getReadCachedXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'read-cached-xml',
    title: toolTitle,
    description:
      'Read an XML file from the cache directory. Use this to inspect worksheet, dashboard, or ' +
      'workbook XML from cache files before or after modifications. For a large cached file, pass a ' +
      'worksheet/dashboard selector (or startByte/endByte) to read just a slice instead of the whole ' +
      'file — this is how a client with no local filesystem edits a capped workbook without pulling it ' +
      'all into context.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
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
