import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { UnsupportedWebAuthoringAuthError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { ValidationIssue } from '../../../sdks/tableau/types/workbookValidation.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { WebTool } from '../tool.js';
import { resolveLocalWorkbook } from './localWorkbookFile.js';
import { stageWorkbookForWebAuthoring } from './stageWorkbookForWebAuthoring.js';

const paramsSchema = {
  workbookFilePath: z
    .string()
    .min(1)
    .describe('Absolute path to a local Tableau workbook (.twb) file accessible to the MCP server'),
};

export type ValidationFinding = {
  severity: string;
  message: string;
  line: number;
  column: number;
  elementName: string;
};

export type StartWebAuthoringSessionResult =
  | {
      status: 'ready';
      url: string;
      uploadSessionId: string;
      warnings: ValidationFinding[];
    }
  | {
      status: 'invalid';
      errors: ValidationFinding[];
      warnings: ValidationFinding[];
    };

export const getStartWebAuthoringSessionTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'start-web-authoring-session',
    description:
      'Starts a live, unsaved Tableau Web Authoring session from a local TWB file. The tool reads the bounded local file, stages and validates it through Tableau temporary upload APIs, and returns an authoring URL and uploadSessionId only when validation has no blocking errors. Pass that uploadSessionId to publish-workbook to publish the validated staged TWB. This tool never publishes or saves the workbook.',
    paramsSchema,
    annotations: {
      title: 'Start Web Authoring Session',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    callback: async ({ workbookFilePath }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<StartWebAuthoringSessionResult>({
        extra,
        args: { workbookFilePath: '<redacted>' },
        callback: async () => {
          if (!isSupportedWebAuthoringAuth(extra.tableauAuthInfo?.type)) {
            return new UnsupportedWebAuthoringAuthError().toErr();
          }

          const workbook = await resolveLocalWorkbook(workbookFilePath);
          const tableauServer = extra.config.server || extra.tableauAuthInfo?.server;
          invariant(tableauServer, 'Tableau server could not be determined.');

          const stagedWorkbook = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) =>
              await stageWorkbookForWebAuthoring({
                restApi,
                server: tableauServer,
                siteName: extra.getSiteName(),
                workbookBytes: workbook.bytes,
                workbookFileName: workbook.fileName,
              }),
          });

          return Ok(toStartWebAuthoringSessionResult(stagedWorkbook));
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};

export function toStartWebAuthoringSessionResult({
  uploadSessionId,
  validation,
  authoringUrl,
}: Awaited<ReturnType<typeof stageWorkbookForWebAuthoring>>): StartWebAuthoringSessionResult {
  const errors = (validation.errors ?? []).map(toValidationFinding);
  const warnings = (validation.warnings ?? []).map(toValidationFinding);

  if (errors.length > 0) {
    return { status: 'invalid', errors, warnings };
  }

  return { status: 'ready', url: authoringUrl, uploadSessionId, warnings };
}

function isSupportedWebAuthoringAuth(
  authType: 'Bearer' | 'X-Tableau-Auth' | 'Passthrough' | undefined,
): boolean {
  return authType === 'Bearer' || authType === 'X-Tableau-Auth' || authType === 'Passthrough';
}

function toValidationFinding(issue: ValidationIssue): ValidationFinding {
  return {
    severity: sanitizeFindingText(issue.severity, 100),
    message: sanitizeFindingText(issue.message, 2_000),
    line: issue.line,
    column: issue.column,
    elementName: sanitizeFindingText(issue.elementName, 255),
  };
}

function sanitizeFindingText(value: string, maxLength: number): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .slice(0, maxLength);
}
