import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ValidationResult } from '../../../desktop/externalApi/types.js';
import { wellFormedXmlRule } from '../../../desktop/validation/rules/wellFormedXml.js';
import { ValidationIssue } from '../../../desktop/validation/types.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  xml: z.string().describe(''),
};

type LocalValidationResult = {
  type: 'local';
  issues: ValidationIssue[];
};

type ServerValidationResult = {
  type: 'server';
  result: ValidationResult;
};

type WorkbookValidationResult = LocalValidationResult | ServerValidationResult;

const toolTitle = 'Check Workbook Structure';
export const getValidateWorkbookXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'validate-workbook-xml',
    title: toolTitle,
    description: 'Check workbook content before apply-workbook.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, xml }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<WorkbookValidationResult>({
        extra,
        args: { session, xml },
        callback: async () => {
          const localIssues = wellFormedXmlRule.validate(xml);
          if (localIssues.length > 0) {
            return new Ok({ type: 'local', issues: localIssues });
          }

          return await runExternalApiReadTool<WorkbookValidationResult>({
            toolName: tool.name,
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const result = await read(
                'workbook validation',
                async (executor, signal) => await executor.validateWorkbookDocument(xml, signal),
                { routeMissingError: workbookValidationEndpointMissing },
              );
              if (result.isErr()) {
                return result;
              }
              return new Ok({ type: 'server', result: result.value });
            },
          });
        },
        getSuccessResult: (validation) => {
          if (validation.type === 'server') {
            return {
              isError: !validation.result.isValid,
              content: [{ type: 'text', text: JSON.stringify(validation.result) }],
            };
          }

          const { issues } = validation;
          if (issues.length === 0) {
            return { content: [{ type: 'text', text: 'Workbook structure is well-formed.' }] };
          }
          const errorList = issues.map((issue, i) => `${i + 1}. ${issue.message}`).join('\n');
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Workbook structure has ${issues.length} error(s):\n\n${errorList}\n\nFix these errors before calling apply-workbook.`,
              },
            ],
          };
        },
      });
    },
  });
  return tool;
};

function workbookValidationEndpointMissing(): McpToolError {
  return new McpToolError({
    type: 'endpoint-not-in-this-build',
    message:
      'This Tableau Desktop build does not serve the workbook validation endpoint yet. ' +
      'Use get-app-info to identify the build; this validation lights up on a newer Desktop update. Do not retry.',
    statusCode: 404,
  });
}
