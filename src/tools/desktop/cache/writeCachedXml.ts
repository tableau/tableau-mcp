import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import { replaceElement } from '../../../desktop/xmlElement.js';
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
    .describe(
      'Path to cached XML file to write (e.g., returned by batch-create-and-cache-sheets).',
    ),
  xmlContent: z
    .string()
    .describe(
      'XML to write. Without a selector this is the whole file. With a worksheet/dashboard ' +
        'selector this is just the replacement element, spliced into the existing file in place.',
    ),
  worksheet: z
    .string()
    .optional()
    .describe(
      'Optional: splice xmlContent in as the replacement for the <worksheet name="..."> element in ' +
        'the existing cached file, leaving the rest untouched. Lets a filesystem-less client save a ' +
        'targeted edit without holding the whole (large) workbook in context.',
    ),
  dashboard: z
    .string()
    .optional()
    .describe(
      'Optional: splice xmlContent in as the replacement for the <dashboard name="..."> element in ' +
        'the existing cached file.',
    ),
};

const toolTitle = 'Write Cached XML';
export const getWriteCachedXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'write-cached-xml',
    title: toolTitle,
    description:
      'Write XML content to a file in the cache directory. Use this to save manually constructed or ' +
      'modified XML back to cache files before applying with apply-* tools. For a large cached file, ' +
      'pass a worksheet/dashboard selector to splice just that element back in place — you only need ' +
      'to hold the one element in context, not the whole workbook.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { filePath, xmlContent, worksheet, dashboard },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { filePath, xmlContent, worksheet, dashboard },
        callback: async () => {
          const absolutePath = resolve(filePath);
          const cacheDir = getCacheDir();

          if (!isWithinCacheDir(absolutePath, cacheDir)) {
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

          // Targeted splice: replace only the selected element in the existing file so a
          // filesystem-less client never has to round-trip the whole (large) document.
          let contentToWrite = xmlContent;
          const selectorTag =
            worksheet !== undefined
              ? 'worksheet'
              : dashboard !== undefined
                ? 'dashboard'
                : undefined;
          const selectorName = worksheet ?? dashboard;
          if (selectorTag !== undefined && selectorName !== undefined) {
            if (!existsSync(absolutePath)) {
              return new FileNotFoundError(filePath).toErr();
            }
            let existing: string;
            try {
              existing = readFileSync(absolutePath, 'utf-8');
            } catch (err) {
              return new FileReadError(err).toErr();
            }
            const spliced = replaceElement(existing, selectorTag, selectorName, xmlContent);
            if (spliced === null) {
              return new ArgsValidationError(
                `No <${selectorTag} name="${selectorName}"> element found in ${filePath}; nothing was written.`,
              ).toErr();
            }
            contentToWrite = spliced;
          }

          try {
            writeFileSync(absolutePath, contentToWrite, 'utf-8');
            return new Ok({
              filePath,
              bytes: contentToWrite.length,
              spliced: selectorTag !== undefined,
            });
          } catch (err) {
            return new FileReadError(err).toErr();
          }
        },
        getSuccessResult: ({ filePath, bytes, spliced }) => ({
          content: [
            {
              type: 'text',
              text: `${spliced ? 'Spliced edit into' : 'Wrote'} ${bytes} bytes ${spliced ? 'in' : 'to'} ${filePath}\n\nFile is ready to use with apply-* tools.`,
            },
          ],
        }),
      });
    },
  });
  return tool;
};
