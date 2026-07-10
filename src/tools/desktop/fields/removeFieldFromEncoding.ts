import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { removeFieldFromEncoding } from '../../../desktop/metadata/index.js';
import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import {
  FileNotFoundError,
  FileReadError,
  XmlModificationError,
  XmlValidationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  worksheetFile: z.string().describe('Worksheet XML cache.'),
  encodingType: z
    .enum(['color', 'size', 'lod', 'detail', 'text', 'tooltip', 'path', 'angle'])
    .describe("Encoding (use 'text' for labels)."),
  columnRef: z.string().describe('Column ref to remove.'),
};

const title = 'Remove Field from Encoding';
export const getRemoveFieldFromEncodingTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const removeFieldFromEncodingTool = new DesktopTool({
    server,
    name: 'remove-field-from-encoding',
    title,
    description:
      'Remove a field from an encoding on a worksheet XML locally. Reads from and writes to cache file. Use apply-worksheet to apply changes.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { worksheetFile, encodingType, columnRef },
      extra,
    ): Promise<CallToolResult> => {
      return await removeFieldFromEncodingTool.logAndExecute({
        extra,
        args: { worksheetFile, encodingType, columnRef },
        callback: async () => {
          if (!existsSync(worksheetFile)) {
            return new FileNotFoundError(worksheetFile).toErr();
          }

          let worksheetXml: string;
          try {
            worksheetXml = readFileSync(worksheetFile, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          let modifiedXml: string;
          try {
            modifiedXml = removeFieldFromEncoding(worksheetXml, encodingType, columnRef);
          } catch (error) {
            return new XmlModificationError(
              error instanceof Error ? error.message : String(error),
            ).toErr();
          }

          const issues = wellFormedXmlRule.validate(modifiedXml);
          const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
          if (errors.length > 0) {
            return new XmlValidationError(errors).toErr();
          }

          try {
            writeFileSync(worksheetFile, modifiedXml, 'utf-8');
          } catch (error) {
            return new FileReadError(error).toErr();
          }

          return new Ok({
            message: `Successfully removed field from ${encodingType} encoding. Updated file: ${worksheetFile}. Use apply-worksheet with this file to apply changes.`,
            file: worksheetFile,
          });
        },
      });
    },
  });

  return removeFieldFromEncodingTool;
};
