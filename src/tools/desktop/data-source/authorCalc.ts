import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import {
  authorCalculationsInWorkbook,
  datatypeSchema,
  resolveCaptionReferencesForTest,
  roleSchema,
} from './authorCalcCore.js';

const paramsSchema = {
  session: z.string().optional(),
  caption: z.string(),
  formula: z.string(),
  role: roleSchema.default('measure'),
  datatype: datatypeSchema.default('real'),
  datasource: z.string().optional(),
};

type AuthorCalcResult = {
  calcName: string;
  caption: string;
  datasource: string;
  hint: string;
};

const title = 'Author Calc';
export const getAuthorCalcTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'author-calc',
    title,
    description: 'Author a calculated field (caption + formula).',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, caption, formula, role = 'measure', datatype = 'real', datasource },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<AuthorCalcResult>({
        extra,
        args: { session, caption, formula, role, datatype, datasource },
        callback: async () => {
          if (caption.trim().length === 0) {
            return new ArgsValidationError('caption empty').toErr();
          }
          if (formula.trim().length === 0) {
            return new ArgsValidationError('formula empty').toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          const readResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (readResult.isErr()) {
            return new DesktopCommandExecutionError(readResult.error).toErr();
          }

          const authored = await authorCalculationsInWorkbook({
            workbookXml: readResult.value,
            calcs: [{ caption, formula, role, datatype }],
            datasource,
            executor,
            signal: extra.signal,
            labelErrors: false,
          });
          if (authored.isErr()) {
            return authored.error.toErr();
          }
          const calc = authored.value.authoredCalcs[0];

          return new Ok({
            calcName: calc.calcName,
            caption: calc.caption,
            datasource: calc.datasource,
            hint: 'reference it by caption in a bind-template ask (name the caption plus a chart shape), auto_apply: true',
          });
        },
      });
    },
  });

  return tool;
};

export { resolveCaptionReferencesForTest };
