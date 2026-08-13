import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { Project } from '../../../sdks/tableau/types/project.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { ValidationIssue } from '../../../sdks/tableau/types/workbookValidation.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { type BucketS3Config } from '../s3Client.js';
import { WebTool } from '../tool.js';
import { getDefaultViewWebUrl } from '../utils/viewUrlUtils.js';
import { type ResolvedWorkbook, resolveStagedWorkbookUpload } from './stagedWorkbookUpload.js';

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
      'Path to a local TWB workbook file on the MCP server filesystem. Use this for local or stdio deployments.',
    ),
  name: z.string().describe('The name to give the published workbook.'),
  overwrite: z
    .boolean()
    .default(false)
    .describe(
      'Whether to overwrite an existing workbook with the same name in the target project. Defaults to false.',
    ),
};

export type ValidateUploadAndPublishWorkbookResult =
  | {
      status: 'published';
      data: Workbook;
      url: string;
      warnings: ValidationFinding[];
    }
  | {
      status: 'invalid';
      errors: ValidationFinding[];
      warnings: ValidationFinding[];
    };

type ValidationFinding = {
  severity: string;
  message: string;
  line: number;
  column: number;
  elementName: string;
};

export const getValidateUploadAndPublishWorkbookTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'validate-upload-and-publish-workbook',
    description:
      'Validates a TWB workbook with Tableau from a local file path or staged upload id, uploads it only when validation succeeds, and immediately publishes it to the site Default project. If validation returns blocking errors, the tool returns those findings and does not publish anything.',
    paramsSchema,
    annotations: {
      title: 'Validate, Upload, and Publish Workbook',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('authoring-tools')),
    ),
    callback: async (
      { workbookUploadId, workbookFilePath, name, overwrite = false },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<ValidateUploadAndPublishWorkbookResult>({
        extra,
        args: {
          workbookUploadId: workbookUploadId ? '<redacted>' : undefined,
          workbookFilePath: workbookFilePath ? '<redacted>' : undefined,
          name,
          overwrite,
        },
        callback: async () => {
          assertValidateWorkbookAndUploadSupported();

          const resolvedWorkbookFile = await resolveWorkbookInput({
            config: extra.config.bucketS3,
            workbookUploadId,
            workbookFilePath,
          });

          const result = await useRestApi<ValidateUploadAndPublishWorkbookResult>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
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
                  'Tableau validation succeeded but did not return an uploadId to publish.',
                );
              }

              const defaultProject = await getDefaultProject(restApi);
              const publishedWorkbook = await restApi.workbooksMethods.publishWorkbook({
                siteId: restApi.siteId,
                uploadSessionId: validation.uploadId,
                name,
                workbookType: 'twb',
                projectId: defaultProject.id,
                overwrite,
              });

              const url =
                getDefaultViewWebUrl(publishedWorkbook, extra.config.server, extra.getSiteName()) ??
                publishedWorkbook.webpageUrl ??
                '';

              return { status: 'published' as const, data: publishedWorkbook, url, warnings };
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

async function resolveWorkbookInput({
  config,
  workbookUploadId,
  workbookFilePath,
}: {
  config: BucketS3Config & { enabled: boolean };
  workbookUploadId?: string;
  workbookFilePath?: string;
}): Promise<ResolvedWorkbook> {
  if (workbookUploadId && workbookFilePath) {
    throw new UnknownError('Provide either workbookFilePath or workbookUploadId, not both.');
  }

  if (workbookFilePath) {
    return await resolveLocalWorkbookFile(workbookFilePath);
  }

  if (!workbookUploadId) {
    throw new UnknownError(
      'Either workbookFilePath or workbookUploadId must be provided. For local MCP servers, pass workbookFilePath. For hosted clients, call request-workbook-upload first and pass workbookUploadId.',
    );
  }
  if (!config.enabled) {
    throw new UnknownError(
      'MCP_S3_BUCKET must be configured before publishing staged workbook uploads.',
    );
  }
  return await resolveStagedWorkbookUpload({
    workbookUploadId,
    config,
  });
}

async function resolveLocalWorkbookFile(workbookFilePath: string): Promise<ResolvedWorkbook> {
  const fileName = basename(workbookFilePath);
  if (extname(fileName).toLowerCase() !== '.twb') {
    throw new UnknownError('workbookFilePath must point to a .twb file.');
  }

  const bytes = await readFile(workbookFilePath);
  if (bytes.byteLength === 0) {
    throw new UnknownError('workbookFilePath must not point to an empty workbook file.');
  }

  return { fileName, bytes };
}

function assertValidateWorkbookAndUploadSupported(): void {
  if (!RestApi.versionIsAtLeast('3.29')) {
    throw new UnknownError(
      `validate-upload-and-publish-workbook requires Tableau REST API version 3.29 or later (Tableau Server 2026.2+). The connected server is using REST API version ${RestApi.version}.`,
    );
  }
}

async function getDefaultProject(restApi: {
  siteId: string;
  projectsMethods: {
    queryProjects: (args: {
      siteId: string;
      filter: string;
      pageSize?: number;
      pageNumber?: number;
    }) => Promise<{ projects: Project[] }>;
  };
}): Promise<Project> {
  const { projects } = await restApi.projectsMethods.queryProjects({
    siteId: restApi.siteId,
    filter: 'name:eq:Default',
    pageSize: 100,
    pageNumber: 1,
  });
  const topLevelProjects = projects.filter((project) => project.parentProjectId === undefined);
  const defaultProject =
    topLevelProjects.find((project) => project.name === 'Default') ??
    topLevelProjects.find((project) => project.name.toLowerCase() === 'default');

  if (!defaultProject) {
    throw new UnknownError('Could not find the site Default project to publish the workbook.');
  }

  return defaultProject;
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
