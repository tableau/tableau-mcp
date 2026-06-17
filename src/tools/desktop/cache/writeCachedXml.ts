import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import { ArgsValidationError, FileReadError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  filePath: z
    .string()
    .describe('Path to cached XML file to write (e.g., returned by batch-create-and-cache-sheets).'),
  xmlContent: z.string().describe('XML content to write to the file.'),
};

function getCacheDir(): string {
  return dirname(new DesktopCache().getCacheFilePath({ prefix: '_', id: '_' }));
}

const toolTitle = 'Write Cached XML';
export const getWriteCachedXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'write-cached-xml',
    title: toolTitle,
    description:
      'Write XML content to a file in the cache directory. Use this to save manually constructed or modified XML back to cache files before applying with apply-* tools.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async ({ filePath, xmlContent }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { filePath, xmlContent },
        callback: async () => {
          const absolutePath = resolve(filePath);
          const cacheDir = resolve(getCacheDir());

          if (!absolutePath.startsWith(cacheDir)) {
            return new ArgsValidationError(
              `Security error: file path must be within cache directory.\n\nCache directory: ${cacheDir}\nRequested: ${absolutePath}`,
            ).toErr();
          }

          const issues = wellFormedXmlRule.validate(xmlContent);
          if (issues.length > 0) {
            const errorList = issues.map((issue, i) => `${i + 1}. ${issue.message}`).join('\n');
            return new ArgsValidationError(
              `XML validation failed with ${issues.length} error(s):\n\n${errorList}\n\nFix these errors before writing.`,
            ).toErr();
          }

          try {
            writeFileSync(absolutePath, xmlContent, 'utf-8');
            return new Ok({ filePath, bytes: xmlContent.length });
          } catch (err) {
            return new FileReadError(err).toErr();
          }
        },
        getSuccessResult: ({ filePath, bytes }) => ({
          content: [
            {
              type: 'text',
              text: `Wrote ${bytes} bytes to ${filePath}\n\nFile is ready to use with apply-* tools.`,
            },
          ],
        }),
      });
    },
  });
  return tool;
};
