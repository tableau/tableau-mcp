import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

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
      'Read an XML file from the cache directory. Use this to inspect worksheet, dashboard, or workbook XML from cache files before or after modifications.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ filePath }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { filePath },
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

          try {
            const xmlContent = readFileSync(absolutePath, 'utf-8');
            return new Ok({ filePath, bytes: xmlContent.length, xml: xmlContent });
          } catch (err) {
            return new FileReadError(err).toErr();
          }
        },
        getSuccessResult: ({ filePath, bytes, xml }) => ({
          content: [{ type: 'text', text: `Read ${bytes} bytes from ${filePath}\n\n${xml}` }],
        }),
      });
    },
  });
  return tool;
};
