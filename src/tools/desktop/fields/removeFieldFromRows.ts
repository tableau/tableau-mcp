import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { removeFieldFromRows } from '../../../desktop/metadata/index.js';
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
  worksheetFile: z.string().describe('Worksheet XML cache file (from get-worksheet-xml).'),
  columnRef: z.string().describe('Column reference to remove.'),
};

const title = 'Remove Field from Rows Shelf';
export const getRemoveFieldFromRowsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const removeFieldFromRowsTool = new DesktopTool({
    server,
    name: 'remove-field-from-rows',
    title,
    description:
      'Remove a field from the rows shelf of a worksheet XML locally. Reads from and writes to cache file. Use apply-worksheet to apply changes.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async ({ worksheetFile, columnRef }, extra): Promise<CallToolResult> => {
      return await removeFieldFromRowsTool.logAndExecute({
        extra,
        args: { worksheetFile, columnRef },
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
            modifiedXml = removeFieldFromRows(worksheetXml, columnRef);
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
            message: `Successfully removed field from rows shelf. Updated file: ${worksheetFile}. Use apply-worksheet with this file to apply changes.`,
            file: worksheetFile,
          });
        },
      });
    },
  });

  return removeFieldFromRowsTool;
};
