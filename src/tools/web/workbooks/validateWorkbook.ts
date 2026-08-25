import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ValidationIssue } from '../../../sdks/tableau/types/workbookValidation.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { getWorkbookFileType, resolveWorkbookInput } from './stagedWorkbookUpload.js';

const paramsSchema = {
  workbookUploadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Staged workbook upload id returned by request-workbook-upload. Use this for hosted clients that cannot pass a local path.',
    ),
  workbookFilePath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Path to a local TWB or TWBX workbook file on the MCP server filesystem. Only supported when staged S3 uploads are not configured.',
    ),
};

export type ValidationFinding = {
  severity: string;
  message: string;
  line: number;
  column: number;
  elementName: string;
};

export type ValidateWorkbookResult =
  | { status: 'invalid'; errors: ValidationFinding[]; warnings: ValidationFinding[] }
  | { status: 'valid'; warnings: ValidationFinding[] };

export const getValidateWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'validate-workbook',
    description:
      'Recommended second step of the publishing workflow, after upload-workbook and before publish-workbook: validates a TWB workbook from a local file path or staged upload id and returns any errors or warnings, without uploading a session for publishing or publishing it. Callers may skip straight from upload-workbook to publish-workbook if pre-publish validation is not needed. TWBX workbooks cannot be validated by Tableau ahead of publishing (Tableau can only validate the inner TWB XML, not extracts packaged inside a TWBX), so calling this on a TWBX is a no-op that always returns status "valid" with no warnings.',
    paramsSchema,
    annotations: {
      title: 'Validate Workbook',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('authoring-tools')),
    ),
    callback: async ({ workbookUploadId, workbookFilePath }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<ValidateWorkbookResult>({
        extra,
        args: {
          workbookUploadId: workbookUploadId ? '<redacted>' : undefined,
          workbookFilePath: workbookFilePath ? '<redacted>' : undefined,
        },
        callback: async () => {
          assertMinimumRestApiVersionSupported();

          const result = await useRestApi<ValidateWorkbookResult>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const resolvedWorkbookFile = await resolveWorkbookInput({
                config: extra.config.bucketS3,
                workbookUploadId,
                workbookFilePath,
              });
              const workbookType = getWorkbookFileType(resolvedWorkbookFile.fileName);
              if (!workbookType) {
                throw new UnknownError(
                  `Resolved workbook file "${resolvedWorkbookFile.fileName}" is neither a .twb nor a .twbx file.`,
                );
              }

              if (workbookType === 'twbx') {
                return { status: 'valid' as const, warnings: [] };
              }

              const validation = await restApi.workbooksMethods.validateWorkbookAndUpload({
                siteId: restApi.siteId,
                filename: resolvedWorkbookFile.fileName,
                workbook: resolvedWorkbookFile.bytes,
              });

              const errors = (validation.errors ?? []).map(toValidationFinding);
              const warnings = (validation.warnings ?? []).map(toValidationFinding);

              if (errors.length > 0) {
                return { status: 'invalid' as const, errors, warnings };
              }

              if (!validation.uploadId) {
                throw new UnknownError(
                  'Tableau validation succeeded but did not return an uploadId.',
                );
              }

              return { status: 'valid' as const, warnings };
            },
          });

          return new Ok(result);
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

function assertMinimumRestApiVersionSupported(): void {
  if (!RestApi.versionIsAtLeast('3.29')) {
    throw new UnknownError(
      `validate-workbook requires Tableau REST API version 3.29 or later (Tableau Server 2026.2+). The connected server is using REST API version ${RestApi.version}.`,
    );
  }
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
